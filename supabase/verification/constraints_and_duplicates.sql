-- PersoNewsAP production-beta constraint and duplicate audit.
-- Read-only. Safe for Supabase SQL editor or psql.

WITH expected_constraints(label, table_name, columns) AS (
  VALUES
    ('one daily drop per user/date', 'daily_drops', ARRAY['user_id', 'drop_date']),
    ('no duplicate daily_drop/content_item links', 'daily_drop_items', ARRAY['daily_drop_id', 'content_item_id']),
    ('no duplicate daily_drop slot positions', 'daily_drop_items', ARRAY['daily_drop_id', 'slot', 'position'])
),
constraint_matches AS (
  SELECT
    expected_constraints.label,
    expected_constraints.table_name,
    expected_constraints.columns,
    EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = ('public.' || expected_constraints.table_name)::regclass
        AND c.contype IN ('p', 'u')
        AND (
          SELECT array_agg(a.attname ORDER BY cols.ordinality)
          FROM unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid
           AND a.attnum = cols.attnum
        ) = expected_constraints.columns
    ) AS exists
  FROM expected_constraints
)
SELECT
  'required unique constraint exists' AS check_name,
  label,
  table_name,
  columns,
  CASE WHEN exists THEN 'PASS' ELSE 'FAIL' END AS status
FROM constraint_matches
ORDER BY table_name, label;

WITH expected_indexes(label, index_name) AS (
  VALUES
    ('complete interaction idempotency', 'content_interactions_complete_once_per_user_content'),
    ('save interaction idempotency', 'content_interactions_save_once_per_user_content')
)
SELECT
  'required partial unique index exists' AS check_name,
  expected_indexes.label,
  expected_indexes.index_name,
  CASE WHEN pg_class.oid IS NULL THEN 'FAIL' ELSE 'PASS' END AS status
FROM expected_indexes
LEFT JOIN pg_class
  ON pg_class.relname = expected_indexes.index_name
LEFT JOIN pg_namespace
  ON pg_namespace.oid = pg_class.relnamespace
 AND pg_namespace.nspname = 'public'
ORDER BY expected_indexes.index_name;

SELECT
  'duplicate daily_drops user/date rows' AS check_name,
  count(*) AS duplicate_groups,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT user_id, drop_date
  FROM public.daily_drops
  GROUP BY user_id, drop_date
  HAVING count(*) > 1
) duplicates;

SELECT
  'duplicate daily_drop_items by content item' AS check_name,
  count(*) AS duplicate_groups,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT daily_drop_id, content_item_id
  FROM public.daily_drop_items
  GROUP BY daily_drop_id, content_item_id
  HAVING count(*) > 1
) duplicates;

SELECT
  'duplicate daily_drop_items by slot position' AS check_name,
  count(*) AS duplicate_groups,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT daily_drop_id, slot, position
  FROM public.daily_drop_items
  GROUP BY daily_drop_id, slot, position
  HAVING count(*) > 1
) duplicates;

SELECT
  'duplicate complete interactions' AS check_name,
  count(*) AS duplicate_groups,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT user_id, content_item_id
  FROM public.content_interactions
  WHERE interaction_type = 'complete'
  GROUP BY user_id, content_item_id
  HAVING count(*) > 1
) duplicates;

SELECT
  'duplicate save interactions' AS check_name,
  count(*) AS duplicate_groups,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM (
  SELECT user_id, content_item_id
  FROM public.content_interactions
  WHERE interaction_type = 'save'
  GROUP BY user_id, content_item_id
  HAVING count(*) > 1
) duplicates;
