-- Playing a question, and what it is worth — PRODUCTION project.
--
-- Everything a client could lie about is decided here, by Postgres:
--
--   * the clock (§11). started_at and deadline_at come from now() inside the
--     database. A phone with its clock moved forward cannot buy time, and one
--     moved back cannot rewind a deadline. The phone is never asked what time
--     it is.
--
--   * the score (§12). The client sends an option id. It never sends a score,
--     cannot write question_attempts, and cannot read the answer key that turns
--     one into the other.
--
--   * how many goes you get (§10). One attempt per user per LOGICAL question,
--     enforced by a unique index — which is also what stops someone answering
--     in French and replaying the same question in English (§9).
--
--   * which teams a score counts for (§13). A question assigned to three of
--     your teams is played once and counts three times, but only for the teams
--     you were eligible in, and only while their edition is open.
--
-- Note the deliberate absence of a `score` argument anywhere in this file's
-- public API, and the absence of any INSERT/UPDATE policy on the scoring
-- tables. Those two facts together are the security model.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Attempts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.question_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  logical_question_id UUID NOT NULL REFERENCES public.logical_questions(id) ON DELETE CASCADE,
  -- The edition the attempt was opened in. The per-team scoring edition is the
  -- assignment's, not this one; this is the solo/audit answer.
  edition_date DATE,
  started_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  selected_option_id UUID REFERENCES public.logical_question_options(id) ON DELETE SET NULL,
  score_milli INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress',
  -- The order the options were shown in. Randomised once, at start, and read
  -- back on every resume: closing the app and reopening it must not move the
  -- answers around under the reader's finger.
  option_order UUID[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT question_attempts_status_check CHECK (status IN ('in_progress', 'submitted')),
  CONSTRAINT question_attempts_deadline_after_start_check CHECK (deadline_at > started_at),
  CONSTRAINT question_attempts_score_check CHECK (
    score_milli IS NULL OR score_milli IN (0, 300, 600, 1000)
  ),
  -- A submitted attempt has a time and a score; an in-progress one has neither.
  -- There is no third state to reason about.
  CONSTRAINT question_attempts_submitted_shape_check CHECK (
    (status = 'submitted' AND submitted_at IS NOT NULL AND score_milli IS NOT NULL)
    OR (status = 'in_progress' AND submitted_at IS NULL AND score_milli IS NULL)
  ),
  CONSTRAINT question_attempts_option_order_not_empty CHECK (
    array_length(option_order, 1) > 0
  )
);

-- THE rule of the whole feature: one attempt, per person, per logical question.
-- Logical, not localized — the FR and EN renderings share a logical question, so
-- this single index is what makes the two languages one game.
CREATE UNIQUE INDEX IF NOT EXISTS question_attempts_user_question_unique
  ON public.question_attempts (user_id, logical_question_id);

CREATE INDEX IF NOT EXISTS idx_question_attempts_user_edition
  ON public.question_attempts (user_id, edition_date);

COMMENT ON TABLE public.question_attempts IS
  'One attempt per reader per logical question, ever. Times and score are written by start_question_attempt/submit_question_answer only; the table has no client write policy.';
COMMENT ON COLUMN public.question_attempts.option_order IS
  'The randomised but fixed presentation order for this attempt. Stored so a resume shows the options exactly where they were.';

-- ---------------------------------------------------------------------------
-- 2. The team score ledger and its aggregate
-- ---------------------------------------------------------------------------
-- Two tables, not three. The ledger is the auditable fact — "this attempt
-- scored this much, for this team, in this edition" — and the aggregate is the
-- read model the leaderboard uses. This Week and All Time are sums over the
-- aggregate rather than two more stored tables that could drift from it.

CREATE TABLE IF NOT EXISTS public.team_question_scores (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  logical_question_id UUID NOT NULL REFERENCES public.logical_questions(id) ON DELETE CASCADE,
  edition_date DATE NOT NULL,
  attempt_id UUID NOT NULL REFERENCES public.question_attempts(id) ON DELETE CASCADE,
  score_milli INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id, logical_question_id),
  CONSTRAINT team_question_scores_score_check CHECK (score_milli IN (0, 300, 600, 1000))
);

CREATE INDEX IF NOT EXISTS idx_team_question_scores_team_edition
  ON public.team_question_scores (team_id, edition_date, user_id);

CREATE TABLE IF NOT EXISTS public.team_member_edition_scores (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  edition_date DATE NOT NULL,
  score_milli INTEGER NOT NULL DEFAULT 0,
  answered_count SMALLINT NOT NULL DEFAULT 0,
  assigned_count SMALLINT NOT NULL DEFAULT 0,
  -- Every assigned question answered before the edition closed. This is the
  -- streak unit (§16) — an edition, never a calendar day.
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id, edition_date),
  CONSTRAINT team_member_edition_scores_counts_check CHECK (
    answered_count >= 0 AND assigned_count >= 0 AND answered_count <= assigned_count
  )
);

CREATE INDEX IF NOT EXISTS idx_team_member_edition_scores_team_edition
  ON public.team_member_edition_scores (team_id, edition_date);

CREATE INDEX IF NOT EXISTS idx_team_member_edition_scores_user
  ON public.team_member_edition_scores (user_id, edition_date DESC);

COMMENT ON TABLE public.team_question_scores IS
  'The audit trail: which attempt scored what, for which team, in which edition. Written only by submit_question_answer.';
COMMENT ON TABLE public.team_member_edition_scores IS
  'Compact read model, one row per member per edition. This Week and All Time are sums over this table, so there is one source of truth rather than three that can disagree.';

-- ---------------------------------------------------------------------------
-- 3. Starting an attempt — the server clock
-- ---------------------------------------------------------------------------

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
  options JSONB
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
    -- Already answered: say so, and return no options. There is no retry (§10),
    -- so this is a report rather than an error — the client shows the result.
    IF v_attempt.status = 'submitted' THEN
      RETURN QUERY
      SELECT
        v_attempt.id, v_now, v_attempt.started_at, v_attempt.deadline_at,
        v_question.time_limit_seconds, TRUE, v_language,
        NULL::TEXT, v_question.question_role, v_question.question_sequence,
        '[]'::JSONB;
      RETURN;
    END IF;

    -- Resuming. The original started_at, deadline and option order are returned
    -- unchanged: reopening the app must not hand back a fresh 20 seconds, and
    -- must not move the options.
    v_order := v_attempt.option_order;
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
    FALSE,
    v_language,
    v_prompt,
    v_question.question_role,
    v_question.question_sequence,
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
      '[]'::JSONB
    );
END;
$$;

REVOKE ALL ON FUNCTION public.start_question_attempt(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_question_attempt(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_question_attempt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_question_attempt(UUID) TO service_role;

COMMENT ON FUNCTION public.start_question_attempt(UUID) IS
  'Opens (or resumes) the caller''s single attempt at a question. Returns the server clock, the deadline it computed, and the options in their fixed order. Never returns a score, a grade band or a rationale.';

-- The channel name, in one place. Both the broadcaster and the RLS policy that
-- authorizes a subscriber have to agree on this string exactly; deriving it
-- twice by hand is how they come to disagree.
CREATE OR REPLACE FUNCTION public.team_leaderboard_topic(p_team_id UUID)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT 'team:' || p_team_id::TEXT || ':leaderboard';
$$;

REVOKE ALL ON FUNCTION public.team_leaderboard_topic(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_leaderboard_topic(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_leaderboard_topic(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3b. Telling an open Team Detail that something changed
-- ---------------------------------------------------------------------------
-- Supabase Broadcast on a private per-team channel, and nothing else (§17). Not
-- Postgres Changes — that would push every row of every table a client
-- subscribes to, and on the Free tier''s 2M messages a month a generic
-- subscription is the thing that runs the budget out. Not Presence either.
--
-- The payload is deliberately tiny and carries no score: it is a nudge saying
-- "this team''s edition moved", and the open screen re-reads the leaderboard it
-- is already entitled to. That keeps the message small, keeps standings out of
-- the message bus, and means a stale or dropped message can never leave a
-- client showing a number the database disagrees with.
--
-- Best effort by construction: if realtime is unavailable the submit still
-- commits. A score is the product; a notification is a convenience.
CREATE OR REPLACE FUNCTION public.broadcast_team_leaderboard_change(
  p_team_id UUID,
  p_edition_date DATE,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb, text, text, boolean)') IS NULL THEN
    RETURN;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'team_id', p_team_id,
      'edition_date', p_edition_date,
      'user_id', p_user_id,
      'at', now()
    ),
    'leaderboard_changed',
    public.team_leaderboard_topic(p_team_id),
    TRUE
  );
EXCEPTION
  WHEN OTHERS THEN
    -- The answer is already graded and committed to the ledger. A realtime
    -- outage must not turn that into a failed submit.
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_team_leaderboard_change(UUID, DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.broadcast_team_leaderboard_change(UUID, DATE, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.broadcast_team_leaderboard_change(UUID, DATE, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_team_leaderboard_change(UUID, DATE, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Submitting — grading, fanout and the aggregate
-- ---------------------------------------------------------------------------

-- Recompute one member's aggregate for one edition from the ledger. Called
-- after every ledger write; cheap, and it means the read model can always be
-- rebuilt from the audit trail rather than being an independent account of
-- events.
CREATE OR REPLACE FUNCTION public.refresh_team_member_edition_score(
  p_team_id UUID,
  p_user_id UUID,
  p_edition_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_score INTEGER;
  v_answered INTEGER;
  v_assigned INTEGER;
BEGIN
  SELECT COALESCE(SUM(s.score_milli), 0), COUNT(*)
  INTO v_score, v_answered
  FROM public.team_question_scores s
  WHERE s.team_id = p_team_id
    AND s.user_id = p_user_id
    AND s.edition_date = p_edition_date;

  SELECT COUNT(*)
  INTO v_assigned
  FROM public.team_question_assignments a
  WHERE a.team_id = p_team_id
    AND a.edition_date = p_edition_date;

  INSERT INTO public.team_member_edition_scores (
    team_id, user_id, edition_date, score_milli, answered_count, assigned_count, completed, updated_at
  )
  VALUES (
    p_team_id, p_user_id, p_edition_date, v_score, v_answered, v_assigned,
    v_assigned > 0 AND v_answered >= v_assigned,
    now()
  )
  ON CONFLICT (team_id, user_id, edition_date) DO UPDATE
  SET score_milli = EXCLUDED.score_milli,
      answered_count = EXCLUDED.answered_count,
      assigned_count = EXCLUDED.assigned_count,
      completed = EXCLUDED.completed,
      updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_team_member_edition_score(UUID, UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_team_member_edition_score(UUID, UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.refresh_team_member_edition_score(UUID, UUID, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_team_member_edition_score(UUID, UUID, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_question_answer(
  p_attempt_id UUID,
  p_selected_option_id UUID DEFAULT NULL
)
RETURNS TABLE (
  attempt_id UUID,
  submitted_at TIMESTAMPTZ,
  server_now TIMESTAMPTZ,
  expired BOOLEAN,
  skipped BOOLEAN,
  score_milli INTEGER,
  grade_band TEXT,
  selected_option_id UUID,
  teams_scored INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_now TIMESTAMPTZ := now();
  v_attempt public.question_attempts;
  v_selected UUID := p_selected_option_id;
  v_expired BOOLEAN;
  v_skipped BOOLEAN;
  v_score INTEGER := 0;
  v_band TEXT := 'bad';
  v_teams INTEGER := 0;
  v_team RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit an answer'
      USING ERRCODE = '28000';
  END IF;

  -- FOR UPDATE: two devices submitting the same attempt at once must serialise,
  -- or both could pass the status check and both write a ledger row.
  SELECT * INTO v_attempt
  FROM public.question_attempts a
  WHERE a.id = p_attempt_id
    AND a.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_attempt.status = 'submitted' THEN
    -- No retries (§10). Answering twice is not an error to recover from, it is
    -- the thing that must not happen, so it is refused rather than absorbed.
    RAISE EXCEPTION 'This question has already been answered'
      USING ERRCODE = '23505';
  END IF;

  -- THE DEADLINE, decided here and nowhere else. The client's clock never
  -- enters this comparison.
  v_expired := v_now > v_attempt.deadline_at;

  IF v_selected IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.logical_question_options o
    WHERE o.id = v_selected
      AND o.logical_question_id = v_attempt.logical_question_id
  ) THEN
    RAISE EXCEPTION 'Selected option does not belong to this question'
      USING ERRCODE = '22023';
  END IF;

  -- A skip is an explicit submit worth zero (§11), not an abandoned attempt.
  v_skipped := v_selected IS NULL;

  IF v_expired OR v_skipped THEN
    v_score := 0;
    v_band := 'bad';
    -- An expired answer is recorded as a zero, and the option the reader chose
    -- too late is not kept: storing it would suggest it counted for something.
    v_selected := CASE WHEN v_expired THEN NULL ELSE v_selected END;
  ELSE
    SELECT g.score_milli, g.grade_band
    INTO v_score, v_band
    FROM private.logical_question_grades g
    WHERE g.option_id = v_selected;

    IF NOT FOUND THEN
      -- An ungraded option is an editorial bug. Refusing is right: silently
      -- scoring it zero would punish the reader for it.
      RAISE EXCEPTION 'Option has no grade'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.question_attempts a
  SET status = 'submitted',
      submitted_at = v_now,
      selected_option_id = v_selected,
      score_milli = v_score
  WHERE a.id = p_attempt_id;

  -- FANOUT (§13). One answer, counted once per team that was playing this
  -- question and in which this reader was eligible — and only while that team's
  -- edition is still open.
  FOR v_team IN
    SELECT t.team_id, t.edition_date
    FROM public.teams_scoring_question(v_user_id, v_attempt.logical_question_id) AS t
  LOOP
    INSERT INTO public.team_question_scores (
      team_id, user_id, logical_question_id, edition_date, attempt_id, score_milli
    )
    VALUES (
      v_team.team_id, v_user_id, v_attempt.logical_question_id,
      v_team.edition_date, p_attempt_id, v_score
    )
    ON CONFLICT (team_id, user_id, logical_question_id) DO NOTHING;

    PERFORM public.refresh_team_member_edition_score(
      v_team.team_id, v_user_id, v_team.edition_date
    );

    PERFORM public.broadcast_team_leaderboard_change(
      v_team.team_id, v_team.edition_date, v_user_id
    );

    v_teams := v_teams + 1;
  END LOOP;

  RETURN QUERY SELECT
    p_attempt_id, v_now, v_now, v_expired, v_skipped, v_score, v_band, v_selected, v_teams;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_question_answer(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_question_answer(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_question_answer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_question_answer(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.submit_question_answer(UUID, UUID) IS
  'Grades one attempt against the server clock and the private answer key, then fans the score out to every team the reader was eligible in. Takes an option id and never a score. A NULL option is an explicit skip worth zero; a submission after deadline_at is worth zero whatever was chosen.';

-- ---------------------------------------------------------------------------
-- 5. Post-answer explanation
-- ---------------------------------------------------------------------------
-- The one door out of private.logical_question_option_feedback, and it only
-- opens once the caller has actually submitted.

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
    -- Before submitting, this is exactly the answer key. Nothing is returned,
    -- and no distinction is drawn between "you have not answered" and "no such
    -- question": both would be information.
    RAISE EXCEPTION 'No submitted answer for this question'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.language INTO v_language FROM public.profiles p WHERE p.id = v_user_id;
  v_language := COALESCE(v_language, 'en');

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
  ORDER BY g.score_milli DESC, o.option_key;
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_feedback(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_question_feedback(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_question_feedback(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_question_feedback(UUID) TO service_role;

COMMENT ON FUNCTION public.get_question_feedback(UUID) IS
  'Releases the grading of a question — scores, bands and localized explanations — but only to a caller who has already submitted their attempt. This is the only path from the private schema to a client.';

-- ---------------------------------------------------------------------------
-- 6. Reading a team: roster, leaderboard, streak
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so that public.profiles keeps its existing "you can only
-- read your own row" policy and team-mates' names come out of a function that
-- returns four columns instead of a policy that would expose the whole row.

CREATE OR REPLACE FUNCTION public.get_team_roster(p_team_id UUID)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  country_code TEXT,
  avatar_path TEXT,
  role TEXT,
  joined_at TIMESTAMPTZ,
  eligible_from_edition DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_active_team_member(p_team_id) THEN
    RAISE EXCEPTION 'Team not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    m.user_id,
    -- Moderation is applied at read time, so hiding a name takes effect
    -- everywhere at once and never destroys the stored value.
    CASE WHEN p.username_status = 'hidden' THEN NULL ELSE p.username END,
    p.country_code,
    CASE WHEN p.avatar_status = 'hidden' THEN NULL ELSE p.avatar_path END,
    m.role,
    m.joined_at,
    m.eligible_from_edition
  FROM public.team_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.team_id = p_team_id
    AND m.left_at IS NULL
  ORDER BY m.joined_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_roster(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_roster(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_roster(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_roster(UUID) TO service_role;

COMMENT ON FUNCTION public.get_team_roster(UUID) IS
  'Public identity of the caller''s team-mates. Returns no email and no other profile column, which is why public.profiles keeps its own-row-only read policy unchanged.';

-- Edition / This Week / All Time.
--
-- THE BASE IS THE ROSTER, NOT THE SCORE TABLE. Reading from
-- `team_member_edition_scores` alone means a member with no row is invisible —
-- and a member with no row is exactly the person the screen most needs to show:
-- somebody who has not started yet. A four-person team where two have played
-- rendered as a leaderboard of two, and the other two were indistinguishable
-- from people who are not in the team.
--
-- So: active roster LEFT JOIN the scores in scope. Everyone appears, once, with
-- zeros when they have nothing, and a status that says which kind of nothing it
-- is.
--
-- STATUS, and the order of the branches is the rule:
--
--   starts_next_edition   eligible_from_edition is still ahead of this edition.
--                         Shown INSTEAD of a zero, because a joiner who cannot
--                         score yet has not failed to score.
--   not_started           nothing assigned yet, or nothing answered. An
--                         assigned_count of 0 is never `completed`: answering
--                         none of nothing is not finishing.
--   in_progress           some but not all.
--   completed             every assigned question answered while the edition
--                         was open.
--
-- THE WEEK is ISO and derived from the EDITION date, never from the caller's
-- device: `date_trunc('week', edition_date::TIMESTAMP)` runs on a date cast to a
-- timestamp with no zone at all, so there is no offset to disagree about. Two
-- members of one team in Paris and in São Paulo get the same week boundary
-- because neither of their clocks is consulted.
--
-- ALL TIME shows the CURRENT ACTIVE ROSTER and their whole history in this team.
-- A member who left is not on the board any more — the board is who you are
-- playing against — but nothing of theirs is deleted or recomputed:
-- `team_question_scores` and `team_member_edition_scores` keep every row, and a
-- rejoin brings the same person back with their history intact. That is a
-- product decision and it is the reversible one.
--
-- TIES share a rank, and the convention is STANDARD COMPETITION RANKING —
-- 1, 2, 2, 4. `rank()`, not `dense_rank()`.
--
-- That is not a fresh preference: `apps/mobile/src/features/teams/leaderboard.ts`
-- already ranks this way and its tests assert `[1, 2, 2, 4]` explicitly. The
-- server and the client have to agree on one number, and changing the
-- established one to compact the UI would silently renumber every standing
-- while both sides still looked correct in isolation.
--
-- There is no speed bonus and no tie-break: the score is the whole ranking, and
-- inventing a separator would make the order depend on something the product
-- never told anyone about.
CREATE OR REPLACE FUNCTION public.get_team_leaderboard(
  p_team_id UUID,
  p_scope TEXT DEFAULT 'edition',
  p_edition_date DATE DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  country_code TEXT,
  avatar_path TEXT,
  rank INTEGER,
  score_milli BIGINT,
  answered_count BIGINT,
  assigned_count BIGINT,
  editions_completed BIGINT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_edition DATE := COALESCE(p_edition_date, public.current_edition_date());
BEGIN
  IF NOT public.is_active_team_member(p_team_id) THEN
    RAISE EXCEPTION 'Team not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_scope NOT IN ('edition', 'week', 'all_time') THEN
    RAISE EXCEPTION 'Scope must be edition, week or all_time'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT
      m.user_id AS member_id,
      m.eligible_from_edition AS eligible_from
    FROM public.team_members m
    WHERE m.team_id = p_team_id
      AND m.left_at IS NULL
  ),
  scoped AS (
    SELECT
      r.member_id,
      r.eligible_from,
      COALESCE(SUM(s.score_milli), 0)::BIGINT AS total_score,
      COALESCE(SUM(s.answered_count), 0)::BIGINT AS total_answered,
      COALESCE(SUM(s.assigned_count), 0)::BIGINT AS total_assigned,
      COUNT(*) FILTER (WHERE s.completed)::BIGINT AS total_completed
    FROM roster r
    LEFT JOIN public.team_member_edition_scores s
      ON s.team_id = p_team_id
     AND s.user_id = r.member_id
     AND (
       (p_scope = 'edition' AND s.edition_date = v_edition)
       OR (p_scope = 'week'
           AND v_edition IS NOT NULL
           AND date_trunc('week', s.edition_date::TIMESTAMP)
               = date_trunc('week', v_edition::TIMESTAMP))
       OR p_scope = 'all_time'
     )
    GROUP BY r.member_id, r.eligible_from
  ),
  ranked AS (
    SELECT
      sc.member_id,
      sc.total_score,
      sc.total_answered,
      sc.total_assigned,
      sc.total_completed,
      -- pg_catalog-qualified deliberately. `rank` is also an output column of
      -- this function and therefore a PL/pgSQL variable; a bare `rank()` reads
      -- as a function call to the parser but is exactly the shape the 42702
      -- guard flags, and the guard is right to be suspicious of it.
      pg_catalog.rank() OVER (ORDER BY sc.total_score DESC)::INTEGER AS member_rank,
      CASE
        WHEN v_edition IS NOT NULL AND sc.eligible_from > v_edition THEN 'starts_next_edition'
        WHEN sc.total_assigned = 0 THEN 'not_started'
        WHEN sc.total_answered = 0 THEN 'not_started'
        WHEN sc.total_answered < sc.total_assigned THEN 'in_progress'
        ELSE 'completed'
      END AS member_status
    FROM scoped sc
  )
  SELECT
    ranked.member_id,
    -- Moderation is applied at read time, so hiding a name takes effect
    -- everywhere at once and never destroys the stored value.
    CASE WHEN p.username_status = 'hidden' THEN NULL ELSE p.username END,
    p.country_code,
    CASE WHEN p.avatar_status = 'hidden' THEN NULL ELSE p.avatar_path END,
    ranked.member_rank,
    ranked.total_score,
    ranked.total_answered,
    ranked.total_assigned,
    ranked.total_completed,
    ranked.member_status
  FROM ranked
  JOIN public.profiles p ON p.id = ranked.member_id
  -- Within a shared rank the order is stable but carries no meaning: the tie is
  -- the answer, and the display order must not read as one.
  ORDER BY ranked.member_rank, p.username NULLS LAST, ranked.member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_leaderboard(UUID, TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_leaderboard(UUID, TEXT, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(UUID, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(UUID, TEXT, DATE) TO service_role;

COMMENT ON FUNCTION public.get_team_leaderboard(UUID, TEXT, DATE) IS
  'Edition, ISO week or all-time standings for the CURRENT ACTIVE ROSTER, one row per member whether or not they have played. Ties share a rank (standard competition ranking, 1/2/2/4, matching the mobile client); the week comes from edition dates, never from the caller''s device; a member who has left keeps every stored row but leaves the board.';

-- The streak (§16): consecutive EDITIONS completed, walking the editions table
-- backwards. Never a count of calendar days — the cadence is Mon/Wed/Fri/Sun,
-- so a 7/7 daily streak would be unwinnable by construction, and a Tuesday
-- cannot break anything because a Tuesday is not an edition.
--
-- THREE RULES THAT ARE EASY TO GET WRONG AND ARE THEREFORE WRITTEN DOWN:
--
--   1. An edition the TEAM was assigned nothing in is NEUTRAL. It neither
--      counts nor breaks. `completed` is false on such an edition because
--      `assigned_count = 0`, so reading it directly would end the streak of
--      somebody who did everything asked of them — which was nothing. Skipped
--      instead, and not silently counted either: answering none of nothing is
--      not a completed edition.
--
--   2. The walk starts at the CURRENT stint's eligible_from_edition. Editions
--      that closed before this reader could play them are not failures.
--
--   3. A REJOIN RESTARTS THE STREAK, deterministically. The walk is bounded by
--      the open stint only, so the editions during a period out of the team are
--      never visited — a gap is not a run of losses, and it is not a free pass
--      either. Somebody who leaves at 5 and comes back starts again at 0.
CREATE OR REPLACE FUNCTION public.team_member_edition_streak(
  p_team_id UUID,
  p_user_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_streak INTEGER := 0;
  v_eligible DATE;
  v_row RECORD;
BEGIN
  IF NOT public.is_active_team_member(p_team_id) THEN
    RAISE EXCEPTION 'Team not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- The open stint, and only it. A closed stint's eligibility date would drag
  -- the walk back across a gap the reader was not in the team for.
  SELECT m.eligible_from_edition INTO v_eligible
  FROM public.team_members m
  WHERE m.team_id = p_team_id
    AND m.user_id = p_user_id
    AND m.left_at IS NULL;

  IF v_eligible IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT
      e.edition_date,
      COALESCE(s.completed, FALSE) AS completed,
      EXISTS (
        SELECT 1
        FROM public.team_question_assignments a
        WHERE a.team_id = p_team_id
          AND a.edition_date = e.edition_date
      ) AS team_was_playing
    FROM public.editions e
    LEFT JOIN public.team_member_edition_scores s
      ON s.team_id = p_team_id
     AND s.user_id = p_user_id
     AND s.edition_date = e.edition_date
    WHERE e.edition_date >= v_eligible
    ORDER BY e.published_at DESC
  LOOP
    -- Rule 1.
    IF NOT v_row.team_was_playing THEN
      CONTINUE;
    END IF;

    IF v_row.completed THEN
      v_streak := v_streak + 1;
    ELSE
      -- The current, still-open edition is not a failure yet: it simply has not
      -- been finished. Anything older that is incomplete ends the streak.
      IF public.is_edition_open(v_row.edition_date) THEN
        CONTINUE;
      END IF;

      EXIT;
    END IF;
  END LOOP;

  RETURN v_streak;
END;
$$;

REVOKE ALL ON FUNCTION public.team_member_edition_streak(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_member_edition_streak(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_member_edition_streak(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_member_edition_streak(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.team_member_edition_streak(UUID, UUID) IS
  'Consecutive editions in which the member answered every question their team was assigned, counted over public.editions from their current stint''s first eligible edition. An edition unit, never a calendar day. An edition the team was assigned nothing in is neutral; a rejoin restarts the count.';

-- ---------------------------------------------------------------------------
-- 7. RLS on the scoring tables
-- ---------------------------------------------------------------------------
-- Read-only for clients, everywhere. There is no INSERT, UPDATE or DELETE
-- policy on any table in this file and no write privilege is granted to
-- `authenticated`: a client that tried to insert a 1000-point attempt, or to
-- update its own row in the leaderboard, has no policy to satisfy and no
-- privilege to use.

ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_question_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_member_edition_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Readers can read their own attempts" ON public.question_attempts;
CREATE POLICY "Readers can read their own attempts"
ON public.question_attempts
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Members can read their team's question scores" ON public.team_question_scores;
CREATE POLICY "Members can read their team's question scores"
ON public.team_question_scores
FOR SELECT
USING (public.is_active_team_member(team_id));

DROP POLICY IF EXISTS "Members can read their team's edition scores" ON public.team_member_edition_scores;
CREATE POLICY "Members can read their team's edition scores"
ON public.team_member_edition_scores
FOR SELECT
USING (public.is_active_team_member(team_id));

REVOKE ALL ON TABLE public.question_attempts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.team_question_scores FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.team_member_edition_scores FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.question_attempts TO authenticated;
GRANT SELECT ON TABLE public.team_question_scores TO authenticated;
GRANT SELECT ON TABLE public.team_member_edition_scores TO authenticated;

GRANT ALL ON TABLE public.question_attempts TO service_role;
GRANT ALL ON TABLE public.team_question_scores TO service_role;
GRANT ALL ON TABLE public.team_member_edition_scores TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
