create or replace function public.claim_generation_jobs_v2(
  p_worker_id text,
  p_limit integer default 8,
  p_lease_minutes integer default 120,
  p_edition_kind text default 'regular'::text,
  p_edition_date date default current_date
)
returns setof public.generation_jobs
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_edition_kind not in ('daily','weekly_digest','regular','test') then
    raise exception 'invalid_edition_kind';
  end if;

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
$function$;

create or replace function public.release_expired_generation_jobs_v2(
  p_edition_kind text default 'regular'::text,
  p_edition_date date default current_date
)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count integer;
  v_batch_ids uuid[];
begin
  if p_edition_kind not in ('daily','weekly_digest','regular','test') then
    raise exception 'invalid_edition_kind';
  end if;

  select coalesce(array_agg(id),array[]::uuid[]) into v_batch_ids
  from public.automation_batches
  where edition_kind=p_edition_kind and edition_date=p_edition_date;

  with released as (
    update public.generation_jobs j
    set status=case when j.attempt_count>=j.max_attempts then 'failed' else 'queued' end,
        claimed_by=null,
        claimed_at=null,
        lease_expires_at=null,
        last_error=coalesce(j.last_error,'lease_expired'),
        updated_at=now()
    where j.batch_id=any(v_batch_ids)
      and j.status='claimed'
      and j.lease_expires_at<now()
    returning j.batch_id
  )
  select count(*) into v_count from released;

  perform public.refresh_batch_status(x)
  from unnest(v_batch_ids) x;

  return v_count;
end;
$function$;

create or replace function public.submit_generation_review_v2(
  p_output_id uuid,
  p_reviewer_id text,
  p_verdict text,
  p_score integer,
  p_checks jsonb,
  p_feedback text default null::text
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_threshold integer := 90;
  v_critical text;
  v_critical_checks jsonb := '["source_grounding","factual_accuracy","safety","schema","fr_en_parity","novelty_anti_repetition"]'::jsonb;
  v_effective_verdict text := p_verdict;
  v_review_id uuid;
  v_batch_id uuid;
begin
  select
    coalesce((value->>'approval_threshold')::integer,90),
    coalesce(value->'critical_checks', v_critical_checks)
  into v_threshold, v_critical_checks
  from public.automation_config
  where key='review_policy';

  if p_verdict='approved' then
    if p_score is null or p_score < v_threshold then
      v_effective_verdict := 'revision_required';
    end if;

    for v_critical in
      select jsonb_array_elements_text(v_critical_checks)
    loop
      if coalesce((p_checks->>v_critical)::boolean,false) is not true then
        v_effective_verdict := 'revision_required';
      end if;
    end loop;
  end if;

  select j.batch_id into v_batch_id
  from public.generation_outputs o
  join public.generation_jobs j on j.id=o.job_id
  where o.id=p_output_id;

  v_review_id := public.submit_generation_review(
    p_output_id,
    p_reviewer_id,
    v_effective_verdict,
    p_score,
    p_checks,
    p_feedback
  );

  perform public.refresh_batch_status(v_batch_id);
  return v_review_id;
end;
$function$;;
