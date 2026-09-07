-- The assignment engine — PRODUCTION project.
--
-- The tables built by 20260906093000 and 20260906103000 describe what a reader
-- and a Team are playing. Nothing has ever written a row into any of them: the
-- publisher writes content and daily drops, the question publisher writes
-- questions, and the gap between "this edition has questions" and "this reader
-- has been asked them" was never closed. solo_question_assignments and
-- team_question_assignments were empty in every environment, which means every
-- question in the product was unreachable — user_has_question_assignment()
-- returns false when nothing was assigned, and it is the gate in front of every
-- question read.
--
-- This closes that gap, and only that. It generates no content, publishes
-- nothing, notifies nobody and changes no existing function.
--
-- THREE PROPERTIES, and each one is a rule about a real failure:
--
--   IDEMPOTENT   Running it three times over one edition produces exactly the
--                state one run produces. Every write is ON CONFLICT DO NOTHING
--                against a real unique constraint, so a re-run cannot double an
--                assignment, move a position, change a config snapshot or
--                disturb an answer somebody has already given.
--
--   DETERMINISTIC  Selection never consults random(), a clock, a UUID's byte
--                order or an insertion timestamp. It reads the ordinal the
--                publisher already records (metadata.staging_ordinal), which is
--                the same key the personal daily-drop selection sorts on. Two
--                Teams configured identically get the same articles; the same
--                Team re-materialized tomorrow gets the same articles.
--
--   SNAPSHOTTED  Every row carries the config version it came from. A Team that
--                changes its topics tonight changes the NEXT edition and leaves
--                every earlier one exactly as it was played.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The ordinal
-- ---------------------------------------------------------------------------
-- The publisher stamps `staging_ordinal` on every item it writes — the job's
-- index in the batch — and the personal newsletter selection already orders on
-- it. That is the edition's real, non-secret ordering, it is stable across
-- re-runs, and it is identical for the FR and the EN rendering of one job, so
-- it orders logical content and not one language's rows.
--
-- Read through a function rather than inline so there is one definition of
-- "which article comes first" instead of one per query, and so a malformed
-- value degrades to last instead of raising 22P02 mid-edition.

CREATE OR REPLACE FUNCTION public.content_edition_ordinal(p_metadata JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_metadata->>'staging_ordinal' ~ '^[0-9]{1,6}$'
      THEN (p_metadata->>'staging_ordinal')::INTEGER
    ELSE 999999
  END;
$$;

COMMENT ON FUNCTION public.content_edition_ordinal(JSONB) IS
  'The publisher-recorded position of an item within its edition batch. Shared by both language renderings of one job, so it orders logical content. Falls back to last for items published before the ordinal existed.';

REVOKE ALL ON FUNCTION public.content_edition_ordinal(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.content_edition_ordinal(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.content_edition_ordinal(JSONB) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Personal assignments (§8)
-- ---------------------------------------------------------------------------
-- The reader is asked about the content they actually received — their own
-- daily drop, whatever their preferences produced. This deliberately does not
-- read topics or preferences again: the drop is the record of what they got, and
-- deriving the question set from anything else would eventually disagree with it.
--
-- Business Stories are included here and only here. They are a solo surface, and
-- the Team side cannot express them at all.
--
-- The join is on the logical key, so a reader who switches language keeps the
-- same assignments: one editorial job, one question set, one attempt.

CREATE OR REPLACE FUNCTION public.materialize_solo_question_assignments(
  p_edition_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_written INTEGER;
BEGIN
  INSERT INTO public.solo_question_assignments (
    user_id, edition_date, logical_question_id, position
  )
  SELECT
    dd.user_id,
    p_edition_date,
    q.id,
    -- Reading order, not an arbitrary one: the slot the item sits in, then its
    -- position inside that slot, then the question's own sequence. The mini-case
    -- progression (method -> application -> conclusion) survives because
    -- question_sequence is pinned to the role by logical_questions' own check.
    (
      CASE ddi.slot
        WHEN 'newsletter' THEN 0
        WHEN 'business_story' THEN 100
        WHEN 'mini_case' THEN 200
        ELSE 300
      END
      + COALESCE(ddi.position, 0) * 10
      + q.question_sequence
    )::SMALLINT
  FROM public.daily_drops dd
  JOIN public.daily_drop_items ddi
    ON ddi.daily_drop_id = dd.id
  JOIN public.content_items ci
    ON ci.id = ddi.content_item_id
   AND ci.status = 'published'
  JOIN public.logical_questions q
    ON q.content_logical_key = public.content_logical_key(ci.metadata)
   AND q.content_type = ci.content_type
  WHERE dd.drop_date = p_edition_date
    AND dd.status IN ('published', 'read', 'archived')
    AND public.content_logical_key(ci.metadata) IS NOT NULL
  -- BY CONSTRAINT NAME. An ON CONFLICT column list is an expression context and
  -- has bitten this repository before (20260906080000); a constraint name is
  -- not an expression and cannot be re-planned into an ambiguity.
  ON CONFLICT ON CONSTRAINT solo_question_assignments_unique DO NOTHING;

  GET DIAGNOSTICS v_written = ROW_COUNT;

  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_solo_question_assignments(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_solo_question_assignments(DATE) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_solo_question_assignments(DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_solo_question_assignments(DATE) TO service_role;

COMMENT ON FUNCTION public.materialize_solo_question_assignments(DATE) IS
  'Server-only. Assigns every question of every item in a reader''s own edition to that reader, once. Idempotent; re-running assigns nothing new and moves nothing.';

-- ---------------------------------------------------------------------------
-- 3. Team content (§9, §10)
-- ---------------------------------------------------------------------------
-- The selection, per Team, from the configuration that governs THIS edition.
--
-- Newsletter: one or two articles per configured topic. Two is the maximum the
-- calendar can satisfy — an edition publishes exactly two articles per topic —
-- and the schema now says so, so a Team can no longer ask for a third and
-- silently receive two.
--
-- Mini case: one published case per configured product topic, matched on
-- metadata.product_topic, which is the same key the personal mini-case selection
-- matches on.
--
-- Business Story: never. Not by omission — team_content_assignments refuses the
-- content type outright, so a future edit here cannot introduce one.
--
-- Candidate sets are built on the LOGICAL key with DISTINCT, so the FR and EN
-- renderings of one job count as one candidate. Selecting content_items rows
-- directly would make "two Finance articles" mean "the same article twice, in
-- two languages" for any Team whose members read in different languages.

CREATE OR REPLACE FUNCTION public.materialize_team_content_assignments(
  p_team_id UUID,
  p_edition_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_config UUID := public.team_effective_config_version(p_team_id, p_edition_date);
  v_written INTEGER := 0;
  v_position SMALLINT := 0;
  v_topic RECORD;
  v_candidate RECORD;
  v_key TEXT;
BEGIN
  -- A Team whose first configuration takes effect later has no content this
  -- edition. That is the correct answer, not an error: the founder becomes
  -- eligible at the next edition, and so does their configuration.
  IF v_config IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_topic IN
    SELECT n.topic_id, n.articles_count
    FROM public.team_config_newsletter_topics n
    WHERE n.config_version_id = v_config
    ORDER BY n.position NULLS LAST, n.topic_id
  LOOP
    FOR v_candidate IN
      SELECT c.logical_key
      FROM (
        SELECT DISTINCT
          public.content_logical_key(ci.metadata) AS logical_key,
          public.content_edition_ordinal(ci.metadata) AS ordinal
        FROM public.content_items ci
        WHERE ci.status = 'published'
          -- publication_date is the edition boundary the publisher itself
          -- writes on every item of the batch, and it is what makes this
          -- independent of anybody's daily drop. That independence IS the fix:
          -- a Finance article nobody subscribes to personally is still this
          -- edition's Finance article.
          AND ci.publication_date = p_edition_date
          AND ci.content_type = 'newsletter_article'
          AND ci.topic_id = v_topic.topic_id
          AND public.content_logical_key(ci.metadata) IS NOT NULL
      ) c
      -- The ordinal decides. The logical key is only a tie-break, so that two
      -- items sharing an ordinal still resolve to one stable order rather than
      -- to whatever the planner returned first.
      ORDER BY c.ordinal, c.logical_key
      LIMIT least(2, greatest(1, v_topic.articles_count))
    LOOP
      v_position := v_position + 1;

      INSERT INTO public.team_content_assignments (
        team_id, edition_date, content_logical_key, content_type,
        topic_id, config_version_id, position
      )
      VALUES (
        p_team_id, p_edition_date, v_candidate.logical_key, 'newsletter_article',
        v_topic.topic_id, v_config, v_position
      )
      ON CONFLICT ON CONSTRAINT team_content_assignments_unique DO NOTHING;

      IF FOUND THEN
        v_written := v_written + 1;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_topic IN
    SELECT c.topic_id
    FROM public.team_config_mini_case_topics c
    WHERE c.config_version_id = v_config
    ORDER BY c.position NULLS LAST, c.topic_id
  LOOP
    v_key := NULL;

    SELECT c.logical_key INTO v_key
    FROM (
      SELECT DISTINCT
        public.content_logical_key(ci.metadata) AS logical_key,
        public.content_edition_ordinal(ci.metadata) AS ordinal
      FROM public.content_items ci
      WHERE ci.status = 'published'
        AND ci.publication_date = p_edition_date
        AND ci.content_type = 'mini_case'
        AND ci.metadata->>'product_topic' = v_topic.topic_id
        AND public.content_logical_key(ci.metadata) IS NOT NULL
    ) c
    ORDER BY c.ordinal, c.logical_key
    LIMIT 1;

    IF v_key IS NULL THEN
      CONTINUE;
    END IF;

    v_position := v_position + 1;

    INSERT INTO public.team_content_assignments (
      team_id, edition_date, content_logical_key, content_type,
      product_topic, config_version_id, position
    )
    VALUES (
      p_team_id, p_edition_date, v_key, 'mini_case',
      v_topic.topic_id, v_config, v_position
    )
    ON CONFLICT ON CONSTRAINT team_content_assignments_unique DO NOTHING;

    IF FOUND THEN
      v_written := v_written + 1;
    END IF;
  END LOOP;

  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_team_content_assignments(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_team_content_assignments(UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_team_content_assignments(UUID, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_team_content_assignments(UUID, DATE) TO service_role;

COMMENT ON FUNCTION public.materialize_team_content_assignments(UUID, DATE) IS
  'Server-only. Selects one Team''s content for one edition from the config version effective for it: 1-2 newsletter articles per configured topic and one mini case per configured product topic, ordered by the publisher''s ordinal. Idempotent and never random.';

-- ---------------------------------------------------------------------------
-- 4. Team questions (§14)
-- ---------------------------------------------------------------------------
-- Questions follow content. A newsletter article carries two, a mini case three,
-- and a content item whose questions were never persisted contributes none —
-- the join simply finds nothing, which is what keeps an edition of question-less
-- legacy content assignable and readable.

CREATE OR REPLACE FUNCTION public.materialize_team_question_assignments(
  p_team_id UUID,
  p_edition_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_written INTEGER;
BEGIN
  INSERT INTO public.team_question_assignments (
    team_id, edition_date, logical_question_id, content_type, config_version_id, position
  )
  SELECT
    a.team_id,
    a.edition_date,
    q.id,
    a.content_type,
    a.config_version_id,
    (a.position * 10 + q.question_sequence)::SMALLINT
  FROM public.team_content_assignments a
  JOIN public.logical_questions q
    ON q.content_logical_key = a.content_logical_key
   AND q.content_type = a.content_type
  WHERE a.team_id = p_team_id
    AND a.edition_date = p_edition_date
  ON CONFLICT ON CONSTRAINT team_question_assignments_unique DO NOTHING;

  GET DIAGNOSTICS v_written = ROW_COUNT;

  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_team_question_assignments(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_team_question_assignments(UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_team_question_assignments(UUID, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_team_question_assignments(UUID, DATE) TO service_role;

COMMENT ON FUNCTION public.materialize_team_question_assignments(UUID, DATE) IS
  'Server-only. Assigns every logical question of a Team''s assigned content for an edition. Business Stories cannot appear: team_content_assignments refuses the content type, so the join has nothing to offer.';

-- ---------------------------------------------------------------------------
-- 5. The roster, before anybody plays (§15)
-- ---------------------------------------------------------------------------
-- "Not started / In progress / Completed" needs a row per eligible member from
-- the moment the edition opens, not from their first answer. Without it a Team
-- of five where two have played shows a leaderboard of two, and the three who
-- have not started are indistinguishable from three people who are not in the
-- team.
--
-- This calls the existing refresh rather than inserting zeros directly, on
-- purpose: refresh recomputes score and answered_count FROM THE LEDGER, so
-- calling it on a member who has already played rebuilds their real figures
-- instead of resetting them. Pre-population and re-materialization are then the
-- same operation, and running the engine again mid-edition cannot cost anybody a
-- point.
--
-- assigned_count is per TEAM. If Team A and Team B were assigned the same
-- question, each counts it once for its own denominator, while the reader still
-- has exactly one attempt at it — the fan-out at submit time writes one ledger
-- row per team from that single attempt.

CREATE OR REPLACE FUNCTION public.initialize_team_edition_roster(
  p_team_id UUID,
  p_edition_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member RECORD;
  v_rows INTEGER := 0;
BEGIN
  -- Exactly the population teams_scoring_question will score: an open stint in
  -- an active team, eligible for this edition. A mid-edition joiner is absent
  -- from this edition's roster and appears in the next one.
  FOR v_member IN
    SELECT m.user_id AS member_id
    FROM public.team_members m
    JOIN public.teams t
      ON t.id = m.team_id
     AND t.status = 'active'
    WHERE m.team_id = p_team_id
      AND m.left_at IS NULL
      AND m.eligible_from_edition <= p_edition_date
    ORDER BY m.joined_at, m.user_id
  LOOP
    PERFORM public.refresh_team_member_edition_score(
      p_team_id, v_member.member_id, p_edition_date
    );

    v_rows := v_rows + 1;
  END LOOP;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_team_edition_roster(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_team_edition_roster(UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.initialize_team_edition_roster(UUID, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_team_edition_roster(UUID, DATE) TO service_role;

COMMENT ON FUNCTION public.initialize_team_edition_roster(UUID, DATE) IS
  'Server-only. Gives every edition-eligible member a leaderboard row before their first answer, with the team''s own assigned_count. Rebuilds from the ledger, so a member who has already played keeps their score.';

-- ---------------------------------------------------------------------------
-- 6. One edition, one call
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.materialize_team_edition_assignments(
  p_edition_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team RECORD;
  v_teams INTEGER := 0;
  v_content INTEGER := 0;
  v_questions INTEGER := 0;
  v_roster INTEGER := 0;
BEGIN
  FOR v_team IN
    SELECT t.id AS team_id
    FROM public.teams t
    WHERE t.status = 'active'
    ORDER BY t.created_at, t.id
  LOOP
    v_teams := v_teams + 1;

    v_content := v_content
      + public.materialize_team_content_assignments(v_team.team_id, p_edition_date);
    v_questions := v_questions
      + public.materialize_team_question_assignments(v_team.team_id, p_edition_date);

    -- No questions this edition means no denominator and nothing to show; a row
    -- of zeros would only put a member on a leaderboard for an edition their
    -- Team is not playing.
    IF EXISTS (
      SELECT 1
      FROM public.team_question_assignments a
      WHERE a.team_id = v_team.team_id
        AND a.edition_date = p_edition_date
    ) THEN
      v_roster := v_roster
        + public.initialize_team_edition_roster(v_team.team_id, p_edition_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'edition_date', p_edition_date,
    'teams_processed', v_teams,
    'content_assignments_written', v_content,
    'question_assignments_written', v_questions,
    'roster_rows', v_roster
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_team_edition_assignments(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_team_edition_assignments(DATE) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_team_edition_assignments(DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_team_edition_assignments(DATE) TO service_role;

COMMENT ON FUNCTION public.materialize_team_edition_assignments(DATE) IS
  'Server-only. Materializes content, questions and leaderboard rows for every active Team for one edition. Idempotent.';

-- The entry point the publication pipeline calls once an edition is live.
--
-- Nothing schedules it in this migration. Wiring it into the edition run is a
-- deployment decision, and this pass ships the mechanism rather than switching
-- it on: a function that exists and has never run changes nothing, whereas a
-- cron entry added in the same breath as the tables would run against an
-- edition whose questions may not be persisted yet.

CREATE OR REPLACE FUNCTION public.materialize_edition_assignments(
  p_edition_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_edition DATE := COALESCE(p_edition_date, public.current_edition_date());
  v_solo INTEGER;
  v_team JSONB;
BEGIN
  IF v_edition IS NULL THEN
    RAISE EXCEPTION 'assignment materialization refused: no edition has published yet'
      USING ERRCODE = 'P0002';
  END IF;

  -- Two runs of the same edition must not interleave. Every write below is
  -- already ON CONFLICT DO NOTHING, so the lock is not what makes this safe —
  -- it is what keeps the returned counts honest, and stops two concurrent runs
  -- from each reporting half the work.
  PERFORM pg_advisory_xact_lock(
    hashtext('materialize_edition_assignments'),
    hashtext(v_edition::TEXT)
  );

  v_solo := public.materialize_solo_question_assignments(v_edition);
  v_team := public.materialize_team_edition_assignments(v_edition);

  RETURN jsonb_build_object(
    'edition_date', v_edition,
    'solo_question_assignments_written', v_solo,
    'team', v_team
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_edition_assignments(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_edition_assignments(DATE) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_edition_assignments(DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_edition_assignments(DATE) TO service_role;

COMMENT ON FUNCTION public.materialize_edition_assignments(DATE) IS
  'Server-only entry point. Materializes personal and Team assignments for an edition (default: the open one) under an advisory lock. Safe to re-run: idempotent, and it never alters an answer already given.';

COMMIT;

NOTIFY pgrst, 'reload schema';
