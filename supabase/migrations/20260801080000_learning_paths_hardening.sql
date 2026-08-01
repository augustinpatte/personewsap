-- Learning Paths hardening.
-- Additive only: it repairs a partially applied install, refuses to run on an
-- incompatible one, and replaces the healthcheck with real verifications.

-- 1. The learning foundation must already exist. Failing loudly here is better
--    than adding columns to tables that were never created.
DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_agg(expected.table_name ORDER BY expected.table_name)
  INTO v_missing
  FROM (
    VALUES
      ('learning_domains'),
      ('learning_objectives'),
      ('user_learning_paths'),
      ('learning_sessions'),
      ('learning_session_feedback')
  ) AS expected(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = expected.table_name
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Learning paths hardening cannot run: missing table(s) %. Apply 20260731190000_learning_paths_complete_repair.sql first.',
      array_to_string(v_missing, ', ')
      USING ERRCODE = '42P01';
  END IF;
END;
$$;

-- 2. Refuse to pretend everything is fine when an older install used
--    incompatible column types.
DO $$
DECLARE
  v_problem RECORD;
  v_problems TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR v_problem IN
    SELECT expected.table_name, expected.column_name, expected.expected_types, columns.data_type
    FROM (
      VALUES
        ('learning_domains', 'id', ARRAY['text', 'character varying']),
        ('learning_objectives', 'id', ARRAY['text', 'character varying']),
        ('learning_objectives', 'domain_id', ARRAY['text', 'character varying']),
        ('user_learning_paths', 'id', ARRAY['uuid']),
        ('user_learning_paths', 'user_id', ARRAY['uuid']),
        ('user_learning_paths', 'current_level', ARRAY['smallint', 'integer', 'bigint']),
        ('user_learning_paths', 'target_level', ARRAY['smallint', 'integer', 'bigint']),
        ('learning_sessions', 'id', ARRAY['uuid']),
        ('learning_sessions', 'path_id', ARRAY['uuid']),
        ('learning_sessions', 'session_number', ARRAY['smallint', 'integer', 'bigint']),
        ('learning_sessions', 'objectives_fr', ARRAY['jsonb']),
        ('learning_sessions', 'objectives_en', ARRAY['jsonb']),
        ('learning_sessions', 'generation_locked_at', ARRAY['timestamp with time zone']),
        ('learning_session_feedback', 'session_id', ARRAY['uuid']),
        ('learning_session_feedback', 'comprehension_rating', ARRAY['smallint', 'integer'])
    ) AS expected(table_name, column_name, expected_types)
    JOIN information_schema.columns AS columns
      ON columns.table_schema = 'public'
     AND columns.table_name = expected.table_name
     AND columns.column_name = expected.column_name
    WHERE NOT (columns.data_type = ANY (expected.expected_types))
  LOOP
    v_problems := v_problems || format(
      '%s.%s is %s but must be one of %s',
      v_problem.table_name,
      v_problem.column_name,
      v_problem.data_type,
      array_to_string(v_problem.expected_types, '/')
    );
  END LOOP;

  IF array_length(v_problems, 1) > 0 THEN
    RAISE EXCEPTION 'Learning paths schema is incompatible: %', array_to_string(v_problems, '; ')
      USING ERRCODE = '42804';
  END IF;
END;
$$;

-- 3. Add whatever an older or partial install is missing.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS learning_path_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS learning_path_choice_completed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.user_learning_paths
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.learning_sessions
  ADD COLUMN IF NOT EXISTS repetition_index SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_drop_id UUID REFERENCES public.daily_drops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adaptation_mode TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS generation_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generation_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS model_name TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS input_hash TEXT,
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_generation_error TEXT,
  ADD COLUMN IF NOT EXISTS available_on DATE,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.learning_sessions.repetition_index IS
  'How many earlier sessions already covered this curriculum step. 0 for a first pass, 1+ for a reinforcement or context shift.';

-- 4. Constraints and indexes the engine relies on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_sessions_repetition_index_check'
      AND conrelid = 'public.learning_sessions'::regclass
  ) THEN
    ALTER TABLE public.learning_sessions
      ADD CONSTRAINT learning_sessions_repetition_index_check CHECK (repetition_index >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_sessions_generation_attempts_check'
      AND conrelid = 'public.learning_sessions'::regclass
  ) THEN
    ALTER TABLE public.learning_sessions
      ADD CONSTRAINT learning_sessions_generation_attempts_check CHECK (generation_attempts >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_sessions_adaptation_mode_check'
      AND conrelid = 'public.learning_sessions'::regclass
  ) THEN
    ALTER TABLE public.learning_sessions
      ADD CONSTRAINT learning_sessions_adaptation_mode_check
      CHECK (adaptation_mode IN ('normal', 'reinforce', 'accelerate', 'context_shift', 'prerequisite'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_sessions_generation_status_check'
      AND conrelid = 'public.learning_sessions'::regclass
  ) THEN
    ALTER TABLE public.learning_sessions
      ADD CONSTRAINT learning_sessions_generation_status_check
      CHECK (generation_status IN ('queued', 'generating', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learning_sessions_status_check'
      AND conrelid = 'public.learning_sessions'::regclass
  ) THEN
    ALTER TABLE public.learning_sessions
      ADD CONSTRAINT learning_sessions_status_check
      CHECK (status IN ('available', 'opened', 'started', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_learning_paths_status_check'
      AND conrelid = 'public.user_learning_paths'::regclass
  ) THEN
    ALTER TABLE public.user_learning_paths
      ADD CONSTRAINT user_learning_paths_status_check
      CHECK (status IN ('active', 'archived', 'completed'));
  END IF;
END;
$$;

-- Stale generation locks are recovered by the daily job: make that scan cheap.
CREATE INDEX IF NOT EXISTS idx_learning_sessions_generation_lock
ON public.learning_sessions(generation_status, generation_locked_at);
CREATE UNIQUE INDEX IF NOT EXISTS learning_sessions_one_ready_unstarted_per_path
ON public.learning_sessions(path_id)
WHERE generation_status = 'ready' AND status IN ('available', 'opened');
CREATE UNIQUE INDEX IF NOT EXISTS user_learning_paths_one_active_per_user
ON public.user_learning_paths(user_id)
WHERE status = 'active';

-- 5. A healthcheck that actually checks.
CREATE OR REPLACE FUNCTION public.learning_paths_healthcheck()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing_columns TEXT[];
  v_missing_functions TEXT[];
  v_missing_constraints TEXT[];
  v_missing_policies TEXT[];
  v_domain_count INTEGER;
  v_objective_count INTEGER;
  v_start_rpc_ready BOOLEAN;
  v_session_lifecycle_ready BOOLEAN;
BEGIN
  SELECT array_agg(format('%s.%s', expected.table_name, expected.column_name) ORDER BY expected.table_name, expected.column_name)
  INTO v_missing_columns
  FROM (
    VALUES
      ('learning_domains', 'active'),
      ('learning_objectives', 'domain_id'),
      ('learning_objectives', 'active'),
      ('user_learning_paths', 'user_id'),
      ('user_learning_paths', 'domain_id'),
      ('user_learning_paths', 'objective_id'),
      ('user_learning_paths', 'current_level'),
      ('user_learning_paths', 'target_level'),
      ('user_learning_paths', 'language'),
      ('user_learning_paths', 'status'),
      ('user_learning_paths', 'completed_at'),
      ('learning_sessions', 'path_id'),
      ('learning_sessions', 'curriculum_step_key'),
      ('learning_sessions', 'session_number'),
      ('learning_sessions', 'repetition_index'),
      ('learning_sessions', 'adaptation_mode'),
      ('learning_sessions', 'prompt_text'),
      ('learning_sessions', 'generation_status'),
      ('learning_sessions', 'generation_attempts'),
      ('learning_sessions', 'generation_locked_at'),
      ('learning_sessions', 'model_name'),
      ('learning_sessions', 'status'),
      ('learning_sessions', 'opened_at'),
      ('learning_sessions', 'started_at'),
      ('learning_sessions', 'completed_at'),
      ('learning_session_feedback', 'session_id'),
      ('learning_session_feedback', 'comprehension_rating'),
      ('learning_session_feedback', 'explainability_rating'),
      ('learning_session_feedback', 'interest_rating'),
      ('learning_session_feedback', 'difficulty_rating'),
      ('user_preferences', 'learning_path_enabled'),
      ('user_preferences', 'learning_path_choice_completed')
  ) AS expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = expected.table_name
      AND column_name = expected.column_name
  );

  SELECT array_agg(expected.function_name ORDER BY expected.function_name)
  INTO v_missing_functions
  FROM (
    VALUES
      ('start_learning_path'),
      ('disable_learning_path'),
      ('open_learning_session'),
      ('start_learning_session'),
      ('submit_learning_session_feedback'),
      ('learning_paths_healthcheck')
  ) AS expected(function_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_proc.proname = expected.function_name
  );

  SELECT array_agg(expected.constraint_name ORDER BY expected.constraint_name)
  INTO v_missing_constraints
  FROM (
    VALUES
      ('user_learning_paths_current_level_check'),
      ('user_learning_paths_target_level_check'),
      ('user_learning_paths_status_check'),
      ('learning_sessions_adaptation_mode_check'),
      ('learning_sessions_generation_status_check'),
      ('learning_sessions_status_check'),
      ('learning_sessions_repetition_index_check'),
      ('learning_sessions_generation_attempts_check')
  ) AS expected(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_constraint.conname = expected.constraint_name
  );

  SELECT array_agg(expected.table_name ORDER BY expected.table_name)
  INTO v_missing_policies
  FROM (
    VALUES
      ('learning_domains'),
      ('learning_objectives'),
      ('user_learning_paths'),
      ('learning_sessions'),
      ('learning_session_feedback')
  ) AS expected(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = expected.table_name
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = expected.table_name
      AND pg_class.relrowsecurity
  );

  SELECT count(*) INTO v_domain_count FROM public.learning_domains WHERE active;
  SELECT count(*) INTO v_objective_count FROM public.learning_objectives WHERE active;

  v_start_rpc_ready :=
    NOT ('start_learning_path' = ANY (COALESCE(v_missing_functions, ARRAY[]::TEXT[])))
    AND NOT ('disable_learning_path' = ANY (COALESCE(v_missing_functions, ARRAY[]::TEXT[])))
    AND EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'user_learning_paths_one_active_per_user'
    )
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(v_missing_columns, ARRAY[]::TEXT[])) AS missing(name)
      WHERE missing.name LIKE 'user_learning_paths.%'
    );

  v_session_lifecycle_ready :=
    NOT ('open_learning_session' = ANY (COALESCE(v_missing_functions, ARRAY[]::TEXT[])))
    AND NOT ('start_learning_session' = ANY (COALESCE(v_missing_functions, ARRAY[]::TEXT[])))
    AND NOT ('submit_learning_session_feedback' = ANY (COALESCE(v_missing_functions, ARRAY[]::TEXT[])))
    AND EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'learning_sessions_one_ready_unstarted_per_path'
    )
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(v_missing_columns, ARRAY[]::TEXT[])) AS missing(name)
      WHERE missing.name LIKE 'learning_sessions.%'
         OR missing.name LIKE 'learning_session_feedback.%'
    );

  RETURN jsonb_build_object(
    'schema_version', '1.0',
    'domain_count', v_domain_count,
    'objective_count', v_objective_count,
    'start_rpc_ready', v_start_rpc_ready,
    'session_lifecycle_ready', v_session_lifecycle_ready,
    'columns_ready', v_missing_columns IS NULL,
    'functions_ready', v_missing_functions IS NULL,
    'constraints_ready', v_missing_constraints IS NULL,
    'rls_ready', v_missing_policies IS NULL,
    'missing_columns', COALESCE(to_jsonb(v_missing_columns), '[]'::jsonb),
    'missing_functions', COALESCE(to_jsonb(v_missing_functions), '[]'::jsonb),
    'missing_constraints', COALESCE(to_jsonb(v_missing_constraints), '[]'::jsonb),
    'missing_rls_tables', COALESCE(to_jsonb(v_missing_policies), '[]'::jsonb),
    'ready',
      v_missing_columns IS NULL
      AND v_missing_functions IS NULL
      AND v_missing_constraints IS NULL
      AND v_missing_policies IS NULL
      AND v_domain_count = 7
      AND v_objective_count = 21
      AND v_start_rpc_ready
      AND v_session_lifecycle_ready
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learning_paths_healthcheck() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_paths_healthcheck() TO authenticated;
GRANT EXECUTE ON FUNCTION public.learning_paths_healthcheck() TO service_role;
