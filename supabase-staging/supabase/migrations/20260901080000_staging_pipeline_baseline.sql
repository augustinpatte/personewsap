-- The staging pipeline tables, so the staging project can be built from zero.
--
-- WHY THIS FILE EXISTS
--
-- Every migration in this directory reads automation_batches, generation_jobs,
-- generation_outputs, generation_reviews, publication_receipts,
-- automation_health and automation_config, and not one of them creates any of
-- those. They were created directly in the staging project
-- (kukyotcgbnchsoeriqoz) outside version control, so `supabase db reset
-- --workdir supabase-staging` failed on the very first migration with
--
--   ERROR: relation "public.automation_batches" does not exist (SQLSTATE 42P01)
--
-- and the staging half of the pipeline could not be exercised anywhere except
-- against the live project. That is the opposite of what a staging project is
-- for.
--
-- WHERE THE SHAPE COMES FROM
--
-- It is reconstructed from the code that reads and writes these tables, not
-- dumped from the remote project (this repository's tooling is deliberately
-- kept away from the Management API):
--
--   supabase-staging/supabase/migrations/20260901090000_*.sql  — %rowtype uses,
--     assert_edition_publishable, get_scheduled_edition_publish_plan
--   supabase-staging/supabase/migrations/20260906110000_*.sql  — the scored
--     question preflight, validate_generation_output
--   supabase-staging/supabase/tests/scheduled_publication_gate.test.sql — the
--     fixture builder, which is the fullest column list anywhere
--   services/content-engine/src/staging/stagingBatchReader.ts — the select lists
--     the publisher actually sends
--   supabase/functions/personews-task-bridge/index.ts — the status endpoint
--
-- IDEMPOTENT ON PURPOSE. Every statement is IF NOT EXISTS, so applying this to
-- the real staging project — which already has these tables, with whatever
-- extra columns were added there by hand — creates nothing and changes nothing.
-- It is a floor for a local rebuild, never a redefinition of the remote.
--
-- If the remote and this file ever disagree in a way that matters, the remote
-- wins and this file is what gets corrected.

begin;

-- ---------------------------------------------------------------------------
-- 1. A batch: one edition's worth of generation work
-- ---------------------------------------------------------------------------

create table if not exists public.automation_batches (
  id uuid primary key default gen_random_uuid(),
  edition_date date not null,
  -- 'daily' or 'weekly_digest', matching the production edition kinds.
  edition_kind text not null default 'daily',
  -- A cache of the job counts below, which is why assert_edition_publishable
  -- recomputes rather than trusts it.
  status text not null default 'generating',
  expected_jobs integer not null default 0,
  completed_jobs integer not null default 0,
  approved_jobs integer not null default 0,
  prompt_bundle_version text,
  -- The production project this batch is destined for. The gate refuses a batch
  -- pointed anywhere else.
  target_project_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_batches_edition_idx
  on public.automation_batches (edition_date, edition_kind, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. A job: one piece of content to generate
-- ---------------------------------------------------------------------------

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.automation_batches (id) on delete cascade,
  -- 'newsletter_article' | 'business_story' | 'mini_case'
  content_type text not null,
  topic text not null,
  -- Only mini cases carry one; it is the product topic, distinct from `topic`,
  -- which is the content topic the article is filed under.
  mini_case_topic text,
  ordinal integer not null default 1,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  prompt_key text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_jobs_batch_idx
  on public.generation_jobs (batch_id, content_type, ordinal);

-- ---------------------------------------------------------------------------
-- 3. An output: what a worker produced for a job
-- ---------------------------------------------------------------------------
-- output_json holds BOTH renderings under 'fr' and 'en'. That is the pairing
-- the production publisher turns into one logical content key with two
-- localized rows, so a single-language output is a rejected batch, not half a
-- batch.

create table if not exists public.generation_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs (id) on delete cascade,
  attempt integer not null default 1,
  worker_id text,
  prompt_version text,
  output_json jsonb not null,
  source_records jsonb not null default '[]'::jsonb,
  -- `submitted_at`, not `created_at`: 20260901090000 line 396 picks the latest
  -- attempt with `order by submitted_at desc`, so the name is load-bearing.
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists generation_outputs_job_idx
  on public.generation_outputs (job_id, attempt);

-- ---------------------------------------------------------------------------
-- 4. A review: the verdict that makes an output publishable
-- ---------------------------------------------------------------------------

create table if not exists public.generation_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs (id) on delete cascade,
  output_id uuid not null references public.generation_outputs (id) on delete cascade,
  reviewer_id text,
  verdict text not null,
  score integer,
  -- One boolean per gate: source_grounding, factual_accuracy, safety, schema,
  -- fr_en_parity, novelty_anti_repetition. The gate requires every one true.
  checks jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz not null default now()
);

create index if not exists generation_reviews_job_idx
  on public.generation_reviews (job_id, reviewed_at);

-- ---------------------------------------------------------------------------
-- 5. A receipt: proof an edition was published, and the reason a second
--    attempt is a no-op rather than a duplicate
-- ---------------------------------------------------------------------------

create table if not exists public.publication_receipts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.automation_batches (id) on delete cascade,
  production_project_ref text not null,
  -- Deterministic: scheduled_publication_run_id(edition_date, batch_id). Two
  -- runs of the same edition compute the same id, which is what makes the
  -- second one idempotent.
  production_run_id text not null,
  production_result jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now()
);

create unique index if not exists publication_receipts_batch_key
  on public.publication_receipts (batch_id);

-- ---------------------------------------------------------------------------
-- 6. The event log and the pipeline config
-- ---------------------------------------------------------------------------

create table if not exists public.automation_health (
  id bigint generated by default as identity primary key,
  batch_id uuid references public.automation_batches (id) on delete set null,
  actor text,
  event_type text not null,
  severity text not null default 'info',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists automation_health_batch_idx
  on public.automation_health (batch_id, created_at desc);

create table if not exists public.automation_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 20260901090000 rewrites this row's publication settings and would touch zero
-- rows without it, silently leaving the pipeline owned by the AI workers on a
-- freshly built database.
insert into public.automation_config (key, value)
values ('pipeline', jsonb_build_object('name', 'chatgpt-staging-v1'))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6-bis. The publication calendar
-- ---------------------------------------------------------------------------
-- Same story as the tables: every migration in this directory calls
-- resolve_staging_edition_kind and none of them defines it. It is the 4x/week
-- cadence, and the contract is pinned by
-- supabase-staging/supabase/tests/scheduled_publication_gate.test.sql tests 11
-- and 12: Monday, Wednesday and Friday are dailies, Sunday is the weekly
-- digest, and every other day is quiet — NULL, not an error, because "nothing
-- is due today" is a normal answer the cron asks for every hour.
--
-- CREATE OR REPLACE rather than IF NOT EXISTS: if the remote already has it,
-- this is the same function; if the cadence ever changes it changes here, in
-- one place, rather than in whichever copy the reader happens to find.

create or replace function public.resolve_staging_edition_kind(p_edition_date date)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case extract(isodow from p_edition_date)
    when 1 then 'daily'          -- Monday
    when 3 then 'daily'          -- Wednesday
    when 5 then 'daily'          -- Friday
    when 7 then 'weekly_digest'  -- Sunday
    else null
  end;
$$;

revoke all on function public.resolve_staging_edition_kind(date) from public, anon, authenticated;
grant execute on function public.resolve_staging_edition_kind(date) to service_role, postgres;

comment on function public.resolve_staging_edition_kind(date) is
  'The edition the calendar asks for on a given date: daily on Monday, Wednesday and Friday, weekly_digest on Sunday, NULL on a quiet day. NULL is an answer, not a failure — the cron asks this every hour.';

-- ---------------------------------------------------------------------------
-- 7. Nothing here is a client table
-- ---------------------------------------------------------------------------
-- The staging project has no app users. Everything reaching these tables is a
-- worker or the publisher, holding service_role. RLS on with no policy means a
-- leaked anon key reads nothing, and the revokes make that true a second time —
-- including from `authenticated`, which Supabase's default privileges grant ALL
-- to on every new table in public and which is exactly the hole this repository
-- had to close on the production side (see
-- supabase/migrations/20260907150000_teams_privilege_hardening.sql).

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'automation_batches', 'generation_jobs', 'generation_outputs',
    'generation_reviews', 'publication_receipts', 'automation_health',
    'automation_config'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
  end loop;
end $$;

commit;
