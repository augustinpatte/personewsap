-- LOCAL HARNESS ONLY. NOT A MIGRATION. NEVER APPLIED TO A REMOTE PROJECT.
--
-- This file lives in tests/, not migrations/, and that placement is the whole
-- safety argument: `supabase db push --workdir supabase-staging` reads
-- migrations/ and cannot see this. It is loaded by
-- scripts/local-sql-tests.mjs after a local `db reset`, and by nothing else.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS
-- ---------------------------------------------------------------------------
-- Four functions that the staging migrations call and that exist ONLY inside
-- the live staging project (kukyotcgbnchsoeriqoz), applied there by hand and
-- never committed — they are among the orphaned migrations
-- `npm run supabase:migration-check` reports:
--
--   refresh_batch_status(uuid)
--   get_ready_batch_payload(date)
--   mark_batch_published(uuid, text, text, jsonb)
--   validate_generation_output(uuid, jsonb, jsonb)
--   trg_enforce_production_batch_mode on automation_batches
--
-- Without them a local staging database stops at the first call:
--   ERROR: function public.refresh_batch_status(uuid) does not exist
-- and the deterministic gate — the thing that decides at 19:00 Paris whether an
-- edition publishes — can be exercised nowhere except against the live project.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS NOT
-- ---------------------------------------------------------------------------
-- It is not a recovery of the remote definitions. Nobody here has read them.
-- Each function below is written from its CALLERS — the assertions in
-- supabase-staging/supabase/migrations/20260901090000_*.sql and the expectations
-- in scheduled_publication_gate.test.sql — so it satisfies the contract the
-- repository states and says nothing about the contract the remote actually
-- implements.
--
-- The consequence, stated plainly so nobody reads more into a green run than is
-- there:
--
--   PROVEN LOCALLY   the gate's own logic — calendar resolution, batch
--                    selection, receipt idempotence, the 16/1/6 composition
--                    rule, review verdict and score bars, the six critical
--                    checks, the stale-cache heal in both directions, and the
--                    scored-question preflight in 20260906110000, which IS in
--                    this repository and is the real thing.
--
--   NOT PROVEN       the editorial rules inside the remote
--                    validate_generation_output. The stand-in below enforces
--                    required keys and the production word ranges and nothing
--                    else. A local pass does not mean an article the remote
--                    would reject is accepted here — it means this file was not
--                    asked about it.
--
-- 20260906110000's own header explains why the remote definition is not
-- reimplemented as a migration: "getting one of its word-count or schema rules
-- subtly wrong would reject every correct article at 19:00 with no way to tell
-- why." That reasoning is why the stand-in stays here, in a test harness, where
-- being approximately right is honest, instead of in migrations/, where it
-- would be a lie with a deploy path.
--
-- PROMPT 8: read the four definitions out of the staging project
-- (`select pg_get_functiondef(oid) ...`) and commit them as a real migration.
-- Then delete this file.

begin;

-- ---------------------------------------------------------------------------
-- refresh_batch_status(uuid) → text
-- ---------------------------------------------------------------------------
-- Contract, from 20260901090000 lines 190-213 and gate test R1/R2:
--   * derives the status purely from generation_jobs, so it demotes a batch
--     wrongly marked `ready` as readily as it promotes one left `reviewing`;
--   * rewrites the cached counters alongside it (R1 expects ready:23 after a
--     stale reviewing:7, R2 expects reviewing:22 after one job is sent back);
--   * leaves a `published` batch alone — it knows nothing about publication and
--     would otherwise undo the marker;
--   * returns the status it settled on.

create or replace function public.refresh_batch_status(p_batch_id uuid)
returns text
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $$
declare
  v_batch public.automation_batches%rowtype;
  v_total integer;
  v_approved integer;
  v_completed integer;
  v_failed integer;
  v_status text;
begin
  select * into v_batch from public.automation_batches where id = p_batch_id;
  if not found then
    return null;
  end if;

  if v_batch.status = 'published' then
    return v_batch.status;
  end if;

  select
    count(*),
    count(*) filter (where status = 'approved'),
    count(*) filter (where status not in ('queued', 'generating')),
    count(*) filter (where status in ('failed', 'cancelled'))
  into v_total, v_approved, v_completed, v_failed
  from public.generation_jobs
  where batch_id = p_batch_id;

  -- `ready` means every job row that EXISTS is approved — not that the count
  -- reached expected_jobs.
  --
  -- The distinction is pinned by two tests that disagree on purpose. R2 sends
  -- one of 23 jobs back for revision and expects reviewing:22. C1 DELETES one
  -- job outright, leaving 22 rows all approved, and expects the batch to stay
  -- ready so that the gate refuses it with `job_count_mismatch` — the honest
  -- reason — rather than `batch_not_ready`, which would blame the bookkeeping
  -- for a missing article. expected_jobs is a batch column, i.e. part of the
  -- cache this function exists to rebuild, so it is not an input to it; the job
  -- rows are.
  v_status := case
    when v_total > 0 and v_approved = v_total then 'ready'
    when v_failed > 0 then 'failed'
    when v_completed > 0 then 'reviewing'
    else 'generating'
  end;

  update public.automation_batches
  set status = v_status,
      approved_jobs = v_approved,
      completed_jobs = v_completed,
      updated_at = now()
  where id = p_batch_id;

  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_ready_batch_payload(date) → jsonb
-- ---------------------------------------------------------------------------
-- Contract, from get_scheduled_edition_publish_plan, which validates every
-- field of what comes back: `ready`, a `batch` object carrying id, edition_date,
-- edition_kind and target_project_ref, and a `jobs` array of 23 entries each
-- holding an output_json object, a non-empty source_records array and an
-- approved review.

create or replace function public.get_ready_batch_payload(p_edition_date date)
returns jsonb
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $$
declare
  v_batch public.automation_batches%rowtype;
  v_jobs jsonb;
begin
  select * into v_batch
  from public.automation_batches
  where edition_date = p_edition_date
    and edition_kind = public.resolve_staging_edition_kind(p_edition_date)
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ready', 'false', 'reason', 'batch_not_found');
  end if;

  if v_batch.status <> 'ready' then
    return jsonb_build_object('ready', 'false', 'reason', 'batch_not_ready',
      'batch_status', v_batch.status);
  end if;

  -- The latest output per job, and its review. `distinct on` rather than a max
  -- subquery because a retried job has several outputs and only the last one is
  -- the candidate.
  select coalesce(jsonb_agg(payload order by content_type, ordinal), '[]'::jsonb)
  into v_jobs
  from (
    select distinct on (j.id)
      j.content_type,
      j.ordinal,
      jsonb_build_object(
        'job_id', j.id,
        'content_type', j.content_type,
        'topic', j.topic,
        'mini_case_topic', j.mini_case_topic,
        'ordinal', j.ordinal,
        'prompt_key', j.prompt_key,
        'output_json', o.output_json,
        'source_records', o.source_records,
        'review', jsonb_build_object(
          'verdict', r.verdict, 'score', r.score, 'checks', r.checks)
      ) as payload
    from public.generation_jobs j
    join public.generation_outputs o on o.job_id = j.id
    left join public.generation_reviews r on r.output_id = o.id
    where j.batch_id = v_batch.id
    order by j.id, o.attempt desc, o.submitted_at desc
  ) latest;

  return jsonb_build_object(
    'ready', 'true',
    'reason', 'ok',
    'batch', jsonb_build_object(
      'id', v_batch.id,
      'edition_date', v_batch.edition_date,
      'edition_kind', v_batch.edition_kind,
      'target_project_ref', v_batch.target_project_ref,
      'prompt_bundle_version', v_batch.prompt_bundle_version,
      'metadata', v_batch.metadata),
    'jobs', v_jobs);
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_batch_published(uuid, text, text, jsonb) → uuid
-- ---------------------------------------------------------------------------
-- Contract, from gate test R1: it re-checks `ready` itself rather than trusting
-- the caller, writes the receipt, and returns non-null on success. The unique
-- index on publication_receipts.batch_id is what makes a second call a no-op
-- instead of a duplicate edition.

create or replace function public.mark_batch_published(
  p_batch_id uuid,
  p_production_project_ref text,
  p_production_run_id text,
  p_production_result jsonb
)
returns uuid
language plpgsql
volatile
set search_path to 'public', 'pg_temp'
as $$
declare
  v_batch public.automation_batches%rowtype;
  v_receipt uuid;
begin
  select * into v_batch from public.automation_batches where id = p_batch_id;
  if not found then
    return null;
  end if;

  if v_batch.status not in ('ready', 'published') then
    return null;
  end if;

  insert into public.publication_receipts
    (batch_id, production_project_ref, production_run_id, production_result)
  values (p_batch_id, p_production_project_ref, p_production_run_id, p_production_result)
  on conflict (batch_id) do update
    set production_result = excluded.production_result
  returning id into v_receipt;

  update public.automation_batches
  set status = 'published', updated_at = now()
  where id = p_batch_id;

  return v_receipt;
end;
$$;

-- ---------------------------------------------------------------------------
-- validate_generation_output(uuid, jsonb, jsonb) → jsonb
-- ---------------------------------------------------------------------------
-- THE STAND-IN. Read the header of this file before relying on a pass here.
--
-- The gate calls this on the stored bytes of all 23 jobs and treats
-- valid <> true as a blocker. Only one check in the whole suite depends on what
-- it decides — T5, a newsletter body cut to 100 words — so what is implemented
-- is what T5 and the happy path pin, and no more:
--
--   * both language halves present under 'fr' and 'en';
--   * the keys each content type's consumer reads;
--   * the production word ranges, which ARE in this repository:
--     newsletter_article 220-275 (supabase/migrations/20260831021509);
--   * at least one source record.
--
-- Anything the remote checks beyond this — topic vocabularies, novelty,
-- formatting, the mini-case and business-story ranges nothing here pins — is
-- NOT checked, and a local pass is silent about it.

create or replace function public.validate_generation_output(
  p_job_id uuid,
  p_output_json jsonb,
  p_source_records jsonb
)
returns jsonb
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_job_type text;
  v_errors jsonb := '[]'::jsonb;
  v_language text;
  v_item jsonb;
  v_words integer;
  c_required constant jsonb := jsonb_build_object(
    'newsletter_article', jsonb_build_array(
      'content_type','language','title','topic','source_urls','summary','body_md','why_it_matters'),
    'business_story', jsonb_build_array(
      'content_type','language','title','topic','source_urls','company_or_market',
      'setup','tension','decision','outcome','lesson','body_md'),
    'mini_case', jsonb_build_array(
      'content_type','language','title','topic','source_urls','product_topic',
      'context','challenge','constraints','question','conclusion','body_md'));
begin
  if jsonb_typeof(p_output_json) <> 'object' then
    return jsonb_build_object('valid', false,
      'errors', jsonb_build_array('output_json is not an object'));
  end if;

  if jsonb_typeof(p_source_records) <> 'array' or jsonb_array_length(p_source_records) = 0 then
    v_errors := v_errors || jsonb_build_array('source_records is empty');
  end if;

  foreach v_language in array array['fr', 'en'] loop
    v_item := p_output_json -> v_language;

    if jsonb_typeof(v_item) <> 'object' then
      v_errors := v_errors || jsonb_build_array(format('%s half is missing', v_language));
      continue;
    end if;

    v_job_type := v_item ->> 'content_type';

    if c_required -> v_job_type is null then
      v_errors := v_errors || jsonb_build_array(
        format('%s: unknown content_type %s', v_language, coalesce(v_job_type, '<null>')));
      continue;
    end if;

    if (v_item ->> 'language') is distinct from v_language then
      v_errors := v_errors || jsonb_build_array(
        format('%s half declares language %s', v_language, coalesce(v_item ->> 'language', '<null>')));
    end if;

    v_errors := v_errors || coalesce((
      select jsonb_agg(format('%s: missing %s', v_language, key))
      from jsonb_array_elements_text(c_required -> v_job_type) key
      where coalesce(v_item ->> key, '') = ''
    ), '[]'::jsonb);

    -- The word range that IS in this repository:
    -- supabase/migrations/20260831021509_align_production_newsletter_word_range_220_275.
    if v_job_type = 'newsletter_article' and coalesce(v_item ->> 'body_md', '') <> '' then
      v_words := array_length(
        regexp_split_to_array(btrim(v_item ->> 'body_md'), '\s+'), 1);

      if v_words < 220 or v_words > 275 then
        v_errors := v_errors || jsonb_build_array(
          format('%s: newsletter body is %s words, range is 220-275', v_language, v_words));
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'job_id', p_job_id,
    'errors', v_errors,
    'validator', 'LOCAL HARNESS STAND-IN — supabase-staging/supabase/tests/local_harness.sql');
end;
$$;

-- ---------------------------------------------------------------------------
-- trg_enforce_production_batch_mode on public.automation_batches
-- ---------------------------------------------------------------------------
-- Also remote-only, and the gate suite names it directly: tests 6 and 7 disable
-- it, plant a batch it would have refused, re-enable it, and then check that
-- the gate refuses the batch too — "to prove the gate is a second, independent
-- line of defence rather than a restatement of the trigger" (test comment,
-- line 450). `alter table ... disable trigger` on a trigger that does not exist
-- is an error, so without this the suite dies at test 6 with every earlier
-- check already passed and nothing to show for them.
--
-- The rule is exactly what the two tests plant against: a batch must target the
-- production project, and must be one of the two real edition kinds. `test` and
-- `regular` are the kinds test 7 rejects by name.

create or replace function public.enforce_production_batch_mode()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(new.target_project_ref, '') <> 'wkbviidrbmehmjbhvpeh' then
    raise exception 'a batch must target the production project, not %',
      coalesce(new.target_project_ref, '<null>')
      using errcode = '22023';
  end if;

  if new.edition_kind not in ('daily', 'weekly_digest') then
    raise exception 'edition_kind must be daily or weekly_digest, not %', new.edition_kind
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_production_batch_mode on public.automation_batches;

-- INSERT, plus UPDATE of only the two guarded columns.
--
-- Not `before insert or update`: the gate's own refresh_batch_status writes
-- status and the job counters back onto a batch it is in the middle of
-- judging, including the deliberately wrong-target batch test 6 plants. A
-- blanket UPDATE trigger turns that write into an exception and the gate never
-- reaches its verdict — the test's whole point being that the gate reaches one
-- on its own. The trigger guards how a batch is CREATED and stops those two
-- fields being edited afterwards; it has no opinion on bookkeeping.
create trigger trg_enforce_production_batch_mode
before insert or update of target_project_ref, edition_kind
on public.automation_batches
for each row execute function public.enforce_production_batch_mode();

revoke all on function public.refresh_batch_status(uuid) from public, anon, authenticated;
revoke all on function public.get_ready_batch_payload(date) from public, anon, authenticated;
revoke all on function public.mark_batch_published(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.validate_generation_output(uuid, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.refresh_batch_status(uuid) to service_role, postgres;
grant execute on function public.get_ready_batch_payload(date) to service_role, postgres;
grant execute on function public.mark_batch_published(uuid, text, text, jsonb) to service_role, postgres;
grant execute on function public.validate_generation_output(uuid, jsonb, jsonb) to service_role, postgres;

commit;
