-- The post-answer explanation: your answer, and the best answer — PRODUCTION.
--
-- WHY
--
-- PersoNews scores a question 0, 0.3, 0.6 or 1, and a reader who earns 0.3 is
-- told almost nothing about why: the app shows the feedback of the option they
-- chose and stops there. They never see which answer was worth the full point,
-- nor why, and partial credit — the unusual part of the product — does not
-- teach anything.
--
-- WHAT THIS FILE CHANGES
--
--   * public.get_question_explanation(question) — new. After the caller's own
--     attempt is settled, and only then, it returns ONE row:
--       - outcome            answered | expired | skipped
--       - the selected option: id, label, the score actually awarded, feedback
--       - the best option:     id, label, its score (1000), feedback
--     Nothing about the two other options, no grade table, no rationale.
--
--   * public.get_question_feedback(question) — tightened, same signature and
--     same columns. Until now it released the WHOLE grid after submitting:
--     every option with its score, band and explanation. The app only ever read
--     the selected row. It now returns the selected option and the best option
--     only, so a build already in the store keeps working and the grid is no
--     longer readable by anyone.
--
-- WHAT DOES NOT CHANGE
--
--   * Before settlement nothing is released. Both functions refuse (42501)
--     until the caller's own attempt is `submitted` — an answer, a skip, or a
--     timeout settled by submit_question_answer. An in-progress attempt, or no
--     attempt at all, is refused the same way, so the refusal says nothing.
--   * The caller can only ever read their own attempt: there is no argument
--     naming an attempt or a user. The attempt itself is the authorization —
--     start_question_attempt opens one only for a question assigned to the
--     caller — so a reader who later leaves a Team can still read why the
--     question they played scored what it scored.
--   * private.logical_question_grades.rationale_md is never read.
--
-- Additive: one new function; one existing function re-bodied with its exact
-- signature, so its grants survive.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The explanation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_question_explanation(p_logical_question_id UUID)
RETURNS TABLE (
  outcome TEXT,
  explanation_language TEXT,
  selected_option_id UUID,
  selected_label TEXT,
  selected_score_milli INTEGER,
  selected_feedback_md TEXT,
  best_option_id UUID,
  best_label TEXT,
  best_score_milli INTEGER,
  best_feedback_md TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $explanation$
#variable_conflict use_column
-- `selected_option_id` is an output column and a question_attempts column.
-- Every table reference below is alias-qualified and every local is v_-/p_-
-- prefixed, so nothing can mean two things.
DECLARE
  v_user_id UUID := auth.uid();
  v_attempt public.question_attempts;
  v_language TEXT;
  v_best UUID;
  v_outcome TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_attempt
  FROM public.question_attempts AS attempt
  WHERE attempt.user_id = v_user_id
    AND attempt.logical_question_id = p_logical_question_id
    AND attempt.status = 'submitted';

  IF NOT FOUND THEN
    -- Before settlement this would be the answer key. Same refusal, whether
    -- the attempt is open, absent, or the question does not exist.
    RAISE EXCEPTION 'No submitted answer for this question'
      USING ERRCODE = '42501';
  END IF;

  -- submit_question_answer keeps the chosen option only for an answer given in
  -- time; a late one is stored without it. So an option means "answered", and
  -- no option means a skip (in time) or a timeout (after the deadline).
  v_outcome := CASE
    WHEN v_attempt.selected_option_id IS NOT NULL THEN 'answered'
    WHEN v_attempt.submitted_at > v_attempt.deadline_at THEN 'expired'
    ELSE 'skipped'
  END;

  SELECT profile.language INTO v_language
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;

  v_language := CASE WHEN v_language IN ('fr', 'en') THEN v_language ELSE 'en' END;

  -- The one option worth the full point. The editorial contract has exactly
  -- one per question; ordering makes the choice deterministic even for a legacy
  -- question that broke it.
  SELECT choice.id INTO v_best
  FROM public.logical_question_options AS choice
  JOIN private.logical_question_grades AS grade ON grade.option_id = choice.id
  WHERE choice.logical_question_id = p_logical_question_id
  ORDER BY grade.score_milli DESC, choice.option_key
  LIMIT 1;

  -- Labels and explanations in the reader's language, or in the other one when
  -- a reader switched language after answering: the explanation of a result
  -- already earned is better in the wrong language than missing.
  RETURN QUERY
  SELECT
    v_outcome,
    v_language,
    v_attempt.selected_option_id,
    (SELECT locale.label
     FROM public.logical_question_option_locales AS locale
     WHERE locale.option_id = v_attempt.selected_option_id
     ORDER BY (locale.language = v_language) DESC, locale.language
     LIMIT 1),
    v_attempt.score_milli,
    (SELECT feedback.feedback_md
     FROM private.logical_question_option_feedback AS feedback
     WHERE feedback.option_id = v_attempt.selected_option_id
     ORDER BY (feedback.language = v_language) DESC, feedback.language
     LIMIT 1),
    v_best,
    (SELECT locale.label
     FROM public.logical_question_option_locales AS locale
     WHERE locale.option_id = v_best
     ORDER BY (locale.language = v_language) DESC, locale.language
     LIMIT 1),
    (SELECT grade.score_milli
     FROM private.logical_question_grades AS grade
     WHERE grade.option_id = v_best),
    (SELECT feedback.feedback_md
     FROM private.logical_question_option_feedback AS feedback
     WHERE feedback.option_id = v_best
     ORDER BY (feedback.language = v_language) DESC, feedback.language
     LIMIT 1);
END;
$explanation$;

REVOKE ALL ON FUNCTION public.get_question_explanation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_question_explanation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_question_explanation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_question_explanation(UUID) TO service_role;

COMMENT ON FUNCTION public.get_question_explanation(UUID) IS
  'After the caller''s own attempt is settled, and only then: what they chose (label, awarded score, feedback) and the best option (label, score, feedback). Never the other options, the grade table or the rationale. Refuses with 42501 before settlement.';

-- ---------------------------------------------------------------------------
-- 2. The older door, narrowed to the same two options
-- ---------------------------------------------------------------------------
-- Same name, arguments and RETURNS TABLE as 20260906094000, so CREATE OR
-- REPLACE is legal and the grants stay. Only the rows change: the selected
-- option and the best option, never the other two.

CREATE OR REPLACE FUNCTION public.get_question_feedback(p_logical_question_id UUID)
RETURNS TABLE (
  option_id UUID,
  is_selected BOOLEAN,
  score_milli INTEGER,
  grade_band TEXT,
  feedback_md TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_attempt public.question_attempts;
  v_language TEXT;
  v_best UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_attempt
  FROM public.question_attempts a
  WHERE a.user_id = v_user_id
    AND a.logical_question_id = p_logical_question_id
    AND a.status = 'submitted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No submitted answer for this question'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.language INTO v_language FROM public.profiles p WHERE p.id = v_user_id;
  v_language := COALESCE(v_language, 'en');

  SELECT o.id INTO v_best
  FROM public.logical_question_options o
  JOIN private.logical_question_grades g ON g.option_id = o.id
  WHERE o.logical_question_id = p_logical_question_id
  ORDER BY g.score_milli DESC, o.option_key
  LIMIT 1;

  RETURN QUERY
  SELECT
    o.id,
    o.id = v_attempt.selected_option_id,
    g.score_milli,
    g.grade_band,
    f.feedback_md
  FROM public.logical_question_options o
  JOIN private.logical_question_grades g ON g.option_id = o.id
  LEFT JOIN private.logical_question_option_feedback f
    ON f.option_id = o.id AND f.language = v_language
  WHERE o.logical_question_id = p_logical_question_id
    AND (o.id = v_attempt.selected_option_id OR o.id = v_best)
  ORDER BY g.score_milli DESC, o.option_key;
END;
$$;

COMMENT ON FUNCTION public.get_question_feedback(UUID) IS
  'Kept for builds already in the store. Since 20260913090000 it releases only the selected option and the best option — never the full grid — and only to a caller who has submitted. New clients use get_question_explanation.';

COMMIT;

NOTIFY pgrst, 'reload schema';
