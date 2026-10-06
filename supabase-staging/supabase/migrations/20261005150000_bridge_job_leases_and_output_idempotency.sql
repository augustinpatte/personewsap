-- Generator job leases and output idempotency for the task bridge — STAGING.
--
-- WHAT WAS WRONG
--
-- personews-task-bridge `action=jobs` handed a generator every queued or
-- revision_required job of its shard WITHOUT claiming them. generation_jobs has
-- had claimed_by / claimed_at / lease_expires_at columns all along, unused by
-- the bridge. So a Scheduled Task that ran twice, or overlapped its own retry,
-- regenerated the same jobs, and two outputs could land for the same attempt.
-- The gate then took the newest by submitted_at, which could orphan a review
-- written against the older one and cost the edition.
--
-- WHAT THIS DOES
--
-- 1. bridge_claim_generation_jobs(job_ids, worker, lease): an atomic claim.
--    A job is claimable when it is queued or revision_required (a reviewed
--    attempt that must be redone) AND it has no live lease or the lease is
--    the caller's own. FOR UPDATE SKIP LOCKED plus the re-checked predicate
--    means two concurrent calls never both receive the same job. An expired
--    lease is reclaimable; a live one is never stolen; a job in any other
--    status (submitted, reviewing, approved, failed) is never handed out.
--
-- 2. bridge_submit_output_once(...): the only way the bridge records an output.
--    One output per (job, claim). Under a per-job lock it:
--      - refuses a submission from a worker that does not hold the live lease;
--      - returns the existing output for an IDENTICAL resubmission (a retried
--        commit), writing nothing;
--      - refuses a DIFFERENT output for the same claim instead of letting two
--        siblings compete on "latest wins";
--      - otherwise calls the existing chatgpt_bridge_submit_output, records
--        the submission in bridge_output_submissions and releases the lease.
--
-- The generation content contract, the reviewer rules and the 23-job
-- composition are untouched. chatgpt_bridge_submit_output itself (a live-only,
-- unversioned function) is called exactly as before.
--
-- Forward-only, additive.

begin;

-- ---------------------------------------------------------------------------
-- 1. The submission ledger
-- ---------------------------------------------------------------------------

create table if not exists public.bridge_output_submissions (
  job_id uuid not null references public.generation_jobs (id) on delete cascade,
  -- The claim the output was produced under (generation_jobs.claimed_at at
  -- submission). 'epoch' for a job submitted without any claim (a task still
  -- on the old contract).
  claim_started_at timestamptz not null,
  output_id uuid,
  payload_hash text not null,
  worker_id text not null,
  submitted_at timestamptz not null default now(),
  primary key (job_id, claim_started_at)
);

comment on table public.bridge_output_submissions is
  'One accepted generator output per (job, claim). An identical resubmission returns the recorded output; a different one is refused.';

alter table public.bridge_output_submissions enable row level security;
revoke all on table public.bridge_output_submissions from public, anon, authenticated;
grant select, insert, update, delete on table public.bridge_output_submissions to service_role;

-- ---------------------------------------------------------------------------
-- 2. Claiming
-- ---------------------------------------------------------------------------

create or replace function public.bridge_claim_generation_jobs(
  p_job_ids uuid[],
  p_worker_id text,
  p_lease_seconds integer default 2700,
  p_at timestamptz default now()
)
returns table (job_id uuid, lease_expires_at timestamptz, claimed_at timestamptz)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if p_worker_id is null or p_worker_id !~ '^personews-generator-[a-z0-9-]+$' then
    raise exception 'bridge claim refused: invalid worker id %', coalesce(p_worker_id, '<null>')
      using errcode = '22023';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 21600 then
    raise exception 'bridge claim refused: lease must be between 60 and 21600 seconds'
      using errcode = '22023';
  end if;

  return query
  with claimable as (
    select j.id
    from public.generation_jobs j
    where j.id = any(coalesce(p_job_ids, array[]::uuid[]))
      and j.status in ('queued', 'revision_required')
      and (
        j.lease_expires_at is null
        or j.lease_expires_at <= p_at
        or j.claimed_by = p_worker_id
      )
    order by j.id
    for update skip locked
  )
  update public.generation_jobs j
  set claimed_by = p_worker_id,
      -- A fresh claim starts a new claim window; the holder renewing its own
      -- live lease keeps the window it already has.
      claimed_at = case
        when j.claimed_by = p_worker_id and j.lease_expires_at > p_at then j.claimed_at
        else p_at
      end,
      lease_expires_at = p_at + make_interval(secs => p_lease_seconds),
      updated_at = p_at
  from claimable c
  where j.id = c.id
  returning j.id, j.lease_expires_at, j.claimed_at;
end;
$function$;

comment on function public.bridge_claim_generation_jobs(uuid[], text, integer, timestamptz) is
  'Atomically leases the given queued/revision_required jobs to one generator worker. Live leases are never stolen; expired ones are reclaimed; the holder renews its own. Returns only the jobs this caller now holds.';

-- ---------------------------------------------------------------------------
-- 3. Submitting, once
-- ---------------------------------------------------------------------------

create or replace function public.bridge_submit_output_once(
  p_job_id uuid,
  p_worker_id text,
  p_output_json jsonb,
  p_source_records jsonb,
  p_prompt_version text,
  p_edition_date date,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.generation_jobs%rowtype;
  v_claim timestamptz;
  v_hash text := md5(coalesce(p_output_json::text, 'null') || '|' || coalesce(p_source_records::text, 'null'));
  v_existing public.bridge_output_submissions%rowtype;
  v_output_id uuid;
begin
  -- One decision per job at a time: two concurrent commits for the same job
  -- serialise here.
  perform pg_advisory_xact_lock(hashtext('personews:job-output:' || p_job_id::text));

  select * into v_job from public.generation_jobs where id = p_job_id for update;

  if not found then
    return jsonb_build_object('status', 'job_not_found', 'job_id', p_job_id);
  end if;

  if v_job.lease_expires_at is not null
     and v_job.lease_expires_at > p_at
     and v_job.claimed_by is distinct from p_worker_id then
    return jsonb_build_object(
      'status', 'lease_held_by_other_worker', 'job_id', p_job_id,
      'lease_expires_at', v_job.lease_expires_at);
  end if;

  v_claim := coalesce(v_job.claimed_at, timestamptz 'epoch');

  select * into v_existing
  from public.bridge_output_submissions s
  where s.job_id = p_job_id and s.claim_started_at = v_claim;

  if found then
    return jsonb_build_object(
      'status', case when v_existing.payload_hash = v_hash then 'duplicate_identical' else 'duplicate_conflict' end,
      'job_id', p_job_id,
      'output_id', v_existing.output_id);
  end if;

  if v_job.status not in ('queued', 'revision_required') then
    return jsonb_build_object('status', 'not_submittable', 'job_id', p_job_id, 'job_status', v_job.status);
  end if;

  v_output_id := public.chatgpt_bridge_submit_output(
    p_job_id, p_worker_id, p_output_json, p_source_records, p_prompt_version, p_edition_date);

  insert into public.bridge_output_submissions (job_id, claim_started_at, output_id, payload_hash, worker_id, submitted_at)
  values (p_job_id, v_claim, v_output_id, v_hash, p_worker_id, p_at);

  -- The claim has produced its output: release it so a revision can be
  -- claimed afresh. claimed_by stays as the record of who produced it.
  update public.generation_jobs
  set lease_expires_at = p_at, updated_at = p_at
  where id = p_job_id;

  return jsonb_build_object('status', 'submitted', 'job_id', p_job_id, 'output_id', v_output_id);
end;
$function$;

comment on function public.bridge_submit_output_once(uuid, text, jsonb, jsonb, text, date, timestamptz) is
  'Records a generator output at most once per (job, claim): submitted | duplicate_identical (retry, nothing written) | duplicate_conflict (refused) | lease_held_by_other_worker | not_submittable | job_not_found. Calls chatgpt_bridge_submit_output for the one real submission.';

-- ---------------------------------------------------------------------------
-- 4. Verification: outputs that already compete for one attempt
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_generation_outputs(p_edition_date date default null)
returns table (job_id uuid, attempt integer, outputs bigint, latest_submitted_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select o.job_id, o.attempt, count(*), max(o.submitted_at)
  from public.generation_outputs o
  join public.generation_jobs j on j.id = o.job_id
  join public.automation_batches b on b.id = j.batch_id
  where p_edition_date is null or b.edition_date = p_edition_date
  group by o.job_id, o.attempt
  having count(*) > 1
  order by max(o.submitted_at) desc;
$function$;

comment on function public.duplicate_generation_outputs(date) is
  'Read-only: jobs with more than one output for the same attempt (what leasing now prevents).';

do $grants$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.bridge_claim_generation_jobs(uuid[], text, integer, timestamptz)',
    'public.bridge_submit_output_once(uuid, text, jsonb, jsonb, text, date, timestamptz)',
    'public.duplicate_generation_outputs(date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role, postgres', v_signature);
  end loop;
end;
$grants$;

commit;
