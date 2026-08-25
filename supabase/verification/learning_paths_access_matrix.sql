-- PersoNewsAP learning paths access and constraint matrix.
-- Run with psql against a disposable or local Supabase database.
-- This script is transactional and rolls back its test data.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE learning_verification_results (
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.expect_blocked(
  check_name TEXT,
  statement TEXT
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE statement;

    INSERT INTO learning_verification_results
    VALUES (check_name, 'FAIL', 'statement unexpectedly succeeded');
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO learning_verification_results
      VALUES (check_name, 'PASS', SQLSTATE || ' ' || SQLERRM);
  END;
END;
$$;

SELECT
  gen_random_uuid()::TEXT AS learning_user_a,
  gen_random_uuid()::TEXT AS learning_user_b,
  gen_random_uuid()::TEXT AS learning_unused_session
\gset

SELECT
  ('learning-a-' || :'learning_user_a' || '@example.test') AS learning_user_a_email,
  ('learning-b-' || :'learning_user_b' || '@example.test') AS learning_user_b_email
\gset

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
VALUES
  (
    :'learning_user_a'::UUID,
    'authenticated',
    'authenticated',
    :'learning_user_a_email',
    '',
    now(),
    now(),
    now()
  ),
  (
    :'learning_user_b'::UUID,
    'authenticated',
    'authenticated',
    :'learning_user_b_email',
    '',
    now(),
    now(),
    now()
  );

INSERT INTO public.profiles (id, email, language, timezone)
VALUES
  (:'learning_user_a'::UUID, :'learning_user_a_email', 'fr', 'Europe/Paris'),
  (:'learning_user_b'::UUID, :'learning_user_b_email', 'en', 'UTC');

INSERT INTO learning_verification_results
SELECT
  'seven learning domains exist',
  CASE WHEN count(*) = 7 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::TEXT || ' row(s)'
FROM public.learning_domains
WHERE id IN (
  'computer_science',
  'artificial_intelligence',
  'blockchain',
  'quantum_physics',
  'mathematics',
  'cybersecurity',
  'human_biology_medicine'
);

INSERT INTO learning_verification_results
SELECT
  'twenty-one learning objectives exist',
  CASE WHEN count(*) = 21 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::TEXT || ' row(s)'
FROM public.learning_objectives
WHERE id IN (
  'cs_systems',
  'cs_programming',
  'cs_software_data',
  'ai_foundations',
  'ai_machine_learning',
  'ai_building',
  'blockchain_foundations',
  'blockchain_ecosystem',
  'blockchain_building',
  'quantum_intuition',
  'quantum_mathematics',
  'quantum_computing',
  'math_foundations',
  'math_probability',
  'math_technology',
  'cyber_foundations',
  'cyber_network_defense',
  'cyber_app_cloud',
  'medicine_body',
  'medicine_disease',
  'medicine_evidence'
);

SELECT pg_temp.expect_blocked(
  'objective cannot belong to the wrong domain',
  format(
    $sql$
      INSERT INTO public.user_learning_paths (
        user_id,
        domain_id,
        objective_id,
        current_level,
        target_level,
        language,
        status
      )
      VALUES (%L::UUID, 'computer_science', 'ai_foundations', 2, 4, 'en', 'archived')
    $sql$,
    :'learning_user_b'
  )
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', :'learning_user_a', true);
SELECT set_config('request.jwt.claim.email', :'learning_user_a_email', true);

SELECT id AS learning_path_a
FROM public.start_learning_path('computer_science', 'cs_systems', 2, 4)
\gset

INSERT INTO learning_verification_results
SELECT
  'start_learning_path valid RPC works',
  CASE WHEN :'learning_path_a'::UUID IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
  :'learning_path_a';

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.user_learning_paths (
  user_id,
  domain_id,
  objective_id,
  current_level,
  target_level,
  language,
  status
)
VALUES (
  :'learning_user_b'::UUID,
  'mathematics',
  'math_foundations',
  1,
  3,
  'en',
  'active'
)
RETURNING id AS learning_path_b
\gset

SELECT pg_temp.expect_blocked(
  'user cannot have two active learning paths',
  format(
    $sql$
      INSERT INTO public.user_learning_paths (
        user_id,
        domain_id,
        objective_id,
        current_level,
        target_level,
        language,
        status
      )
      VALUES (%L::UUID, 'cybersecurity', 'cyber_foundations', 1, 3, 'en', 'active')
    $sql$,
    :'learning_user_b'
  )
);

INSERT INTO public.learning_sessions (
  user_learning_path_id,
  curriculum_step_id,
  catalog_version,
  sequence_number,
  adaptation_mode,
  language,
  title,
  summary,
  learning_goals,
  prompt_text,
  estimated_minutes,
  status,
  release_date
)
VALUES (
  :'learning_path_a'::UUID,
  'cs_systems_intro_001',
  'v1',
  1,
  'normal',
  'fr',
  'Comprendre le processeur',
  'Une session courte sur le rôle du processeur.',
  '["Identifier le rôle du processeur"]'::JSONB,
  'Lis la session et réponds aux quatre notes finales.',
  5,
  'available',
  CURRENT_DATE
)
RETURNING id AS learning_session_a
\gset

INSERT INTO learning_verification_results
VALUES (
  'service role can create learning sessions',
  'PASS',
  :'learning_session_a'
);

SELECT pg_temp.expect_blocked(
  'session duration different from five minutes is refused',
  format(
    $sql$
      INSERT INTO public.learning_sessions (
        user_learning_path_id,
        curriculum_step_id,
        sequence_number,
        language,
        title,
        summary,
        prompt_text,
        estimated_minutes,
        status,
        release_date
      )
      VALUES (%L::UUID, 'invalid_duration_probe', 2, 'fr', 'Invalid', 'Invalid', 'Invalid', 4, 'available', CURRENT_DATE)
    $sql$,
    :'learning_path_a'
  )
);

SELECT pg_temp.expect_blocked(
  'feedback rating outside one to five is refused',
  format(
    $sql$
      INSERT INTO public.learning_session_feedback (
        session_id,
        user_id,
        comprehension_rating,
        explainability_rating,
        interest_rating,
        difficulty_rating
      )
      VALUES (%L::UUID, %L::UUID, 6, 4, 4, 2)
    $sql$,
    :'learning_session_a',
    :'learning_user_a'
  )
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', :'learning_user_b', true);
SELECT set_config('request.jwt.claim.email', :'learning_user_b_email', true);

INSERT INTO learning_verification_results
SELECT
  'user cannot read another user learning path',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::TEXT || ' row(s)'
FROM public.user_learning_paths
WHERE id = :'learning_path_a'::UUID;

SELECT pg_temp.expect_blocked(
  'user cannot evaluate another user learning session',
  format(
    $sql$
      SELECT public.submit_learning_session_feedback(%L::UUID, 3, 3, 3, 3)
    $sql$,
    :'learning_session_a'
  )
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', :'learning_user_a', true);
SELECT set_config('request.jwt.claim.email', :'learning_user_a_email', true);

SELECT pg_temp.expect_blocked(
  'authenticated direct learning_sessions write is refused',
  format(
    $sql$
      INSERT INTO public.learning_sessions (
        user_learning_path_id,
        curriculum_step_id,
        sequence_number,
        language,
        title,
        summary,
        prompt_text,
        status,
        release_date
      )
      VALUES (%L::UUID, 'direct_client_probe', 3, 'fr', 'Direct', 'Direct', 'Direct', 'available', CURRENT_DATE)
    $sql$,
    :'learning_path_a'
  )
);

SELECT id AS completed_session_id, status AS completed_session_status
FROM public.submit_learning_session_feedback(:'learning_session_a'::UUID, 4, 4, 5, 2)
\gset

INSERT INTO learning_verification_results
SELECT
  'submit_learning_session_feedback valid RPC works',
  CASE WHEN :'completed_session_status' = 'completed' THEN 'PASS' ELSE 'FAIL' END,
  :'completed_session_id' || ' status=' || :'completed_session_status';

RESET ROLE;

TABLE learning_verification_results
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM learning_verification_results
    WHERE status <> 'PASS'
  ) THEN
    RAISE EXCEPTION 'Learning paths verification failed';
  END IF;
END;
$$;

ROLLBACK;
