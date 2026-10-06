create or replace function public.submit_generation_output_v3(
  p_job_id uuid,
  p_worker_id text,
  p_output_json jsonb,
  p_source_records jsonb,
  p_prompt_version text
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_check jsonb;
  v_output_id uuid;
  v_batch_id uuid;
begin
  v_check := public.validate_generation_output(p_job_id,p_output_json,p_source_records);
  if coalesce((v_check->>'valid')::boolean,false) is not true then
    raise exception 'output_preflight_failed: %', v_check->'errors';
  end if;

  select batch_id into v_batch_id from public.generation_jobs where id=p_job_id;
  v_output_id := public.submit_generation_output_v2(
    p_job_id,p_worker_id,p_output_json,p_source_records,p_prompt_version
  );
  perform public.refresh_batch_status(v_batch_id);
  return v_output_id;
end;
$$;

create or replace function public.submit_generation_review_v2(
  p_output_id uuid,
  p_reviewer_id text,
  p_verdict text,
  p_score integer,
  p_checks jsonb,
  p_feedback text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_threshold integer := 90;
  v_critical text;
  v_effective_verdict text := p_verdict;
  v_review_id uuid;
  v_batch_id uuid;
begin
  select coalesce((value->>'approval_threshold')::integer,90)
    into v_threshold
  from public.automation_config where key='review_policy';

  if p_verdict='approved' then
    if p_score is null or p_score < v_threshold then
      v_effective_verdict := 'revision_required';
    end if;
    foreach v_critical in array array['source_grounding','factual_accuracy','safety','schema','fr_en_parity'] loop
      if coalesce((p_checks->>v_critical)::boolean,false) is not true then
        v_effective_verdict := 'revision_required';
      end if;
    end loop;
  end if;

  select j.batch_id into v_batch_id
  from public.generation_outputs o join public.generation_jobs j on j.id=o.job_id
  where o.id=p_output_id;

  v_review_id := public.submit_generation_review(
    p_output_id,p_reviewer_id,v_effective_verdict,p_score,p_checks,p_feedback
  );
  perform public.refresh_batch_status(v_batch_id);
  return v_review_id;
end;
$$;

create or replace function public.fail_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid;
begin
  select batch_id into v_batch_id from public.generation_jobs where id=p_job_id;
  update public.generation_jobs
  set status=case when attempt_count>=max_attempts then 'failed' else 'queued' end,
      claimed_by=null,claimed_at=null,lease_expires_at=null,
      last_error=left(p_error,4000),updated_at=now()
  where id=p_job_id and status='claimed' and claimed_by=p_worker_id;
  if not found then raise exception 'job_not_owned_by_worker'; end if;
  perform public.refresh_batch_status(v_batch_id);
end;
$$;;
