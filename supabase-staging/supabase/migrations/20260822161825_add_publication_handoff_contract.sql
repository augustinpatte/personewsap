create table if not exists public.publication_receipts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.automation_batches(id) on delete restrict,
  production_project_ref text not null,
  production_run_id text not null,
  production_result jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  unique(batch_id),
  unique(production_project_ref,production_run_id)
);
alter table public.publication_receipts enable row level security;
revoke all on public.publication_receipts from anon,authenticated;

create or replace function public.get_ready_batch_payload(p_edition_date date)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_batch public.automation_batches%rowtype;
  v_total integer;
  v_approved integer;
  v_payload jsonb;
begin
  select * into v_batch
  from public.automation_batches
  where edition_date=p_edition_date and edition_kind='regular'
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ready',false,'reason','batch_not_found','edition_date',p_edition_date);
  end if;

  select count(*), count(*) filter (where status='approved')
  into v_total,v_approved
  from public.generation_jobs where batch_id=v_batch.id;

  if v_batch.status <> 'ready' or v_total <> 23 or v_approved <> 23 then
    return jsonb_build_object(
      'ready',false,
      'reason','batch_not_fully_approved',
      'batch_id',v_batch.id,
      'batch_status',v_batch.status,
      'total_jobs',v_total,
      'approved_jobs',v_approved
    );
  end if;

  select jsonb_build_object(
    'ready',true,
    'batch',jsonb_build_object(
      'id',v_batch.id,
      'edition_date',v_batch.edition_date,
      'prompt_bundle_version',v_batch.prompt_bundle_version,
      'target_project_ref',v_batch.target_project_ref,
      'metadata',v_batch.metadata
    ),
    'jobs',coalesce(jsonb_agg(
      jsonb_build_object(
        'job_id',j.id,
        'content_type',j.content_type,
        'topic',j.topic,
        'mini_case_topic',j.mini_case_topic,
        'ordinal',j.ordinal,
        'attempt',j.attempt_count,
        'prompt_key',j.prompt_key,
        'output_id',o.id,
        'prompt_version',o.prompt_version,
        'output_json',o.output_json,
        'source_records',o.source_records,
        'review',jsonb_build_object(
          'id',r.id,
          'reviewer_id',r.reviewer_id,
          'verdict',r.verdict,
          'score',r.score,
          'checks',r.checks,
          'feedback',r.feedback,
          'reviewed_at',r.reviewed_at
        )
      ) order by
        case j.content_type when 'newsletter_article' then 1 when 'business_story' then 2 else 3 end,
        j.topic nulls last,j.mini_case_topic nulls last,j.ordinal
    ),'[]'::jsonb)
  ) into v_payload
  from public.generation_jobs j
  join public.generation_outputs o on o.job_id=j.id and o.attempt=j.attempt_count
  join public.generation_reviews r on r.output_id=o.id and r.verdict='approved'
  where j.batch_id=v_batch.id and j.status='approved';

  return v_payload;
end;
$$;

create or replace function public.mark_batch_published(
  p_batch_id uuid,
  p_production_project_ref text,
  p_production_run_id text,
  p_production_result jsonb
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_total integer;
  v_approved integer;
  v_receipt_id uuid;
begin
  select status into v_status from public.automation_batches where id=p_batch_id for update;
  if v_status is null then raise exception 'batch_not_found'; end if;

  select count(*),count(*) filter (where status='approved')
    into v_total,v_approved
  from public.generation_jobs where batch_id=p_batch_id;

  if v_status <> 'ready' or v_total <> 23 or v_approved <> 23 then
    raise exception 'batch_not_ready_for_publication';
  end if;

  if p_production_project_ref <> 'wkbviidrbmehmjbhvpeh' then
    raise exception 'unexpected_production_project';
  end if;
  if nullif(trim(p_production_run_id),'') is null then
    raise exception 'production_run_id_required';
  end if;

  insert into public.publication_receipts(batch_id,production_project_ref,production_run_id,production_result)
  values (p_batch_id,p_production_project_ref,p_production_run_id,coalesce(p_production_result,'{}'::jsonb))
  on conflict(batch_id) do update
    set production_result=excluded.production_result,
        production_run_id=excluded.production_run_id,
        published_at=now()
  returning id into v_receipt_id;

  update public.automation_batches
  set status='published',updated_at=now(),
      metadata=metadata || jsonb_build_object('production_run_id',p_production_run_id,'published_at',now())
  where id=p_batch_id;

  return v_receipt_id;
end;
$$;

create or replace function public.get_automation_health(p_edition_date date default current_date)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
with b as (
  select * from public.automation_batches
  where edition_date=p_edition_date and edition_kind='regular'
  order by created_at desc limit 1
), counts as (
  select
    count(*) as total,
    count(*) filter(where j.status='queued') as queued,
    count(*) filter(where j.status='claimed') as claimed,
    count(*) filter(where j.status='submitted') as submitted,
    count(*) filter(where j.status='approved') as approved,
    count(*) filter(where j.status='revision_required') as revision_required,
    count(*) filter(where j.status='failed') as failed,
    count(*) filter(where j.status='claimed' and j.lease_expires_at<now()) as expired_claims
  from b left join public.generation_jobs j on j.batch_id=b.id
), mem as (
  select created_at from public.editorial_memory_snapshots order by created_at desc limit 1
), heartbeat as (
  select created_at from public.automation_health order by created_at desc limit 1
)
select jsonb_build_object(
  'edition_date',p_edition_date,
  'batch_id',(select id from b),
  'batch_status',(select status from b),
  'jobs',jsonb_build_object(
    'total',(select total from counts),'queued',(select queued from counts),'claimed',(select claimed from counts),
    'submitted',(select submitted from counts),'approved',(select approved from counts),
    'revision_required',(select revision_required from counts),'failed',(select failed from counts),
    'expired_claims',(select expired_claims from counts)
  ),
  'latest_memory_snapshot_at',(select created_at from mem),
  'latest_health_event_at',(select created_at from heartbeat),
  'publishable',coalesce((select status='ready' from b),false)
);
$$;

revoke all on function public.get_ready_batch_payload(date) from public,anon,authenticated;
revoke all on function public.mark_batch_published(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.get_automation_health(date) from public,anon,authenticated;;
