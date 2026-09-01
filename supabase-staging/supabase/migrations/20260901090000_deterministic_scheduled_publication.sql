-- Deterministic scheduled publication — STAGING project (kukyotcgbnchsoeriqoz).
--
-- Publication used to be decided by whichever agent happened to finish the last
-- review: `personews-task-bridge` published as a side effect of `action=commit`.
-- That put the final go/no-go inside an AI turn. This migration moves the whole
-- decision into SQL, where it is deterministic, inspectable and testable, and
-- leaves the AI workers with exactly one job: filling generation_outputs and
-- generation_reviews.
--
-- Nothing here relaxes a rule. Everything here is a rule the pipeline already
-- claimed to enforce, restated as code that runs on a schedule instead of on a
-- model's judgement.
--
-- APPLY TO STAGING ONLY. These objects reference automation_batches /
-- generation_jobs, which exist only in the staging project.

begin;

-- ---------------------------------------------------------------------------
-- 1. Audit trail
-- ---------------------------------------------------------------------------
-- automation_health already records pipeline events, but it is an event log:
-- one row per thing that happened, no shape. A publication attempt is a
-- transaction with a beginning, an outcome and a reason, and diagnosing "why was
-- there no edition last Wednesday" should be one SELECT, not a jsonb archaeology
-- session. Every attempt gets a row, including the ones that publish nothing —
-- especially those.

create table if not exists public.scheduled_publication_runs (
  id bigserial primary key,
  run_id text not null,
  edition_date date not null,
  expected_edition_kind text,
  batch_id uuid,
  edition_kind text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  gate_passed boolean not null default false,
  publication_attempted boolean not null default false,
  publication_succeeded boolean not null default false,
  production_verified boolean not null default false,
  receipt_recorded boolean not null default false,
  already_published boolean not null default false,
  approved_jobs integer,
  expected_jobs integer,
  reason text,
  blockers jsonb not null default '[]'::jsonb,
  gate_result jsonb not null default '{}'::jsonb,
  production_result jsonb,
  verification_result jsonb,
  error text,
  trigger_source text not null default 'cron',
  publisher_version text not null default 'scheduled-publisher-v1'
);

comment on table public.scheduled_publication_runs is
  'One row per automatic publication attempt. Rows are never deleted: an edition that did not go out is the interesting case.';

create index if not exists scheduled_publication_runs_edition_date_idx
  on public.scheduled_publication_runs (edition_date desc, started_at desc);
create index if not exists scheduled_publication_runs_run_id_idx
  on public.scheduled_publication_runs (run_id);

alter table public.scheduled_publication_runs enable row level security;
revoke all on public.scheduled_publication_runs from anon, authenticated;
grant select, insert, update on public.scheduled_publication_runs to service_role;
grant usage, select on sequence public.scheduled_publication_runs_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 2. The hard gate
-- ---------------------------------------------------------------------------
-- Returns a verdict, never an exception, so a refusal is diagnosable data rather
-- than a stack trace. `ok` is true only when every single condition holds.
--
-- Deliberately duplicates checks that `publish_scheduled_staging_payload` also
-- performs in production. Production refusing is a last line of defence; this is
-- the decision. Agreeing twice costs nothing and disagreeing is exactly the
-- signal worth having.

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
    'blockers', v_blockers
  );
end;
$function$;

comment on function public.assert_edition_publishable(date) is
  'Deterministic hard gate. Returns ok=true only when a batch is genuinely, completely publishable; otherwise returns every reason it is not.';

-- ---------------------------------------------------------------------------
-- 3. Gate + canonical payload, in one call
-- ---------------------------------------------------------------------------
-- The publisher must never assemble a payload by hand. It asks for this, and
-- gets either a refusal or the exact jsonb `get_ready_batch_payload` produced —
-- re-checked here against the same batch the gate approved, because two
-- functions reading the database a millisecond apart is one assumption too many.

create or replace function public.get_scheduled_edition_publish_plan(p_edition_date date)
returns jsonb
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_production_ref constant text := 'wkbviidrbmehmjbhvpeh';
  v_gate jsonb;
  v_payload jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_jobs jsonb;
  v_news integer;
  v_story integer;
  v_mini integer;
begin
  v_gate := public.assert_edition_publishable(p_edition_date);

  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return jsonb_build_object('gate', v_gate, 'ready_payload', null);
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

    if jsonb_typeof(v_jobs) <> 'array' or jsonb_array_length(v_jobs) <> 23 then
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
        where jsonb_typeof(j->'output_json') <> 'object'
           or jsonb_typeof(j->'source_records') <> 'array'
           or jsonb_array_length(j->'source_records') = 0
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

  return jsonb_build_object('gate', v_gate, 'ready_payload', v_payload);
end;
$function$;

comment on function public.get_scheduled_edition_publish_plan(date) is
  'Single entry point for the scheduled publisher: the hard gate verdict plus, only when it passes, the canonical get_ready_batch_payload output.';

-- ---------------------------------------------------------------------------
-- 4. Deterministic run id
-- ---------------------------------------------------------------------------
-- Same edition, same batch, same publisher version => same id, forever. A retry
-- reuses it; production's dedup_key then makes the retry a no-op instead of a
-- second edition.

create or replace function public.scheduled_publication_run_id(
  p_edition_date date,
  p_batch_id uuid,
  p_publisher_version text default 'scheduled-publisher-v1'
)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select 'personews-scheduled-publish:' || p_publisher_version || ':' ||
         to_char(p_edition_date,'YYYY-MM-DD') || ':' || p_batch_id::text;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Is a publication due right now?
-- ---------------------------------------------------------------------------
-- Europe/Paris, computed at call time, so CET and CEST are both simply correct.
-- The cron entry fires twice an hour apart precisely so this function can pick
-- the one that lands on 19:00 local, whatever the offset is that week.

create or replace function public.scheduled_publication_due(p_at timestamptz default now())
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select extract(hour from (p_at at time zone 'Europe/Paris'))::int = 19
     and public.resolve_staging_edition_kind((p_at at time zone 'Europe/Paris')::date) is not null;
$function$;

comment on function public.scheduled_publication_due(timestamptz) is
  'True only at the 19:00 Europe/Paris hour of a PersoNews publication day. DST-correct by construction: the offset is never hardcoded.';

create or replace function public.scheduled_publication_edition_date(p_at timestamptz default now())
returns date
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select (p_at at time zone 'Europe/Paris')::date;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Audit writers
-- ---------------------------------------------------------------------------

create or replace function public.begin_scheduled_publication_run(
  p_run_id text,
  p_edition_date date,
  p_trigger_source text default 'cron',
  p_publisher_version text default 'scheduled-publisher-v1'
)
returns bigint
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id bigint;
begin
  if nullif(trim(p_run_id),'') is null then
    raise exception 'run_id_required';
  end if;

  insert into public.scheduled_publication_runs (
    run_id, edition_date, expected_edition_kind, trigger_source, publisher_version
  ) values (
    p_run_id, p_edition_date, public.resolve_staging_edition_kind(p_edition_date),
    coalesce(nullif(trim(p_trigger_source),''),'cron'), p_publisher_version
  ) returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.finish_scheduled_publication_run(
  p_id bigint,
  p_gate jsonb,
  p_gate_passed boolean,
  p_publication_attempted boolean,
  p_publication_succeeded boolean,
  p_production_verified boolean,
  p_receipt_recorded boolean,
  p_already_published boolean,
  p_reason text,
  p_production_result jsonb default null,
  p_verification_result jsonb default null,
  p_error text default null
)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.scheduled_publication_runs
  set finished_at = now(),
      gate_result = coalesce(p_gate,'{}'::jsonb),
      blockers = coalesce(p_gate->'blockers','[]'::jsonb),
      batch_id = nullif(p_gate->>'batch_id','')::uuid,
      edition_kind = p_gate->>'edition_kind',
      approved_jobs = nullif(p_gate->>'approved_jobs','')::integer,
      expected_jobs = nullif(p_gate->>'expected_jobs','')::integer,
      gate_passed = coalesce(p_gate_passed,false),
      publication_attempted = coalesce(p_publication_attempted,false),
      publication_succeeded = coalesce(p_publication_succeeded,false),
      production_verified = coalesce(p_production_verified,false),
      receipt_recorded = coalesce(p_receipt_recorded,false),
      already_published = coalesce(p_already_published,false),
      reason = p_reason,
      production_result = p_production_result,
      verification_result = p_verification_result,
      error = p_error
  where id = p_id;

  -- Mirrored into the pipeline's own event log so the existing health tooling
  -- sees publication attempts alongside generation and review events.
  insert into public.automation_health (batch_id, actor, event_type, severity, details)
  select r.batch_id,
         'scheduled-publisher',
         case when r.publication_succeeded then 'scheduled_publication_succeeded'
              when r.already_published then 'scheduled_publication_noop'
              else 'scheduled_publication_blocked' end,
         case when r.publication_succeeded or r.already_published then 'info' else 'warning' end,
         jsonb_build_object(
           'run_id', r.run_id,
           'edition_date', r.edition_date,
           'reason', r.reason,
           'approved_jobs', r.approved_jobs,
           'expected_jobs', r.expected_jobs,
           'blockers', r.blockers)
  from public.scheduled_publication_runs r
  where r.id = p_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Permissions — least privilege
-- ---------------------------------------------------------------------------
-- Only the service role (the Edge Function) and postgres (pg_cron) may call any
-- of this. Nothing is reachable from an anon or authenticated PostgREST session.

revoke all on function public.assert_edition_publishable(date) from public, anon, authenticated;
revoke all on function public.get_scheduled_edition_publish_plan(date) from public, anon, authenticated;
revoke all on function public.scheduled_publication_run_id(date, uuid, text) from public, anon, authenticated;
revoke all on function public.scheduled_publication_due(timestamptz) from public, anon, authenticated;
revoke all on function public.scheduled_publication_edition_date(timestamptz) from public, anon, authenticated;
revoke all on function public.begin_scheduled_publication_run(text, date, text, text) from public, anon, authenticated;
revoke all on function public.finish_scheduled_publication_run(bigint, jsonb, boolean, boolean, boolean, boolean, boolean, boolean, text, jsonb, jsonb, text) from public, anon, authenticated;

grant execute on function public.assert_edition_publishable(date) to service_role;
grant execute on function public.get_scheduled_edition_publish_plan(date) to service_role;
grant execute on function public.scheduled_publication_run_id(date, uuid, text) to service_role;
grant execute on function public.scheduled_publication_due(timestamptz) to service_role, postgres;
grant execute on function public.scheduled_publication_edition_date(timestamptz) to service_role, postgres;
grant execute on function public.begin_scheduled_publication_run(text, date, text, text) to service_role;
grant execute on function public.finish_scheduled_publication_run(bigint, jsonb, boolean, boolean, boolean, boolean, boolean, boolean, text, jsonb, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Config: publication ownership moved
-- ---------------------------------------------------------------------------

update public.automation_config
set value = value
      || jsonb_build_object(
           'publication_owner','deterministic_supabase_cron',
           'scheduled_workers_may_publish', false,
           'publication_time','19:00',
           'publication_timezone','Europe/Paris'),
    updated_at = now()
where key = 'pipeline';

commit;
