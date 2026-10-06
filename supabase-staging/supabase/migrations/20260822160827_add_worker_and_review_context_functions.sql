create or replace function public.claim_generation_job_context(
  p_worker_id text,
  p_limit integer default 8,
  p_lease_minutes integer default 90
)
returns setof jsonb
language plpgsql
as $$
begin
  return query
  with claimed as (
    select * from public.claim_generation_jobs(p_worker_id,p_limit,p_lease_minutes)
  ), latest_memory as (
    select public.latest_editorial_memory_snapshot() as snapshot
  )
  select jsonb_build_object(
    'job', to_jsonb(c),
    'prompt', jsonb_build_object(
      'prompt_key', p.prompt_key,
      'version', p.version,
      'sha256', p.sha256,
      'metadata', p.metadata
    ),
    'canonical_output_contract', (select value from public.automation_config where key='canonical_output_contract'),
    'source_record_contract', (select value from public.automation_config where key='source_record_contract'),
    'editorial_memory', m.snapshot,
    'pipeline_config', (select value from public.automation_config where key='pipeline')
  )
  from claimed c
  join public.prompt_versions p on p.prompt_key=c.prompt_key and p.active=true
  cross join latest_memory m;
end;
$$;

create or replace function public.get_generation_review_queue(p_limit integer default 30)
returns setof jsonb
language sql
stable
as $$
select jsonb_build_object(
  'job', to_jsonb(j),
  'output', jsonb_build_object(
    'id',o.id,
    'attempt',o.attempt,
    'worker_id',o.worker_id,
    'prompt_version',o.prompt_version,
    'output_json',o.output_json,
    'source_records',o.source_records,
    'submitted_at',o.submitted_at
  ),
  'canonical_output_contract',(select value from public.automation_config where key='canonical_output_contract'),
  'source_record_contract',(select value from public.automation_config where key='source_record_contract'),
  'editorial_memory',public.latest_editorial_memory_snapshot()
)
from public.generation_jobs j
join public.generation_outputs o on o.job_id=j.id and o.attempt=j.attempt_count
left join public.generation_reviews r on r.output_id=o.id
where j.status='submitted' and r.id is null
order by o.submitted_at
limit greatest(1,least(p_limit,100));
$$;

create or replace function public.create_current_edition_batch(p_edition_kind text default 'regular')
returns uuid
language sql
volatile
as $$
  select public.create_edition_batch(current_date,p_edition_kind);
$$;

revoke all on function public.claim_generation_job_context(text,integer,integer) from public,anon,authenticated;
revoke all on function public.get_generation_review_queue(integer) from public,anon,authenticated;
revoke all on function public.create_current_edition_batch(text) from public,anon,authenticated;
;
