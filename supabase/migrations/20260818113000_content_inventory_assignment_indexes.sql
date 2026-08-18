-- Production catalog reuse and assignment scale indexes.
--
-- Additive only: these indexes support the server-side daily job when it scans
-- published reusable inventory and excludes previously assigned reusable items
-- for batches of users. They do not change RLS or existing constraints.

CREATE INDEX IF NOT EXISTS idx_content_items_reusable_inventory
ON public.content_items(language, content_type, created_at, id)
WHERE status = 'published'
  AND content_type IN ('business_story', 'mini_case');

CREATE INDEX IF NOT EXISTS idx_content_items_bootstrap_catalog_run
ON public.content_items((metadata->>'bootstrap_run_id'), status, content_type, id)
WHERE content_type IN ('business_story', 'mini_case')
  AND metadata->>'scheduler_mode' = 'bootstrap-catalog';

CREATE INDEX IF NOT EXISTS idx_daily_drops_user_drop_date_id
ON public.daily_drops(user_id, drop_date, id);
