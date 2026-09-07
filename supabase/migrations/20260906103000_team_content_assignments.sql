-- Team content, as a first-class assignment — PRODUCTION project.
--
-- THE BUG THIS FILE EXISTS FOR.
--
-- Everything a reader could reach went through one route:
--
--     daily_drops -> daily_drop_items -> content_items
--
-- and the Teams work built on top of it added Team *questions* only. A Team
-- badge could therefore be hung on an article the reader already had in their
-- own edition, and nothing else. Take the case the product is actually sold on:
--
--     PERSONAL   Tech & AI
--     TEAM A     Finance
--     TEAM B     Finance + Business
--
-- The Finance and Business articles are in nobody's daily drop, because this
-- reader subscribes to neither topic. They are published, they exist, both
-- Teams were configured for them — and the reader could not SELECT a single one
-- of them. Not a missing screen: RLS refused the rows. The whole Team newsletter
-- was empty by construction.
--
-- So a Team assigns CONTENT, and questions hang off that content. Two things
-- follow, and they are the design:
--
--   1. A Team assignment names a LOGICAL content (content_logical_key), never
--      one language's row. A French and an English member of the same Team must
--      receive the same editorial event and read it in their own language; an
--      assignment pinned to the French content_items row would give the English
--      member either nothing or somebody else's article.
--
--   2. Entitlement gets one server-side answer — "may this reader read this
--      item: personally, as a translation of something personal, or through a
--      Team?" — and every read policy asks that one question. The Team branch is
--      exactly as strict as the personal one: an assignment to a Team the reader
--      is not an eligible, active member of grants nothing.
--
-- What this migration is NOT: it never widens "assigned content only" into "all
-- published content". Every policy below still refuses an item that was not
-- assigned to this reader by some route, and the archive escape hatch
-- (public_archive_enabled) keeps the semantics it already had.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The assignment
-- ---------------------------------------------------------------------------
-- Deliberately NOT written into daily_drop_items. That table means "the
-- reader's own edition", it is keyed by a per-reader drop, and a Team
-- assignment belongs to a team and an edition rather than to a person. Merging
-- the two is the mobile client's job, on the logical key, and it is one the
-- client can only do correctly if the two stay distinguishable.

CREATE TABLE IF NOT EXISTS public.team_content_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  edition_date DATE NOT NULL,
  -- The logical identity, shared by the FR and EN renderings of one editorial
  -- job. Not a content_items id: see the header.
  content_logical_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  -- The newsletter topic (public.topics) this was selected for, or the mini-case
  -- product topic. Kept so an edition's selection can be explained afterwards
  -- without re-reading the config and re-running the selection.
  topic_id TEXT REFERENCES public.topics(id) ON DELETE RESTRICT,
  product_topic TEXT,
  -- The configuration this selection came from (§11). A later config change
  -- writes a new version; this column is what stops it rewriting the story of an
  -- edition that has already been played.
  config_version_id UUID REFERENCES public.team_config_versions(id) ON DELETE SET NULL,
  position SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per team per edition per logical content. Re-running the assignment
  -- engine is then a no-op rather than a second copy of the same article.
  CONSTRAINT team_content_assignments_unique
    UNIQUE (team_id, edition_date, content_logical_key, content_type),

  CONSTRAINT team_content_assignments_key_not_blank
    CHECK (length(btrim(content_logical_key)) > 0),

  -- Business Stories and the Learning Path are solo surfaces, always. The same
  -- rule team_question_assignments enforces on the question side, enforced here
  -- on the content side so the two cannot disagree: a business_story cannot be
  -- assigned to a team, and therefore neither can its questions.
  CONSTRAINT team_content_assignments_type_check
    CHECK (content_type IN ('newsletter_article', 'mini_case')),

  -- Each surface carries its own topic vocabulary and only its own. A
  -- newsletter row with a product_topic, or a mini case with a newsletter
  -- topic_id, would be a selection nobody could explain.
  CONSTRAINT team_content_assignments_topic_shape_check CHECK (
    (content_type = 'newsletter_article' AND topic_id IS NOT NULL AND product_topic IS NULL)
    OR (content_type = 'mini_case' AND topic_id IS NULL AND product_topic IS NOT NULL)
  ),

  CONSTRAINT team_content_assignments_product_topic_check CHECK (
    product_topic IS NULL OR product_topic IN (
      'finance_economy',
      'stock_market',
      'ai',
      'law_compliance',
      'health_pharma',
      'engineering_operations'
    )
  )
);

-- The entitlement predicate's access path: given a content item, is there an
-- assignment for its logical key?
CREATE INDEX IF NOT EXISTS idx_team_content_assignments_logical
  ON public.team_content_assignments (content_logical_key, content_type, team_id);

-- The read path: "my Team content for edition X".
CREATE INDEX IF NOT EXISTS idx_team_content_assignments_team_edition
  ON public.team_content_assignments (team_id, edition_date, position);

CREATE INDEX IF NOT EXISTS idx_team_content_assignments_edition
  ON public.team_content_assignments (edition_date);

COMMENT ON TABLE public.team_content_assignments IS
  'The content a Team is reading in an edition, named by content_logical_key so one assignment serves both language renderings. The root of every Team entitlement: questions hang off this, not the other way round.';
COMMENT ON COLUMN public.team_content_assignments.content_logical_key IS
  'Language-independent content identity (public.content_logical_key). A FR and an EN member of the same Team get the same editorial event and read it in their own language.';
COMMENT ON COLUMN public.team_content_assignments.config_version_id IS
  'The config version this selection was produced from. Never updated: an edition already played keeps the configuration it was played under.';

-- ---------------------------------------------------------------------------
-- 2. Team entitlement
-- ---------------------------------------------------------------------------
-- "May this reader read this item because a Team was assigned it?"
--
-- The four conditions, all of them load-bearing:
--
--   the item is published and carries a logical key
--   an assignment exists for that logical key and content type
--   the reader has an OPEN membership stint in that team  (leaving revokes)
--   the stint was eligible for the assignment's edition    (§4, mid-edition join)
--   the team is still active                               (archived revokes)
--
-- Eligibility is compared against the ASSIGNMENT's edition, not today's. A
-- member who joined during edition E1 has eligible_from_edition = E2 and is
-- refused E1's Team content outright — they cannot read it, so they cannot have
-- read the questions before answering them.

CREATE OR REPLACE FUNCTION public.user_has_team_content_entitlement(
  target_content_item_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_items ci
    JOIN public.team_content_assignments a
      ON a.content_logical_key = public.content_logical_key(ci.metadata)
     AND a.content_type = ci.content_type
    JOIN public.teams t
      ON t.id = a.team_id
     AND t.status = 'active'
    JOIN public.team_members m
      ON m.team_id = a.team_id
     AND m.user_id = auth.uid()
     AND m.left_at IS NULL
     AND m.eligible_from_edition <= a.edition_date
    WHERE ci.id = target_content_item_id
      AND ci.status = 'published'
      AND public.content_logical_key(ci.metadata) IS NOT NULL
  );
$$;

COMMENT ON FUNCTION public.user_has_team_content_entitlement(UUID) IS
  'True when a Team the caller is an active, edition-eligible member of was assigned this item''s logical content. Matches on the logical key, so the FR and EN renderings are both entitled by one assignment.';

-- The whole read entitlement, in one place (§4).
--
-- public.user_has_assigned_content is NOT redefined. It answers a narrower and
-- older question — "is this item in one of my own daily drops" — and other
-- policies, the archive view and the write paths all depend on that meaning
-- staying exactly what it is. This composes it instead.
CREATE OR REPLACE FUNCTION public.user_has_content_entitlement(
  target_content_item_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.user_has_assigned_content(target_content_item_id)
      OR public.user_has_assigned_content_translation(target_content_item_id)
      OR public.user_has_team_content_entitlement(target_content_item_id);
$$;

COMMENT ON FUNCTION public.user_has_content_entitlement(UUID) IS
  'The single read entitlement: a personal daily-drop assignment, the translation of one, or an eligible Team assignment. Nothing else — an item nobody assigned to this reader stays unreadable.';

-- Sources, by the same rule (§6). A Team-only article shows its sources like any
-- other article, and no source becomes readable that is not cited by content
-- this reader is entitled to.
CREATE OR REPLACE FUNCTION public.user_has_team_content_source(
  target_source_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_item_sources cis
    JOIN public.content_items ci
      ON ci.id = cis.content_item_id
     AND ci.status = 'published'
    JOIN public.team_content_assignments a
      ON a.content_logical_key = public.content_logical_key(ci.metadata)
     AND a.content_type = ci.content_type
    JOIN public.teams t
      ON t.id = a.team_id
     AND t.status = 'active'
    JOIN public.team_members m
      ON m.team_id = a.team_id
     AND m.user_id = auth.uid()
     AND m.left_at IS NULL
     AND m.eligible_from_edition <= a.edition_date
    WHERE cis.source_id = target_source_id
  );
$$;

COMMENT ON FUNCTION public.user_has_team_content_source(UUID) IS
  'True when the source is cited by content a Team assigned to the caller. Scoped to that content, never to the source catalogue.';

REVOKE ALL ON FUNCTION public.user_has_team_content_entitlement(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_team_content_entitlement(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.user_has_content_entitlement(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_content_entitlement(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.user_has_team_content_source(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_team_content_source(UUID) FROM anon;

GRANT EXECUTE ON FUNCTION public.user_has_team_content_entitlement(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_content_entitlement(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_team_content_source(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS on the assignment itself
-- ---------------------------------------------------------------------------

ALTER TABLE public.team_content_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read their team content assignments"
  ON public.team_content_assignments;

CREATE POLICY "Members can read their team content assignments"
ON public.team_content_assignments
FOR SELECT
USING (public.is_active_team_member(team_id));

-- No INSERT/UPDATE/DELETE policy and no write privilege: assignments are
-- materialized by the server, never by a client.
REVOKE ALL ON TABLE public.team_content_assignments FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.team_content_assignments TO authenticated;
GRANT ALL ON TABLE public.team_content_assignments TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The read policies, widened by exactly one branch each
-- ---------------------------------------------------------------------------
-- Each policy below is the policy that is in production today (20260429120000,
-- as amended by 20260904121000) plus a Team term. Nothing else about them
-- changes: same archive escape hatch, same published-only requirement, same
-- refusal of everything unassigned.
--
-- Only content_items gets the composed predicate. The source policies keep the
-- narrower personal one because 20260904121000 deliberately left them alone —
-- the FR and EN renderings of a job cite the same source records, so translation
-- access was never needed there and granting it now would widen a policy for no
-- reason anybody could point at.

-- The reading policy now asks the one composed question rather than listing its
-- branches, so a future route to content is added in one place instead of in
-- every policy that has to agree with this one.
DROP POLICY IF EXISTS "Users can read assigned published content" ON public.content_items;

CREATE POLICY "Users can read assigned published content"
ON public.content_items
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND status = 'published'
  AND (
    public.public_archive_enabled()
    OR public.user_has_content_entitlement(id)
  )
);

DROP POLICY IF EXISTS "Users can read source links for assigned content"
  ON public.content_item_sources;

CREATE POLICY "Users can read source links for assigned content"
ON public.content_item_sources
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND (
    public.user_has_assigned_content(content_item_id)
    OR public.user_has_team_content_entitlement(content_item_id)
    OR (
      public.public_archive_enabled()
      AND public.is_published_content(content_item_id)
    )
  )
);

DROP POLICY IF EXISTS "Users can read sources for assigned content" ON public.sources;

CREATE POLICY "Users can read sources for assigned content"
ON public.sources
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND (
    public.user_has_assigned_source(id)
    OR public.user_has_team_content_source(id)
    OR (
      public.public_archive_enabled()
      AND public.published_content_has_source(id)
    )
  )
);

-- ---------------------------------------------------------------------------
-- 5. Writing progress on Team-only content (§7)
-- ---------------------------------------------------------------------------
-- Marking a Team-only article read has to work, or the Newsletter tab shows a
-- Team article that can never be completed.
--
-- The Team term is added to the personal one rather than replacing it, and
-- translation entitlement is deliberately NOT added here: 20260904121000 chose
-- to keep interactions anchored to the assigned item id, and widening a write
-- path is not something to do as a side effect of a read fix. `user_id =
-- auth.uid()` is untouched — nobody writes another reader's interaction.

DROP POLICY IF EXISTS "Users can read own interactions for assigned content"
  ON public.content_interactions;

CREATE POLICY "Users can read own interactions for assigned content"
ON public.content_interactions
FOR SELECT
USING (
  user_id = auth.uid()
  AND (
    public.user_has_assigned_content(content_item_id)
    OR public.user_has_team_content_entitlement(content_item_id)
  )
);

DROP POLICY IF EXISTS "Users can insert own interactions for assigned content"
  ON public.content_interactions;

CREATE POLICY "Users can insert own interactions for assigned content"
ON public.content_interactions
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND (
    public.user_has_assigned_content(content_item_id)
    OR public.user_has_team_content_entitlement(content_item_id)
  )
);

-- Mini cases are a Team surface (§10), so the mini-case reader must work on a
-- Team-only case exactly as it does on a personal one. Same shape as above; the
-- published-and-is-a-mini-case check on INSERT is kept as it was.

DROP POLICY IF EXISTS "Users can read own mini-case responses for assigned content"
  ON public.mini_case_responses;

CREATE POLICY "Users can read own mini-case responses for assigned content"
ON public.mini_case_responses
FOR SELECT
USING (
  user_id = auth.uid()
  AND (
    public.user_has_assigned_content(content_item_id)
    OR public.user_has_team_content_entitlement(content_item_id)
  )
);

DROP POLICY IF EXISTS "Users can insert own mini-case responses for assigned content"
  ON public.mini_case_responses;

CREATE POLICY "Users can insert own mini-case responses for assigned content"
ON public.mini_case_responses
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND (
    public.user_has_assigned_content(content_item_id)
    OR public.user_has_team_content_entitlement(content_item_id)
  )
  AND public.is_published_content(content_item_id, 'mini_case')
);

DROP POLICY IF EXISTS "Users can update own mini-case responses for assigned content"
  ON public.mini_case_responses;

CREATE POLICY "Users can update own mini-case responses for assigned content"
ON public.mini_case_responses
FOR UPDATE
USING (
  user_id = auth.uid()
  AND (
    public.user_has_assigned_content(content_item_id)
    OR public.user_has_team_content_entitlement(content_item_id)
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND (
    public.user_has_assigned_content(content_item_id)
    OR public.user_has_team_content_entitlement(content_item_id)
  )
);

-- ---------------------------------------------------------------------------
-- 6. "My Team content for this edition", in one round trip (§13)
-- ---------------------------------------------------------------------------
-- The alternative is the client fetching assignments, then teams, then content
-- items per assignment, then resolving a language per item — an N+1 that also
-- puts the entitlement rules in the app. This keeps both in the database.
--
-- One row per LOGICAL content, never one per team. Two teams assigning the same
-- Finance article is the normal case, and the reader must see one article with
-- two badges; returning it twice would push that deduplication into every screen
-- that reads it.
--
-- SECURITY DEFINER for the same reason get_team_roster is: it joins profiles and
-- teams, and the membership predicate is written into the query itself rather
-- than relying on a policy to hold. The columns it returns are the public ones —
-- there is no invite code, no config, no grading, no answer key here.

CREATE OR REPLACE FUNCTION public.get_my_team_edition_content(
  p_edition_date DATE DEFAULT NULL,
  p_language TEXT DEFAULT NULL
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
    -- The language comes from the authenticated profile. An argument is
    -- accepted so the client can render an explicit switch without waiting for
    -- the profile write to land, and it is validated against the two languages
    -- that exist rather than trusted.
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
  target AS (
    SELECT COALESCE(p_edition_date, public.current_edition_date()) AS target_edition
  ),
  mine AS (
    SELECT
      a.content_logical_key AS logical_key,
      a.content_type AS logical_type,
      a.edition_date AS assigned_edition,
      min(a.topic_id) AS newsletter_topic,
      min(a.product_topic) AS case_topic,
      min(a.position)::SMALLINT AS list_position,
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          -- Moderation applied at read time, exactly as the roster does it.
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
    WHERE a.edition_date = (SELECT g.target_edition FROM target g)
    GROUP BY a.content_logical_key, a.content_type, a.edition_date
  ),
  rendered AS (
    -- The rendering to display: the reader's language when it exists, and
    -- whatever else was published when it does not. A Team assignment is
    -- logical, so a missing translation degrades to the other language rather
    -- than to nothing.
    SELECT DISTINCT ON (mine.logical_key, mine.logical_type)
      mine.logical_key,
      mine.logical_type,
      ci.id AS item_id,
      ci.language AS item_language,
      mine.newsletter_topic,
      mine.case_topic,
      ci.title AS item_title,
      ci.summary AS item_summary,
      mine.assigned_edition,
      mine.list_position,
      mine.team_refs
    FROM mine
    JOIN public.content_items ci
      ON public.content_logical_key(ci.metadata) = mine.logical_key
     AND ci.content_type = mine.logical_type
     AND ci.status = 'published'
    ORDER BY
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
  ORDER BY rendered.list_position, rendered.logical_key;
$$;

REVOKE ALL ON FUNCTION public.get_my_team_edition_content(DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_team_edition_content(DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_team_edition_content(DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_team_edition_content(DATE, TEXT) TO service_role;

COMMENT ON FUNCTION public.get_my_team_edition_content(DATE, TEXT) IS
  'The caller''s Team content for an edition: one row per logical content, carrying the rendering in their language and every Team that assigned it. Returns no invite code, no configuration and nothing from the private grading schema.';

COMMIT;

NOTIFY pgrst, 'reload schema';
