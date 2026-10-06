create extension if not exists pgcrypto;

create table if not exists public.automation_batches (
  id uuid primary key default gen_random_uuid(),
  edition_date date not null,
  edition_kind text not null default 'regular' check (edition_kind in ('regular','test')),
  status text not null default 'queued' check (status in ('queued','generating','reviewing','ready','published','failed','cancelled')),
  expected_jobs integer not null default 0 check (expected_jobs >= 0),
  completed_jobs integer not null default 0 check (completed_jobs >= 0),
  approved_jobs integer not null default 0 check (approved_jobs >= 0),
  prompt_bundle_version text not null,
  target_project_ref text not null default 'wkbviidrbmehmjbhvpeh',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_date, edition_kind)
);

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  version text not null,
  content text not null,
  sha256 text,
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (prompt_key, version)
);
create unique index if not exists prompt_versions_one_active_per_key on public.prompt_versions(prompt_key) where active;

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.automation_batches(id) on delete cascade,
  content_type text not null check (content_type in ('newsletter_article','business_story','mini_case')),
  topic text,
  mini_case_topic text,
  ordinal integer not null default 1,
  status text not null default 'queued' check (status in ('queued','claimed','submitted','approved','revision_required','failed','cancelled')),
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  prompt_key text not null,
  source_packet jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists generation_jobs_identity_idx on public.generation_jobs(batch_id, content_type, coalesce(topic,''), coalesce(mini_case_topic,''), ordinal);
create index if not exists generation_jobs_claim_idx on public.generation_jobs(status, lease_expires_at, created_at);

create table if not exists public.generation_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  attempt integer not null,
  worker_id text not null,
  prompt_version text not null,
  output_json jsonb not null,
  source_urls jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  unique(job_id, attempt)
);

create table if not exists public.generation_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  output_id uuid not null references public.generation_outputs(id) on delete cascade,
  reviewer_id text not null,
  verdict text not null check (verdict in ('approved','revision_required','rejected')),
  score integer check (score between 0 and 100),
  checks jsonb not null default '{}'::jsonb,
  feedback text,
  reviewed_at timestamptz not null default now(),
  unique(output_id)
);

create table if not exists public.automation_health (
  id bigserial primary key,
  batch_id uuid references public.automation_batches(id) on delete cascade,
  actor text not null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','error')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.automation_batches enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_outputs enable row level security;
alter table public.generation_reviews enable row level security;
alter table public.automation_health enable row level security;

revoke all on public.automation_batches from anon, authenticated;
revoke all on public.prompt_versions from anon, authenticated;
revoke all on public.generation_jobs from anon, authenticated;
revoke all on public.generation_outputs from anon, authenticated;
revoke all on public.generation_reviews from anon, authenticated;
revoke all on public.automation_health from anon, authenticated;
;
