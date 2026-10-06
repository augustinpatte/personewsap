create or replace function public.claim_generation_jobs(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_minutes integer default 45
)
returns setof public.generation_jobs
language plpgsql
as $$
begin
  return query
  with candidates as (
    select id
    from public.generation_jobs
    where (
      status = 'queued'
      or (status = 'claimed' and lease_expires_at < now())
      or (status = 'revision_required' and attempt_count < max_attempts)
    )
    and attempt_count < max_attempts
    order by created_at, ordinal
    for update skip locked
    limit greatest(1, least(p_limit, 20))
  )
  update public.generation_jobs j
  set status = 'claimed',
      claimed_by = p_worker_id,
      claimed_at = now(),
      lease_expires_at = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 180))),
      attempt_count = attempt_count + 1,
      updated_at = now(),
      last_error = null
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.submit_generation_output(
  p_job_id uuid,
  p_worker_id text,
  p_output_json jsonb,
  p_source_urls jsonb,
  p_prompt_version text
)
returns uuid
language plpgsql
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_output_id uuid;
begin
  select * into v_job
  from public.generation_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'job_not_found';
  end if;
  if v_job.status <> 'claimed' then
    raise exception 'job_not_claimed';
  end if;
  if v_job.claimed_by is distinct from p_worker_id then
    raise exception 'job_claimed_by_other_worker';
  end if;
  if v_job.lease_expires_at is not null and v_job.lease_expires_at < now() then
    raise exception 'job_lease_expired';
  end if;

  insert into public.generation_outputs(job_id, attempt, worker_id, prompt_version, output_json, source_urls)
  values (p_job_id, v_job.attempt_count, p_worker_id, p_prompt_version, p_output_json, coalesce(p_source_urls,'[]'::jsonb))
  returning id into v_output_id;

  update public.generation_jobs
  set status = 'submitted', lease_expires_at = null, updated_at = now()
  where id = p_job_id;

  return v_output_id;
end;
$$;

create or replace function public.submit_generation_review(
  p_output_id uuid,
  p_reviewer_id text,
  p_verdict text,
  p_score integer,
  p_checks jsonb,
  p_feedback text default null
)
returns uuid
language plpgsql
as $$
declare
  v_job_id uuid;
  v_review_id uuid;
begin
  if p_verdict not in ('approved','revision_required','rejected') then
    raise exception 'invalid_verdict';
  end if;
  if p_score is not null and (p_score < 0 or p_score > 100) then
    raise exception 'invalid_score';
  end if;

  select job_id into v_job_id
  from public.generation_outputs
  where id = p_output_id;
  if v_job_id is null then
    raise exception 'output_not_found';
  end if;

  insert into public.generation_reviews(job_id, output_id, reviewer_id, verdict, score, checks, feedback)
  values (v_job_id, p_output_id, p_reviewer_id, p_verdict, p_score, coalesce(p_checks,'{}'::jsonb), p_feedback)
  returning id into v_review_id;

  update public.generation_jobs
  set status = case
      when p_verdict = 'approved' then 'approved'
      when p_verdict = 'revision_required' and attempt_count < max_attempts then 'revision_required'
      else 'failed'
    end,
    updated_at = now(),
    last_error = case when p_verdict = 'approved' then null else p_feedback end
  where id = v_job_id;

  return v_review_id;
end;
$$;

create or replace function public.refresh_batch_status(p_batch_id uuid)
returns text
language plpgsql
as $$
declare
  v_total integer;
  v_submitted integer;
  v_approved integer;
  v_failed integer;
  v_status text;
begin
  select count(*),
         count(*) filter (where status in ('submitted','approved')),
         count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'failed')
  into v_total, v_submitted, v_approved, v_failed
  from public.generation_jobs
  where batch_id = p_batch_id;

  if v_total = 0 then v_status := 'queued';
  elsif v_failed > 0 then v_status := 'failed';
  elsif v_approved = v_total then v_status := 'ready';
  elsif v_submitted > 0 then v_status := 'reviewing';
  else v_status := 'generating';
  end if;

  update public.automation_batches
  set expected_jobs = v_total,
      completed_jobs = v_submitted,
      approved_jobs = v_approved,
      status = v_status,
      updated_at = now()
  where id = p_batch_id;

  return v_status;
end;
$$;

revoke all on function public.claim_generation_jobs(text,integer,integer) from public, anon, authenticated;
revoke all on function public.submit_generation_output(uuid,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.submit_generation_review(uuid,text,text,integer,jsonb,text) from public, anon, authenticated;
revoke all on function public.refresh_batch_status(uuid) from public, anon, authenticated;
;
