-- Late answers earn half — PRODUCTION project.
--
-- THE RULE
--
-- A question can still be answered after its edition, but an answer settled
-- after the reader's FULL-CREDIT DAY earns 50% of its normal value:
--
--     full_credit_date := max(edition_date,
--                             local date of editions.published_at)
--     late             := local date at settlement > full_credit_date
--
-- "Local" is the reader's zone AS IT WAS WHEN THE EDITION PUBLISHED (see the
-- timezone history below). So a reader is never penalised for living east of
-- Paris: an edition dated Oct 6 that only became available after their local
-- midnight is fully credited through the end of their Oct 7. An old edition
-- keeps the full-credit day it had when it published; opening it later, a
-- notification, or the screen it is answered from change nothing.
--
--     grade (milli)   0    300    600   1000
--     on time         0    300    600   1000
--     late            0    150    300    500
--
-- AVAILABILITY is `editions.published_at`: written once when the edition
-- registers (register_edition_from_daily_drop), immutable afterwards
-- (guard_edition_registry, 20261005130000), and not writable by clients.
-- Never the reader's first open, a notification's delivery, the device, or
-- current_edition_date(). An edition with no registry row falls back to its
-- own date.
--
-- THE ZONE is `profiles.timezone` (useProfileTimezoneSync), validated as an
-- IANA name (UTC when unusable; never Europe/Paris), read AT PUBLICATION from
-- `profile_timezone_history`. Changing the zone after an edition published
-- therefore cannot move that edition's full-credit day or the date an answer
-- to it is judged in. The answer instant is now() inside
-- submit_question_answer, the same server clock as the 20-second deadline.
--
-- "Today" in the app is NOT this rule: it stays edition_date == the reader's
-- local date. Full credit is a scoring concept only.
--
-- WHERE IT IS ENFORCED
--
-- Here, in submit_question_answer, and nowhere a client can reach. The client
-- still sends an attempt id and an option id and nothing else; it cannot send a
-- date, a zone or a score. The client mirrors the rule for immediate feedback
-- (apps/mobile/src/features/quiz/points.ts), but what counts is what this
-- function writes.
--
-- WHAT IS STORED, AND WHY THE UNIT DOES NOT CHANGE
--
-- Scores stay in milli-points (0–1000 per question). The app's new 100-point
-- display scale is exactly milli / 10 — 300 → 30, 1000 → 100, 1500 → 150 — so
-- a points total is an integer by construction and no stored value has to be
-- rewritten. A unit migration would have been the risky option: every
-- historical row, both ledgers, the realtime payloads and every old client
-- multiplying or dividing twice. Leaderboard order is untouched because
-- nothing is rescaled.
--
--   question_attempts.score_milli   the GRADE of the chosen answer, as before
--                                   (0/300/600/1000). Old clients derive the
--                                   verdict and band from it, so it keeps its
--                                   meaning.
--   question_attempts.late_answer   new; FALSE on every existing row.
--   question_attempts.earned_milli  new, GENERATED from the two above: what the
--                                   answer actually earned. Cannot drift.
--   team_question_scores.score_milli  what counts for the Team — now the EARNED
--                                   value. Its CHECK admits the late values
--                                   only on a row flagged late.
--
-- HISTORICAL DATA
--
-- Nothing is backfilled and nothing is penalised retroactively: every existing
-- attempt reads late_answer = FALSE, so earned_milli = score_milli, and every
-- existing ledger row keeps its value. Aggregates
-- (team_member_edition_scores) are sums over the ledger and are not touched.
--
-- IDEMPOTENT. Every statement can run twice (IF NOT EXISTS, DROP … IF EXISTS,
-- CREATE OR REPLACE); supabase/tests/late_answer_credit.test.sql replays the
-- whole file a second time inside its own transaction to prove it.
--
-- BACKWARD COMPATIBLE. The two RPCs gain output columns at the END and keep
-- every existing one with its existing meaning, so a client built before this
-- migration (which reads named fields off one row) keeps working: it shows the
-- grade of a late answer, while the Team ledger records the halved value.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The stored facts
-- ---------------------------------------------------------------------------

ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS late_answer BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS earned_milli INTEGER
  GENERATED ALWAYS AS (
    CASE
      WHEN score_milli IS NULL THEN NULL
      WHEN late_answer THEN score_milli / 2
      ELSE score_milli
    END
  ) STORED;

COMMENT ON COLUMN public.question_attempts.late_answer IS
  'Settled after the edition''s date had passed in the reader''s own zone (profiles.timezone), so it earns half. Decided by submit_question_answer; FALSE for every attempt settled before 20261006120000.';
COMMENT ON COLUMN public.question_attempts.earned_milli IS
  'What the answer earned: score_milli, halved when late_answer. Generated, so it can never disagree with the grade and the flag. Points shown to readers are earned_milli / 10.';

ALTER TABLE public.team_question_scores
  ADD COLUMN IF NOT EXISTS late_answer BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.team_question_scores
  DROP CONSTRAINT IF EXISTS team_question_scores_score_check;

ALTER TABLE public.team_question_scores
  ADD CONSTRAINT team_question_scores_score_check CHECK (
    score_milli IN (0, 300, 600, 1000)
    OR (late_answer AND score_milli IN (0, 150, 300, 500))
  );

COMMENT ON COLUMN public.team_question_scores.score_milli IS
  'What this answer counts for in this Team: the earned value (late answers at half). Sums of this column are the leaderboard; points shown are milli / 10.';

-- ---------------------------------------------------------------------------
-- 2. The rule, as functions
-- ---------------------------------------------------------------------------

-- The zone a reader's CALENDAR is read in. Same validation as
-- reader_notification_timezone (a Region/City name, or UTC/GMT; never a POSIX
-- offset or an abbreviation, which Postgres would read with the wrong sign or
-- without DST). The fallback is deliberately UTC, the column's own default and
-- the app's (lib/localDate FALLBACK_TIME_ZONE), not the publisher's Paris.
CREATE OR REPLACE FUNCTION public.reader_calendar_timezone(p_timezone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $zone$
DECLARE
  v_zone TEXT := nullif(btrim(p_timezone), '');
BEGIN
  IF v_zone IS NULL
     OR NOT (v_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' OR v_zone IN ('UTC', 'GMT')) THEN
    RETURN 'UTC';
  END IF;

  PERFORM now() AT TIME ZONE v_zone;
  RETURN v_zone;
EXCEPTION
  WHEN invalid_parameter_value THEN
    RETURN 'UTC';
END;
$zone$;

-- Which zone a reader was in, and since when. One row per change, written by
-- a trigger on profiles.timezone (the app writes it only when the device zone
-- actually changes). Existing readers start with their current zone valid
-- since -infinity, so every edition already published is judged exactly as it
-- would have been. No client access: RLS on, no policy, no grant.
CREATE TABLE IF NOT EXISTS public.profile_timezone_history (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  valid_from TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  PRIMARY KEY (user_id, valid_from)
);

ALTER TABLE public.profile_timezone_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_timezone_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profile_timezone_history TO service_role;

COMMENT ON TABLE public.profile_timezone_history IS
  'The zone each reader was in from valid_from on. Scoring reads the zone in effect when an edition published, so a zone changed afterwards cannot extend that edition''s full-credit day. Written only by the profiles trigger.';

INSERT INTO public.profile_timezone_history (user_id, valid_from, timezone)
SELECT p.id, '-infinity'::TIMESTAMPTZ, p.timezone
FROM public.profiles p
ON CONFLICT (user_id, valid_from) DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_profile_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    INSERT INTO public.profile_timezone_history (user_id, valid_from, timezone)
    -- A new reader's first zone covers the past too: they have no other.
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN '-infinity'::TIMESTAMPTZ ELSE now() END, NEW.timezone)
    ON CONFLICT (user_id, valid_from) DO UPDATE SET timezone = EXCLUDED.timezone;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_record_timezone ON public.profiles;
CREATE TRIGGER trg_profiles_record_timezone
AFTER INSERT OR UPDATE OF timezone ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.record_profile_timezone();

-- The (validated) zone a reader was in at an instant. Falls back to the
-- current profile zone if no history row covers it.
CREATE OR REPLACE FUNCTION public.reader_timezone_at(p_user_id UUID, p_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.reader_calendar_timezone(COALESCE(
    (SELECT h.timezone
     FROM public.profile_timezone_history h
     WHERE h.user_id = p_user_id AND h.valid_from <= p_at
     ORDER BY h.valid_from DESC
     LIMIT 1),
    (SELECT p.timezone FROM public.profiles p WHERE p.id = p_user_id)
  ));
$$;

-- The edition a reader is answering a question FOR: the edition it was
-- assigned to them in, personally or through a Team they were eligible in.
-- When the same logical question reached them in more than one edition, the
-- most recent one is used — the generous reading, and the one a reader
-- answering "today's" copy of it would expect. NULL only when the reader holds
-- no assignment at all, in which case the caller falls back to the edition the
-- attempt was opened in.
CREATE OR REPLACE FUNCTION public.question_edition_date_for_reader(
  p_user_id UUID,
  p_logical_question_id UUID
)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT max(assigned.edition_date)
  FROM (
    SELECT s.edition_date
    FROM public.solo_question_assignments s
    WHERE s.user_id = p_user_id
      AND s.logical_question_id = p_logical_question_id
    UNION ALL
    SELECT a.edition_date
    FROM public.team_question_assignments a
    JOIN public.team_members m
      ON m.team_id = a.team_id
     AND m.user_id = p_user_id
     AND m.left_at IS NULL
     AND m.eligible_from_edition <= a.edition_date
    WHERE a.logical_question_id = p_logical_question_id
  ) AS assigned;
$$;

-- THE RULE, pure: no table, no clock, no profile. Every argument is a fact the
-- caller looked up on the server.
--
--   full credit through the end of max(edition_date, local publication date)
--   late once the local date of the answer is after that.
CREATE OR REPLACE FUNCTION public.full_credit_date(
  p_edition_date DATE,
  p_published_at TIMESTAMPTZ,
  p_timezone TEXT
)
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_published_at IS NULL THEN p_edition_date
    ELSE greatest(
      p_edition_date,
      (p_published_at AT TIME ZONE public.reader_calendar_timezone(p_timezone))::DATE
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_late_answer(
  p_edition_date DATE,
  p_published_at TIMESTAMPTZ,
  p_timezone TEXT,
  p_answered_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_edition_date IS NOT NULL
    AND p_answered_at IS NOT NULL
    AND (p_answered_at AT TIME ZONE public.reader_calendar_timezone(p_timezone))::DATE
        > public.full_credit_date(p_edition_date, p_published_at, p_timezone);
$$;

-- The rule, applied to a reader: the edition's canonical publication instant
-- and the reader's zone at that instant. Nothing about how or when they
-- opened it, and nothing a client sends.
CREATE OR REPLACE FUNCTION public.answer_is_late(
  p_user_id UUID,
  p_edition_date DATE,
  p_answered_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH edition AS (
    SELECT (SELECT e.published_at FROM public.editions e WHERE e.edition_date = p_edition_date) AS published_at
  )
  SELECT public.is_late_answer(
    p_edition_date,
    edition.published_at,
    public.reader_timezone_at(p_user_id, COALESCE(edition.published_at, p_answered_at)),
    p_answered_at
  )
  FROM edition;
$$;

-- What a graded answer earns. Integer arithmetic: every grade is even, so half
-- of it is exact — 1000 → 500, 600 → 300, 300 → 150, 0 → 0.
CREATE OR REPLACE FUNCTION public.answer_credit_milli(p_score_milli INTEGER, p_late BOOLEAN)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_late THEN p_score_milli / 2 ELSE p_score_milli END;
$$;

REVOKE ALL ON FUNCTION public.reader_calendar_timezone(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_profile_timezone() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reader_timezone_at(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.full_credit_date(DATE, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.answer_is_late(UUID, DATE, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.question_edition_date_for_reader(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_late_answer(DATE, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.answer_credit_milli(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reader_calendar_timezone(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_profile_timezone() TO service_role;
GRANT EXECUTE ON FUNCTION public.reader_timezone_at(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.full_credit_date(DATE, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.answer_is_late(UUID, DATE, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.question_edition_date_for_reader(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_late_answer(DATE, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.answer_credit_milli(INTEGER, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.full_credit_date(DATE, TIMESTAMPTZ, TEXT) IS
  'The last local day of full credit: max(edition date, local date of publication). Never earlier than the edition date; later only when the edition reached the reader after their own midnight.';
COMMENT ON FUNCTION public.is_late_answer(DATE, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) IS
  'True when the answer''s local date is after full_credit_date. The late-answer rule, in one place.';
COMMENT ON FUNCTION public.answer_is_late(UUID, DATE, TIMESTAMPTZ) IS
  'The rule for one reader: editions.published_at and the reader''s zone at publication (profile_timezone_history). Independent of opens, notifications and client input.';
COMMENT ON FUNCTION public.answer_credit_milli(INTEGER, BOOLEAN) IS
  'Earned milli-points for a grade: the grade on time, half of it late. Mirrored by apps/mobile/src/features/quiz/points.ts.';

-- ---------------------------------------------------------------------------
-- 3. Settling an answer — the one authoritative place the rule is applied
-- ---------------------------------------------------------------------------
-- RETURNS TABLE gains columns, which CREATE OR REPLACE cannot do. Nothing in
-- the schema calls this function from SQL (the client and the test suites
-- do), so the drop is safe.
DROP FUNCTION IF EXISTS public.submit_question_answer(UUID, UUID);

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
  -- The GRADE of the answer (0/300/600/1000), unchanged in meaning.
  score_milli INTEGER,
  grade_band TEXT,
  selected_option_id UUID,
  teams_scored INTEGER,
  -- New, at the end: settled after the edition's date had passed for this
  -- reader, and what the answer therefore earned.
  late_answer BOOLEAN,
  earned_milli INTEGER
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
  v_edition DATE;
  v_late BOOLEAN;
  v_earned INTEGER;
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

  -- LATE (20261006120000). Decided at settlement, from the server clock, the
  -- edition's canonical publication instant and the reader's zone at that
  -- instant — not from when the question was opened, a notification, or
  -- anything the client sent.
  v_edition := COALESCE(
    public.question_edition_date_for_reader(v_user_id, v_attempt.logical_question_id),
    v_attempt.edition_date
  );
  v_late := public.answer_is_late(v_user_id, v_edition, v_now);
  v_earned := public.answer_credit_milli(v_score, v_late);

  UPDATE public.question_attempts a
  SET status = 'submitted',
      submitted_at = v_now,
      selected_option_id = v_selected,
      score_milli = v_score,
      late_answer = v_late
  WHERE a.id = p_attempt_id;

  -- FANOUT (§13). One answer, counted once per team that was playing this
  -- question and in which this reader was eligible — and only while that team's
  -- edition is still open. What counts is what was EARNED.
  FOR v_team IN
    SELECT t.team_id, t.edition_date
    FROM public.teams_scoring_question(v_user_id, v_attempt.logical_question_id) AS t
  LOOP
    INSERT INTO public.team_question_scores (
      team_id, user_id, logical_question_id, edition_date, attempt_id, score_milli, late_answer
    )
    VALUES (
      v_team.team_id, v_user_id, v_attempt.logical_question_id,
      v_team.edition_date, p_attempt_id, v_earned, v_late
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
    p_attempt_id, v_now, v_now, v_expired, v_skipped, v_score, v_band, v_selected, v_teams,
    v_late, v_earned;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_question_answer(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_question_answer(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_question_answer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_question_answer(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.submit_question_answer(UUID, UUID) IS
  'Grades one attempt against the server clock and the private answer key, then fans the EARNED score out to every team the reader was eligible in. Takes an option id and never a score, a date or a zone. A NULL option is an explicit skip worth zero; a submission after deadline_at is worth zero whatever was chosen; a submission after the edition''s date in the reader''s own zone earns half (late_answer).';

-- ---------------------------------------------------------------------------
-- 4. Reopening a question — the settled result now says whether it was late
-- ---------------------------------------------------------------------------
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
  skipped BOOLEAN,
  -- New, at the end. Settled: whether it was late and what it earned. Open:
  -- whether an answer settled NOW would be late — a preview for the reader,
  -- re-decided by submit_question_answer at the instant that counts.
  late_answer BOOLEAN,
  earned_milli INTEGER,
  late_if_submitted_now BOOLEAN
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
  v_late BOOLEAN := FALSE;
  v_earned INTEGER := NULL;
  v_late_now BOOLEAN;
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
      v_late := COALESCE(v_attempt.late_answer, FALSE);
      v_earned := COALESCE(v_attempt.earned_milli, v_score);

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
      -- CHECK. score_milli is still the GRADE (a late answer keeps its grade and
      -- earns half of it), so this mapping is unchanged by the late rule.
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

  -- The same rule submit_question_answer applies, evaluated now. Only a
  -- preview: the answer is judged again at the instant it is settled.
  v_late_now := CASE WHEN v_settled THEN NULL ELSE public.answer_is_late(
    v_user_id,
    COALESCE(
      public.question_edition_date_for_reader(v_user_id, p_logical_question_id),
      v_attempt.edition_date
    ),
    v_now
  ) END;

  SELECT l.prompt INTO v_prompt
  FROM public.logical_question_locales l
  WHERE l.logical_question_id = p_logical_question_id
    AND l.language = v_language;

  IF v_prompt IS NULL AND v_settled THEN
    -- See 20260907170000: a settled question is never withheld over a missing
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
    v_skipped,
    v_late,
    v_earned,
    v_late_now;
END;
$$;

REVOKE ALL ON FUNCTION public.start_question_attempt(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_question_attempt(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_question_attempt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_question_attempt(UUID) TO service_role;

COMMENT ON FUNCTION public.start_question_attempt(UUID) IS
  'Opens — or resumes — the caller''s single attempt at a question. Returns the server clock, the deadline it computed, and the options in their fixed order. For an attempt the caller has ALREADY submitted it also returns what they chose, its grade, whether it was late and what it earned; while a question is still open those columns are NULL and no grading is released, and late_if_submitted_now previews the late-answer rule.';

COMMIT;

NOTIFY pgrst, 'reload schema';
