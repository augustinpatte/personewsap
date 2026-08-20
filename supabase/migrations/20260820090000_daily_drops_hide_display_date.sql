-- Undated prelaunch editions.
--
-- A handful of editions are seeded by hand before the public launch. They must
-- read as evergreen, so the mobile app does not print their calendar date. That
-- is a display decision about one edition, and nothing else: the edition still
-- carries a real drop_date, and every ordering, cadence, weekly-digest,
-- notification and analytics rule keeps reading it.
--
-- The flag is explicit and stored per edition rather than derived from a launch
-- date, the account age or the row's rank. Six months from now the reason an
-- edition shows no date must be readable from the row itself.
--
-- It belongs to the edition, never to the content: a Business Story or Mini Case
-- carried by an undated prelaunch edition can be reused later in a normal dated
-- one.

ALTER TABLE public.daily_drops
  ADD COLUMN IF NOT EXISTS hide_display_date BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.daily_drops.hide_display_date IS
  'Display-only: when true the mobile app renders this edition without its calendar date (prelaunch seeded editions). drop_date is still stored and still drives ordering, cadence, weekly-digest detection, notifications and analytics.';

-- The archive-search view carries the flag so a searched item can be rendered
-- with the same rule as the edition it belongs to. Appended last: CREATE OR
-- REPLACE VIEW keeps the existing columns in place, along with the view's
-- security_invoker setting and grants.
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
  ci.metadata,
  dd.hide_display_date
FROM public.daily_drops dd
JOIN public.daily_drop_items ddi
  ON ddi.daily_drop_id = dd.id
JOIN public.content_items ci
  ON ci.id = ddi.content_item_id
WHERE dd.user_id = auth.uid()
  AND dd.status IN ('published', 'read', 'archived')
  AND ci.status = 'published'
ORDER BY dd.user_id, ddi.content_item_id, dd.drop_date DESC, dd.id DESC;
