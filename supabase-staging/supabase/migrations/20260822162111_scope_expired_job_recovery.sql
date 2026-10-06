create or replace function public.release_expired_generation_jobs_v2(
  p_edition_kind text default 'regular',
  p_edition_date date default current_date
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_batch_ids uuid[];
begin
  if p_edition_kind not in ('regular','test') then raise exception 'invalid_edition_kind'; end if;
  select coalesce(array_agg(id),array[]::uuid[]) into v_batch_ids
  from public.automation_batches
  where edition_kind=p_edition_kind and edition_date=p_edition_date;

  with released as (
    update public.generation_jobs j
    set status=case when j.attempt_count>=j.max_attempts then 'failed' else 'queued' end,
        claimed_by=null,claimed_at=null,lease_expires_at=null,
        last_error=coalesce(j.last_error,'lease_expired'),updated_at=now()
    where j.batch_id=any(v_batch_ids)
      and j.status='claimed' and j.lease_expires_at<now()
    returning j.batch_id
  ) select count(*) into v_count from released;

  perform public.refresh_batch_status(x)
  from unnest(v_batch_ids) x;
  return v_count;
end;
$$;
revoke all on function public.release_expired_generation_jobs_v2(text,date) from public,anon,authenticated;;
