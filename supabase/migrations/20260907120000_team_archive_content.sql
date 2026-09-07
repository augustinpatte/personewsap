-- Team content, across a span of editions — PRODUCTION project.
--
-- `get_my_team_edition_content` answers "what did my Teams give me today". The
-- archive asks the same question of twenty-five editions at once, and asking it
-- twenty-five times is the N+1 the mobile provider was explicitly built to
-- avoid. This is the same function over a closed date range.
--
-- WHY THE ARCHIVE NEEDS ANYTHING AT ALL. The archive is built from
-- `daily_drop_items`, and Team-only content has no row there — it reached the
-- reader through `team_content_assignments`, not through their own drop. So a
-- Finance article a reader was given by their Team, opened, and marked read
-- would vanish the day the edition rolled over. It has to stay reachable.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not mint a durable grant. There
-- is no new table, no "archive entitlement" row, nothing that says a reader may
-- read Team content forever. It reads the assignments that were actually
-- written, with exactly the eligibility predicate every other Team surface
-- uses:
--
--     an ACTIVE team, a membership that has not ended, and
--     eligible_from_edition <= the ASSIGNMENT's edition
--
-- so a reader sees the editions they were genuinely part of and nothing else.
-- A member who joined during edition E1 never sees E1's Team content, in the
-- archive or anywhere. This is the same rule as
-- public.user_has_team_content_entitlement, which is what actually authorises
-- the read — this function only lists; RLS still decides.
--
-- The range is bounded server-side (see p_limit) so a client cannot ask for the
-- whole history of every team in one call.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_team_archive_content(
  p_from_date DATE,
  p_to_date DATE,
  p_language TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  content_logical_key TEXT,
  content_type TEXT,
  display_content_item_id UUID,
  display_language TEXT,
  topic_id TEXT,
  product_topic TEXT,
  title TEXT,
  summary TEXT,
  edition_date DATE,
  assignment_position SMALLINT,
  teams JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH reader AS (
    -- Same rule as get_my_team_edition_content: the language comes from the
    -- profile, and an explicit argument is validated against the two that
    -- exist rather than trusted.
    SELECT
      p.id AS reader_id,
      CASE
        WHEN p_language = 'fr' THEN 'fr'
        WHEN p_language = 'en' THEN 'en'
        WHEN p.language IN ('fr', 'en') THEN p.language
        ELSE 'en'
      END AS reader_language
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ),
  bounds AS (
    SELECT
      least(p_from_date, p_to_date) AS from_date,
      greatest(p_from_date, p_to_date) AS to_date,
      -- A client asking for a million rows gets 500. The archive is paged, so
      -- a page's worth of editions never approaches this.
      least(greatest(COALESCE(p_limit, 200), 1), 500) AS row_limit
  ),
  mine AS (
    -- One row per (edition, logical content), never one per team: two Teams
    -- assigned the same article is the normal case and the reader must see one
    -- article with two badges.
    SELECT
      a.edition_date AS assigned_edition,
      a.content_logical_key AS logical_key,
      a.content_type AS logical_type,
      min(a.topic_id) AS newsletter_topic,
      min(a.product_topic) AS case_topic,
      min(a.position)::SMALLINT AS list_position,
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END
        )
        ORDER BY a.position, t.id
      ) AS team_refs
    FROM public.team_content_assignments a
    JOIN public.teams t
      ON t.id = a.team_id
     AND t.status = 'active'
    JOIN public.team_members m
      ON m.team_id = a.team_id
     AND m.user_id = (SELECT r.reader_id FROM reader r)
     AND m.left_at IS NULL
     AND m.eligible_from_edition <= a.edition_date
    WHERE a.edition_date >= (SELECT b.from_date FROM bounds b)
      AND a.edition_date <= (SELECT b.to_date FROM bounds b)
    GROUP BY a.edition_date, a.content_logical_key, a.content_type
  ),
  rendered AS (
    SELECT DISTINCT ON (mine.assigned_edition, mine.logical_key, mine.logical_type)
      mine.assigned_edition,
      mine.logical_key,
      mine.logical_type,
      ci.id AS item_id,
      ci.language AS item_language,
      mine.newsletter_topic,
      mine.case_topic,
      ci.title AS item_title,
      ci.summary AS item_summary,
      mine.list_position,
      mine.team_refs
    FROM mine
    JOIN public.content_items ci
      ON public.content_logical_key(ci.metadata) = mine.logical_key
     AND ci.content_type = mine.logical_type
     AND ci.status = 'published'
    ORDER BY
      mine.assigned_edition,
      mine.logical_key,
      mine.logical_type,
      (ci.language = (SELECT r.reader_language FROM reader r)) DESC,
      ci.language,
      ci.id
  )
  SELECT
    rendered.logical_key,
    rendered.logical_type,
    rendered.item_id,
    rendered.item_language,
    rendered.newsletter_topic,
    rendered.case_topic,
    rendered.item_title,
    rendered.item_summary,
    rendered.assigned_edition,
    rendered.list_position,
    rendered.team_refs
  FROM rendered
  ORDER BY rendered.assigned_edition DESC, rendered.list_position, rendered.logical_key
  LIMIT (SELECT b.row_limit FROM bounds b);
$$;

REVOKE ALL ON FUNCTION public.get_my_team_archive_content(DATE, DATE, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_team_archive_content(DATE, DATE, TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_team_archive_content(DATE, DATE, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_team_archive_content(DATE, DATE, TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.get_my_team_archive_content(DATE, DATE, TEXT, INTEGER) IS
  'The caller''s Team content across a range of editions, one row per edition and logical content, for the archive. Lists only assignments made while the caller was an eligible member of an active team; it grants nothing — RLS still authorises every read.';

COMMIT;

NOTIFY pgrst, 'reload schema';
