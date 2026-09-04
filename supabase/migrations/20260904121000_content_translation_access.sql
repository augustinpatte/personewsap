-- Cross-language reading of a reader's own archive.
--
-- An edition (daily_drops row) is unique per (user_id, drop_date) and is stored
-- in the language the reader had when it was published. Its items point at
-- content_items rows in that language. The French and English renderings of one
-- logical item are two content_items rows produced from the same editorial job,
-- and they already share a stable key in metadata:
--
--   * staging_job_id    — scheduled (staging-publish) editions
--   * catalog_entry_id  — curated launch catalog imports
--   * entry_key         — the 2026-08-23 weekly payload
--
-- Verified against production on 2026-09-04: every published content item
-- referenced by any daily_drop carries exactly one of these keys, and every such
-- key resolves to exactly one FR and one EN published row. (The only rows
-- without a key are status='archived' test-era items that the app never shows.)
--
-- Until now RLS only let a reader SELECT content items assigned to them through
-- their own drops, so after a language switch the other-language rendering of an
-- edition they own was unreadable, and the app either hid the edition or showed
-- it in the old language. This migration lets a reader read the *translation of
-- content already assigned to them* — nothing else. It changes no write policy:
-- interactions and mini-case responses stay anchored to the assigned item id.

-- ---------------------------------------------------------------------------
-- 1. The logical-content key, as a function so every consumer agrees on it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.content_logical_key(p_metadata JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    p_metadata->>'staging_job_id',
    p_metadata->>'catalog_entry_id',
    p_metadata->>'entry_key'
  );
$$;

COMMENT ON FUNCTION public.content_logical_key(JSONB) IS
  'Language-independent identity of a content item: the FR and EN renderings of one editorial job share this key. NULL for legacy rows that predate the keyed pipelines.';

-- Twin lookups run per logical key; the expression index makes them index
-- scans instead of catalog-wide metadata scans.
CREATE INDEX IF NOT EXISTS idx_content_items_logical_key
ON public.content_items (public.content_logical_key(metadata), language)
WHERE status = 'published'
  AND public.content_logical_key(metadata) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. "Is this row a translation of something assigned to me?"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_assigned_content_translation(
  target_content_item_id UUID
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_items twin
    JOIN public.content_items assigned
      ON public.content_logical_key(assigned.metadata) = public.content_logical_key(twin.metadata)
      AND assigned.content_type = twin.content_type
      AND assigned.id <> twin.id
    JOIN public.daily_drop_items ddi
      ON ddi.content_item_id = assigned.id
    JOIN public.daily_drops dd
      ON dd.id = ddi.daily_drop_id
    WHERE twin.id = target_content_item_id
      AND twin.status = 'published'
      AND public.content_logical_key(twin.metadata) IS NOT NULL
      AND assigned.status = 'published'
      AND dd.user_id = auth.uid()
      AND dd.status IN ('published', 'read', 'archived')
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_assigned_content_translation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_assigned_content_translation(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.user_has_assigned_content_translation(UUID) IS
  'True when the target published content item shares a content_logical_key (and content type) with a published item assigned to the caller through their own daily drops. Grants read-side translation access only; write policies do not use it.';

-- ---------------------------------------------------------------------------
-- 3. Read policy: assigned content, plus its translations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read assigned published content" ON public.content_items;

CREATE POLICY "Users can read assigned published content"
ON public.content_items
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND status = 'published'
  AND (
    public.public_archive_enabled()
    OR public.user_has_assigned_content(id)
    OR public.user_has_assigned_content_translation(id)
  )
);

-- content_item_sources / sources policies are deliberately untouched: the FR
-- and EN renderings of one job cite the same source records, and the app shows
-- the assigned item's sources whichever language is displayed.

-- ---------------------------------------------------------------------------
-- 4. Archive search across languages
-- ---------------------------------------------------------------------------
-- The view used to expose exactly the assigned rows, so a reader who switched
-- to French could never find their English-era archive (the stored titles are
-- English). It now emits one row per (assigned item, available language):
-- content_item_id stays the ASSIGNED item id — the stable anchor every
-- interaction and reader route uses — while title/language/metadata come from
-- the rendering in that row's language. A caller filtering language=fr
-- therefore searches French titles and still gets back ids whose interactions
-- and RLS assignment checks resolve.
--
-- The column set changes, so the view is dropped and recreated (CREATE OR
-- REPLACE cannot change an output column's source expression order safely).
DROP VIEW IF EXISTS public.user_archive_search_items;

CREATE VIEW public.user_archive_search_items AS
SELECT DISTINCT ON (dd.user_id, ddi.content_item_id, v.language)
  dd.user_id,
  ddi.content_item_id,
  dd.id AS drop_id,
  dd.drop_date,
  dd.language AS drop_language,
  v.content_type,
  v.language,
  v.title,
  v.topic_id,
  v.source_count,
  v.metadata,
  dd.hide_display_date,
  v.id AS translation_item_id
FROM public.daily_drops dd
JOIN public.daily_drop_items ddi
  ON ddi.daily_drop_id = dd.id
JOIN public.content_items ci
  ON ci.id = ddi.content_item_id
JOIN public.content_items v
  ON v.status = 'published'
  AND (
    v.id = ci.id
    OR (
      public.content_logical_key(ci.metadata) IS NOT NULL
      AND public.content_logical_key(v.metadata) = public.content_logical_key(ci.metadata)
      AND v.content_type = ci.content_type
    )
  )
WHERE dd.user_id = auth.uid()
  AND dd.status IN ('published', 'read', 'archived')
  AND ci.status = 'published'
ORDER BY dd.user_id, ddi.content_item_id, v.language, dd.drop_date DESC, dd.id DESC;

-- security_invoker keeps every underlying RLS policy applied to the caller;
-- the translation rows are readable because of the policy extension above,
-- never because of the view itself.
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
  'Flat, de-duplicated archive of the calling reader''s assigned content items, one row per (content item, available language). content_item_id is always the assigned item (the interaction anchor); title/language/metadata are the rendering in that row''s language. Keyset-paginate on (drop_date DESC, content_item_id DESC) with a language filter.';

NOTIFY pgrst, 'reload schema';
