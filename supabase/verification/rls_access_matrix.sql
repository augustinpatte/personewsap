-- PersoNewsAP RLS access matrix.
-- Run with psql through scripts/run-supabase-verification.sh.
-- Required psql variables:
--   user_a: auth/profile UUID for tester A
--   user_a_email: email claim for tester A
--   user_b: auth/profile UUID for tester B
--   published_content_id: UUID of a published content_items row
-- Optional psql variables:
--   proof_date: date for rollbacked daily_drop client-write probes, defaults to 2099-01-02

\set ON_ERROR_STOP on

\if :{?user_a}
\else
  \echo 'Missing -v user_a=<uuid>'
  \quit 2
\endif

\if :{?user_a_email}
\else
  \echo 'Missing -v user_a_email=<email>'
  \quit 2
\endif

\if :{?user_b}
\else
  \echo 'Missing -v user_b=<uuid>'
  \quit 2
\endif

\if :{?published_content_id}
\else
  \echo 'Missing -v published_content_id=<uuid>'
  \quit 2
\endif

\if :{?proof_date}
\else
  \set proof_date '2099-01-02'
\endif

BEGIN;

CREATE TEMP TABLE verification_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.record_blocked_other_interaction(
  other_user_id uuid,
  published_content_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    INSERT INTO public.content_interactions (user_id, content_item_id, interaction_type)
    VALUES (other_user_id, published_content_id, 'view');

    INSERT INTO verification_results
      VALUES ('authenticated user cannot insert another user interaction', 'FAIL', 'insert unexpectedly succeeded');
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR with_check_option_violation THEN
      INSERT INTO verification_results
        VALUES ('authenticated user cannot insert another user interaction', 'PASS', SQLSTATE);
    WHEN OTHERS THEN
      INSERT INTO verification_results
        VALUES ('authenticated user cannot insert another user interaction', 'PASS', SQLSTATE);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.record_blocked_daily_drop_insert(
  actor_user_id uuid,
  check_label text,
  proof_date date
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    INSERT INTO public.daily_drops (user_id, drop_date, language, status, published_at)
    VALUES (actor_user_id, proof_date, 'en', 'published', now());

    INSERT INTO verification_results
      VALUES (check_label, 'FAIL', 'insert unexpectedly succeeded');
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR with_check_option_violation THEN
      INSERT INTO verification_results
        VALUES (check_label, 'PASS', SQLSTATE);
    WHEN OTHERS THEN
      INSERT INTO verification_results
        VALUES (check_label, 'PASS', SQLSTATE);
  END;
END;
$$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);

INSERT INTO verification_results
SELECT
  'anon cannot read profiles',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.profiles
WHERE id IN (:'user_a'::uuid, :'user_b'::uuid);

INSERT INTO verification_results
SELECT
  'anon cannot read user_preferences',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.user_preferences
WHERE user_id IN (:'user_a'::uuid, :'user_b'::uuid);

INSERT INTO verification_results
SELECT
  'anon cannot read user_topic_preferences',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.user_topic_preferences
WHERE user_id IN (:'user_a'::uuid, :'user_b'::uuid);

INSERT INTO verification_results
SELECT
  'anon cannot read content_interactions',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.content_interactions
WHERE user_id IN (:'user_a'::uuid, :'user_b'::uuid);

INSERT INTO verification_results
SELECT
  'anon cannot read daily_drops',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.daily_drops
WHERE user_id IN (:'user_a'::uuid, :'user_b'::uuid);

INSERT INTO verification_results
SELECT
  'anon cannot read daily_drop_items for private drops',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.daily_drop_items;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', :'user_a', true);
SELECT set_config('request.jwt.claim.email', :'user_a_email', true);

INSERT INTO verification_results
SELECT
  'authenticated user reads own profile',
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.profiles
WHERE id = :'user_a'::uuid;

INSERT INTO verification_results
SELECT
  'authenticated user cannot read another profile',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.profiles
WHERE id = :'user_b'::uuid;

INSERT INTO verification_results
SELECT
  'authenticated user reads own preferences',
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.user_preferences
WHERE user_id = :'user_a'::uuid;

INSERT INTO verification_results
SELECT
  'authenticated user cannot read another preferences',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.user_preferences
WHERE user_id = :'user_b'::uuid;

INSERT INTO verification_results
SELECT
  'authenticated user reads own topic preferences',
  CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.user_topic_preferences
WHERE user_id = :'user_a'::uuid;

INSERT INTO verification_results
SELECT
  'authenticated user cannot read another topic preferences',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.user_topic_preferences
WHERE user_id = :'user_b'::uuid;

WITH updated AS (
  UPDATE public.profiles
  SET timezone = timezone
  WHERE id = :'user_a'::uuid
  RETURNING id
)
INSERT INTO verification_results
SELECT
  'authenticated user can update own profile',
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM updated;

WITH updated AS (
  UPDATE public.profiles
  SET timezone = timezone
  WHERE id = :'user_b'::uuid
  RETURNING id
)
INSERT INTO verification_results
SELECT
  'authenticated user cannot update another profile',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM updated;

WITH inserted AS (
  INSERT INTO public.content_interactions (user_id, content_item_id, interaction_type)
  VALUES (:'user_a'::uuid, :'published_content_id'::uuid, 'view')
  RETURNING id
)
INSERT INTO verification_results
SELECT
  'authenticated user can insert own interaction for published content',
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM inserted;

SELECT pg_temp.record_blocked_other_interaction(:'user_b'::uuid, :'published_content_id'::uuid);

SELECT pg_temp.record_blocked_daily_drop_insert(
  :'user_a'::uuid,
  'authenticated user cannot insert own daily_drop from client',
  :'proof_date'::date
);

SELECT pg_temp.record_blocked_daily_drop_insert(
  :'user_b'::uuid,
  'authenticated user cannot insert another daily_drop from client',
  :'proof_date'::date
);

INSERT INTO verification_results
SELECT
  'authenticated users can read published content_items',
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.content_items
WHERE id = :'published_content_id'::uuid
  AND status = 'published';

INSERT INTO verification_results
SELECT
  'authenticated user only reads own daily drops',
  CASE WHEN bool_and(user_id = :'user_a'::uuid) IS NOT FALSE THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' visible row(s)'
FROM public.daily_drops
WHERE status IN ('published', 'read', 'archived');

INSERT INTO verification_results
SELECT
  'authenticated user cannot filter another daily drops',
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
  count(*)::text || ' row(s)'
FROM public.daily_drops
WHERE user_id = :'user_b'::uuid
  AND status IN ('published', 'read', 'archived');

SELECT *
FROM verification_results
ORDER BY check_name;

ROLLBACK;
