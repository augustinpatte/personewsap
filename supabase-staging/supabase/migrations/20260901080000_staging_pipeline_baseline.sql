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
-- CORRECTED 2026-09-07 against the column list observed on the live staging
-- project. The first version of this file was reconstructed from the callers
-- alone, and reconstruction from callers can only ever recover the columns
-- somebody reads. It was wrong in ways that matter:
--
--   automation_batches.edition_kind      defaulted 'daily'; live default is 'regular'
--   automation_batches.status            defaulted 'generating'; live default is 'queued'
--   automation_batches.prompt_bundle_version  nullable here, NOT NULL live
--   automation_batches.target_project_ref     nullable and undefaulted here;
--                                        live is NOT NULL default the production ref
--   generation_jobs.topic                NOT NULL here — but a mini-case job
--                                        carries `mini_case_topic` and no `topic`,
--                                        so the real column is nullable and this
--                                        file could not represent the batch the
--                                        pipeline actually builds
--   generation_jobs                      missing claimed_by, claimed_at,
--                                        lease_expires_at, max_attempts,
--                                        source_packet, constraints;
--                                        prompt_key nullable here, NOT NULL live
--   generation_outputs                   missing source_urls
--   generation_reviews                   missing feedback
--
-- `max_attempts integer not null default 3` is the one worth naming twice: the
-- "there is no attempt 4" rule is a column on this table, and a baseline without
-- it let a local rebuild disagree with the editorial policy the whole pipeline
-- is built on.
--
-- The remaining shape still comes from the code that reads and writes these
-- tables, not from a dump (this repository's tooling is deliberately kept away
-- from the Management API):
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
  -- Live default is 'regular'. The pipeline overwrites it with the production
  -- edition kind ('daily' | 'weekly_digest') when it creates the batch, and
  -- `assert_edition_publishable` compares it against the calendar — so the
  -- default is only ever what an un-filled row looks like, and this file records
  -- the real one rather than the convenient one.
  edition_kind text not null default 'regular',
  -- A cache of the job counts below, which is why assert_edition_publishable
  -- recomputes rather than trusts it.
  status text not null default 'queued',
  expected_jobs integer not null default 0,
  completed_jobs integer not null default 0,
  approved_jobs integer not null default 0,
  -- NOT NULL live: it is what `batch_requires_scored_questions` reads to decide
  -- whether a batch is held to the scored-question contract, and a NULL there
  -- would be a batch nobody can classify.
  prompt_bundle_version text not null,
  -- The production project this batch is destined for. The gate refuses a batch
  -- pointed anywhere else.
  target_project_ref text not null default 'wkbviidrbmehmjbhvpeh',
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
  -- NULLABLE, and this is not laxity: a mini-case job files its subject under
  -- `mini_case_topic` and leaves `topic` empty. The gate reads
  -- `coalesce(topic, mini_case_topic)` for exactly that reason, and a NOT NULL
  -- here made the canonical 16/1/6 batch unbuildable locally.
  topic text,
  -- Only mini cases carry one; it is the product topic, distinct from `topic`,
  -- which is the content topic the article is filed under.
  mini_case_topic text,
  ordinal integer not null default 1,
  status text not null default 'queued',
  -- The lease a worker takes on a job. Nothing in this repository reads them
  -- yet — the claim/renew logic lives in the Scheduled Tasks — but they are
  -- columns of the real table and a baseline that omits them is a baseline the
  -- next migration cannot safely ALTER.
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  -- THERE IS NO ATTEMPT 4, and this is where that rule is a column rather than
  -- a paragraph. Attempts 1 and 2 come back as revision_required; attempt 3 is
  -- the reviewer's last word — approve, or repair a purely local question defect
  -- and approve, or fail. Nothing regenerates a fourth time.
  max_attempts integer not null default 3,
  prompt_key text not null,
  -- What the generator was given to work from, and the constraints it was held
  -- to. Persisted per job so an output can be judged against the brief it was
  -- actually written to, months later.
  source_packet jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
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
  -- The flat URL list, alongside the richer `source_records`. Both exist on the
  -- live table: `source_urls` is what the early pipeline wrote, `source_records`
  -- is what the gate checks. Recorded here so a local rebuild is the same table.
  source_urls jsonb,
  source_records jsonb not null default '[]'::jsonb,
  -- `submitted_at`, not `created_at`: 20260901090000 line 396 picks the latest
  -- attempt with `order by submitted_at desc`, so the name is load-bearing.
  submitted_at timestamptz not null default now()
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
  -- The Reviewer's prose. Never read by the gate — a verdict is a verdict — but
  -- it is what an operator reads to find out WHY an edition is blocked, which is
  -- the whole job on the morning of a failed batch.
  feedback text,
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
