-- PersoNewsAP service_role write probe.
-- Runs write checks inside a transaction and rolls them back.
-- Required psql variables:
--   user_a: auth/profile UUID that exists in public.profiles
-- Optional psql variables:
--   proof_date: date for the rollbacked daily_drop insert, defaults to 2099-01-01

\set ON_ERROR_STOP on

\if :{?user_a}
\else
  \echo 'Missing -v user_a=<uuid>'
  \quit 2
\endif

\if :{?proof_date}
\else
  \set proof_date '2099-01-01'
\endif

BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

WITH inserted_content AS (
  INSERT INTO public.content_items (
    content_type,
    topic_id,
    language,
    title,
    summary,
    body_md,
    publication_date,
    status,
    source_count,
    metadata
  )
  VALUES (
    'concept',
    'business',
    'en',
    '[VERIFY] service role content insert',
    'Rollbacked service-role verification row.',
    'Rollbacked service-role verification body.',
    :'proof_date'::date,
    'published',
    0,
    '{"verification":"service_role_write_probe"}'::jsonb
  )
  RETURNING id
),
inserted_drop AS (
  INSERT INTO public.daily_drops (
    user_id,
    drop_date,
    language,
    status,
    published_at
  )
  VALUES (
    :'user_a'::uuid,
    :'proof_date'::date,
    'en',
    'published',
    now()
  )
  ON CONFLICT (user_id, drop_date)
  DO UPDATE SET
    language = EXCLUDED.language,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    updated_at = now()
  RETURNING id
),
inserted_drop_item AS (
  INSERT INTO public.daily_drop_items (
    daily_drop_id,
    content_item_id,
    slot,
    position
  )
  SELECT
    inserted_drop.id,
    inserted_content.id,
    'concept',
    0
  FROM inserted_drop, inserted_content
  ON CONFLICT (daily_drop_id, slot, position)
  DO UPDATE SET
    content_item_id = EXCLUDED.content_item_id
  RETURNING daily_drop_id, content_item_id
)
SELECT
  'service_role can write content_items and daily_drops' AS check_name,
  CASE
    WHEN count(*) = 1 THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  count(*)::text || ' daily_drop_item row(s)' AS detail
FROM inserted_drop_item;

ROLLBACK;
