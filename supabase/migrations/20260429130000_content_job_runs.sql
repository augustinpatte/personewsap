-- Production observability for content-engine daily jobs.
-- Stores one operational summary per scheduler run. generation_runs remains
-- item-level; job_runs is job-level and can span languages/topics.

CREATE TABLE IF NOT EXISTS public.job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL,
  run_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  dry_run BOOLEAN NOT NULL DEFAULT false,
  generator TEXT NOT NULL,
  source_mode TEXT NOT NULL,
  languages TEXT[] NOT NULL DEFAULT '{}'::text[],
  topics TEXT[] NOT NULL DEFAULT '{}'::text[],
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  operator_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_runs_job_type_check CHECK (job_type IN ('daily-job', 'daily-job-test')),
  CONSTRAINT job_runs_status_check CHECK (status IN ('running', 'completed', 'partial_failed', 'failed')),
  CONSTRAINT job_runs_generator_check CHECK (generator IN ('dry-run', 'llm')),
  CONSTRAINT job_runs_source_mode_check CHECK (source_mode IN ('sample', 'rss', 'mixed'))
);

CREATE INDEX IF NOT EXISTS idx_job_runs_run_date_status
ON public.job_runs(run_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_job_runs_completed_at
ON public.job_runs(completed_at DESC);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies are added for job_runs.
-- Job health is an operator concern and should be read only with service role.
