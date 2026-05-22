-- Production beta content-item deduplication guard.
-- The content engine writes metadata.dedup_key for generated items using:
-- run id + language + content type + topic + normalized source URL fingerprint.
-- This partial unique index only constrains rows that opt in with the metadata key.

CREATE UNIQUE INDEX IF NOT EXISTS content_items_dedup_key_unique
ON public.content_items ((metadata->>'dedup_key'))
WHERE metadata ? 'dedup_key'
  AND status <> 'archived';

COMMENT ON INDEX public.content_items_dedup_key_unique IS
  'Prevents repeated same-run content-engine writes from creating duplicate active content_items.';
