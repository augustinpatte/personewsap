create or replace function public.chatgpt_bridge_prepare_manifest(p_edition_date date)
returns jsonb
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $$
declare
  v_batch_id uuid;
  v_kind text;
  v_manifest jsonb;
begin
  v_kind := public.resolve_staging_edition_kind(p_edition_date);
  if v_kind is null then
    return jsonb_build_object('edition_date',p_edition_date,'edition_kind',null,'quiet_day',true,'jobs','[]'::jsonb);
  end if;
  v_batch_id := public.create_scheduled_edition_batch(p_edition_date);
  select jsonb_build_object(
    'edition_date', b.edition_date,
    'edition_kind', b.edition_kind,
    'batch_id', b.id,
    'batch_status', b.status,
    'batch_metadata', b.metadata,
    'prompt_bundle_version', b.prompt_bundle_version,
    'canonical_output_contract',(select value from public.automation_config where key='canonical_output_contract'),
    'source_record_contract',(select value from public.automation_config where key='source_record_contract'),
    'common_runtime_contract',(select value->'common' from public.automation_config where key='runtime_contracts'),
    'review_policy',(select value from public.automation_config where key='review_policy'),
    'reviewer_prompt',(select jsonb_build_object('version',version,'content',content,'metadata',metadata) from public.prompt_versions where prompt_key='reviewer' and active=true limit 1),
    'editorial_memory',public.latest_editorial_memory_snapshot(),
    'jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'job',to_jsonb(j),
        'prompt',jsonb_build_object('prompt_key',p.prompt_key,'version',p.version,'sha256',p.sha256,'metadata',p.metadata),
        'runtime_contract',(select value->j.content_type from public.automation_config where key='runtime_contracts')
      ) order by case j.content_type when 'newsletter_article' then 1 when 'business_story' then 2 else 3 end,j.topic nulls last,j.mini_case_topic nulls last,j.ordinal)
      from public.generation_jobs j
      join public.prompt_versions p on p.prompt_key=j.prompt_key and p.active=true
      where j.batch_id=b.id
    ),'[]'::jsonb)
  ) into v_manifest
  from public.automation_batches b where b.id=v_batch_id;
  return v_manifest;
end;
$$;

create or replace function public.chatgpt_bridge_submit_output(
  p_job_id uuid,
  p_worker_id text,
  p_output_json jsonb,
  p_source_records jsonb,
  p_prompt_version text,
  p_edition_date date
) returns uuid
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_kind text;
  v_output_id uuid;
begin
  v_kind := public.resolve_staging_edition_kind(p_edition_date);
  if v_kind is null then raise exception 'quiet_day'; end if;
  select j.* into v_job
  from public.generation_jobs j
  join public.automation_batches b on b.id=j.batch_id
  where j.id=p_job_id and b.edition_date=p_edition_date and b.edition_kind=v_kind
  for update of j;
  if not found then raise exception 'job_not_found_for_edition'; end if;
  if v_job.status not in ('queued','revision_required') then raise exception 'job_not_available: %',v_job.status; end if;
  if v_job.attempt_count >= v_job.max_attempts then raise exception 'max_attempts_reached'; end if;
  update public.generation_jobs
    set status='claimed',claimed_by=p_worker_id,claimed_at=now(),lease_expires_at=now()+interval '30 minutes',attempt_count=attempt_count+1,updated_at=now(),last_error=null
    where id=p_job_id;
  v_output_id := public.submit_generation_output_v3(p_job_id,p_worker_id,p_output_json,p_source_records,p_prompt_version);
  return v_output_id;
end;
$$;

create or replace function public.chatgpt_bridge_submit_review(
  p_job_id uuid,
  p_reviewer_id text,
  p_verdict text,
  p_score integer,
  p_checks jsonb,
  p_feedback text default null
) returns uuid
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $$
declare
  v_output_id uuid;
  v_review_id uuid;
begin
  select o.id into v_output_id
  from public.generation_jobs j
  join public.generation_outputs o on o.job_id=j.id and o.attempt=j.attempt_count
  left join public.generation_reviews r on r.output_id=o.id
  where j.id=p_job_id and j.status='submitted' and r.id is null
  order by o.submitted_at desc limit 1;
  if v_output_id is null then raise exception 'reviewable_output_not_found'; end if;
  v_review_id := public.submit_generation_review_v2(v_output_id,p_reviewer_id,p_verdict,p_score,p_checks,p_feedback);
  return v_review_id;
end;
$$;

revoke all on function public.chatgpt_bridge_prepare_manifest(date) from public, anon, authenticated;
revoke all on function public.chatgpt_bridge_submit_output(uuid,text,jsonb,jsonb,text,date) from public, anon, authenticated;
revoke all on function public.chatgpt_bridge_submit_review(uuid,text,text,integer,jsonb,text) from public, anon, authenticated;
grant execute on function public.chatgpt_bridge_prepare_manifest(date) to service_role;
grant execute on function public.chatgpt_bridge_submit_output(uuid,text,jsonb,jsonb,text,date) to service_role;
grant execute on function public.chatgpt_bridge_submit_review(uuid,text,text,integer,jsonb,text) to service_role;;
