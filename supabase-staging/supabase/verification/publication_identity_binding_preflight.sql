-- Preflight for 20261005190000_publication_identity_binding — STAGING.
-- Run BEFORE applying that migration. Writes nothing (begin … rollback).
--
-- The binding refuses a payload unless every job carries the gate's selected
-- output byte for byte (output_json, source_records) and that output's latest
-- review (verdict, score, checks). The canonical builder, get_ready_batch_payload,
-- lives only in this project and is not versioned, so this checks that it really
-- does what the binding assumes — on real batches — before the binding can stop
-- an edition over a formatting difference.
--
-- Set the date to a recent edition whose batch is complete (ready or published).
-- Expected: 23 rows, every *_equal column true. Any false means: do NOT deploy the
-- migration; the builder transforms what it returns and the binding must learn
-- that transformation first. The two names_* columns say whether the builder
-- names its output and review (the binding uses them when present).

begin;

with params as (
  select date '2026-10-05' as edition_date        -- <<< a recent edition date
),
payload as (
  select public.get_ready_batch_payload((select edition_date from params)) as p
),
jobs as (
  select j as payload_job, (j->>'job_id')::uuid as job_id
  from payload, jsonb_array_elements(coalesce(p->'jobs', '[]'::jsonb)) j
),
gate_output as (
  -- The gate's rule (assert_edition_publishable): the output at the job's
  -- current attempt, latest submitted; then that output's latest review.
  select distinct on (gj.id) gj.id as job_id, o.id, o.output_json, o.source_records
  from public.generation_jobs gj
  join public.generation_outputs o on o.job_id = gj.id and o.attempt = gj.attempt_count
  where gj.id in (select job_id from jobs)
  order by gj.id, o.submitted_at desc
),
gate_review as (
  select distinct on (r.output_id) r.*
  from public.generation_reviews r
  where r.output_id in (select id from gate_output)
  order by r.output_id, r.reviewed_at desc
)
select
  jobs.job_id,
  jobs.payload_job ? 'output_id'                                         as names_output,
  (jobs.payload_job ? 'review_id' or jobs.payload_job->'review' ? 'id')   as names_review,
  (not (jobs.payload_job ? 'output_id') or jobs.payload_job->>'output_id' = go.id::text) as output_id_equal,
  (jobs.payload_job->'output_json') = go.output_json                     as output_json_equal,
  (jobs.payload_job->'source_records') = go.source_records               as source_records_equal,
  (jobs.payload_job->'review'->>'verdict') = gr.verdict                  as review_verdict_equal,
  (jobs.payload_job->'review'->>'score')::numeric = gr.score::numeric    as review_score_equal,
  (jobs.payload_job->'review'->'checks') = gr.checks                     as review_checks_equal
from jobs
left join gate_output go on go.job_id = jobs.job_id
left join gate_review gr on gr.output_id = go.id
order by jobs.job_id;

rollback;
