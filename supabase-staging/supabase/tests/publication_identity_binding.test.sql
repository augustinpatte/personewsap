-- Publication identity binding — STAGING project.
--
-- Proves 20261005190000_publication_identity_binding: the payload the plan
-- hands the publisher is made of exactly the outputs and reviews the gate
-- verified, or the plan refuses with verified_payload_identity_mismatch.
--
-- Runs against the real assert_edition_publishable, get_scheduled_edition_publish_plan
-- and bind_payload_to_verified_identities, with the local harness stand-in for
-- the live-only get_ready_batch_payload (tests/local_harness.sql). One
-- transaction, rolled back.
--
-- Run locally:
--   node scripts/local-sql-tests.mjs staging-identity-binding
--
-- The final SELECT is the report: `failed` must be 0.

begin;

create temp table ib_results (seq int, test text, expectation text, observed text, pass boolean);

create or replace function pg_temp.record(p_seq int, p_test text, p_expected text, p_observed text)
returns void language sql as $$
  insert into ib_results
  values (p_seq, p_test, p_expected, coalesce(p_observed, 'NULL'), p_expected = coalesce(p_observed, 'NULL'));
$$;

-- 'ok' or the codes and fields of the refusal, compactly.
create or replace function pg_temp.bind_verdict(p_gate jsonb, p_payload jsonb) returns text
language sql as $$
  select case when (b->>'ok')::boolean then 'ok'
         else (select string_agg(distinct x->>'code', ',') from jsonb_array_elements(b->'blockers') x)
              || coalesce(':' || (select string_agg(f, ',' order by f)
                                  from jsonb_array_elements(b->'blockers') x,
                                       jsonb_array_elements_text(coalesce(x->'fields', '[]'::jsonb)) f), '')
         end
  from (select public.bind_payload_to_verified_identities(p_gate, p_payload) as b) s;
$$;

-- A job of the fixture batch, by its slot.
create or replace function pg_temp.job_of(p_date date, p_topic text, p_ordinal int) returns uuid
language sql as $$
  select j.id from public.generation_jobs j
  join public.automation_batches b on b.id = j.batch_id
  where b.edition_date = p_date and j.topic = p_topic and j.ordinal = p_ordinal
    and j.content_type = 'newsletter_article';
$$;

-- A newer output for a job, at its current attempt, landing "now".
create or replace function pg_temp.newer_output(p_job uuid, p_same_bytes boolean, p_reviewed boolean default true) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.generation_outputs (job_id, attempt, worker_id, prompt_version, output_json, source_records, submitted_at)
  select o.job_id, o.attempt, 'personews-generator-b', o.prompt_version,
         case when p_same_bytes then o.output_json
              else jsonb_set(o.output_json, '{en,title}', '"A different article"') end,
         o.source_records, o.submitted_at + interval '1 minute'
  from public.generation_outputs o
  where o.job_id = p_job
  order by o.submitted_at desc
  limit 1
  returning id into v_id;

  -- An approved review of its own, as good as the verified one: having a
  -- review must not make an unverified output publishable.
  if p_reviewed then
    insert into public.generation_reviews (job_id, output_id, reviewer_id, verdict, score, checks, reviewed_at)
    select r.job_id, v_id, r.reviewer_id, r.verdict, r.score, r.checks, r.reviewed_at + interval '1 minute'
    from public.generation_reviews r
    where r.job_id = p_job
    order by r.reviewed_at desc
    limit 1;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- E. Nothing moves between gate and payload: the plan publishes, bound
-- ---------------------------------------------------------------------------

select pg_temp.mk_edition('2027-03-01'::date, 'daily');

create temp table ib_plan as select public.get_scheduled_edition_publish_plan('2027-03-01') as p;

select pg_temp.record(1, 'E1 the plan passes and hands over a payload', 'true|true',
  (select (p->'gate'->>'ok') || '|' || (p->'ready_payload' is not null and jsonb_typeof(p->'ready_payload') = 'object')::text from ib_plan));

select pg_temp.record(2, 'E2 the gate names 23 distinct verified (job, output, review) triples', '23|23',
  (select jsonb_array_length(p->'gate'->'verified_identities')::text || '|' ||
          (select count(distinct e->>'job_id') from jsonb_array_elements(p->'gate'->'verified_identities') e)::text
   from ib_plan));

select pg_temp.record(3, 'E3 every payload job carries exactly the verified output and review ids', '23',
  (select count(*)::text
   from ib_plan, jsonb_array_elements(p->'ready_payload'->'jobs') j
   join jsonb_array_elements(p->'gate'->'verified_identities') e on e->>'job_id' = j->>'job_id'
   where j->>'output_id' = e->>'output_id' and j->>'review_id' = e->>'review_id'));

select pg_temp.record(4, 'E4 those ids are the rows the gate rule selects (current attempt, its review)', '23',
  (select count(*)::text
   from ib_plan, jsonb_array_elements(p->'ready_payload'->'jobs') j
   join public.generation_outputs o on o.id = (j->>'output_id')::uuid and o.job_id = (j->>'job_id')::uuid
   join public.generation_jobs gj on gj.id = o.job_id and gj.attempt_count = o.attempt
   join public.generation_reviews r on r.id = (j->>'review_id')::uuid and r.output_id = o.id));

select pg_temp.record(5, 'E5 the identity digest travels on the payload batch', 'true',
  (select (p->'ready_payload'->'batch'->>'verified_identity_digest') = (p->'gate'->>'verified_identity_digest')
          and length(p->'gate'->>'verified_identity_digest') = 32
   from ib_plan)::text);

select pg_temp.record(6, 'E6 the declaration added by 20260907180000 is still there', 'true',
  (select (p->'ready_payload'->'batch') ? 'scored_question_contract_version' from ib_plan)::text);

select pg_temp.record(7, 'E7 asking again (a catch-up tick, a retry) binds the same identities', 'true',
  ((select public.get_scheduled_edition_publish_plan('2027-03-01')->'gate'->>'verified_identity_digest')
   = (select p->'gate'->>'verified_identity_digest' from ib_plan))::text);

-- ---------------------------------------------------------------------------
-- D. The race: the gate verified O1/R1, a newer O2 lands, the builder picks O2
-- ---------------------------------------------------------------------------

create temp table ib_race as
select public.assert_edition_publishable('2027-03-01') as gate, null::jsonb as payload, null::uuid as o2;

update ib_race set o2 = pg_temp.newer_output(pg_temp.job_of('2027-03-01', 'law', 1), false);
update ib_race set payload = public.get_ready_batch_payload('2027-03-01');

select pg_temp.record(10, 'D1 the canonical builder did pick the newer output O2', 'true',
  (select exists (select 1 from jsonb_array_elements(payload->'jobs') j where (j->>'output_id')::uuid = o2) from ib_race)::text);

select pg_temp.record(11, 'D2 the binding refuses: O2 is not what the gate verified, approved review or not', 'verified_payload_identity_mismatch:output_id,output_json',
  (select pg_temp.bind_verdict(gate, payload) from ib_race));

select pg_temp.record(12, 'D3 the refusal names the job and both outputs', 'true',
  (select (b->'blockers'->0->>'job_id')::uuid = pg_temp.job_of('2027-03-01', 'law', 1)
          and (b->'blockers'->0->>'payload_output_id')::uuid = r.o2
          and (b->'blockers'->0->>'verified_output_id')::uuid <> r.o2
   from ib_race r, lateral (select public.bind_payload_to_verified_identities(r.gate, r.payload) as b) x)::text);

select pg_temp.mk_edition('2027-03-17'::date, 'daily');
create temp table ib_bare as
select public.assert_edition_publishable('2027-03-17') as gate, null::jsonb as payload;
select pg_temp.newer_output(pg_temp.job_of('2027-03-17', 'law', 2), false, false);
update ib_bare set payload = public.get_ready_batch_payload('2027-03-17');

select pg_temp.record(15, 'D6 an unreviewed O2 is refused on the output and on the review it lacks',
  'verified_payload_identity_mismatch:output_id,output_json,review_checks,review_score,review_verdict',
  (select pg_temp.bind_verdict(gate, payload) from ib_bare));

select pg_temp.record(13, 'D4 a builder that does not name its output is caught by the bytes', 'verified_payload_identity_mismatch:output_json',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs}',
            (select jsonb_agg(j - 'output_id') from jsonb_array_elements(payload->'jobs') j)))
   from ib_race));

-- Same bytes, different row: the ids alone must still refuse it.
select pg_temp.mk_edition('2027-03-15'::date, 'daily');
create temp table ib_twin as
select public.assert_edition_publishable('2027-03-15') as gate, null::jsonb as payload;
select pg_temp.newer_output(pg_temp.job_of('2027-03-15', 'medicine', 2), true);
update ib_twin set payload = public.get_ready_batch_payload('2027-03-15');

select pg_temp.record(14, 'D5 a byte-identical O2 is still not O1: refused on the id', 'verified_payload_identity_mismatch:output_id',
  (select pg_temp.bind_verdict(gate, payload) from ib_twin));

-- ---------------------------------------------------------------------------
-- P. The same race inside ONE plan call: the plan refuses, publishes nothing
-- ---------------------------------------------------------------------------
-- The builder is wrapped so that, the first time the plan calls it, a newer
-- output lands first — after the gate, before the payload.

select pg_temp.mk_edition('2027-03-03'::date, 'daily');

alter function public.get_ready_batch_payload(date) rename to get_ready_batch_payload_inner;
create temp table ib_race_once (fired boolean);
create function public.get_ready_batch_payload(p_edition_date date) returns jsonb
language plpgsql volatile set search_path to 'public', 'pg_temp' as $$
begin
  if not exists (select 1 from ib_race_once) then
    insert into ib_race_once values (true);
    perform pg_temp.newer_output(pg_temp.job_of(p_edition_date, 'finance', 2), false);
  end if;
  return public.get_ready_batch_payload_inner(p_edition_date);
end $$;

create temp table ib_raced_plan as select public.get_scheduled_edition_publish_plan('2027-03-03') as p;

select pg_temp.record(20, 'P1 the plan refuses with the identity blocker', 'false|verified_payload_identity_mismatch',
  (select (p->'gate'->>'ok') || '|' || (p->'gate'->>'reason') from ib_raced_plan));

select pg_temp.record(21, 'P2 and hands the publisher no payload at all', 'true',
  (select (p->'ready_payload') is null or jsonb_typeof(p->'ready_payload') = 'null' from ib_raced_plan)::text);

select pg_temp.record(22, 'P3 the blocker is in the run audit''s gate verdict', 'true',
  (select exists (select 1 from jsonb_array_elements(p->'gate'->'blockers') x
                  where x->>'code' = 'verified_payload_identity_mismatch') from ib_raced_plan)::text);

drop function public.get_ready_batch_payload(date);
alter function public.get_ready_batch_payload_inner(date) rename to get_ready_batch_payload;

-- The next tick sees the newer output with no review: the gate itself stops it.
-- The next tick judges the newer output on its own review, and binds THAT.
select pg_temp.record(23, 'P4 the next tick verifies the newer output and binds it consistently', 'true|true',
  (select (p->'gate'->>'ok') || '|' ||
          ((select j->>'output_id' from jsonb_array_elements(p->'ready_payload'->'jobs') j
            where (j->>'job_id')::uuid = pg_temp.job_of('2027-03-03', 'finance', 2))
           = (select e->>'output_id' from jsonb_array_elements(p->'gate'->'verified_identities') e
              where (e->>'job_id')::uuid = pg_temp.job_of('2027-03-03', 'finance', 2)))::text
   from (select public.get_scheduled_edition_publish_plan('2027-03-03') as p) s));

-- ---------------------------------------------------------------------------
-- R. A review changed or swapped between gate and payload
-- ---------------------------------------------------------------------------

select pg_temp.mk_edition('2027-03-05'::date, 'daily');
create temp table ib_rev as
select public.assert_edition_publishable('2027-03-05') as gate,
       public.get_ready_batch_payload('2027-03-05') as payload;

select pg_temp.record(30, 'R1 untouched, gate and builder agree', 'ok',
  (select pg_temp.bind_verdict(gate, payload) from ib_rev));

select pg_temp.record(31, 'R2 a payload carrying another review''s score is refused', 'verified_payload_identity_mismatch:review_score',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs,0,review,score}', '91')) from ib_rev));

select pg_temp.record(32, 'R3 a payload naming another review id is refused', 'verified_payload_identity_mismatch:review_id',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs,0,review_id}', to_jsonb(gen_random_uuid()::text))) from ib_rev));

select pg_temp.record(33, 'R4 failed checks in the payload review are refused', 'verified_payload_identity_mismatch:review_checks',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs,0,review,checks,safety}', 'false')) from ib_rev));

select pg_temp.record(34, 'R5 swapped sources are refused', 'verified_payload_identity_mismatch:source_records',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs,0,source_records}', '[{"url":"https://elsewhere.test/x"}]')) from ib_rev));

-- ---------------------------------------------------------------------------
-- C. One-to-one: 23 on both sides, no duplicate, missing or extra job
-- ---------------------------------------------------------------------------

select pg_temp.record(40, 'C1 a payload with 22 jobs is refused', 'verified_payload_identity_mismatch',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs}', (payload->'jobs') - 0)) from ib_rev));

select pg_temp.record(41, 'C2 a duplicated job (one dropped) is refused', 'verified_payload_identity_mismatch',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs,0}', payload->'jobs'->1)) from ib_rev));

select pg_temp.record(42, 'C3 an extra, unverified job is refused', 'verified_payload_identity_mismatch',
  (select pg_temp.bind_verdict(gate, jsonb_set(payload, '{jobs,0,job_id}', to_jsonb(gen_random_uuid()::text))) from ib_rev));

select pg_temp.record(43, 'C4 a gate verdict naming only 22 jobs binds nothing', 'verified_payload_identity_mismatch',
  (select pg_temp.bind_verdict(jsonb_set(gate, '{verified_identities}', (gate->'verified_identities') - 0), payload) from ib_rev));

select pg_temp.record(44, 'C5 a gate verdict without identities (an older gate) binds nothing', 'verified_payload_identity_mismatch',
  (select pg_temp.bind_verdict(gate - 'verified_identities', payload) from ib_rev));

select pg_temp.record(45, 'C6 the refusal message is diagnostic for a missing job', 'true',
  (select (public.bind_payload_to_verified_identities(gate, jsonb_set(payload, '{jobs,0,job_id}', to_jsonb(gen_random_uuid()::text)))
            ->'blockers'->0->>'jobs_missing_from_payload') is not null
   from ib_rev)::text);

-- ---------------------------------------------------------------------------
-- V. A revision is a new attempt, verified and bound as such
-- ---------------------------------------------------------------------------
-- A job sent back and redone: attempt 2 carries the new output and its review.

select pg_temp.mk_edition('2027-03-07'::date, 'weekly_digest');

do $$
declare v_job uuid; v_out uuid;
begin
  select j.id into v_job from public.generation_jobs j join public.automation_batches b on b.id = j.batch_id
  where b.edition_date = '2027-03-07' and j.content_type = 'business_story';

  update public.generation_jobs set attempt_count = 2 where id = v_job;

  insert into public.generation_outputs (job_id, attempt, worker_id, prompt_version, output_json, source_records, submitted_at)
  select job_id, 2, 'personews-generator-b', prompt_version,
         jsonb_set(output_json, '{en,title}', '"The revised story"'), source_records, submitted_at + interval '1 hour'
  from public.generation_outputs where job_id = v_job and attempt = 1
  returning id into v_out;

  insert into public.generation_reviews (job_id, output_id, reviewer_id, verdict, score, checks, reviewed_at)
  select job_id, v_out, reviewer_id, 'approved', 93, checks, reviewed_at + interval '2 hours'
  from public.generation_reviews where job_id = v_job;
end $$;

select pg_temp.record(50, 'V1 the revised attempt is verified and bound: the plan passes', 'true',
  (select public.get_scheduled_edition_publish_plan('2027-03-07')->'gate'->>'ok'));

select pg_temp.record(51, 'V2 the payload carries attempt 2''s output and its review', '2|93',
  (select (j->>'output_attempt') || '|' || (j->'review'->>'score')
   from jsonb_array_elements(public.get_scheduled_edition_publish_plan('2027-03-07')->'ready_payload'->'jobs') j
   where j->>'content_type' = 'business_story'));

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
select
  (select count(*) from ib_results) as checks,
  (select count(*) from ib_results where pass) as passed,
  (select count(*) from ib_results where not pass) as failed,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'test', test, 'expected', expectation, 'observed', observed) order by seq), '[]'::jsonb)
   from ib_results where not pass) as failures;

rollback;
