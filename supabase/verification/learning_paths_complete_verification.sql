-- Learning Paths complete verification.
-- Run after applying all Learning migrations through
-- 20260801090000_learning_paths_final_fixes.sql.

DO $$
DECLARE
  v_missing_tables TEXT[];
  v_missing_rpcs TEXT[];
  v_domain_count INTEGER;
  v_objective_count INTEGER;
  v_health JSONB;
BEGIN
  SELECT array_agg(required_table)
  INTO v_missing_tables
  FROM unnest(ARRAY[
    'learning_domains',
    'learning_objectives',
    'user_learning_paths',
    'learning_sessions',
    'learning_session_feedback'
  ]) AS required_table
  WHERE to_regclass('public.' || required_table) IS NULL;

  IF v_missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Missing learning table(s): %', v_missing_tables;
  END IF;

  SELECT array_agg(required_rpc)
  INTO v_missing_rpcs
  FROM unnest(ARRAY[
    'start_learning_path',
    'disable_learning_path',
    'open_learning_session',
    'start_learning_session',
    'submit_learning_session_feedback',
    'learning_paths_healthcheck'
  ]) AS required_rpc
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = required_rpc
  );

  IF v_missing_rpcs IS NOT NULL THEN
    RAISE EXCEPTION 'Missing learning RPC(s): %', v_missing_rpcs;
  END IF;

  SELECT count(*) INTO v_domain_count FROM public.learning_domains WHERE active;
  SELECT count(*) INTO v_objective_count FROM public.learning_objectives WHERE active;

  IF v_domain_count <> 7 THEN
    RAISE EXCEPTION 'Expected 7 active learning domains, got %', v_domain_count;
  END IF;

  IF v_objective_count <> 21 THEN
    RAISE EXCEPTION 'Expected 21 active learning objectives, got %', v_objective_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.learning_objectives objective
    LEFT JOIN public.learning_domains domain ON domain.id = objective.domain_id
    WHERE domain.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A learning objective references a missing domain';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'user_learning_paths_one_active_per_user'
  ) THEN
    RAISE EXCEPTION 'Missing unique active path index';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'learning_sessions_ready_prompt_check'
  ) THEN
    RAISE EXCEPTION 'Missing ready prompt constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'learning_sessions_opened_at_check'
  ) THEN
    RAISE EXCEPTION 'Missing opened_at lifecycle constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'learning_sessions_started_at_check'
  ) THEN
    RAISE EXCEPTION 'Missing started_at lifecycle constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'learning_sessions'
      AND column_name = 'skipped_step_key'
  ) THEN
    RAISE EXCEPTION 'Missing learning_sessions.skipped_step_key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'learning_sessions_skipped_step_key_check'
  ) THEN
    RAISE EXCEPTION 'Missing skipped_step_key constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'learning_sessions'
      AND policyname = 'Users can read ready own learning sessions'
  ) THEN
    RAISE EXCEPTION 'Missing learning_sessions RLS policy';
  END IF;

  SELECT public.learning_paths_healthcheck() INTO v_health;
  IF v_health->>'schema_version' <> '1.1'
    OR (v_health->>'domain_count')::INTEGER <> 7
    OR (v_health->>'objective_count')::INTEGER <> 21
    OR (v_health->>'ready')::BOOLEAN IS NOT TRUE
  THEN
    RAISE EXCEPTION 'Unexpected healthcheck payload: %', v_health;
  END IF;
END;
$$;

SELECT 'learning_paths_complete_verification passed' AS result;
