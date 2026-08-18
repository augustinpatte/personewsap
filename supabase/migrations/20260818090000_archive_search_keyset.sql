-- Archive search over the whole history, with keyset pagination.
--
-- The app searches Business Stories and Mini Cases across every edition a
-- reader has ever received. That search was capped at ~40 rows because it could
-- not be paginated: it queried public.daily_drop_items and embedded
-- daily_drops/content_items, and PostgREST can only order the *embedded* rows
-- by drop_date — never the top-level ones. Without a reliable top-level order
-- there is no stable cursor, so the only way to bound the response was a fixed
-- limit, and anything past it was unreachable.
--
-- This view flattens the join so drop_date and content_item_id become ordinary
-- top-level columns. That makes a real keyset possible:
--
--   ORDER BY drop_date DESC, content_item_id DESC
--   WHERE drop_date < :cursor_date
--      OR (drop_date = :cursor_date AND content_item_id < :cursor_item)
--
-- which is stable while new editions are published (they sort above the cursor
-- and simply do not appear in later pages), unlike OFFSET.
--
-- Strictly additive: one view and one grant. No table, column, index, policy or
-- row is created, altered or dropped, and nothing existing reads this view.

-- One row per (reader, content item): a content item can legitimately appear in
-- more than one daily drop, and a search result must never be listed twice. The
-- deterministic rule is "the most recent edition that carried it" — DISTINCT ON
-- keeps the first row per key in the ORDER BY below, i.e. the newest drop_date
-- (ties broken by drop id so the choice is reproducible). Both the drop_date
-- shown next to the result and the keyset itself therefore refer to that
-- edition.
--
-- Ownership is enforced twice on purpose:
--   * security_invoker (set below) makes every underlying RLS policy apply to
--     the calling reader, exactly as if they had written the join themselves;
--   * the auth.uid() predicate here is defence in depth, so the view can never
--     widen access even if it were ever read with the owner's rights.
-- This is not a global SELECT over content_items: a row exists only because one
-- of the reader's own published drops assigned that item to them.
CREATE OR REPLACE VIEW public.user_archive_search_items AS
SELECT DISTINCT ON (dd.user_id, ddi.content_item_id)
  dd.user_id,
  ddi.content_item_id,
  dd.id AS drop_id,
  dd.drop_date,
  dd.language AS drop_language,
  ci.content_type,
  ci.language,
  ci.title,
  ci.topic_id,
  ci.source_count,
  ci.metadata
FROM public.daily_drops dd
JOIN public.daily_drop_items ddi
  ON ddi.daily_drop_id = dd.id
JOIN public.content_items ci
  ON ci.id = ddi.content_item_id
WHERE dd.user_id = auth.uid()
  AND dd.status IN ('published', 'read', 'archived')
  AND ci.status = 'published'
ORDER BY dd.user_id, ddi.content_item_id, dd.drop_date DESC, dd.id DESC;

-- security_invoker exists from PostgreSQL 15. The guard keeps this migration
-- applicable on an older instance, where the auth.uid() predicate above is what
-- scopes the view.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW public.user_archive_search_items SET (security_invoker = true)';
  END IF;
END;
$$;

REVOKE ALL ON public.user_archive_search_items FROM PUBLIC;
GRANT SELECT ON public.user_archive_search_items TO authenticated;

COMMENT ON VIEW public.user_archive_search_items IS
  'Flat, de-duplicated archive of the calling reader''s assigned content items (one row per content item, carrying its most recent edition). Exists so archive search can keyset-paginate on (drop_date DESC, content_item_id DESC) over the whole history.';

-- No new index is added: the join already runs on existing ones —
-- idx_daily_drops_user_date (user_id, drop_date DESC), the daily_drop_items
-- primary key (daily_drop_id, content_item_id) and the content_items primary
-- key. The result set is bounded by one reader's own archive, so the title
-- ILIKE runs over that set rather than the whole catalog.

NOTIFY pgrst, 'reload schema';
