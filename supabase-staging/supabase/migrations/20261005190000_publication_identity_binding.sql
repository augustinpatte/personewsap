-- Publication identity binding — STAGING.
--
-- THE RACE
--
-- get_scheduled_edition_publish_plan asks two questions in two statements:
--   1. assert_edition_publishable(date): for each job, the output at
--      attempt = attempt_count (latest submitted_at) and its latest review —
--      verdict, score >= 90, six checks, deterministic revalidation;
--   2. get_ready_batch_payload(date): the canonical payload, which picks each
--      job's output and review again, on its own.
-- The plan then checked the payload's batch, date, kind, target, composition
-- and that every job had SOME output and an approved review — never that it
-- was the output and review the gate had just judged. A newer output (or a
-- later review) landing between the two statements could be published under
-- the earlier one's verdict.
--
-- THE FIX
--
-- 1. The gate returns what it judged: verified_identities, one
--    {job_id, output_id, output_attempt, review_id} per job, and a digest of
--    the sorted triples. Returned, not stored: no mutable intermediate state.
-- 2. bind_payload_to_verified_identities(gate, payload) refuses with
--    verified_payload_identity_mismatch unless both sides name exactly the same
--    23 jobs, once each, and every payload job carries the verified output
--    (its id when the payload names one; its output_json and source_records
--    byte-equal) and the verified review (its id when named; verdict, score
--    and checks equal). On success it stamps output_id, output_attempt and
--    review_id on each job and the digest on the batch, so production records
--    the provenance (staging_output_id / staging_review_id).
-- 3. The plan runs the binding before its only success return.
--
-- Restated in full (no text patching): assert_edition_publishable as
-- 20260901090000 defined it, and get_scheduled_edition_publish_plan as
-- 20260906110000 defined it plus the payload declaration 20260907180000
-- patched in. Every rule, threshold and refusal is unchanged; only the identity
-- record, the binding and its refusal are added. get_ready_batch_payload (live
-- only, not versioned) is not touched.
--
-- Proved by supabase-staging/supabase/tests/publication_identity_binding.test.sql.
-- Forward-only.

begin;

-- ---------------------------------------------------------------------------
-- 1. The gate, now naming what it verified
-- ---------------------------------------------------------------------------

create or replace function public.assert_edition_publishable(p_edition_date date)
returns jsonb
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_production_ref constant text := 'wkbviidrbmehmjbhvpeh';
  c_expected_jobs constant integer := 23;
  c_newsletter_jobs constant integer := 16;
  c_business_story_jobs constant integer := 1;
  c_mini_case_jobs constant integer := 6;
  c_newsletter_topics constant text[] := array[
    'business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'
  ];
  c_mini_case_topics constant text[] := array[
    'finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'
  ];
  c_required_checks constant text[] := array[
    'source_grounding','factual_accuracy','safety','schema','fr_en_parity','novelty_anti_repetition'
  ];

  v_expected_kind text;
  v_batch public.automation_batches%rowtype;
  v_receipt public.publication_receipts%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_blocking_jobs jsonb := '[]'::jsonb;
  v_status_counts jsonb := '{}'::jsonb;
  v_total integer := 0;
  v_approved integer := 0;
  v_news integer := 0;
  v_story integer := 0;
  v_mini integer := 0;
  v_job record;
  v_output public.generation_outputs%rowtype;
  v_review public.generation_reviews%rowtype;
  v_check text;
  v_validation jsonb;
  v_topic_counts jsonb;
  v_found_mini_topics text[];
  v_dup record;
  v_status_before text;
  v_refreshed_status text;
  -- 20261005190000: the exact rows this gate judged, one per job.
  v_verified jsonb := '[]'::jsonb;
begin
  -- (a) The calendar decides the kind. Nothing else gets a vote.
  v_expected_kind := public.resolve_staging_edition_kind(p_edition_date);

  if v_expected_kind is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'quiet_day',
      'edition_date', p_edition_date,
      'expected_edition_kind', null,
      'already_published', false,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','quiet_day',
        'detail', format('%s is not a PersoNews publication day', to_char(p_edition_date,'Dy DD Mon YYYY'))
      ))
    );
  end if;

  -- (b) The batch. Latest wins, but it still has to be the right one.
  select * into v_batch
  from public.automation_batches
  where edition_date = p_edition_date
    and edition_kind = v_expected_kind
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'batch_not_found',
      'edition_date', p_edition_date,
      'expected_edition_kind', v_expected_kind,
      'already_published', false,
      'blockers', jsonb_build_array(jsonb_build_object(
        'code','batch_not_found',
        'detail', format('no %s batch exists for %s', v_expected_kind, p_edition_date)
      ))
    );
  end if;

  -- (c) Already published? That is a success, not a failure: the caller must
  -- no-op rather than retry. Reported separately from the blocker list.
  select * into v_receipt
  from public.publication_receipts
  where batch_id = v_batch.id
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_published',
      'already_published', true,
      'edition_date', p_edition_date,
      'expected_edition_kind', v_expected_kind,
      'edition_kind', v_batch.edition_kind,
      'batch_id', v_batch.id,
      'batch_status', v_batch.status,
      'receipt', jsonb_build_object(
        'id', v_receipt.id,
        'production_project_ref', v_receipt.production_project_ref,
        'production_run_id', v_receipt.production_run_id,
        'published_at', v_receipt.published_at
      ),
      'blockers', '[]'::jsonb
    );
  end if;

  -- (c-bis) `automation_batches.status` is a cache, not a fact.
  --
  -- It is maintained by `refresh_batch_status`, which the workers call after each
  -- submission and each review. A worker that crashed between approving the last
  -- job and refreshing the batch leaves 23 genuinely approved jobs behind a batch
  -- row still saying `reviewing` — and the edition would then be silently skipped
  -- for a bookkeeping reason, which is the one failure mode nobody would think to
  -- look for at 19:05.
  --
  -- So the gate recomputes the cache from the jobs themselves before reading it.
  -- This is not a relaxation: `refresh_batch_status` derives the status purely
  -- from `generation_jobs`, so it downgrades a batch wrongly marked `ready` just
  -- as readily as it promotes one wrongly left `reviewing`, and every other check
  -- below still runs against the jobs directly rather than against this field.
  --
  -- A `published` batch is deliberately left alone: `refresh_batch_status` knows
  -- nothing about publication and would demote it back to `ready`, undoing the
  -- marker. That row is already handled by the receipt check above; this is the
  -- belt to its braces.
  v_status_before := v_batch.status;

  if v_batch.status <> 'published' then
    v_refreshed_status := public.refresh_batch_status(v_batch.id);

    select * into v_batch
    from public.automation_batches
    where id = v_batch.id;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'reason', 'batch_vanished',
        'already_published', false,
        'edition_date', p_edition_date,
        'expected_edition_kind', v_expected_kind,
        'blockers', jsonb_build_array(jsonb_build_object(
          'code','batch_vanished',
          'detail','the batch disappeared between selection and refresh')));
    end if;
  end if;

  -- (d) Batch-level identity.
  if v_batch.edition_date <> p_edition_date then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','edition_date_mismatch',
      'detail', format('batch is dated %s, expected %s', v_batch.edition_date, p_edition_date)));
  end if;

  if v_batch.edition_kind is distinct from v_expected_kind then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','edition_kind_mismatch',
      'detail', format('batch kind is %s, calendar says %s', v_batch.edition_kind, v_expected_kind)));
  end if;

  -- Named explicitly rather than left to the mismatch above: `test` and
  -- `regular` batches are the two shapes that must never reach readers, and a
  -- blocker code that says so is worth more than one that says "mismatch".
  if v_batch.edition_kind in ('test','regular') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','edition_kind_forbidden',
      'detail', format('batch kind %s is never publishable', v_batch.edition_kind)));
  end if;

  if v_batch.edition_kind not in ('daily','weekly_digest') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','edition_kind_unsupported',
      'detail', format('batch kind %s is not daily or weekly_digest', v_batch.edition_kind)));
  end if;

  if coalesce(v_batch.target_project_ref,'') <> c_production_ref then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','wrong_target_project',
      'detail', format('batch targets %s, not %s', coalesce(v_batch.target_project_ref,'<null>'), c_production_ref)));
  end if;

  if v_batch.status <> 'ready' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','batch_not_ready',
      'detail', format('batch status is %s, not ready', v_batch.status)));
  end if;

  -- (e) Job census.
  select count(*), count(*) filter (where status = 'approved')
  into v_total, v_approved
  from public.generation_jobs
  where batch_id = v_batch.id;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_status_counts
  from (
    select status, count(*) as n
    from public.generation_jobs
    where batch_id = v_batch.id
    group by status
  ) s;

  if v_total <> c_expected_jobs then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','job_count_mismatch',
      'detail', format('batch holds %s jobs, expected %s', v_total, c_expected_jobs)));
  end if;

  if v_approved <> c_expected_jobs then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','jobs_not_all_approved',
      'detail', format('%s of %s jobs are approved', v_approved, c_expected_jobs)));
  end if;

  -- (f) Composition: 16 / 1 / 6, with the exact topic spread.
  select
    count(*) filter (where content_type = 'newsletter_article'),
    count(*) filter (where content_type = 'business_story'),
    count(*) filter (where content_type = 'mini_case')
  into v_news, v_story, v_mini
  from public.generation_jobs
  where batch_id = v_batch.id;

  if v_news <> c_newsletter_jobs or v_story <> c_business_story_jobs or v_mini <> c_mini_case_jobs then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','composition_invalid',
      'detail', format('newsletter %s/%s, business_story %s/%s, mini_case %s/%s',
        v_news, c_newsletter_jobs, v_story, c_business_story_jobs, v_mini, c_mini_case_jobs)));
  end if;

  select coalesce(jsonb_object_agg(coalesce(topic,'<null>'), n), '{}'::jsonb) into v_topic_counts
  from (
    select topic, count(*) as n
    from public.generation_jobs
    where batch_id = v_batch.id and content_type = 'newsletter_article'
    group by topic
  ) t;

  foreach v_check in array c_newsletter_topics loop
    if coalesce((v_topic_counts->>v_check)::integer, 0) <> 2 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','newsletter_topic_count_invalid',
        'detail', format('newsletter topic %s has %s job(s), expected 2',
          v_check, coalesce((v_topic_counts->>v_check)::integer, 0))));
    end if;
  end loop;

  if exists (
    select 1 from public.generation_jobs
    where batch_id = v_batch.id
      and content_type = 'newsletter_article'
      and (topic is null or not (topic = any(c_newsletter_topics)))
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','newsletter_topic_unknown',
      'detail','a newsletter job carries a topic outside the eight PersoNews topics'));
  end if;

  select coalesce(array_agg(distinct mini_case_topic order by mini_case_topic), array[]::text[])
  into v_found_mini_topics
  from public.generation_jobs
  where batch_id = v_batch.id and content_type = 'mini_case';

  if v_found_mini_topics is distinct from (select array_agg(t order by t) from unnest(c_mini_case_topics) t) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','mini_case_topics_invalid',
      'detail', format('mini case topics are %s, expected exactly %s',
        array_to_string(v_found_mini_topics, ','), array_to_string(c_mini_case_topics, ','))));
  end if;

  -- (g) No duplicate slot claims. Two jobs answering to the same
  -- (content_type, topic, mini_case_topic, ordinal) means one of them is a ghost.
  for v_dup in
    select content_type, topic, mini_case_topic, ordinal, count(*) as n
    from public.generation_jobs
    where batch_id = v_batch.id
    group by content_type, topic, mini_case_topic, ordinal
    having count(*) > 1
  loop
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','duplicate_job_slot',
      'detail', format('%s/%s/%s ordinal %s appears %s times',
        v_dup.content_type, coalesce(v_dup.topic,'-'), coalesce(v_dup.mini_case_topic,'-'),
        v_dup.ordinal, v_dup.n)));
  end loop;

  -- (h) Every job, one at a time: status, current output, current review,
  -- verdict, score, the six critical checks, and the deterministic preflight
  -- re-run from scratch on what is actually stored.
  for v_job in
    select * from public.generation_jobs
    where batch_id = v_batch.id
    order by content_type, coalesce(topic, mini_case_topic), ordinal
  loop
    if v_job.status <> 'approved' then
      v_blocking_jobs := v_blocking_jobs || jsonb_build_array(jsonb_build_object(
        'job_id', v_job.id, 'content_type', v_job.content_type,
        'topic', v_job.topic, 'mini_case_topic', v_job.mini_case_topic,
        'ordinal', v_job.ordinal, 'status', v_job.status,
        'blocker','job_not_approved', 'last_error', v_job.last_error));
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','job_not_approved',
        'job_id', v_job.id,
        'detail', format('%s %s#%s is %s', v_job.content_type,
          coalesce(v_job.topic, v_job.mini_case_topic, '-'), v_job.ordinal, v_job.status)));
      continue;
    end if;

    -- Current output means the one for the current attempt. An approved job
    -- whose latest attempt produced nothing is a contradiction, not an edition.
    select * into v_output
    from public.generation_outputs
    where job_id = v_job.id and attempt = v_job.attempt_count
    order by submitted_at desc
    limit 1;

    if not found then
      v_blocking_jobs := v_blocking_jobs || jsonb_build_array(jsonb_build_object(
        'job_id', v_job.id, 'content_type', v_job.content_type, 'ordinal', v_job.ordinal,
        'status', v_job.status, 'blocker','output_missing'));
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','output_missing', 'job_id', v_job.id,
        'detail', format('%s %s#%s is approved but has no output at attempt %s',
          v_job.content_type, coalesce(v_job.topic, v_job.mini_case_topic, '-'),
          v_job.ordinal, v_job.attempt_count)));
      continue;
    end if;

    select * into v_review
    from public.generation_reviews
    where output_id = v_output.id
    order by reviewed_at desc
    limit 1;

    if not found then
      v_blocking_jobs := v_blocking_jobs || jsonb_build_array(jsonb_build_object(
        'job_id', v_job.id, 'content_type', v_job.content_type, 'ordinal', v_job.ordinal,
        'status', v_job.status, 'blocker','review_missing'));
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','review_missing', 'job_id', v_job.id,
        'detail', format('current output of %s %s#%s has no review', v_job.content_type,
          coalesce(v_job.topic, v_job.mini_case_topic, '-'), v_job.ordinal)));
      continue;
    end if;

    -- What the rest of this loop judges is THIS output and THIS review. Recorded
    -- so the publish plan can prove the payload carries exactly them
    -- (bind_payload_to_verified_identities).
    v_verified := v_verified || jsonb_build_array(jsonb_build_object(
      'job_id', v_job.id,
      'output_id', v_output.id,
      'output_attempt', v_output.attempt,
      'review_id', v_review.id));

    if v_review.verdict <> 'approved' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','review_not_approved', 'job_id', v_job.id,
        'detail', format('%s %s#%s review verdict is %s', v_job.content_type,
          coalesce(v_job.topic, v_job.mini_case_topic, '-'), v_job.ordinal, v_review.verdict)));
    end if;

    if coalesce(v_review.score, -1) < 90 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','review_score_below_bar', 'job_id', v_job.id,
        'detail', format('%s %s#%s scored %s, bar is 90',
          v_job.content_type, coalesce(v_job.topic, v_job.mini_case_topic, '-'),
          v_job.ordinal, coalesce(v_review.score::text,'null'))));
    end if;

    foreach v_check in array c_required_checks loop
      if coalesce(v_review.checks->>v_check, 'false') <> 'true' then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','critical_check_failed', 'job_id', v_job.id, 'check', v_check,
          'detail', format('%s %s#%s check %s is not true', v_job.content_type,
            coalesce(v_job.topic, v_job.mini_case_topic, '-'), v_job.ordinal, v_check)));
      end if;
    end loop;

    -- The reviewer is an agent. The preflight is arithmetic. Run the arithmetic
    -- again on the stored bytes rather than trusting that it was run before.
    v_validation := public.validate_generation_output(v_job.id, v_output.output_json, v_output.source_records);

    if coalesce((v_validation->>'valid')::boolean, false) is not true then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','deterministic_preflight_invalid', 'job_id', v_job.id,
        'detail', format('%s %s#%s failed revalidation', v_job.content_type,
          coalesce(v_job.topic, v_job.mini_case_topic, '-'), v_job.ordinal),
        'errors', coalesce(v_validation->'errors','[]'::jsonb)));
    end if;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'reason', case when jsonb_array_length(v_blockers) = 0 then 'ok' else v_blockers->0->>'code' end,
    'already_published', false,
    'edition_date', p_edition_date,
    'expected_edition_kind', v_expected_kind,
    'edition_kind', v_batch.edition_kind,
    'batch_id', v_batch.id,
    'batch_status', v_batch.status,
    'batch_status_before_refresh', v_status_before,
    'batch_status_refreshed', v_status_before is distinct from v_batch.status,
    'target_project_ref', v_batch.target_project_ref,
    'prompt_bundle_version', v_batch.prompt_bundle_version,
    'expected_jobs', c_expected_jobs,
    'total_jobs', v_total,
    'approved_jobs', v_approved,
    'job_status_counts', v_status_counts,
    'composition', jsonb_build_object(
      'newsletter_article', v_news, 'business_story', v_story, 'mini_case', v_mini),
    'blocking_jobs', v_blocking_jobs,
    'blockers', v_blockers,
    'verified_identities', v_verified,
    'verified_identity_digest', (
      select md5(string_agg(
        (e->>'job_id') || ':' || (e->>'output_id') || ':' || (e->>'review_id'),
        ',' order by e->>'job_id'))
      from jsonb_array_elements(v_verified) e)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The binding
-- ---------------------------------------------------------------------------
-- Proves, job by job, that the payload IS what the gate verified, and stamps
-- the verified ids on it for production's provenance. Refuses otherwise.
--
-- For each of the 23 jobs, the payload entry must match the verified output row
-- and the verified review row:
--   - output_id, when the payload carries one, equals the verified output id;
--   - the review id, when the payload carries one, equals the verified review id;
--   - output_json and source_records equal the verified output's stored bytes
--     (jsonb equality);
--   - the review's verdict, score and checks equal the verified review's.
-- So whether or not the canonical builder names its rows, a payload made of any
-- other output or review cannot pass. Pure check plus stamping: it writes
-- nothing.

create or replace function public.bind_payload_to_verified_identities(
  p_gate jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_expected_jobs constant integer := 23;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_verified jsonb := coalesce(p_gate->'verified_identities', 'null'::jsonb);
  v_jobs jsonb := coalesce(p_payload->'jobs', 'null'::jsonb);
  v_blockers jsonb := '[]'::jsonb;
  v_bound jsonb := '[]'::jsonb;
  v_job jsonb;
  v_entry jsonb;
  v_output public.generation_outputs%rowtype;
  v_review public.generation_reviews%rowtype;
  v_fields text[];
  v_payload_review_id text;
  v_payload_score text;
  v_missing text;
  v_extra text;
begin
  -- (1) The verified set: exactly 23 jobs, each once, each fully named.
  if jsonb_typeof(v_verified) is distinct from 'array'
     or jsonb_array_length(v_verified) <> c_expected_jobs
     or (select count(distinct e->>'job_id') from jsonb_array_elements(v_verified) e) <> c_expected_jobs
     or exists (
       select 1 from jsonb_array_elements(v_verified) e
       where coalesce(e->>'job_id', '') !~* c_uuid
          or coalesce(e->>'output_id', '') !~* c_uuid
          or coalesce(e->>'review_id', '') !~* c_uuid)
  then
    return jsonb_build_object('ok', false, 'blockers', jsonb_build_array(jsonb_build_object(
      'code', 'verified_payload_identity_mismatch',
      'detail', format('the gate verified %s job identities, expected %s distinct, fully named ones',
        case when jsonb_typeof(v_verified) = 'array' then jsonb_array_length(v_verified)::text else 'no' end,
        c_expected_jobs))));
  end if;

  -- (2) The payload: exactly 23 jobs, each once, each named.
  if jsonb_typeof(v_jobs) is distinct from 'array'
     or jsonb_array_length(v_jobs) <> c_expected_jobs
     or (select count(distinct j->>'job_id') from jsonb_array_elements(v_jobs) j) <> c_expected_jobs
     or exists (select 1 from jsonb_array_elements(v_jobs) j where coalesce(j->>'job_id', '') !~* c_uuid)
  then
    return jsonb_build_object('ok', false, 'blockers', jsonb_build_array(jsonb_build_object(
      'code', 'verified_payload_identity_mismatch',
      'detail', 'the payload does not carry 23 distinct, named jobs')));
  end if;

  -- (3) The same 23 jobs on both sides: none missing, none extra.
  select string_agg(e->>'job_id', ',' order by e->>'job_id') into v_missing
  from jsonb_array_elements(v_verified) e
  where not exists (select 1 from jsonb_array_elements(v_jobs) j where lower(j->>'job_id') = lower(e->>'job_id'));

  select string_agg(j->>'job_id', ',' order by j->>'job_id') into v_extra
  from jsonb_array_elements(v_jobs) j
  where not exists (select 1 from jsonb_array_elements(v_verified) e where lower(e->>'job_id') = lower(j->>'job_id'));

  if v_missing is not null or v_extra is not null then
    return jsonb_build_object('ok', false, 'blockers', jsonb_build_array(jsonb_build_object(
      'code', 'verified_payload_identity_mismatch',
      'detail', 'the payload and the gate name different jobs',
      'jobs_missing_from_payload', v_missing,
      'jobs_not_verified', v_extra)));
  end if;

  -- (4) Job by job: the payload carries the verified output and review, byte for byte.
  for v_job in select j from jsonb_array_elements(v_jobs) as t(j)
  loop
    select e into v_entry
    from jsonb_array_elements(v_verified) e
    where lower(e->>'job_id') = lower(v_job->>'job_id');

    v_fields := array[]::text[];

    select * into v_output
    from public.generation_outputs o
    where o.id = (v_entry->>'output_id')::uuid
      and o.job_id = (v_entry->>'job_id')::uuid;

    if not found then
      v_fields := array_append(v_fields, 'verified_output_row');
    end if;

    select * into v_review
    from public.generation_reviews r
    where r.id = (v_entry->>'review_id')::uuid
      and r.output_id = (v_entry->>'output_id')::uuid;

    if not found then
      v_fields := array_append(v_fields, 'verified_review_row');
    end if;

    if cardinality(v_fields) = 0 then
      if v_job ? 'output_id' and (v_job->>'output_id') is distinct from v_output.id::text then
        v_fields := array_append(v_fields, 'output_id');
      end if;

      v_payload_review_id := coalesce(v_job->>'review_id', v_job->'review'->>'id');
      if v_payload_review_id is not null and v_payload_review_id is distinct from v_review.id::text then
        v_fields := array_append(v_fields, 'review_id');
      end if;

      if (v_job->'output_json') is distinct from v_output.output_json then
        v_fields := array_append(v_fields, 'output_json');
      end if;

      if (v_job->'source_records') is distinct from v_output.source_records then
        v_fields := array_append(v_fields, 'source_records');
      end if;

      if (v_job->'review'->>'verdict') is distinct from v_review.verdict then
        v_fields := array_append(v_fields, 'review_verdict');
      end if;

      v_payload_score := v_job->'review'->>'score';
      if v_payload_score is null
         or v_payload_score !~ '^-?[0-9]+(\.[0-9]+)?$'
         or v_payload_score::numeric is distinct from v_review.score::numeric then
        v_fields := array_append(v_fields, 'review_score');
      end if;

      if (v_job->'review'->'checks') is distinct from v_review.checks then
        v_fields := array_append(v_fields, 'review_checks');
      end if;
    end if;

    if cardinality(v_fields) > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'verified_payload_identity_mismatch',
        'job_id', v_job->>'job_id',
        'verified_output_id', v_entry->>'output_id',
        'verified_review_id', v_entry->>'review_id',
        'payload_output_id', v_job->>'output_id',
        'fields', to_jsonb(v_fields),
        'detail', format('job %s: the payload differs from what the gate verified (%s)',
          v_job->>'job_id', array_to_string(v_fields, ', '))));
    else
      -- Production's provenance: the rows this edition was verified and built from.
      v_bound := v_bound || jsonb_build_array(v_job || jsonb_build_object(
        'output_id', v_output.id,
        'output_attempt', v_output.attempt,
        'review_id', v_review.id));
    end if;
  end loop;

  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('ok', false, 'blockers', v_blockers);
  end if;

  return jsonb_build_object(
    'ok', true,
    'blockers', '[]'::jsonb,
    'verified_identity_digest', p_gate->>'verified_identity_digest',
    'payload', p_payload
      || jsonb_build_object('jobs', v_bound)
      || jsonb_build_object('batch', coalesce(p_payload->'batch', '{}'::jsonb)
           || jsonb_build_object('verified_identity_digest', p_gate->>'verified_identity_digest')));
end;
$function$;

comment on function public.bind_payload_to_verified_identities(jsonb, jsonb) is
  'Refuses (verified_payload_identity_mismatch) unless the payload carries, for exactly the 23 jobs the gate verified, the verified output (id when named, output_json and source_records byte-equal) and the verified review (id when named, verdict, score and checks equal). On success returns the payload with output_id, output_attempt and review_id stamped on each job. Writes nothing.';


-- ---------------------------------------------------------------------------
-- 3. The plan, refusing a payload that is not what was verified
-- ---------------------------------------------------------------------------

create or replace function public.get_scheduled_edition_publish_plan(p_edition_date date)
returns jsonb
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_production_ref constant text := 'wkbviidrbmehmjbhvpeh';
  v_gate jsonb;
  v_questions jsonb;
  v_payload jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_jobs jsonb;
  v_news integer;
  v_story integer;
  v_mini integer;
  v_binding jsonb;
begin
  v_gate := public.assert_edition_publishable(p_edition_date);

  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return jsonb_build_object('gate', v_gate, 'ready_payload', null);
  end if;

  -- THE ADDED BLOCK. The editorial gate passed; the game must also be
  -- publishable. Run second because a batch that is not editorially ready has
  -- nothing worth reporting about its questions, and running it first would bury
  -- the real blocker under 23 question errors.
  v_questions := public.assert_edition_questions_publishable(p_edition_date);

  if coalesce((v_questions->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'gate', v_gate
        || jsonb_build_object('ok', false, 'reason', 'scored_questions_invalid')
        || jsonb_build_object('blockers',
             (v_gate->'blockers') || coalesce(v_questions->'blockers', '[]'::jsonb))
        || jsonb_build_object('question_gate', v_questions),
      'ready_payload', null);
  end if;

  v_payload := public.get_ready_batch_payload(p_edition_date);

  if coalesce((v_payload->>'ready')::text,'false') <> 'true' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','payload_not_ready',
      'detail', format('get_ready_batch_payload answered %s', coalesce(v_payload->>'reason','<no reason>'))));
  else
    v_jobs := v_payload->'jobs';

    if (v_payload->'batch'->>'id') is distinct from (v_gate->>'batch_id') then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_batch_mismatch',
        'detail', format('payload carries batch %s, gate approved %s',
          v_payload->'batch'->>'id', v_gate->>'batch_id')));
    end if;

    if (v_payload->'batch'->>'edition_date')::date is distinct from p_edition_date then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_date_mismatch',
        'detail', format('payload is dated %s', v_payload->'batch'->>'edition_date')));
    end if;

    if (v_payload->'batch'->>'edition_kind') is distinct from (v_gate->>'expected_edition_kind') then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_kind_mismatch',
        'detail', format('payload kind is %s, calendar says %s',
          v_payload->'batch'->>'edition_kind', v_gate->>'expected_edition_kind')));
    end if;

    if coalesce(v_payload->'batch'->>'target_project_ref','') <> c_production_ref then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_target_mismatch',
        'detail', format('payload targets %s', coalesce(v_payload->'batch'->>'target_project_ref','<null>'))));
    end if;

    -- coalesce: a payload with no `jobs` key made this whole condition NULL,
    -- took the else branch, and then counted composition over zero rows — so
    -- v_news/v_story/v_mini were NULL, `v_news <> 16` was NULL, and a payload
    -- carrying no jobs at all reached the publisher with no blocker raised.
    if coalesce(jsonb_typeof(v_jobs), 'null') <> 'array' or jsonb_array_length(v_jobs) <> 23 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','payload_job_count_mismatch',
        'detail', format('payload carries %s jobs, expected 23',
          case when jsonb_typeof(v_jobs) = 'array' then jsonb_array_length(v_jobs)::text else 'a non-array' end)));
    else
      select
        count(*) filter (where j->>'content_type' = 'newsletter_article'),
        count(*) filter (where j->>'content_type' = 'business_story'),
        count(*) filter (where j->>'content_type' = 'mini_case')
      into v_news, v_story, v_mini
      from jsonb_array_elements(v_jobs) j;

      if v_news <> 16 or v_story <> 1 or v_mini <> 6 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','payload_composition_invalid',
          'detail', format('payload composition is %s/%s/%s, expected 16/1/6', v_news, v_story, v_mini)));
      end if;

      if exists (
        select 1 from jsonb_array_elements(v_jobs) j
        -- Every term coalesced. A WHERE clause that evaluates to NULL does not
        -- match, so a job missing output_json entirely was the one shape this
        -- check could not see.
        where coalesce(jsonb_typeof(j->'output_json'), 'null') <> 'object'
           or coalesce(jsonb_typeof(j->'source_records'), 'null') <> 'array'
           or coalesce(jsonb_array_length(j->'source_records'), 0) = 0
           or coalesce(j->'review'->>'verdict','') <> 'approved'
      ) then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','payload_job_incomplete',
          'detail','a payload job is missing its output, its sources or an approved review'));
      end if;
    end if;
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object(
      'gate', v_gate
        || jsonb_build_object('ok', false, 'reason', v_blockers->0->>'code')
        || jsonb_build_object('blockers', (v_gate->'blockers') || v_blockers),
      'ready_payload', null);
  end if;

  -- 20261005190000: the payload must be made of exactly the outputs and
  -- reviews the gate verified. The gate and the canonical builder read the
  -- database in separate statements; a newer output landing in between must
  -- stop the edition, never ride on the older output's review.
  v_binding := public.bind_payload_to_verified_identities(v_gate, v_payload);

  if coalesce((v_binding->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'gate', v_gate
        || jsonb_build_object('ok', false, 'reason', 'verified_payload_identity_mismatch')
        || jsonb_build_object('blockers', (v_gate->'blockers') || coalesce(v_binding->'blockers', '[]'::jsonb))
        || jsonb_build_object('question_gate', v_questions),
      'ready_payload', null);
  end if;

  -- The question verdict travels with a passing plan too, so the run audit
  -- records which contract version an edition was published under. The
  -- declaration is the one 20260907180000 patched in, now restated in full.
  return jsonb_build_object(
    'gate', v_gate || jsonb_build_object('question_gate', v_questions),
    'ready_payload', public.decorate_payload_with_question_contract(v_binding->'payload', v_questions));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Permissions (as before; the binding is service-only too)
-- ---------------------------------------------------------------------------

revoke all on function public.assert_edition_publishable(date) from public, anon, authenticated;
revoke all on function public.get_scheduled_edition_publish_plan(date) from public, anon, authenticated;
revoke all on function public.bind_payload_to_verified_identities(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.assert_edition_publishable(date) to service_role;
grant execute on function public.get_scheduled_edition_publish_plan(date) to service_role;
grant execute on function public.bind_payload_to_verified_identities(jsonb, jsonb) to service_role;

commit;
