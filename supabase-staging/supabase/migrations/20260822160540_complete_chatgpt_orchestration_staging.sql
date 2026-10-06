alter table public.generation_outputs
  add column if not exists source_records jsonb not null default '[]'::jsonb;

create table if not exists public.editorial_memory_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_project_ref text not null,
  business_story_memory jsonb not null default '[]'::jsonb,
  mini_case_memory jsonb not null default '[]'::jsonb,
  source_business_story_latest_at timestamptz,
  source_mini_case_latest_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists editorial_memory_snapshots_created_idx
  on public.editorial_memory_snapshots(created_at desc);
alter table public.editorial_memory_snapshots enable row level security;
revoke all on public.editorial_memory_snapshots from anon, authenticated;

create table if not exists public.automation_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.automation_config enable row level security;
revoke all on public.automation_config from anon, authenticated;

insert into public.automation_config(key,value) values
('pipeline', jsonb_build_object(
  'version','chatgpt-staging-v1',
  'staging_project_ref','kukyotcgbnchsoeriqoz',
  'production_project_ref','wkbviidrbmehmjbhvpeh',
  'languages',jsonb_build_array('fr','en'),
  'newsletter_topics',jsonb_build_array('business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'),
  'newsletter_items_per_topic',2,
  'business_story_items',1,
  'mini_case_topics',jsonb_build_array('finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'),
  'expected_jobs',23,
  'worker_count',3,
  'publication_owner','deterministic_github_bridge',
  'scheduled_workers_may_publish',false
))
on conflict (key) do update set value=excluded.value, updated_at=now();

create or replace function public.create_edition_batch(
  p_edition_date date,
  p_edition_kind text default 'regular'
)
returns uuid
language plpgsql
as $$
declare
  v_batch_id uuid;
  v_bundle text;
  v_topic text;
  v_mini_topic text;
  v_ord integer;
begin
  if p_edition_kind not in ('regular','test') then
    raise exception 'invalid_edition_kind';
  end if;

  select string_agg(prompt_key || ':' || version, '|' order by prompt_key)
    into v_bundle
  from public.prompt_versions
  where active = true;

  if v_bundle is null then
    raise exception 'no_active_prompts';
  end if;

  insert into public.automation_batches(
    edition_date, edition_kind, status, expected_jobs, prompt_bundle_version, metadata
  ) values (
    p_edition_date, p_edition_kind, 'queued', 23, v_bundle,
    jsonb_build_object('pipeline_version','chatgpt-staging-v1','paired_languages',true)
  )
  on conflict (edition_date, edition_kind) do update
    set prompt_bundle_version = excluded.prompt_bundle_version,
        expected_jobs = 23,
        updated_at = now()
  returning id into v_batch_id;

  foreach v_topic in array array['business','finance','tech_ai','law','medicine','engineering','sport_business','culture_media'] loop
    for v_ord in 1..2 loop
      insert into public.generation_jobs(
        batch_id, content_type, topic, ordinal, prompt_key, constraints
      ) values (
        v_batch_id, 'newsletter_article', v_topic, v_ord, 'newsletter',
        jsonb_build_object(
          'languages',jsonb_build_array('fr','en'),
          'paired',true,
          'canonical_output_required',true,
          'source_records_required',true,
          'topic',v_topic,
          'ordinal',v_ord
        )
      ) on conflict do nothing;
    end loop;
  end loop;

  insert into public.generation_jobs(
    batch_id, content_type, ordinal, prompt_key, constraints
  ) values (
    v_batch_id, 'business_story', 1, 'business_story',
    jsonb_build_object(
      'languages',jsonb_build_array('fr','en'),
      'paired',true,
      'canonical_output_required',true,
      'source_records_required',true,
      'editorial_memory_required',true
    )
  ) on conflict do nothing;

  foreach v_mini_topic in array array['finance_economy','stock_market','ai','law_compliance','health_pharma','engineering_operations'] loop
    insert into public.generation_jobs(
      batch_id, content_type, mini_case_topic, ordinal, prompt_key, constraints
    ) values (
      v_batch_id, 'mini_case', v_mini_topic, 1, 'mini_case',
      jsonb_build_object(
        'languages',jsonb_build_array('fr','en'),
        'paired',true,
        'canonical_output_required',true,
        'source_records_required',true,
        'editorial_memory_required',true,
        'product_topic',v_mini_topic
      )
    ) on conflict do nothing;
  end loop;

  perform public.refresh_batch_status(v_batch_id);
  return v_batch_id;
end;
$$;

create or replace function public.fail_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
returns void
language plpgsql
as $$
begin
  update public.generation_jobs
  set status = case when attempt_count >= max_attempts then 'failed' else 'queued' end,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error = left(p_error, 4000),
      updated_at = now()
  where id = p_job_id
    and status = 'claimed'
    and claimed_by = p_worker_id;

  if not found then
    raise exception 'job_not_owned_by_worker';
  end if;
end;
$$;

create or replace function public.release_expired_generation_jobs()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with released as (
    update public.generation_jobs
    set status = case when attempt_count >= max_attempts then 'failed' else 'queued' end,
        claimed_by = null,
        claimed_at = null,
        lease_expires_at = null,
        last_error = coalesce(last_error,'lease_expired'),
        updated_at = now()
    where status='claimed' and lease_expires_at < now()
    returning 1
  ) select count(*) into v_count from released;
  return v_count;
end;
$$;

create or replace function public.get_batch_progress(p_batch_id uuid)
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'batch_id', b.id,
  'edition_date', b.edition_date,
  'status', b.status,
  'expected_jobs', count(j.id),
  'queued', count(j.id) filter (where j.status='queued'),
  'claimed', count(j.id) filter (where j.status='claimed'),
  'submitted', count(j.id) filter (where j.status='submitted'),
  'approved', count(j.id) filter (where j.status='approved'),
  'revision_required', count(j.id) filter (where j.status='revision_required'),
  'failed', count(j.id) filter (where j.status='failed'),
  'prompt_bundle_version', b.prompt_bundle_version
)
from public.automation_batches b
left join public.generation_jobs j on j.batch_id=b.id
where b.id=p_batch_id
group by b.id;
$$;

revoke all on function public.create_edition_batch(date,text) from public, anon, authenticated;
revoke all on function public.fail_generation_job(uuid,text,text) from public, anon, authenticated;
revoke all on function public.release_expired_generation_jobs() from public, anon, authenticated;
revoke all on function public.get_batch_progress(uuid) from public, anon, authenticated;
;
