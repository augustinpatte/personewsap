create or replace function public.claim_generation_jobs_v2(
  p_worker_id text,
  p_limit integer default 8,
  p_lease_minutes integer default 120,
  p_edition_kind text default 'regular',
  p_edition_date date default current_date
)
returns setof public.generation_jobs
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_edition_kind not in ('regular','test') then raise exception 'invalid_edition_kind'; end if;

  return query
  with candidates as (
    select j.id
    from public.generation_jobs j
    join public.automation_batches b on b.id=j.batch_id
    where b.edition_kind=p_edition_kind
      and b.edition_date=p_edition_date
      and b.status not in ('published','cancelled')
      and (
        j.status='queued'
        or (j.status='claimed' and j.lease_expires_at<now())
        or (j.status='revision_required' and j.attempt_count<j.max_attempts)
      )
      and j.attempt_count<j.max_attempts
    order by j.created_at,j.ordinal
    for update of j skip locked
    limit greatest(1,least(p_limit,20))
  )
  update public.generation_jobs j
  set status='claimed',
      claimed_by=p_worker_id,
      claimed_at=now(),
      lease_expires_at=now()+make_interval(mins=>greatest(5,least(p_lease_minutes,240))),
      attempt_count=j.attempt_count+1,
      updated_at=now(),
      last_error=null
  from candidates c
  where j.id=c.id
  returning j.*;
end;
$$;

create or replace function public.claim_generation_job_context_v2(
  p_worker_id text,
  p_limit integer default 8,
  p_lease_minutes integer default 120,
  p_edition_kind text default 'regular',
  p_edition_date date default current_date
)
returns setof jsonb
language sql
volatile
set search_path = public, pg_temp
as $$
with claimed as (
  select * from public.claim_generation_jobs_v2(p_worker_id,p_limit,p_lease_minutes,p_edition_kind,p_edition_date)
)
select jsonb_build_object(
  'job',to_jsonb(c),
  'batch',jsonb_build_object('edition_kind',b.edition_kind,'edition_date',b.edition_date,'status',b.status,'prompt_bundle_version',b.prompt_bundle_version),
  'prompt',jsonb_build_object('prompt_key',p.prompt_key,'version',p.version,'sha256',p.sha256,'metadata',p.metadata),
  'canonical_output_contract',(select value from public.automation_config where key='canonical_output_contract'),
  'source_record_contract',(select value from public.automation_config where key='source_record_contract'),
  'editorial_memory',public.latest_editorial_memory_snapshot(),
  'pipeline_config',(select value from public.automation_config where key='pipeline')
)
from claimed c
join public.automation_batches b on b.id=c.batch_id
join public.prompt_versions p on p.prompt_key=c.prompt_key and p.active=true;
$$;

create or replace function public.get_generation_review_queue_v3(
  p_limit integer default 30,
  p_edition_kind text default 'regular',
  p_edition_date date default current_date
)
returns setof jsonb
language sql
stable
set search_path = public, pg_temp
as $$
select jsonb_build_object(
  'batch',jsonb_build_object('id',b.id,'edition_kind',b.edition_kind,'edition_date',b.edition_date,'status',b.status),
  'job',to_jsonb(j),
  'output',jsonb_build_object(
    'id',o.id,'attempt',o.attempt,'worker_id',o.worker_id,'prompt_version',o.prompt_version,
    'output_json',o.output_json,'source_records',o.source_records,'submitted_at',o.submitted_at
  ),
  'deterministic_preflight',public.validate_generation_output(j.id,o.output_json,o.source_records),
  'reviewer_prompt',(select jsonb_build_object('version',version,'content',content,'metadata',metadata) from public.prompt_versions where prompt_key='reviewer' and active=true limit 1),
  'review_policy',(select value from public.automation_config where key='review_policy'),
  'editorial_memory',public.latest_editorial_memory_snapshot()
)
from public.automation_batches b
join public.generation_jobs j on j.batch_id=b.id
join public.generation_outputs o on o.job_id=j.id and o.attempt=j.attempt_count
left join public.generation_reviews r on r.output_id=o.id
where b.edition_kind=p_edition_kind and b.edition_date=p_edition_date
  and j.status='submitted' and r.id is null
order by o.submitted_at
limit greatest(1,least(p_limit,100));
$$;

revoke all on function public.claim_generation_jobs_v2(text,integer,integer,text,date) from public,anon,authenticated;
revoke all on function public.claim_generation_job_context_v2(text,integer,integer,text,date) from public,anon,authenticated;
revoke all on function public.get_generation_review_queue_v3(integer,text,date) from public,anon,authenticated;;
