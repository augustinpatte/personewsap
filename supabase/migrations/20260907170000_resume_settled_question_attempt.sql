-- Reopening a question you have already answered — PRODUCTION project.
--
-- THE BUG THIS FILE EXISTS FOR.
--
-- `start_question_attempt` is the only way a client learns anything about a
-- question, and for an attempt that was already submitted it answered:
--
--     already_submitted = true, prompt = NULL, options = '[]'
--
-- with no score, no band and no record of what was chosen. The comment above it
-- said "this is a report rather than an error — the client shows the result",
-- but there was no result in the payload to show. So every path that reopens a
-- settled question rendered an empty prompt, zero option rows and a fabricated
-- "0 points":
--
--   * the app was killed after answering and reopened;
--   * the reading is opened again from the archive;
--   * a second device opens a question the first one answered;
--   * the reader switched language after answering.
--
-- A reader who scored 1000 was shown a blank card worth nothing. The data to
-- render the debrief correctly existed the whole time — it simply was not sent.
--
-- WHAT IS AND IS NOT RELEASED, AND WHY THAT IS UNCHANGED.
--
-- The five new columns are populated ONLY when `already_submitted` is true —
-- that is, only when `question_attempts.status = 'submitted'`, which is exactly
-- the gate `get_question_feedback` already opens on. Before submitting they are
-- NULL and FALSE, so nothing about an unanswered question moved one inch:
--
--   * `options` still carries `{option_id, label}` and never a score or a band;
--   * `private.logical_question_grades` is still not read by this function —
--     `grade_band` is derived from the attempt's own stored `score_milli`
--     through the bijection the grades table's own CHECK constraint enforces
--     (0=bad, 300=average, 600=good, 1000=excellent), so this adds no path out
--     of the private schema;
--   * the rationale is still unreachable from here.
--
-- THE LANGUAGE RULE IS DELIBERATELY DIFFERENT ON THE TWO BRANCHES.
--
-- An unanswered question with no rendering in the reader's language is refused:
-- putting an English question in front of a French reader mid-competition is
-- worse than showing them nothing. A SETTLED one is not refused — the reader
-- has already played it, there is nothing left to be unfair about, and locking
-- them out of their own debrief because a translation is missing would be the
-- language switch eating a result they already earned. So the settled branch
-- falls back to whatever rendering exists.
--
-- BACKWARD COMPATIBLE. The output columns are additive and in the same order,
-- so a client built before this migration (which reads named fields off one
-- row) is unaffected.

BEGIN;

-- RETURNS TABLE gains columns, and that is not something CREATE OR REPLACE can
-- do. Nothing else in the schema depends on this function — it is called by the
-- mobile client and by the test suites, never from SQL — so the drop is safe.
DROP FUNCTION IF EXISTS public.start_question_attempt(UUID);

CREATE OR REPLACE FUNCTION public.start_question_attempt(p_logical_question_id UUID)
RETURNS TABLE (
  attempt_id UUID,
  server_now TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  time_limit_seconds SMALLINT,
  already_submitted BOOLEAN,
  language TEXT,
  prompt TEXT,
  question_role TEXT,
  question_sequence SMALLINT,
  options JSONB,
  -- Populated only for an attempt that is already submitted. NULL/FALSE while
  -- the question is still open, which is what keeps the answer key private.
  selected_option_id UUID,
  score_milli INTEGER,
  grade_band TEXT,
  expired BOOLEAN,
  skipped BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_now TIMESTAMPTZ := now();
  v_question public.logical_questions;
  v_attempt public.question_attempts;
  v_language TEXT;
  v_prompt TEXT;
  v_order UUID[];
  v_settled BOOLEAN := FALSE;
  v_expired BOOLEAN := FALSE;
  v_skipped BOOLEAN := FALSE;
  v_score INTEGER := NULL;
  v_band TEXT := NULL;
  v_selected UUID := NULL;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to start a question'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_question
  FROM public.logical_questions q
  WHERE q.id = p_logical_question_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Entitlement first, and only then anything about the question. A reader with
  -- no assignment gets the same answer whether the question exists or not.
  IF NOT public.user_has_question_assignment(p_logical_question_id) THEN
    RAISE EXCEPTION 'Question not available'
      USING ERRCODE = '42501';
  END IF;

  -- The reader's own language, from the canonical column. Not a parameter: the
  -- language a question is rendered in is not the client's to assert.
  SELECT p.language INTO v_language FROM public.profiles p WHERE p.id = v_user_id;
  v_language := COALESCE(v_language, 'en');

  SELECT * INTO v_attempt
  FROM public.question_attempts a
  WHERE a.user_id = v_user_id
    AND a.logical_question_id = p_logical_question_id;

  IF FOUND THEN
    -- Resuming. The original started_at, deadline and option order are returned
    -- unchanged: reopening the app must not hand back a fresh 20 seconds, and
    -- must not move the options.
    v_order := v_attempt.option_order;

    IF v_attempt.status = 'submitted' THEN
      v_settled := TRUE;
      v_selected := v_attempt.selected_option_id;
      v_score := COALESCE(v_attempt.score_milli, 0);

      -- The server's own clock decided this at submit time, and the attempt row
      -- still carries both halves of the comparison. Recomputing it here is
      -- reading a fact, not re-judging one.
      v_expired := v_attempt.submitted_at IS NOT NULL
        AND v_attempt.submitted_at > v_attempt.deadline_at;

      -- A skip is an explicit submit with no option. An expiry also stores no
      -- option, so the two are told apart by the deadline and never by the
      -- absent option alone.
      v_skipped := v_selected IS NULL AND NOT v_expired;

      -- The bijection `private.logical_question_grades` enforces with its own
      -- CHECK. Derived rather than joined, so this function still reads nothing
      -- from the private schema.
      v_band := CASE v_score
        WHEN 1000 THEN 'excellent'
        WHEN 600  THEN 'good'
        WHEN 300  THEN 'average'
        ELSE 'bad'
      END;
    END IF;
  ELSE
    SELECT array_agg(o.id ORDER BY random())
    INTO v_order
    FROM public.logical_question_options o
    WHERE o.logical_question_id = p_logical_question_id;

    IF v_order IS NULL OR array_length(v_order, 1) IS NULL THEN
      RAISE EXCEPTION 'Question has no options'
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.question_attempts (
      user_id, logical_question_id, edition_date,
      started_at, deadline_at, option_order
    )
    VALUES (
      v_user_id,
      p_logical_question_id,
      public.current_edition_date(v_now),
      v_now,
      v_now + make_interval(secs => v_question.time_limit_seconds),
      v_order
    )
    -- Two devices starting at the same instant: the first wins, the second
    -- resumes it. Racing must not create a second attempt or a second deadline.
    ON CONFLICT (user_id, logical_question_id) DO NOTHING
    RETURNING * INTO v_attempt;

    IF v_attempt.id IS NULL THEN
      SELECT * INTO v_attempt
      FROM public.question_attempts a
      WHERE a.user_id = v_user_id
        AND a.logical_question_id = p_logical_question_id;

      v_order := v_attempt.option_order;
    END IF;
  END IF;

  SELECT l.prompt INTO v_prompt
  FROM public.logical_question_locales l
  WHERE l.logical_question_id = p_logical_question_id
    AND l.language = v_language;

  IF v_prompt IS NULL AND v_settled THEN
    -- See the header: a settled question is never withheld over a missing
    -- translation. The reader has already played it; the debrief is theirs.
    SELECT l.prompt INTO v_prompt
    FROM public.logical_question_locales l
    WHERE l.logical_question_id = p_logical_question_id
    ORDER BY l.language
    LIMIT 1;
  END IF;

  IF v_prompt IS NULL THEN
    -- A question with no rendering in the reader's language is an editorial
    -- gap, not something to paper over with the other language: that would put
    -- an English question in front of a French reader mid-competition.
    RAISE EXCEPTION 'Question is not available in the reader''s language'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    v_attempt.id,
    v_now,
    v_attempt.started_at,
    v_attempt.deadline_at,
    v_question.time_limit_seconds,
    v_settled,
    v_language,
    v_prompt,
    v_question.question_role,
    v_question.question_sequence,
    -- The SAME order on every call, settled or not. The debrief has to show the
    -- options where the reader actually saw them, or "the one I picked was
    -- second" stops being true the moment they reopen it.
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('option_id', ordered.id, 'label', ordered.label)
          ORDER BY ordered.ordinal
        )
        FROM (
          SELECT o.id, ol.label, ordering.ordinal
          FROM unnest(v_order) WITH ORDINALITY AS ordering(option_id, ordinal)
          JOIN public.logical_question_options o ON o.id = ordering.option_id
          JOIN public.logical_question_option_locales ol
            ON ol.option_id = o.id AND ol.language = v_language
        ) AS ordered
      ),
      -- A settled attempt whose labels have no rendering in this language still
      -- has to come back with SOMETHING, for the same reason the prompt does.
      CASE WHEN v_settled THEN (
        SELECT jsonb_agg(
          jsonb_build_object('option_id', fallback.id, 'label', fallback.label)
          ORDER BY fallback.ordinal
        )
        FROM (
          SELECT DISTINCT ON (ordering.ordinal)
            o.id, ol.label, ordering.ordinal
          FROM unnest(v_order) WITH ORDINALITY AS ordering(option_id, ordinal)
          JOIN public.logical_question_options o ON o.id = ordering.option_id
          JOIN public.logical_question_option_locales ol ON ol.option_id = o.id
          ORDER BY ordering.ordinal, ol.language
        ) AS fallback
      ) END,
      '[]'::JSONB
    ),
    v_selected,
    v_score,
    v_band,
    v_expired,
    v_skipped;
END;
$$;

REVOKE ALL ON FUNCTION public.start_question_attempt(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_question_attempt(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_question_attempt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_question_attempt(UUID) TO service_role;

COMMENT ON FUNCTION public.start_question_attempt(UUID) IS
  'Opens — or resumes — the caller''s single attempt at a question. Returns the server clock, the deadline it computed, and the options in their fixed order. For an attempt the caller has ALREADY submitted it also returns what they chose and what it scored, so a reopened reading shows the debrief it showed on the day; while a question is still open those columns are NULL and no grading is released.';

COMMIT;

NOTIFY pgrst, 'reload schema';
