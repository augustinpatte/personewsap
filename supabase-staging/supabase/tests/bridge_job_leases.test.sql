-- Generator job leases and output idempotency — STAGING project.
--
-- Proves 20261005150000_bridge_job_leases_and_output_idempotency. The migration
-- is inlined by the runner; this transaction ends in ROLLBACK.
--
-- chatgpt_bridge_submit_output exists only in the live staging project and has
-- never been committed. A stand-in below records an output at attempt_count+1
-- and marks the job submitted, which is the behaviour the bridge relies on.
-- The assertions are about the new functions, not about that stand-in.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs staging-bridge-leases
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table bl_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into bl_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

create or replace function public.chatgpt_bridge_submit_output(
  p_job_id uuid, p_worker_id text, p_output_json jsonb, p_source_records jsonb,
  p_prompt_version text, p_edition_date date
) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  update public.generation_jobs set attempt_count = attempt_count + 1, status = 'submitted' where id = p_job_id;
  insert into public.generation_outputs (job_id, attempt, worker_id, prompt_version, output_json, source_records)
  select p_job_id, j.attempt_count, p_worker_id, p_prompt_version, p_output_json, coalesce(p_source_records, '[]'::jsonb)
  from public.generation_jobs j where j.id = p_job_id
  returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.t(p_minute int) returns timestamptz language sql immutable as $$
  select timestamptz '2030-07-01 08:00:00+00' + make_interval(mins => p_minute)
$$;

create or replace function pg_temp.j(p_n int) returns uuid language sql immutable as $$
  select ('b1000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create or replace function pg_temp.claimed(p_worker text, p_minute int, p_lease int default 2700) returns text
language sql as $$
  select coalesce(string_agg(right(c.job_id::text, 2), ',' order by c.job_id), '')
  from public.bridge_claim_generation_jobs(array[pg_temp.j(1), pg_temp.j(2), pg_temp.j(3), pg_temp.j(4)], p_worker, p_lease, pg_temp.t(p_minute)) c
$$;

insert into public.automation_batches (id, edition_date, edition_kind, status, prompt_bundle_version)
values ('b1000000-0000-4000-8000-0000000000ff', date '2030-07-01', 'weekly_digest', 'generating', 'test');

insert into public.generation_jobs (id, batch_id, content_type, topic, ordinal, status, prompt_key)
values
  (pg_temp.j(1), 'b1000000-0000-4000-8000-0000000000ff', 'newsletter_article', 'law', 1, 'queued', 'k'),
  (pg_temp.j(2), 'b1000000-0000-4000-8000-0000000000ff', 'newsletter_article', 'law', 2, 'queued', 'k'),
  (pg_temp.j(3), 'b1000000-0000-4000-8000-0000000000ff', 'newsletter_article', 'tech_ai', 1, 'approved', 'k'),
  (pg_temp.j(4), 'b1000000-0000-4000-8000-0000000000ff', 'newsletter_article', 'tech_ai', 2, 'revision_required', 'k');

-- ---------------------------------------------------------------------------
-- A / C. Claims are exclusive; finished jobs are never handed out
-- ---------------------------------------------------------------------------

select pg_temp.record(1, 'A1 worker a claims the claimable jobs (queued + revision_required), not the approved one', '01,02,04',
  pg_temp.claimed('personews-generator-a', 0));

select pg_temp.record(2, 'A2 worker b, a minute later, gets none of them', '',
  pg_temp.claimed('personews-generator-b', 1));

select pg_temp.record(3, 'A3 worker a asking again (a retried fetch) gets its own jobs back', '01,02,04',
  pg_temp.claimed('personews-generator-a', 2));

select pg_temp.record(4, 'A4 renewing keeps the original claim window', '2030-07-01 08:00',
  (select to_char(claimed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.generation_jobs where id = pg_temp.j(1)));

select pg_temp.record(5, 'C1 the approved job is never claimed by anyone', 'NULL',
  (select claimed_by from public.generation_jobs where id = pg_temp.j(3)));

select pg_temp.record(6, 'A5 the claim takes row locks with SKIP LOCKED, so concurrent callers cannot both get a job', 'true',
  (pg_get_functiondef('public.bridge_claim_generation_jobs(uuid[],text,integer,timestamptz)'::regprocedure)
     like '%for update skip locked%')::text);

do $$
declare v_state text := 'none';
begin
  begin
    perform public.bridge_claim_generation_jobs(array[pg_temp.j(1)], 'anyone', 2700, pg_temp.t(3));
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.record(7, 'A6 a malformed worker id is refused', '22023', v_state);
end $$;

-- ---------------------------------------------------------------------------
-- B. Expired leases are reclaimed
-- ---------------------------------------------------------------------------

-- Worker a's lease (45 minutes from minute 2) has run out by minute 50.
select pg_temp.record(10, 'B1 after the lease expires, worker b can take the jobs over', '01,02,04',
  pg_temp.claimed('personews-generator-b', 50));

select pg_temp.record(11, 'B2 with a fresh claim window', '2030-07-01 08:50',
  (select to_char(claimed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.generation_jobs where id = pg_temp.j(1)));

-- ---------------------------------------------------------------------------
-- D / E. Outputs: once per claim
-- ---------------------------------------------------------------------------

create temp table bl_submit as
select public.bridge_submit_output_once(pg_temp.j(1), 'personews-generator-a',
  '{"fr":{"title":"A"},"en":{"title":"A"}}', '[]', 'v1', date '2030-07-01', pg_temp.t(55)) as r;

select pg_temp.record(20, 'D1 a worker that does not hold the live lease cannot submit', 'lease_held_by_other_worker',
  (select r->>'status' from bl_submit));

create temp table bl_submit_b as
select public.bridge_submit_output_once(pg_temp.j(1), 'personews-generator-b',
  '{"fr":{"title":"B"},"en":{"title":"B"}}', '[]', 'v1', date '2030-07-01', pg_temp.t(55)) as r;

select pg_temp.record(21, 'D2 the lease holder submits', 'submitted',
  (select r->>'status' from bl_submit_b));

select pg_temp.record(22, 'E1 retrying the exact same submission writes nothing and returns the same output', 'duplicate_identical|true|1',
  (select (r->>'status') || '|' || ((r->>'output_id') = (select r2->>'output_id' from (select r as r2 from bl_submit_b) x))::text
          || '|' || (select count(*) from public.generation_outputs where job_id = pg_temp.j(1))
   from (select public.bridge_submit_output_once(pg_temp.j(1), 'personews-generator-b',
           '{"fr":{"title":"B"},"en":{"title":"B"}}', '[]', 'v1', date '2030-07-01', pg_temp.t(56)) as r) s));

select pg_temp.record(23, 'D3 a different output for the same claim is refused, not a competing sibling', 'duplicate_conflict|1',
  (select (r->>'status') || '|' || (select count(*) from public.generation_outputs where job_id = pg_temp.j(1))
   from (select public.bridge_submit_output_once(pg_temp.j(1), 'personews-generator-b',
           '{"fr":{"title":"B2"},"en":{"title":"B2"}}', '[]', 'v1', date '2030-07-01', pg_temp.t(57)) as r) s));

-- Separate statement: proves E1 and D3 really wrote nothing.
select pg_temp.record(26, 'E2 after the retry and the conflicting attempt, the job still has exactly one output', '1',
  (select count(*)::text from public.generation_outputs where job_id = pg_temp.j(1)));

select pg_temp.record(24, 'D4 submitting releases the lease (so a revision can be claimed afresh)', 'true',
  ((select lease_expires_at from public.generation_jobs where id = pg_temp.j(1)) <= pg_temp.t(55))::text);

select pg_temp.record(25, 'C2 a submitted job is not claimable again', '',
  (select coalesce(string_agg(c.job_id::text, ','), '')
   from public.bridge_claim_generation_jobs(array[pg_temp.j(1)], 'personews-generator-c', 2700, pg_temp.t(60)) c));

-- ---------------------------------------------------------------------------
-- R. A revision is a new attempt under a new claim
-- ---------------------------------------------------------------------------

update public.generation_jobs set status = 'revision_required' where id = pg_temp.j(1);

select pg_temp.record(30, 'R1 the reviewer sends it back; it can be claimed again', '01',
  (select coalesce(string_agg(right(c.job_id::text, 2), ','), '')
   from public.bridge_claim_generation_jobs(array[pg_temp.j(1)], 'personews-generator-c', 2700, pg_temp.t(70)) c));

create temp table bl_submit_c as
select public.bridge_submit_output_once(pg_temp.j(1), 'personews-generator-c',
  '{"fr":{"title":"C"},"en":{"title":"C"}}', '[]', 'v2', date '2030-07-01', pg_temp.t(71)) as r;

-- A separate statement, so the count sees the new output.
select pg_temp.record(31, 'R2 and the new attempt is accepted as a new output', 'submitted|2',
  (select (r->>'status') || '|' || (select count(*) from public.generation_outputs where job_id = pg_temp.j(1))
   from bl_submit_c));

select pg_temp.record(32, 'R3 one output per attempt, as the gate expects', '0',
  (select count(*)::text from public.duplicate_generation_outputs(date '2030-07-01')));

select pg_temp.record(33, 'N1 an unknown job is reported, not raised', 'job_not_found',
  public.bridge_submit_output_once('b1000000-0000-4000-8000-0000000000ee', 'personews-generator-a', '{}', '[]', 'v1', date '2030-07-01')->>'status');

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from bl_results) as checks,
  (select count(*) from bl_results where pass) as passed,
  (select count(*) from bl_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from bl_results where not pass) as failures;

rollback;
