-- Edition notifications move to the reader's own clock — PRODUCTION project.
--
-- WHAT CHANGES
--
-- Until now every edition notification went out at one instant: when the
-- edition was verified, around 19:00 Europe/Paris. For a reader in Chicago that
-- is noon; for a reader in Los Angeles it is ten in the morning. This file makes
-- two edition notifications follow the reader's own timezone:
--
--   edition_ready            ~19:00 reader-local on the edition date, and never
--                            before the edition has been verified;
--   edition_answer_reminder  ~08:30 reader-local the following morning, once,
--                            and only while an assigned question is unanswered.
--
-- Nothing else moves. Team notifications (team_invite_received,
-- team_member_joined, team_edition_result) are not scheduled by anything here
-- and keep whatever immediacy their sender gives them.
--
-- THE TIMEZONE IS READ, NEVER STORED BESIDE THE NOTIFICATION
--
-- `profiles.timezone` is the one authority: an IANA name the app writes from the
-- device and refreshes when the device's zone changes. Every due time below is
-- computed from it AT THE MOMENT IT IS ASKED, by PostgreSQL's own tz database
-- (`timestamp AT TIME ZONE 'America/Chicago'`). So:
--
--   * no UTC offset is written anywhere, and DST is resolved by the zone rules;
--   * a reader who flies from Paris to Chicago and opens the app before the
--     notification is due is notified on Chicago time, because nothing about the
--     old zone was frozen into a schedule row.
--
-- THE REMINDER IS NOT A JOB, IT IS AN OBLIGATION
--
-- There is no queue of reminders to cancel. A reader is owed a reminder exactly
-- while all of this holds, evaluated in the statement that leases the delivery
-- row: the edition was verified, they were assigned questions, at least one is
-- unanswered, notifications are on, a device can receive it, the edition is
-- still open for answering, it is past 08:30 local and inside the send window,
-- and they have not already been reminded for this edition. Answering the last
-- question removes the obligation the instant that answer commits; no trigger
-- and no cancellation step is needed for the reminder to not be sent.
--
-- IDEMPOTENCY IS THE EXISTING KEY
--
-- (push_token_id, drop_date, notification_kind) is unchanged. edition_ready and
-- edition_answer_reminder for the same device and edition are two rows under two
-- kinds, so neither can suppress the other and neither can be sent twice. On top
-- of the device key, a reader is fanned out to devices ONCE per edition: a
-- device registered after the reminder went out does not produce a second one.
--
-- Additive: two CHECK constraints widened, one small operational table, new
-- service-role functions, one function body replaced with the same signature,
-- one health function re-created with two extra trailing columns, and the
-- dispatcher's cron widened from the Paris evening to the whole day.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The new kind, and a way to stand a delivery down cleanly
-- ---------------------------------------------------------------------------
-- 'cancelled' is for a reminder row that was fanned out and is no longer owed —
-- typically because the reader answered between fan-out and send. It is final,
-- it is not a failure, and nothing re-leases it.

ALTER TABLE public.push_notification_deliveries
  DROP CONSTRAINT IF EXISTS push_notification_deliveries_kind_check;

ALTER TABLE public.push_notification_deliveries
  ADD CONSTRAINT push_notification_deliveries_kind_check
  CHECK (
    notification_kind IN (
      'edition_ready',
      'edition_answer_reminder',
      'team_invite_received',
      'team_member_joined',
      'team_edition_result'
    )
  );

ALTER TABLE public.push_notification_deliveries
  DROP CONSTRAINT IF EXISTS push_notification_deliveries_status_check;

ALTER TABLE public.push_notification_deliveries
  ADD CONSTRAINT push_notification_deliveries_status_check
  CHECK (
    status IN (
      'pending',
      'claimed',
      'sending',
      'ticket_accepted',
      'awaiting_receipt',
      'sent',
      'retryable_failure',
      'terminal_failure',
      'failed',
      'cancelled'
    )
  );

COMMENT ON COLUMN public.push_notification_deliveries.status IS
  'pending/retryable_failure: can be claimed. claimed/sending: leased. awaiting_receipt: Expo ticket accepted, final receipt pending. sent/terminal_failure/failed: final. cancelled: final, no longer owed (e.g. the reader answered before the reminder was sent) — not a failure.';

-- ---------------------------------------------------------------------------
-- 2. The reader's clock
-- ---------------------------------------------------------------------------

-- The zone a reader's notifications are computed in. Only a Region/City name
-- (or bare UTC/GMT, which older rows hold by default) is accepted. PostgreSQL
-- would also accept a POSIX spec such as 'UTC+5' — and read its sign backwards —
-- or an abbreviation such as 'CEST', which is a fixed offset with no DST. Either
-- would silently put a reader an hour or ten off, so both fall back to the
-- product's own zone instead.
CREATE OR REPLACE FUNCTION public.reader_notification_timezone(p_timezone TEXT)
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
    RETURN 'Europe/Paris';
  END IF;

  -- Unknown names ('Mars/Olympus') are only discovered by using them.
  PERFORM now() AT TIME ZONE v_zone;
  RETURN v_zone;
EXCEPTION
  WHEN invalid_parameter_value THEN
    RETURN 'Europe/Paris';
END;
$zone$;

COMMENT ON FUNCTION public.reader_notification_timezone(TEXT) IS
  'The IANA zone a reader is notified in: profiles.timezone when it is a real Region/City (or UTC/GMT) name, Europe/Paris otherwise. Never an offset.';

-- A wall-clock time on a calendar day in a zone, as an instant. DST is the tz
-- database's business: 08:30 in Chicago is 13:30 UTC in September and 14:30 UTC
-- in November without anyone writing either number down.
CREATE OR REPLACE FUNCTION public.reader_local_instant(
  p_day DATE,
  p_local_time TIME,
  p_timezone TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $instant$
  SELECT (p_day + p_local_time) AT TIME ZONE public.reader_notification_timezone(p_timezone);
$instant$;

-- ---------------------------------------------------------------------------
-- 3. When an edition may be announced at all
-- ---------------------------------------------------------------------------
-- The verification success boundary from 20260906081000, read as an instant.
-- An outbox row that exists answers with its verified_at — NULL while it still
-- sits at awaiting_verification, which keeps every reader-local notification
-- for that edition from ever becoming due. An edition with no outbox row at all
-- (published before the outbox existed) falls back to its publication instant,
-- which is exactly how the sender treated it before this file.
CREATE OR REPLACE FUNCTION public.edition_notification_released_at(p_edition_date DATE)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $released$
  SELECT CASE
    WHEN outbox.id IS NOT NULL THEN outbox.verified_at
    ELSE edition.published_at
  END
  FROM (SELECT p_edition_date AS day) AS target
  LEFT JOIN public.notification_outbox AS outbox
    ON outbox.event_type = 'edition_published'
   AND outbox.event_date = target.day
  LEFT JOIN public.editions AS edition
    ON edition.edition_date = target.day;
$released$;

COMMENT ON FUNCTION public.edition_notification_released_at(DATE) IS
  'The instant readers may first be told about an edition: its verification time, or its publication time when it predates the outbox. NULL while it awaits verification.';

-- ---------------------------------------------------------------------------
-- 4. The two due times
-- ---------------------------------------------------------------------------

-- edition_ready: 19:00 reader-local on the edition date, or the verification
-- instant if that is later.
--
--   target = edition_date 19:00 in the reader's zone
--   due    = target      when target > verified_at
--            verified_at otherwise
--
-- The edition is verified around 19:00 PARIS. For a reader west of Paris their
-- 19:00 is still ahead, so they are told at 19:00 on the dot. For a reader east
-- of Paris (Shanghai, Tokyo) their 19:00 has already passed, so they are due
-- the moment the edition is verified. It is never moved to another day.
CREATE OR REPLACE FUNCTION public.edition_ready_due_at(
  p_edition_date DATE,
  p_timezone TEXT,
  p_released_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $ready$
  SELECT CASE
    WHEN p_edition_date IS NULL OR p_released_at IS NULL THEN NULL
    ELSE greatest(
      public.reader_local_instant(p_edition_date, TIME '19:00', p_timezone),
      p_released_at
    )
  END;
$ready$;

COMMENT ON FUNCTION public.edition_ready_due_at(DATE, TEXT, TIMESTAMPTZ) IS
  'greatest(19:00 reader-local on the edition date, verification instant). Never a later day. Computed from the zone passed in, so a changed profiles.timezone moves it.';

-- edition_answer_reminder: 08:30 reader-local on the calendar day after the
-- edition date — and never before that reader's edition_ready, so the two
-- cannot arrive in the wrong order even for an edition verified very late.
CREATE OR REPLACE FUNCTION public.edition_answer_reminder_due_at(
  p_edition_date DATE,
  p_timezone TEXT,
  p_released_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $reminder$
DECLARE
  v_zone TEXT := public.reader_notification_timezone(p_timezone);
  v_ready TIMESTAMPTZ;
BEGIN
  v_ready := public.edition_ready_due_at(p_edition_date, v_zone, p_released_at);

  IF v_ready IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN greatest(
    public.reader_local_instant(p_edition_date + 1, TIME '08:30', v_zone),
    v_ready
  );
END;
$reminder$;

COMMENT ON FUNCTION public.edition_answer_reminder_due_at(DATE, TEXT, TIMESTAMPTZ) IS
  '08:30 reader-local on the calendar day after the edition date, never before the reader''s edition_ready. The reminder is sendable from then for three hours and never after.';

-- ---------------------------------------------------------------------------
-- 5. One reader, one edition: is a reminder owed?
-- ---------------------------------------------------------------------------
-- THE single definition of reminder eligibility. The claim, the dispatcher's
-- probe and the health report all read it, so they cannot disagree.
--
-- "Assigned" is exactly what `user_has_question_assignment` lets the reader
-- open: their personal assignments for the edition, plus the questions of every
-- active Team they are currently a member of and eligible in for that edition.
-- "Answered" is a submitted attempt — the product allows one attempt per
-- logical question, ever, so an answer given in any context counts.
--
-- reader_state, in precedence order:
--   no_assignments          nothing was assigned; no reminder is ever owed
--   reminded                a reminder was already fanned out for this edition
--   completed               every assigned question is answered
--   awaiting_verification   the edition has not been verified
--   notifications_disabled  the reader switched PersoNews notifications off
--   no_active_token         no device can receive a push
--   scheduled_not_due       before 08:30 reader-local
--   edition_closed          the next edition has replaced this one
--   window_missed           more than three hours past 08:30 local
--   due                     owed now
CREATE OR REPLACE FUNCTION public.edition_answer_reminder_reader(
  p_user_id UUID,
  p_edition_date DATE,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(
  reader_id UUID,
  reader_timezone TEXT,
  due_at TIMESTAMPTZ,
  assigned_questions INTEGER,
  answered_questions INTEGER,
  notifications_on BOOLEAN,
  active_devices INTEGER,
  edition_open BOOLEAN,
  reminder_devices INTEGER,
  still_owed BOOLEAN,
  reader_state TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $reader$
  WITH assigned AS (
    SELECT solo.logical_question_id
    FROM public.solo_question_assignments AS solo
    WHERE solo.user_id = p_user_id
      AND solo.edition_date = p_edition_date
    UNION
    SELECT team_assignment.logical_question_id
    FROM public.team_question_assignments AS team_assignment
    JOIN public.team_members AS membership
      ON membership.team_id = team_assignment.team_id
     AND membership.user_id = p_user_id
     AND membership.left_at IS NULL
     AND membership.eligible_from_edition <= team_assignment.edition_date
    JOIN public.teams AS team
      ON team.id = team_assignment.team_id
     AND team.status = 'active'
    WHERE team_assignment.edition_date = p_edition_date
  ),
  progress AS (
    SELECT
      count(*)::INTEGER AS assigned_count,
      count(attempt.id) FILTER (WHERE attempt.status = 'submitted')::INTEGER AS answered_count
    FROM assigned
    LEFT JOIN public.question_attempts AS attempt
      ON attempt.user_id = p_user_id
     AND attempt.logical_question_id = assigned.logical_question_id
  ),
  facts AS (
    SELECT
      profile.id AS fact_reader,
      public.reader_notification_timezone(profile.timezone) AS fact_zone,
      public.edition_answer_reminder_due_at(
        p_edition_date,
        profile.timezone,
        public.edition_notification_released_at(p_edition_date)
      ) AS fact_due,
      progress.assigned_count,
      progress.answered_count,
      coalesce(preference.notifications_enabled, false) AS fact_enabled,
      (
        SELECT count(*)::INTEGER
        FROM public.push_tokens AS device
        WHERE device.user_id = profile.id
          AND device.enabled
          AND device.expo_push_token ~ '^Expo(nent)?PushToken\[.+\]$'
      ) AS fact_devices,
      public.is_edition_open(p_edition_date, p_now) AS fact_open,
      (
        SELECT count(*)::INTEGER
        FROM public.push_notification_deliveries AS delivery
        WHERE delivery.user_id = profile.id
          AND delivery.drop_date = p_edition_date
          AND delivery.notification_kind = 'edition_answer_reminder'
      ) AS fact_reminded
    FROM public.profiles AS profile
    CROSS JOIN progress
    LEFT JOIN public.user_preferences AS preference
      ON preference.user_id = profile.id
    WHERE profile.id = p_user_id
  )
  SELECT
    facts.fact_reader,
    facts.fact_zone,
    facts.fact_due,
    facts.assigned_count,
    facts.answered_count,
    facts.fact_enabled,
    facts.fact_devices,
    facts.fact_open,
    facts.fact_reminded,
    -- Everything except "not yet reminded": the claim uses this to decide
    -- whether an already fanned-out row may still be sent.
    (
      facts.assigned_count > facts.answered_count
      AND facts.fact_due IS NOT NULL
      AND facts.fact_enabled
      AND facts.fact_devices > 0
      AND p_now >= facts.fact_due
      AND p_now < facts.fact_due + INTERVAL '3 hours'
      AND facts.fact_open
    ),
    CASE
      WHEN facts.assigned_count = 0 THEN 'no_assignments'
      WHEN facts.fact_reminded > 0 THEN 'reminded'
      WHEN facts.answered_count >= facts.assigned_count THEN 'completed'
      WHEN facts.fact_due IS NULL THEN 'awaiting_verification'
      WHEN NOT facts.fact_enabled THEN 'notifications_disabled'
      WHEN facts.fact_devices = 0 THEN 'no_active_token'
      WHEN p_now < facts.fact_due THEN 'scheduled_not_due'
      WHEN NOT facts.fact_open THEN 'edition_closed'
      WHEN p_now >= facts.fact_due + INTERVAL '3 hours' THEN 'window_missed'
      ELSE 'due'
    END
  FROM facts;
$reader$;

COMMENT ON FUNCTION public.edition_answer_reminder_reader(UUID, DATE, TIMESTAMPTZ) IS
  'The one definition of next-morning reminder eligibility for one reader and one edition, evaluated at p_now from current production state.';

-- Every reader an edition could owe a reminder to, or has already reminded.
CREATE OR REPLACE FUNCTION public.edition_answer_reminder_readers(
  p_edition_date DATE,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(
  reader_id UUID,
  reader_timezone TEXT,
  due_at TIMESTAMPTZ,
  assigned_questions INTEGER,
  answered_questions INTEGER,
  notifications_on BOOLEAN,
  active_devices INTEGER,
  edition_open BOOLEAN,
  reminder_devices INTEGER,
  still_owed BOOLEAN,
  reader_state TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $readers$
  SELECT reader.*
  FROM (
    SELECT solo.user_id
    FROM public.solo_question_assignments AS solo
    WHERE solo.edition_date = p_edition_date
    UNION
    SELECT membership.user_id
    FROM public.team_question_assignments AS team_assignment
    JOIN public.team_members AS membership
      ON membership.team_id = team_assignment.team_id
     AND membership.left_at IS NULL
     AND membership.eligible_from_edition <= team_assignment.edition_date
    WHERE team_assignment.edition_date = p_edition_date
    UNION
    SELECT delivery.user_id
    FROM public.push_notification_deliveries AS delivery
    WHERE delivery.drop_date = p_edition_date
      AND delivery.notification_kind = 'edition_answer_reminder'
  ) AS candidate(user_id)
  CROSS JOIN LATERAL public.edition_answer_reminder_reader(candidate.user_id, p_edition_date, p_now) AS reader;
$readers$;

-- ---------------------------------------------------------------------------
-- 6. The editions a sender still has local-time work for
-- ---------------------------------------------------------------------------
-- Released within the last three days: enough for the furthest-west reader's
-- 19:00 and every reader's next morning. Older editions have nothing left that
-- is not already late.
CREATE OR REPLACE FUNCTION public.get_recent_released_edition_dates(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(released_edition_date DATE, released_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $recent$
  SELECT edition.edition_date, released.at
  FROM public.editions AS edition
  CROSS JOIN LATERAL (
    SELECT public.edition_notification_released_at(edition.edition_date) AS at
  ) AS released
  WHERE edition.published_at <= p_now
    AND edition.published_at > p_now - INTERVAL '3 days'
    AND released.at IS NOT NULL
    AND released.at <= p_now
  ORDER BY edition.edition_date;
$recent$;

-- ---------------------------------------------------------------------------
-- 7. edition_ready: which readers are due, for the sender's gate
-- ---------------------------------------------------------------------------
-- The sender still decides WHO is eligible for edition_ready (published,
-- complete, notifications on, a live device) exactly as before. This answers
-- only WHEN, per reader, from the reader's current zone.
CREATE OR REPLACE FUNCTION public.get_edition_ready_schedule(
  p_edition_date DATE,
  p_user_ids UUID[],
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(
  schedule_user_id UUID,
  schedule_timezone TEXT,
  schedule_due_at TIMESTAMPTZ,
  schedule_is_due BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $schedule$
  SELECT
    profile.id,
    public.reader_notification_timezone(profile.timezone),
    ready.due,
    coalesce(ready.due <= p_now, false)
  FROM public.profiles AS profile
  CROSS JOIN LATERAL (
    SELECT public.edition_ready_due_at(
      p_edition_date,
      profile.timezone,
      public.edition_notification_released_at(p_edition_date)
    ) AS due
  ) AS ready
  WHERE profile.id = ANY (coalesce(p_user_ids, ARRAY[]::UUID[]));
$schedule$;

COMMENT ON FUNCTION public.get_edition_ready_schedule(DATE, UUID[], TIMESTAMPTZ) IS
  'Per reader: the zone, the edition_ready due instant and whether it has passed. NULL due means the edition is not verified and nobody is due.';

-- ---------------------------------------------------------------------------
-- 8. Claiming reminders
-- ---------------------------------------------------------------------------
-- One call does the whole send-time decision, in this order, for every edition
-- released in the last four days:
--
--   a. a fanned-out row that is no longer owed — the reader answered, turned
--      notifications off, or the edition closed — is stood down as 'cancelled';
--   b. a row still unsent when the three-hour window ends becomes a terminal
--      failure, so a late morning never turns into an afternoon nag;
--   c. a reader newly owed a reminder is fanned out to each live device, once;
--   d. rows still owed are leased — eligibility re-read IN THE LEASING
--      STATEMENT — and returned to the sender with the token and the reader's
--      current language.
--
-- Anything not returned must not be sent. p_now exists for the test suite and
-- replays; production passes nothing and gets the database clock.
CREATE OR REPLACE FUNCTION public.claim_edition_answer_reminders(
  p_claim_id TEXT,
  p_limit INTEGER DEFAULT 500,
  p_claim_ttl_seconds INTEGER DEFAULT 900,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  claimed_push_token_id UUID,
  claimed_user_id UUID,
  claimed_edition_date DATE,
  claimed_expo_push_token TEXT,
  claimed_language TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $claim$
#variable_conflict use_column
-- Every local and parameter is v_- or p_-prefixed and every output column is
-- claimed_-prefixed, so no identifier below can mean two things.
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_ttl_seconds INTEGER := greatest(coalesce(p_claim_ttl_seconds, 900), 60);
  v_limit INTEGER := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_edition DATE;
BEGIN
  IF p_claim_id IS NULL OR length(trim(p_claim_id)) = 0 THEN
    RAISE EXCEPTION 'claim id is required' USING ERRCODE = '22023';
  END IF;

  FOR v_edition IN
    SELECT recent.edition_date
    FROM public.editions AS recent
    WHERE recent.published_at <= v_now
      AND recent.published_at > v_now - INTERVAL '4 days'
    ORDER BY recent.published_at
  LOOP
    -- a. No longer owed: stand down, never a failure.
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = 'cancelled',
      error = CASE
        WHEN reader.answered_questions >= reader.assigned_questions THEN 'completed_before_send'
        WHEN NOT reader.notifications_on THEN 'notifications_disabled'
        ELSE 'edition_closed'
      END,
      claim_id = NULL,
      claim_expires_at = NULL,
      updated_at = v_now
    FROM public.edition_answer_reminder_readers(v_edition, v_now) AS reader
    WHERE delivery.drop_date = v_edition
      AND delivery.notification_kind = 'edition_answer_reminder'
      AND delivery.user_id = reader.reader_id
      AND (
        delivery.status IN ('pending', 'retryable_failure')
        OR (
          delivery.status IN ('claimed', 'sending')
          AND (delivery.claim_expires_at IS NULL OR delivery.claim_expires_at <= v_now)
        )
      )
      AND (
        reader.answered_questions >= reader.assigned_questions
        OR NOT reader.notifications_on
        OR NOT reader.edition_open
      );

    -- b. Still unsent when the morning window closed: a failure, and final.
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = 'terminal_failure',
      error = 'reminder send window elapsed',
      claim_id = NULL,
      claim_expires_at = NULL,
      updated_at = v_now
    FROM public.edition_answer_reminder_readers(v_edition, v_now) AS reader
    WHERE delivery.drop_date = v_edition
      AND delivery.notification_kind = 'edition_answer_reminder'
      AND delivery.user_id = reader.reader_id
      AND (
        delivery.status IN ('pending', 'retryable_failure')
        OR (
          delivery.status IN ('claimed', 'sending')
          AND (delivery.claim_expires_at IS NULL OR delivery.claim_expires_at <= v_now)
        )
      )
      AND reader.due_at IS NOT NULL
      AND v_now >= reader.due_at + INTERVAL '3 hours';

    -- c. Newly owed: one row per live device, once per reader and edition.
    -- `reader_state = 'due'` already requires that no reminder row exists for
    -- this reader and edition, which is what makes the fan-out happen once.
    INSERT INTO public.push_notification_deliveries (
      push_token_id,
      user_id,
      drop_date,
      notification_kind,
      status
    )
    SELECT device.id, reader.reader_id, v_edition, 'edition_answer_reminder', 'pending'
    FROM public.edition_answer_reminder_readers(v_edition, v_now) AS reader
    JOIN public.push_tokens AS device
      ON device.user_id = reader.reader_id
     AND device.enabled
     AND device.expo_push_token ~ '^Expo(nent)?PushToken\[.+\]$'
    WHERE reader.reader_state = 'due'
    ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique DO NOTHING;
  END LOOP;

  -- d. Lease what is still owed, re-checking eligibility in this statement.
  RETURN QUERY
  WITH owed AS (
    SELECT delivery.id AS delivery_id
    FROM public.push_notification_deliveries AS delivery
    JOIN public.editions AS recent
      ON recent.edition_date = delivery.drop_date
     AND recent.published_at <= v_now
     AND recent.published_at > v_now - INTERVAL '4 days'
    JOIN public.push_tokens AS device
      ON device.id = delivery.push_token_id
     AND device.enabled
    CROSS JOIN LATERAL public.edition_answer_reminder_reader(
      delivery.user_id, delivery.drop_date, v_now
    ) AS reader
    WHERE delivery.notification_kind = 'edition_answer_reminder'
      AND (
        delivery.status IN ('pending', 'retryable_failure')
        OR (
          delivery.status IN ('claimed', 'sending')
          AND (delivery.claim_expires_at IS NULL OR delivery.claim_expires_at <= v_now)
        )
      )
      AND reader.still_owed
    ORDER BY delivery.created_at, delivery.id
    LIMIT v_limit
    FOR UPDATE OF delivery SKIP LOCKED
  ),
  leased AS (
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = 'claimed',
      claim_id = p_claim_id,
      claimed_at = v_now,
      claim_expires_at = v_now + make_interval(secs => v_ttl_seconds),
      error = NULL,
      updated_at = v_now
    FROM owed
    WHERE delivery.id = owed.delivery_id
    RETURNING
      delivery.push_token_id AS token_id,
      delivery.user_id AS reader_id,
      delivery.drop_date AS day
  )
  SELECT
    leased.token_id,
    leased.reader_id,
    leased.day,
    device.expo_push_token,
    CASE WHEN profile.language IN ('fr', 'en') THEN profile.language ELSE 'en' END
  FROM leased
  JOIN public.push_tokens AS device ON device.id = leased.token_id
  JOIN public.profiles AS profile ON profile.id = leased.reader_id;
END;
$claim$;

COMMENT ON FUNCTION public.claim_edition_answer_reminders(TEXT, INTEGER, INTEGER, TIMESTAMPTZ) IS
  'Stands down reminders no longer owed, fans newly owed readers out to their devices once, and leases what is still owed with eligibility re-read in the leasing statement. Only returned rows may be sent.';

-- ---------------------------------------------------------------------------
-- 9. Is there local-time work right now? (the dispatcher's probe)
-- ---------------------------------------------------------------------------
-- Counts readers whose notification is due and has NEVER been attempted. Retries
-- are deliberately not counted: a device that keeps failing must not wake the
-- sender every few minutes, and the recovery schedule retries it anyway.
--
-- The edition_ready half mirrors the sender's own eligibility — published,
-- notifications on, a well-formed live device, and every slot the reader enabled
-- actually present — so that a reader the sender will skip cannot keep the
-- probe true. It is bounded to six hours after each reader's due time.
CREATE OR REPLACE FUNCTION public.count_due_edition_notifications(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(edition_ready_due BIGINT, answer_reminders_due BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $due$
  WITH recent AS (
    SELECT released_edition_date AS day, released_at AS released
    FROM public.get_recent_released_edition_dates(p_now)
  ),
  ready AS (
    SELECT count(DISTINCT edition_drop.user_id) AS readers
    FROM recent
    JOIN public.daily_drops AS edition_drop
      ON edition_drop.drop_date = recent.day
     AND edition_drop.status = 'published'
    JOIN public.user_preferences AS preference
      ON preference.user_id = edition_drop.user_id
     AND preference.notifications_enabled
    JOIN public.profiles AS profile
      ON profile.id = edition_drop.user_id
    CROSS JOIN LATERAL (
      SELECT public.edition_ready_due_at(recent.day, profile.timezone, recent.released) AS due
    ) AS schedule
    WHERE schedule.due <= p_now
      AND p_now < schedule.due + INTERVAL '6 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM (VALUES
          ('newsletter', coalesce(preference.newsletter_enabled, true)),
          ('business_story', coalesce(preference.business_stories_enabled, true)),
          ('mini_case', coalesce(preference.mini_cases_enabled, true))
        ) AS required(slot, wanted)
        WHERE required.wanted
          AND NOT EXISTS (
            SELECT 1
            FROM public.daily_drop_items AS item
            WHERE item.daily_drop_id = edition_drop.id
              AND item.slot = required.slot
          )
      )
      AND EXISTS (
        SELECT 1
        FROM public.push_tokens AS device
        WHERE device.user_id = edition_drop.user_id
          AND device.enabled
          AND device.expo_push_token ~ '^Expo(nent)?PushToken\[.+\]$'
          AND NOT EXISTS (
            SELECT 1
            FROM public.push_notification_deliveries AS delivery
            WHERE delivery.push_token_id = device.id
              AND delivery.drop_date = recent.day
              AND delivery.notification_kind = 'edition_ready'
          )
      )
  ),
  reminders AS (
    SELECT count(*) AS readers
    FROM recent
    CROSS JOIN LATERAL public.edition_answer_reminder_readers(recent.day, p_now) AS reader
    WHERE reader.reader_state = 'due'
  )
  SELECT ready.readers, reminders.readers
  FROM ready, reminders;
$due$;

-- ---------------------------------------------------------------------------
-- 10. Waking the sender on the reader's clock
-- ---------------------------------------------------------------------------
-- The dispatcher already wakes the sender when an edition is verified. It now
-- also wakes it when a reader-local notification has come due — at most once
-- every five minutes, remembered here so two ticks cannot both fire.

CREATE TABLE IF NOT EXISTS public.notification_dispatch_state (
  dispatch_key TEXT PRIMARY KEY,
  last_dispatched_at TIMESTAMPTZ NOT NULL,
  last_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_dispatch_state ENABLE ROW LEVEL SECURITY;

-- No policy: operational data, service role and cron only.
REVOKE ALL ON TABLE public.notification_dispatch_state FROM anon;
REVOKE ALL ON TABLE public.notification_dispatch_state FROM authenticated;

COMMENT ON TABLE public.notification_dispatch_state IS
  'When the dispatcher last woke the sender for reader-local work. A throttle, not a queue: the work itself is always re-derived from production state.';

-- Same signature as 20260906082000, so CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION public.dispatch_notification_events(
  p_min_dispatch_interval_seconds INTEGER DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $dispatch$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_interval INTERVAL := make_interval(secs => greatest(coalesce(p_min_dispatch_interval_seconds, 600), 60));
  v_local_interval INTERVAL := INTERVAL '5 minutes';
  v_url TEXT;
  v_token TEXT;
  v_event RECORD;
  v_request_id BIGINT;
  v_dispatched INTEGER := 0;
  v_has_events BOOLEAN;
  v_ready_due BIGINT := 0;
  v_reminders_due BIGINT := 0;
  v_local_fired BOOLEAN := false;
  v_payload JSONB;
BEGIN
  v_has_events := EXISTS (
    SELECT 1
    FROM public.notification_outbox AS outbox
    WHERE outbox.status = 'pending'
      AND (outbox.dispatched_at IS NULL OR outbox.dispatched_at <= v_now - v_interval)
  );

  -- The probe must never cost the edition path its wake-up.
  BEGIN
    SELECT due.edition_ready_due, due.answer_reminders_due
    INTO v_ready_due, v_reminders_due
    FROM public.count_due_edition_notifications(v_now) AS due;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'reader-local notification probe failed: %', SQLERRM;
      v_ready_due := 0;
      v_reminders_due := 0;
  END;

  IF NOT v_has_events AND coalesce(v_ready_due, 0) + coalesce(v_reminders_due, 0) = 0 THEN
    RETURN jsonb_build_object('fired', false, 'reason', 'no_pending_events');
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'personews_notification_dispatch_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'personews_notification_dispatch_token'
  LIMIT 1;

  IF v_url IS NULL OR v_token IS NULL THEN
    -- Inert, not broken. The recovery schedule still runs the sender.
    RETURN jsonb_build_object('fired', false, 'reason', 'not_configured');
  END IF;

  IF NOT pg_try_advisory_lock(hashtext('personews_notification_dispatch')) THEN
    RETURN jsonb_build_object('fired', false, 'reason', 'another_tick_holds_the_lock');
  END IF;

  FOR v_event IN
    SELECT outbox.id, outbox.event_type, outbox.event_date
    FROM public.notification_outbox AS outbox
    WHERE outbox.status = 'pending'
      AND (outbox.dispatched_at IS NULL OR outbox.dispatched_at <= v_now - v_interval)
    ORDER BY outbox.created_at
    LIMIT 10
  LOOP
    SELECT net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'event_type', v_event.event_type,
        'client_payload', jsonb_build_object(
          'edition_date', to_char(v_event.event_date, 'YYYY-MM-DD'),
          'outbox_event_id', v_event.id
        )
      ),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'accept', 'application/vnd.github+json',
        'user-agent', 'personews-notification-dispatch',
        'authorization', 'Bearer ' || v_token
      ),
      timeout_milliseconds := 15000
    ) INTO v_request_id;

    UPDATE public.notification_outbox AS outbox
    SET dispatched_at = v_now, updated_at = v_now
    WHERE outbox.id = v_event.id;

    v_dispatched := v_dispatched + 1;
  END LOOP;

  IF coalesce(v_ready_due, 0) + coalesce(v_reminders_due, 0) > 0 THEN
    v_payload := jsonb_build_object(
      'edition_ready_due', v_ready_due,
      'answer_reminders_due', v_reminders_due
    );

    -- The throttle is claimed before the request is made, atomically: the
    -- upsert only writes when the last wake-up is old enough.
    INSERT INTO public.notification_dispatch_state AS state (
      dispatch_key, last_dispatched_at, last_payload, updated_at
    )
    VALUES ('reader_local_due', v_now, v_payload, v_now)
    ON CONFLICT (dispatch_key) DO UPDATE
    SET last_dispatched_at = excluded.last_dispatched_at,
        last_payload = excluded.last_payload,
        updated_at = excluded.updated_at
    WHERE state.last_dispatched_at <= v_now - v_local_interval
    RETURNING true INTO v_local_fired;

    IF coalesce(v_local_fired, false) THEN
      SELECT net.http_post(
        url := v_url,
        body := jsonb_build_object(
          'event_type', 'edition_notifications_due',
          'client_payload', v_payload
        ),
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'accept', 'application/vnd.github+json',
          'user-agent', 'personews-notification-dispatch',
          'authorization', 'Bearer ' || v_token
        ),
        timeout_milliseconds := 15000
      ) INTO v_request_id;
    END IF;
  END IF;

  PERFORM pg_advisory_unlock(hashtext('personews_notification_dispatch'));

  RETURN jsonb_build_object(
    'fired', v_dispatched > 0 OR coalesce(v_local_fired, false),
    'dispatched', v_dispatched,
    'reader_local_dispatched', coalesce(v_local_fired, false),
    'edition_ready_due', v_ready_due,
    'answer_reminders_due', v_reminders_due
  );
END;
$dispatch$;

COMMENT ON FUNCTION public.dispatch_notification_events(INTEGER) IS
  'Wakes the notification sender when an edition is verified and whenever a reader-local notification (19:00 edition_ready, 08:30 edition_answer_reminder) comes due. Never sends anything itself, and is inert until its two Vault secrets exist.';

-- Reader-local times happen at every hour of the UTC day, so the window that
-- used to cover only the Paris evening now covers the whole day. Still ONE job,
-- still every two minutes, and a tick with nothing due costs two indexed reads.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'personews-notification-dispatch';

SELECT cron.schedule(
  'personews-notification-dispatch',
  '*/2 * * * *',
  $cron$select public.dispatch_notification_events();$cron$
);

-- ---------------------------------------------------------------------------
-- 11. Health
-- ---------------------------------------------------------------------------
-- edition_ready: a Chicago reader who has not been told at 19:10 Paris is not a
-- failure, they are six hours early. never_attempted now counts only devices
-- whose reader's due time passed more than thirty minutes ago (or whose edition
-- never passed verification, which stays critical exactly as before). Two
-- columns are appended; the ones before them keep their names and order, so a
-- reader of the old shape still works.

DROP FUNCTION IF EXISTS public.get_edition_notification_health(DATE);

CREATE FUNCTION public.get_edition_notification_health(
  p_edition_date DATE DEFAULT NULL
)
RETURNS TABLE(
  edition_date DATE,
  eligible_devices BIGINT,
  delivery_rows BIGINT,
  sent BIGINT,
  awaiting_receipt BIGINT,
  retryable BIGINT,
  terminal BIGINT,
  never_attempted BIGINT,
  outbox_status TEXT,
  scheduled_not_due BIGINT,
  due_awaiting_worker BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $health$
  WITH target AS (
    SELECT coalesce(p_edition_date, max(edition_drop.drop_date)) AS day
    FROM public.daily_drops AS edition_drop
    WHERE edition_drop.status = 'published'
  ),
  released AS (
    SELECT public.edition_notification_released_at(target.day) AS at
    FROM target
  ),
  eligible AS (
    SELECT DISTINCT ON (token.id)
      token.id AS device_id,
      public.edition_ready_due_at(target.day, profile.timezone, released.at) AS due,
      EXISTS (
        SELECT 1
        FROM public.push_notification_deliveries AS delivery
        WHERE delivery.push_token_id = token.id
          AND delivery.drop_date = target.day
          AND delivery.notification_kind = 'edition_ready'
      ) AS attempted
    FROM target
    CROSS JOIN released
    JOIN public.daily_drops AS edition_drop
      ON edition_drop.drop_date = target.day AND edition_drop.status = 'published'
    JOIN public.user_preferences AS preference
      ON preference.user_id = edition_drop.user_id AND preference.notifications_enabled
    JOIN public.profiles AS profile
      ON profile.id = edition_drop.user_id
    JOIN public.push_tokens AS token
      ON token.user_id = edition_drop.user_id AND token.enabled
  ),
  schedule AS (
    SELECT
      count(*) AS devices,
      count(*) FILTER (WHERE NOT attempted AND due IS NOT NULL AND now() < due) AS not_due,
      count(*) FILTER (
        WHERE NOT attempted AND due IS NOT NULL
          AND now() >= due AND now() < due + INTERVAL '30 minutes'
      ) AS due_pending,
      count(*) FILTER (
        WHERE NOT attempted AND (due IS NULL OR now() >= due + INTERVAL '30 minutes')
      ) AS missed
    FROM eligible
  ),
  delivered AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE delivery.status = 'sent') AS sent,
      count(*) FILTER (WHERE delivery.status IN ('ticket_accepted', 'awaiting_receipt')) AS awaiting,
      count(*) FILTER (WHERE delivery.status IN ('pending', 'claimed', 'sending', 'retryable_failure')) AS retryable,
      count(*) FILTER (WHERE delivery.status IN ('terminal_failure', 'failed')) AS terminal
    FROM target
    JOIN public.push_notification_deliveries AS delivery
      ON delivery.drop_date = target.day AND delivery.notification_kind = 'edition_ready'
  )
  SELECT
    target.day,
    schedule.devices,
    delivered.total,
    delivered.sent,
    delivered.awaiting,
    delivered.retryable,
    delivered.terminal,
    schedule.missed,
    coalesce(
      (SELECT outbox.status FROM public.notification_outbox AS outbox
       WHERE outbox.event_type = 'edition_published' AND outbox.event_date = target.day),
      'no_event'
    ),
    schedule.not_due,
    schedule.due_pending
  FROM target, schedule, delivered;
$health$;

COMMENT ON FUNCTION public.get_edition_notification_health(DATE) IS
  'edition_ready health for one edition. never_attempted > 0 means devices whose reader-local due time passed more than 30 minutes ago (or whose edition never verified) have no delivery row. scheduled_not_due are readers whose 19:00 has not come yet — healthy.';

-- edition_answer_reminder: one row per edition, counted in READERS, so that
-- every state the product cares about is a separate, named number.
CREATE OR REPLACE FUNCTION public.get_edition_answer_reminder_health(
  p_edition_date DATE DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(
  edition_date DATE,
  released BOOLEAN,
  assigned_readers BIGINT,
  completed_before_reminder BIGINT,
  scheduled_not_due BIGINT,
  due_awaiting_worker BIGINT,
  sent BIGINT,
  awaiting_receipt BIGINT,
  retryable BIGINT,
  terminal BIGINT,
  cancelled BIGINT,
  not_eligible BIGINT,
  not_released BIGINT,
  edition_closed BIGINT,
  never_attempted BIGINT,
  next_due_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $reminder_health$
  WITH target AS (
    SELECT coalesce(
      p_edition_date,
      (SELECT max(edition.edition_date) FROM public.editions AS edition WHERE edition.published_at <= p_now)
    ) AS day
  ),
  readers AS (
    SELECT reader.*, target.day
    FROM target
    CROSS JOIN LATERAL public.edition_answer_reminder_readers(target.day, p_now) AS reader
    WHERE reader.assigned_questions > 0 OR reader.reminder_devices > 0
  ),
  outcomes AS (
    SELECT
      readers.reader_state,
      readers.due_at,
      (
        -- A reader with no reminder row has no delivery outcome at all; the
        -- aggregates below would otherwise be NULL and fall through to
        -- 'terminal', reporting "never reminded" as "failed".
        SELECT CASE
          WHEN count(*) = 0 THEN NULL
          WHEN bool_or(delivery.status = 'sent') THEN 'sent'
          WHEN bool_or(delivery.status IN ('ticket_accepted', 'awaiting_receipt')) THEN 'awaiting_receipt'
          WHEN bool_or(delivery.status IN ('pending', 'claimed', 'sending', 'retryable_failure')) THEN 'retryable'
          WHEN bool_and(delivery.status = 'cancelled') THEN 'cancelled'
          ELSE 'terminal'
        END
        FROM public.push_notification_deliveries AS delivery
        WHERE delivery.user_id = readers.reader_id
          AND delivery.drop_date = readers.day
          AND delivery.notification_kind = 'edition_answer_reminder'
      ) AS outcome
    FROM readers
  )
  SELECT
    target.day,
    public.edition_notification_released_at(target.day) IS NOT NULL,
    count(outcomes.reader_state),
    count(*) FILTER (WHERE outcomes.reader_state = 'completed'),
    count(*) FILTER (WHERE outcomes.reader_state = 'scheduled_not_due'),
    count(*) FILTER (
      WHERE outcomes.reader_state = 'due' AND p_now < outcomes.due_at + INTERVAL '30 minutes'
    ),
    count(*) FILTER (WHERE outcomes.outcome = 'sent'),
    count(*) FILTER (WHERE outcomes.outcome = 'awaiting_receipt'),
    count(*) FILTER (WHERE outcomes.outcome = 'retryable'),
    count(*) FILTER (WHERE outcomes.outcome = 'terminal'),
    count(*) FILTER (WHERE outcomes.outcome = 'cancelled'),
    count(*) FILTER (WHERE outcomes.reader_state IN ('notifications_disabled', 'no_active_token')),
    count(*) FILTER (WHERE outcomes.reader_state = 'awaiting_verification'),
    count(*) FILTER (WHERE outcomes.reader_state = 'edition_closed'),
    count(*) FILTER (
      WHERE outcomes.reader_state = 'window_missed'
         OR (outcomes.reader_state = 'due' AND p_now >= outcomes.due_at + INTERVAL '30 minutes')
    ),
    min(outcomes.due_at) FILTER (WHERE outcomes.reader_state = 'scheduled_not_due')
  FROM target
  LEFT JOIN outcomes ON true
  GROUP BY target.day;
$reminder_health$;

COMMENT ON FUNCTION public.get_edition_answer_reminder_health(DATE, TIMESTAMPTZ) IS
  'Next-morning reminder health for one edition, in readers: completed before the reminder, scheduled for later, due, sent/awaiting receipt, retryable, terminal, cancelled, not eligible, and never_attempted — due more than 30 minutes ago and never tried, the only unhealthy state.';

-- ---------------------------------------------------------------------------
-- 12. Privileges
-- ---------------------------------------------------------------------------
-- Every function here reads across readers. None is callable by a client key.

DO $grants$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.reader_notification_timezone(TEXT)',
    'public.reader_local_instant(DATE, TIME, TEXT)',
    'public.edition_notification_released_at(DATE)',
    'public.edition_ready_due_at(DATE, TEXT, TIMESTAMPTZ)',
    'public.edition_answer_reminder_due_at(DATE, TEXT, TIMESTAMPTZ)',
    'public.edition_answer_reminder_reader(UUID, DATE, TIMESTAMPTZ)',
    'public.edition_answer_reminder_readers(DATE, TIMESTAMPTZ)',
    'public.get_recent_released_edition_dates(TIMESTAMPTZ)',
    'public.get_edition_ready_schedule(DATE, UUID[], TIMESTAMPTZ)',
    'public.claim_edition_answer_reminders(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)',
    'public.count_due_edition_notifications(TIMESTAMPTZ)',
    'public.get_edition_notification_health(DATE)',
    'public.get_edition_answer_reminder_health(DATE, TIMESTAMPTZ)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$grants$;

COMMIT;

NOTIFY pgrst, 'reload schema';
