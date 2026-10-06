create or replace function public.submit_generation_output_v2(
  p_job_id uuid,
  p_worker_id text,
  p_output_json jsonb,
  p_source_records jsonb,
  p_prompt_version text
)
returns uuid
language plpgsql
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_output_id uuid;
  v_source_urls jsonb;
begin
  select * into v_job
  from public.generation_jobs
  where id = p_job_id
  for update;

  if not found then raise exception 'job_not_found'; end if;
  if v_job.status <> 'claimed' then raise exception 'job_not_claimed'; end if;
  if v_job.claimed_by is distinct from p_worker_id then raise exception 'job_claimed_by_other_worker'; end if;
  if v_job.lease_expires_at is not null and v_job.lease_expires_at < now() then raise exception 'job_lease_expired'; end if;

  if jsonb_typeof(p_output_json) <> 'object'
     or not (p_output_json ? 'fr')
     or not (p_output_json ? 'en')
     or jsonb_typeof(p_output_json->'fr') <> 'object'
     or jsonb_typeof(p_output_json->'en') <> 'object' then
    raise exception 'bilingual_output_required';
  end if;

  if coalesce(p_output_json->'fr'->>'language','') <> 'fr'
     or coalesce(p_output_json->'en'->>'language','') <> 'en' then
    raise exception 'language_pair_mismatch';
  end if;

  if jsonb_typeof(coalesce(p_source_records,'[]'::jsonb)) <> 'array' then
    raise exception 'source_records_must_be_array';
  end if;

  if v_job.content_type in ('newsletter_article','business_story')
     and jsonb_array_length(coalesce(p_source_records,'[]'::jsonb)) = 0 then
    raise exception 'source_records_required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s->>'url')), '[]'::jsonb)
    into v_source_urls
  from jsonb_array_elements(coalesce(p_source_records,'[]'::jsonb)) s
  where nullif(s->>'url','') is not null;

  insert into public.generation_outputs(
    job_id, attempt, worker_id, prompt_version, output_json, source_urls, source_records
  ) values (
    p_job_id, v_job.attempt_count, p_worker_id, p_prompt_version,
    p_output_json, coalesce(v_source_urls,'[]'::jsonb), coalesce(p_source_records,'[]'::jsonb)
  ) returning id into v_output_id;

  update public.generation_jobs
  set status='submitted', lease_expires_at=null, updated_at=now()
  where id=p_job_id;

  return v_output_id;
end;
$$;

create or replace function public.latest_editorial_memory_snapshot()
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'snapshot_id', id,
  'source_project_ref', source_project_ref,
  'business_story_memory', business_story_memory,
  'mini_case_memory', mini_case_memory,
  'source_business_story_latest_at', source_business_story_latest_at,
  'source_mini_case_latest_at', source_mini_case_latest_at,
  'created_at', created_at
)
from public.editorial_memory_snapshots
order by created_at desc
limit 1;
$$;

revoke all on function public.submit_generation_output_v2(uuid,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.latest_editorial_memory_snapshot() from public, anon, authenticated;
;
