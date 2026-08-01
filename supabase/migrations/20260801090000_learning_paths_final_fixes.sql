-- Learning Paths final reliability fixes.
-- Additive schema change plus RPC replacements for level coherence and
-- versioned readiness checks. This migration intentionally fails loudly if the
-- Learning foundation has not been installed first.

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
      'Learning paths final fixes cannot run: missing table(s) %. Apply previous Learning migrations first.',
      array_to_string(v_missing, ', ')
      USING ERRCODE = '42P01';
  END IF;
END;
$$;

ALTER TABLE public.learning_sessions
  ADD COLUMN IF NOT EXISTS skipped_step_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'learning_sessions_skipped_step_key_check'
      AND conrelid = 'public.learning_sessions'::regclass
  ) THEN
    ALTER TABLE public.learning_sessions
      ADD CONSTRAINT learning_sessions_skipped_step_key_check
      CHECK (
        skipped_step_key IS NULL
        OR (
          adaptation_mode = 'accelerate'
          AND skipped_step_key <> curriculum_step_key
          AND length(trim(skipped_step_key)) > 0
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_learning_path(
  p_domain_id TEXT,
  p_objective_id TEXT,
  p_current_level SMALLINT,
  p_target_level SMALLINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_language TEXT;
  v_new_path_id UUID;
  v_min_target_level SMALLINT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to start a learning path' USING ERRCODE = '28000';
  END IF;

  IF p_current_level NOT BETWEEN 1 AND 7 OR p_target_level NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Learning levels are outside allowed bounds' USING ERRCODE = '22023';
  END IF;

  v_min_target_level := CASE
    WHEN p_current_level IN (1, 2) THEN 1
    WHEN p_current_level = 3 THEN 2
    WHEN p_current_level = 4 THEN 3
    WHEN p_current_level = 5 THEN 4
    WHEN p_current_level IN (6, 7) THEN 5
  END;

  IF p_target_level < v_min_target_level THEN
    RAISE EXCEPTION 'Target learning level is lower than the selected current level'
      USING ERRCODE = '22023';
  END IF;

  SELECT language INTO v_language
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_language NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'Authenticated profile is missing a supported language' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.learning_domains WHERE id = p_domain_id AND active = true) THEN
    RAISE EXCEPTION 'Learning domain is not active or does not exist' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.learning_objectives
    WHERE id = p_objective_id
      AND domain_id = p_domain_id
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Learning objective is not active or does not belong to the selected domain' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_learning_paths
  SET status = 'archived',
      archived_at = COALESCE(archived_at, now())
  WHERE user_id = v_user_id
    AND status = 'active';

  UPDATE public.learning_sessions sessions
  SET generation_status = CASE WHEN generation_status = 'generating' THEN 'failed' ELSE generation_status END,
      last_generation_error = CASE WHEN generation_status = 'generating' THEN 'Superseded by a new active learning path.' ELSE last_generation_error END
  FROM public.user_learning_paths paths
  WHERE sessions.path_id = paths.id
    AND paths.user_id = v_user_id
    AND paths.status = 'archived'
    AND sessions.status IN ('available', 'opened');

  INSERT INTO public.user_learning_paths (
    user_id, domain_id, objective_id, current_level, target_level, language, status
  )
  VALUES (
    v_user_id, p_domain_id, p_objective_id, p_current_level, p_target_level, v_language, 'active'
  )
  RETURNING id INTO v_new_path_id;

  INSERT INTO public.user_preferences (user_id, learning_path_enabled, learning_path_choice_completed)
  VALUES (v_user_id, true, true)
  ON CONFLICT (user_id) DO UPDATE
  SET learning_path_enabled = true,
      learning_path_choice_completed = true,
      updated_at = now();

  RETURN v_new_path_id;
END;
$$;

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
  v_missing_indexes TEXT[];
  v_missing_rls_tables TEXT[];
  v_domain_count INTEGER;
  v_objective_count INTEGER;
  v_start_rpc_ready BOOLEAN;
  v_session_lifecycle_ready BOOLEAN;
  v_columns_ready BOOLEAN;
  v_functions_ready BOOLEAN;
  v_constraints_ready BOOLEAN;
  v_indexes_ready BOOLEAN;
  v_rls_ready BOOLEAN;
BEGIN
  SELECT array_agg(format('%s.%s', expected.table_name, expected.column_name) ORDER BY expected.table_name, expected.column_name)
  INTO v_missing_columns
  FROM (
    VALUES
      ('learning_domains', 'id'),
      ('learning_domains', 'position'),
      ('learning_domains', 'label_fr'),
      ('learning_domains', 'label_en'),
      ('learning_domains', 'description_fr'),
      ('learning_domains', 'description_en'),
      ('learning_domains', 'active'),
      ('learning_objectives', 'id'),
      ('learning_objectives', 'domain_id'),
      ('learning_objectives', 'position'),
      ('learning_objectives', 'label_fr'),
      ('learning_objectives', 'label_en'),
      ('learning_objectives', 'description_fr'),
      ('learning_objectives', 'description_en'),
      ('learning_objectives', 'active'),
      ('user_learning_paths', 'id'),
      ('user_learning_paths', 'user_id'),
      ('user_learning_paths', 'domain_id'),
      ('user_learning_paths', 'objective_id'),
      ('user_learning_paths', 'current_level'),
      ('user_learning_paths', 'target_level'),
      ('user_learning_paths', 'language'),
      ('user_learning_paths', 'status'),
      ('user_learning_paths', 'completed_at'),
      ('learning_sessions', 'id'),
      ('learning_sessions', 'path_id'),
      ('learning_sessions', 'daily_drop_id'),
      ('learning_sessions', 'curriculum_step_key'),
      ('learning_sessions', 'skipped_step_key'),
      ('learning_sessions', 'session_number'),
      ('learning_sessions', 'repetition_index'),
      ('learning_sessions', 'adaptation_mode'),
      ('learning_sessions', 'generation_status'),
      ('learning_sessions', 'generation_attempts'),
      ('learning_sessions', 'generation_locked_at'),
      ('learning_sessions', 'model_name'),
      ('learning_sessions', 'available_on'),
      ('learning_sessions', 'status'),
      ('learning_sessions', 'opened_at'),
      ('learning_sessions', 'started_at'),
      ('learning_sessions', 'completed_at'),
      ('learning_session_feedback', 'session_id'),
      ('learning_session_feedback', 'user_id'),
      ('learning_session_feedback', 'comprehension_rating'),
      ('learning_session_feedback', 'explainability_rating'),
      ('learning_session_feedback', 'interest_rating'),
      ('learning_session_feedback', 'difficulty_rating')
  ) AS expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = expected.table_name
      AND column_name = expected.column_name
  );

  SELECT array_agg(expected.signature ORDER BY expected.signature)
  INTO v_missing_functions
  FROM (
    VALUES
      ('public.start_learning_path(text,text,smallint,smallint)'),
      ('public.disable_learning_path()'),
      ('public.open_learning_session(uuid)'),
      ('public.start_learning_session(uuid)'),
      ('public.submit_learning_session_feedback(uuid,smallint,smallint,smallint,smallint)'),
      ('public.learning_paths_healthcheck()')
  ) AS expected(signature)
  WHERE to_regprocedure(expected.signature) IS NULL;

  SELECT array_agg(expected.constraint_name ORDER BY expected.constraint_name)
  INTO v_missing_constraints
  FROM (
    VALUES
      ('user_learning_paths_current_level_check'),
      ('user_learning_paths_target_level_check'),
      ('user_learning_paths_language_check'),
      ('user_learning_paths_status_check'),
      ('learning_sessions_session_number_check'),
      ('learning_sessions_adaptation_mode_check'),
      ('learning_sessions_language_check'),
      ('learning_sessions_generation_status_check'),
      ('learning_sessions_generation_attempts_check'),
      ('learning_sessions_status_check'),
      ('learning_sessions_curriculum_step_key_not_blank'),
      ('learning_sessions_skipped_step_key_check')
  ) AS expected(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_constraint.conname = expected.constraint_name
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_rows
    JOIN pg_class table_rows ON table_rows.oid = constraint_rows.conrelid
    JOIN pg_namespace namespaces ON namespaces.oid = constraint_rows.connamespace
    JOIN LATERAL unnest(constraint_rows.conkey) WITH ORDINALITY key_columns(attnum, ordinality) ON true
    JOIN pg_attribute attributes ON attributes.attrelid = table_rows.oid AND attributes.attnum = key_columns.attnum
    WHERE namespaces.nspname = 'public'
      AND table_rows.relname = 'learning_sessions'
      AND constraint_rows.contype = 'u'
    GROUP BY constraint_rows.oid
    HAVING array_agg(attributes.attname ORDER BY key_columns.ordinality) = ARRAY['path_id', 'session_number']::TEXT[]
  ) THEN
    v_missing_constraints := COALESCE(v_missing_constraints, ARRAY[]::TEXT[]) || 'learning_sessions_unique_path_session_number';
  END IF;

  SELECT array_agg(expected.index_name ORDER BY expected.index_name)
  INTO v_missing_indexes
  FROM (
    VALUES
      ('idx_learning_sessions_generation_lock'),
      ('user_learning_paths_one_active_per_user')
  ) AS expected(index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = expected.index_name
  );

  SELECT array_agg(expected.table_name ORDER BY expected.table_name)
  INTO v_missing_rls_tables
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
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = expected.table_name
      AND pg_class.relrowsecurity
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = expected.table_name
  );

  SELECT count(*) INTO v_domain_count FROM public.learning_domains WHERE active;
  SELECT count(*) INTO v_objective_count FROM public.learning_objectives WHERE active;

  v_columns_ready := v_missing_columns IS NULL;
  v_functions_ready := v_missing_functions IS NULL;
  v_constraints_ready := v_missing_constraints IS NULL;
  v_indexes_ready := v_missing_indexes IS NULL;
  v_rls_ready := v_missing_rls_tables IS NULL;
  v_start_rpc_ready := to_regprocedure('public.start_learning_path(text,text,smallint,smallint)') IS NOT NULL
    AND NOT ('user_learning_paths_one_active_per_user' = ANY (COALESCE(v_missing_indexes, ARRAY[]::TEXT[])));
  v_session_lifecycle_ready :=
    to_regprocedure('public.open_learning_session(uuid)') IS NOT NULL
    AND to_regprocedure('public.start_learning_session(uuid)') IS NOT NULL
    AND to_regprocedure('public.submit_learning_session_feedback(uuid,smallint,smallint,smallint,smallint)') IS NOT NULL
    AND NOT ('learning_sessions_skipped_step_key_check' = ANY (COALESCE(v_missing_constraints, ARRAY[]::TEXT[])));

  RETURN jsonb_build_object(
    'schema_version', '1.1',
    'domain_count', v_domain_count,
    'objective_count', v_objective_count,
    'columns_ready', v_columns_ready,
    'functions_ready', v_functions_ready,
    'constraints_ready', v_constraints_ready,
    'indexes_ready', v_indexes_ready,
    'rls_ready', v_rls_ready,
    'start_rpc_ready', v_start_rpc_ready,
    'session_lifecycle_ready', v_session_lifecycle_ready,
    'ready',
      v_columns_ready
      AND v_functions_ready
      AND v_constraints_ready
      AND v_indexes_ready
      AND v_rls_ready
      AND v_start_rpc_ready
      AND v_session_lifecycle_ready
      AND v_domain_count = 7
      AND v_objective_count = 21,
    'missing_columns', COALESCE(to_jsonb(v_missing_columns), '[]'::jsonb),
    'missing_functions', COALESCE(to_jsonb(v_missing_functions), '[]'::jsonb),
    'missing_constraints', COALESCE(to_jsonb(v_missing_constraints), '[]'::jsonb),
    'missing_indexes', COALESCE(to_jsonb(v_missing_indexes), '[]'::jsonb),
    'missing_rls_tables', COALESCE(to_jsonb(v_missing_rls_tables), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_learning_path(TEXT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_paths_healthcheck() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_learning_path(TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.learning_paths_healthcheck() TO authenticated;
GRANT EXECUTE ON FUNCTION public.learning_paths_healthcheck() TO service_role;
