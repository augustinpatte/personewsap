-- Push timing: 20:00 and 08:30 reader-local, three attempts, Supabase as the
-- clock — PRODUCTION project.
--
-- WHAT WENT WRONG ON 11–12 SEPTEMBER (see docs/READER_LOCAL_NOTIFICATIONS.md)
--
-- The edition of 2026-09-11 was verified at 17:00 UTC (12:00 in Chicago). The
-- evening notification was due at 19:00 Chicago (00:00 UTC) and went out at
-- 20:27 Chicago; the morning reminder was due at 08:30 Chicago (13:30 UTC) and
-- went out at 09:19. Neither delay came from the database, which had both due
-- times right. Both came from the only thing that actually ran the sender: a
-- GitHub Actions schedule written as `*/30 * * * *` that GitHub honoured about
-- once every three to five hours (01:26, 06:24, 11:10, 14:19, 17:24 UTC on the
-- 12th). The event path (pg_cron -> repository_dispatch) fired, but no run was
-- ever started by it: all 43 recorded runs are `schedule` runs.
--
-- WHAT THIS FILE CHANGES
--
--   * The evening target is 20:00 reader-local (was 19:00). The rule is
--     unchanged otherwise: greatest(20:00 local, edition verified). An edition
--     that is not ready is never announced; one that becomes ready at 20:27 is
--     announced at 20:27, and the row says why.
--   * Supabase owns the whole schedule. Every delivery row carries its target,
--     its scheduled time, the reader's zone and the edition's ready time; every
--     lease counts an attempt; a retryable failure is rescheduled by a trigger to
--     scheduled_for + 15 min, then + 30 min; the third failure is terminal. At
--     most three attempts per device x edition x kind, and never after an
--     accepted ticket.
--   * A pg_cron job, every minute, wakes a Supabase Edge Function
--     (`personews-push-notifications`) — and only when something is due. No
--     GitHub scheduler stands between a due time and a send any more. The
--     GitHub workflow stays as a fallback on the same SQL claims, so the two can
--     run at once without a duplicate.
--
-- Additive: new columns, new functions, one trigger, one cron job. Functions
-- that already exist are replaced with their exact signatures, so every caller —
-- including the sender currently on `main` — keeps working.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The two numbers the retry policy is made of
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.push_max_attempts()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT 3 $$;

CREATE OR REPLACE FUNCTION public.push_retry_step()
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$ SELECT INTERVAL '15 minutes' $$;

COMMENT ON FUNCTION public.push_max_attempts() IS
  'At most three attempts per device x edition x kind: the initial one, scheduled_for + 15 min, scheduled_for + 30 min.';

-- ---------------------------------------------------------------------------
-- 2. What a delivery row knows about its own schedule
-- ---------------------------------------------------------------------------

ALTER TABLE public.push_notification_deliveries
  ADD COLUMN IF NOT EXISTS target_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reader_timezone TEXT,
  ADD COLUMN IF NOT EXISTS edition_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.push_notification_deliveries.target_at IS
  'The product target as an instant: 20:00 (edition_ready) or 08:30 the next morning (edition_answer_reminder) in reader_timezone.';
COMMENT ON COLUMN public.push_notification_deliveries.scheduled_for IS
  'The first moment the notification may be sent: greatest(target_at, edition_ready_at). Retries are counted from here.';
COMMENT ON COLUMN public.push_notification_deliveries.edition_ready_at IS
  'When the edition passed verification. Later than target_at means the notification waited for the edition (blocked until ready).';
COMMENT ON COLUMN public.push_notification_deliveries.next_attempt_at IS
  'When the next attempt may start: scheduled_for + 15 min after attempt 1, + 30 min after attempt 2. NULL when no further attempt will ever be made.';

CREATE INDEX IF NOT EXISTS idx_push_notification_deliveries_attempt_due
  ON public.push_notification_deliveries (next_attempt_at, scheduled_for)
  WHERE status IN ('pending', 'retryable_failure', 'claimed', 'sending');

-- ---------------------------------------------------------------------------
-- 3. The two targets, on the reader's clock
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.edition_ready_target_at(
  p_edition_date DATE,
  p_timezone TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_edition_date IS NULL THEN NULL
    ELSE public.reader_local_instant(p_edition_date, TIME '20:00', p_timezone)
  END;
$$;

COMMENT ON FUNCTION public.edition_ready_target_at(DATE, TEXT) IS
  '20:00 reader-local on the edition date, as an instant. DST is resolved by the zone.';

-- Same signature as 20260910090000; only the hour moves, 19:00 -> 20:00.
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
    ELSE greatest(public.edition_ready_target_at(p_edition_date, p_timezone), p_released_at)
  END;
$ready$;

COMMENT ON FUNCTION public.edition_ready_due_at(DATE, TEXT, TIMESTAMPTZ) IS
  'greatest(20:00 reader-local on the edition date, verification instant). An unverified edition is never due. Never moved to another day.';

CREATE OR REPLACE FUNCTION public.edition_answer_reminder_target_at(
  p_edition_date DATE,
  p_timezone TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_edition_date IS NULL THEN NULL
    ELSE public.reader_local_instant(p_edition_date + 1, TIME '08:30', p_timezone)
  END;
$$;

-- ---------------------------------------------------------------------------
-- 4. When may a row be attempted?
-- ---------------------------------------------------------------------------
-- The single predicate every claim uses. A row may be attempted when it has
-- never been sent successfully (pending, retryable, or a lease whose worker
-- died), it has attempts left, its next slot has come, and it is still inside
-- the three-hour window after its scheduled time — an evening notification is
-- never sent at two in the morning because a worker was down all evening.
-- `awaiting_receipt` and `sent` are never here: an accepted ticket is final.

CREATE OR REPLACE FUNCTION public.push_delivery_attempt_due(
  p_status TEXT,
  p_attempt_count INTEGER,
  p_next_attempt_at TIMESTAMPTZ,
  p_scheduled_for TIMESTAMPTZ,
  p_created_at TIMESTAMPTZ,
  p_claim_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (
      p_status IN ('pending', 'retryable_failure')
      OR (
        p_status IN ('claimed', 'sending')
        AND (p_claim_expires_at IS NULL OR p_claim_expires_at <= p_now)
      )
    )
    AND coalesce(p_attempt_count, 0) < public.push_max_attempts()
    AND coalesce(p_next_attempt_at, p_scheduled_for, p_created_at) <= p_now
    AND (p_scheduled_for IS NULL OR p_now < p_scheduled_for + INTERVAL '3 hours');
$$;

-- ---------------------------------------------------------------------------
-- 5. A retryable failure reschedules itself
-- ---------------------------------------------------------------------------
-- In the database, so it holds for every writer — the Edge Function, the Node
-- sender on `main`, anything later. attempt_count is incremented by the lease,
-- so after attempt n the next slot is scheduled_for + n x 15 min, and a failure
-- on the last attempt is terminal.
--
-- The sender on `main` also adds one to attempt_count when it records a result.
-- Until it is replaced, that would count every attempt twice and leave a device
-- two attempts instead of three, so exactly that write — a leased row being
-- recorded with attempt_count + 1 — keeps the count the lease already set.

CREATE OR REPLACE FUNCTION public.schedule_push_delivery_retry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $retry$
BEGIN
  IF OLD.status IN ('claimed', 'sending')
     AND NEW.status IN ('awaiting_receipt', 'ticket_accepted', 'retryable_failure', 'terminal_failure', 'failed')
     AND NEW.attempt_count = OLD.attempt_count + 1 THEN
    NEW.attempt_count := OLD.attempt_count;
  END IF;

  IF NEW.status = 'retryable_failure' AND OLD.status IS DISTINCT FROM 'retryable_failure' THEN
    IF coalesce(NEW.attempt_count, 0) >= public.push_max_attempts() THEN
      NEW.status := 'terminal_failure';
      NEW.error := left(
        coalesce(NEW.error || ' · ', '') || 'gave up after ' || NEW.attempt_count || ' attempts',
        500
      );
      NEW.next_attempt_at := NULL;
    ELSE
      NEW.next_attempt_at := greatest(
        coalesce(NEW.scheduled_for, NEW.first_attempt_at, NEW.created_at)
          + public.push_retry_step() * greatest(coalesce(NEW.attempt_count, 0), 1),
        now()
      );
    END IF;

    NEW.claim_id := NULL;
    NEW.claim_expires_at := NULL;
  END IF;

  RETURN NEW;
END;
$retry$;

DROP TRIGGER IF EXISTS trg_push_delivery_retry ON public.push_notification_deliveries;
CREATE TRIGGER trg_push_delivery_retry
BEFORE UPDATE ON public.push_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.schedule_push_delivery_retry();

-- Rows written before this file have no schedule. They are given their creation
-- time, which is when they were first due, so the three-hour window applies to
-- them too: a days-old retryable row is retired, never sent tonight.
UPDATE public.push_notification_deliveries AS delivery
SET scheduled_for = delivery.created_at
WHERE delivery.scheduled_for IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Housekeeping every claim runs first
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_push_deliveries(p_now TIMESTAMPTZ DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $finalize$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_total INTEGER := 0;
  v_rows INTEGER;
BEGIN
  -- Out of attempts: a third lease whose worker died, or anything left over.
  UPDATE public.push_notification_deliveries AS delivery
  SET status = 'terminal_failure',
      error = left(coalesce(delivery.error || ' · ', '') || 'gave up after ' || delivery.attempt_count || ' attempts', 500),
      claim_id = NULL,
      claim_expires_at = NULL,
      next_attempt_at = NULL,
      updated_at = v_now
  WHERE delivery.attempt_count >= public.push_max_attempts()
    AND (
      delivery.status IN ('pending', 'retryable_failure')
      OR (delivery.status IN ('claimed', 'sending')
          AND delivery.claim_expires_at IS NOT NULL
          AND delivery.claim_expires_at <= v_now)
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- Out of time: three hours after its scheduled time nothing is sent.
  UPDATE public.push_notification_deliveries AS delivery
  SET status = 'terminal_failure',
      error = 'send window elapsed',
      claim_id = NULL,
      claim_expires_at = NULL,
      next_attempt_at = NULL,
      updated_at = v_now
  WHERE delivery.scheduled_for IS NOT NULL
    AND v_now >= delivery.scheduled_for + INTERVAL '3 hours'
    AND (
      delivery.status IN ('pending', 'retryable_failure')
      OR (delivery.status IN ('claimed', 'sending')
          AND delivery.claim_expires_at IS NOT NULL
          AND delivery.claim_expires_at <= v_now)
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  -- No longer wanted: a scheduled notification for a device that was retired,
  -- or an evening one for a reader who switched notifications off, since it was
  -- written. (The reminder's own stand-down reasons are in its prepare step.)
  UPDATE public.push_notification_deliveries AS delivery
  SET status = 'cancelled',
      error = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.push_tokens AS device
          WHERE device.id = delivery.push_token_id AND device.enabled
        ) THEN 'device_disabled'
        ELSE 'notifications_disabled'
      END,
      claim_id = NULL,
      claim_expires_at = NULL,
      next_attempt_at = NULL,
      updated_at = v_now
  WHERE delivery.notification_kind IN ('edition_ready', 'edition_answer_reminder')
    AND delivery.status IN ('pending', 'retryable_failure')
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.push_tokens AS device
        WHERE device.id = delivery.push_token_id AND device.enabled
      )
      OR (
        delivery.notification_kind = 'edition_ready'
        AND NOT EXISTS (
          SELECT 1 FROM public.user_preferences AS preference
          WHERE preference.user_id = delivery.user_id AND preference.notifications_enabled
        )
      )
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN v_total + v_rows;
END;
$finalize$;

-- ---------------------------------------------------------------------------
-- 7. Writing the evening rows
-- ---------------------------------------------------------------------------
-- One row per live device of every reader whose edition_ready has come due:
-- the same eligibility the probe and the Node sender use — published, complete,
-- notifications on, a well-formed live device — with its schedule written down.

CREATE OR REPLACE FUNCTION public.prepare_edition_ready_deliveries(p_now TIMESTAMPTZ DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $prepare_ready$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_rows INTEGER;
BEGIN
  INSERT INTO public.push_notification_deliveries (
    push_token_id,
    user_id,
    drop_date,
    notification_kind,
    status,
    target_at,
    scheduled_for,
    reader_timezone,
    edition_ready_at
  )
  SELECT
    device.id,
    edition_drop.user_id,
    recent.released_edition_date,
    'edition_ready',
    'pending',
    schedule.target,
    schedule.due,
    zone.name,
    recent.released_at
  FROM public.get_recent_released_edition_dates(v_now) AS recent
  JOIN public.daily_drops AS edition_drop
    ON edition_drop.drop_date = recent.released_edition_date
   AND edition_drop.status = 'published'
  JOIN public.user_preferences AS preference
    ON preference.user_id = edition_drop.user_id
   AND preference.notifications_enabled
  JOIN public.profiles AS profile
    ON profile.id = edition_drop.user_id
  CROSS JOIN LATERAL (
    SELECT public.reader_notification_timezone(profile.timezone) AS name
  ) AS zone
  CROSS JOIN LATERAL (
    SELECT
      public.edition_ready_target_at(recent.released_edition_date, zone.name) AS target,
      public.edition_ready_due_at(recent.released_edition_date, zone.name, recent.released_at) AS due
  ) AS schedule
  JOIN public.push_tokens AS device
    ON device.user_id = edition_drop.user_id
   AND device.enabled
   AND device.expo_push_token ~ '^Expo(nent)?PushToken\[.+\]$'
  WHERE schedule.due <= v_now
    AND v_now < schedule.due + INTERVAL '3 hours'
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
  ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$prepare_ready$;

-- ---------------------------------------------------------------------------
-- 8. Writing and standing down the morning rows
-- ---------------------------------------------------------------------------
-- Exactly the reminder rules of 20260910090000 — owed only while an assigned
-- question is unanswered, stood down when it no longer is — with the schedule
-- written onto each row it fans out.

CREATE OR REPLACE FUNCTION public.prepare_edition_answer_reminders(p_now TIMESTAMPTZ DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $prepare_reminders$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_edition DATE;
  v_released TIMESTAMPTZ;
BEGIN
  FOR v_edition IN
    SELECT recent.edition_date
    FROM public.editions AS recent
    WHERE recent.published_at <= v_now
      AND recent.published_at > v_now - INTERVAL '4 days'
    ORDER BY recent.published_at
  LOOP
    v_released := public.edition_notification_released_at(v_edition);

    -- No longer owed: stand down, never a failure.
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
      next_attempt_at = NULL,
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

    -- Still unsent when the morning window closed: a failure, and final.
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = 'terminal_failure',
      error = 'reminder send window elapsed',
      claim_id = NULL,
      claim_expires_at = NULL,
      next_attempt_at = NULL,
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

    -- Newly owed: one row per live device, once per reader and edition.
    INSERT INTO public.push_notification_deliveries (
      push_token_id,
      user_id,
      drop_date,
      notification_kind,
      status,
      target_at,
      scheduled_for,
      reader_timezone,
      edition_ready_at
    )
    SELECT
      device.id,
      reader.reader_id,
      v_edition,
      'edition_answer_reminder',
      'pending',
      public.edition_answer_reminder_target_at(v_edition, reader.reader_timezone),
      reader.due_at,
      reader.reader_timezone,
      v_released
    FROM public.edition_answer_reminder_readers(v_edition, v_now) AS reader
    JOIN public.push_tokens AS device
      ON device.user_id = reader.reader_id
     AND device.enabled
     AND device.expo_push_token ~ '^Expo(nent)?PushToken\[.+\]$'
    WHERE reader.reader_state = 'due'
    ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique DO NOTHING;
  END LOOP;
END;
$prepare_reminders$;

-- ---------------------------------------------------------------------------
-- 9. The claim the Edge Function uses: both kinds, due now, one lease each
-- ---------------------------------------------------------------------------
-- Returns only what may be sent right now, each row with the attempt number it
-- is and the schedule it carries. Leasing counts the attempt and pre-computes
-- the next slot, so a worker that dies after leasing still leaves a retry at
-- the right time — and a third lease that is never answered ends terminal.
-- Team notifications are not claimed here: they are not scheduled.

CREATE OR REPLACE FUNCTION public.claim_due_push_notifications(
  p_claim_id TEXT,
  p_limit INTEGER DEFAULT 200,
  p_claim_ttl_seconds INTEGER DEFAULT 600,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  claimed_delivery_id UUID,
  claimed_push_token_id UUID,
  claimed_user_id UUID,
  claimed_drop_date DATE,
  claimed_kind TEXT,
  claimed_expo_push_token TEXT,
  claimed_language TEXT,
  claimed_attempt_number INTEGER,
  claimed_target_at TIMESTAMPTZ,
  claimed_scheduled_for TIMESTAMPTZ,
  claimed_timezone TEXT,
  claimed_edition_ready_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $claim_due$
#variable_conflict use_column
-- Locals and parameters are v_/p_-prefixed, outputs claimed_-prefixed.
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_ttl_seconds INTEGER := least(greatest(coalesce(p_claim_ttl_seconds, 600), 60), 840);
  v_limit INTEGER := least(greatest(coalesce(p_limit, 200), 1), 1000);
BEGIN
  IF p_claim_id IS NULL OR length(trim(p_claim_id)) = 0 THEN
    RAISE EXCEPTION 'claim id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM public.prepare_edition_answer_reminders(v_now);
  PERFORM public.prepare_edition_ready_deliveries(v_now);
  PERFORM public.finalize_push_deliveries(v_now);

  RETURN QUERY
  WITH owed AS (
    SELECT delivery.id AS delivery_id
    FROM public.push_notification_deliveries AS delivery
    JOIN public.push_tokens AS device
      ON device.id = delivery.push_token_id
     AND device.enabled
    JOIN public.user_preferences AS preference
      ON preference.user_id = delivery.user_id
     AND preference.notifications_enabled
    LEFT JOIN LATERAL public.edition_answer_reminder_reader(
      delivery.user_id, delivery.drop_date, v_now
    ) AS reader ON delivery.notification_kind = 'edition_answer_reminder'
    WHERE delivery.notification_kind IN ('edition_ready', 'edition_answer_reminder')
      AND public.push_delivery_attempt_due(
        delivery.status, delivery.attempt_count, delivery.next_attempt_at,
        delivery.scheduled_for, delivery.created_at, delivery.claim_expires_at, v_now
      )
      AND (
        (
          delivery.notification_kind = 'edition_ready'
          AND public.edition_notification_released_at(delivery.drop_date) IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.daily_drops AS edition_drop
            WHERE edition_drop.user_id = delivery.user_id
              AND edition_drop.drop_date = delivery.drop_date
              AND edition_drop.status = 'published'
          )
        )
        OR (delivery.notification_kind = 'edition_answer_reminder' AND reader.still_owed)
      )
    ORDER BY coalesce(delivery.next_attempt_at, delivery.scheduled_for, delivery.created_at), delivery.id
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
      attempt_count = delivery.attempt_count + 1,
      first_attempt_at = coalesce(delivery.first_attempt_at, v_now),
      last_attempt_at = v_now,
      next_attempt_at = CASE
        WHEN delivery.attempt_count + 1 < public.push_max_attempts()
          THEN coalesce(delivery.scheduled_for, delivery.created_at)
               + public.push_retry_step() * (delivery.attempt_count + 1)
        ELSE NULL
      END,
      error = NULL,
      updated_at = v_now
    FROM owed
    WHERE delivery.id = owed.delivery_id
    RETURNING
      delivery.id AS row_id,
      delivery.push_token_id AS token_id,
      delivery.user_id AS reader_id,
      delivery.drop_date AS day,
      delivery.notification_kind AS kind,
      delivery.attempt_count AS attempt,
      delivery.target_at AS target,
      delivery.scheduled_for AS scheduled,
      delivery.reader_timezone AS zone,
      delivery.edition_ready_at AS ready
  )
  SELECT
    leased.row_id,
    leased.token_id,
    leased.reader_id,
    leased.day,
    leased.kind,
    device.expo_push_token,
    CASE WHEN profile.language IN ('fr', 'en') THEN profile.language ELSE 'en' END,
    leased.attempt,
    leased.target,
    leased.scheduled,
    leased.zone,
    leased.ready
  FROM leased
  JOIN public.push_tokens AS device ON device.id = leased.token_id
  JOIN public.profiles AS profile ON profile.id = leased.reader_id;
END;
$claim_due$;

COMMENT ON FUNCTION public.claim_due_push_notifications(TEXT, INTEGER, INTEGER, TIMESTAMPTZ) IS
  'Writes the evening and morning rows that have come due, retires what is out of attempts or out of time, and leases what may be sent now — counting the attempt. Only returned rows may be sent. p_now is for tests and replays.';

-- ---------------------------------------------------------------------------
-- 10. Writing down what one attempt did
-- ---------------------------------------------------------------------------
-- Only the worker holding the lease can record it. An accepted ticket is final
-- for sending: the row waits for its receipt and is never leased again.

CREATE OR REPLACE FUNCTION public.record_push_delivery_attempt(
  p_delivery_id UUID,
  p_claim_id TEXT,
  p_outcome TEXT,
  p_expo_ticket_id TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS TABLE(recorded_status TEXT, recorded_next_attempt_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $record$
#variable_conflict use_column
DECLARE
  v_status TEXT;
  v_token_id UUID;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('ticket_accepted', 'retryable', 'permanent', 'token_invalid') THEN
    RAISE EXCEPTION 'unknown push outcome %', p_outcome USING ERRCODE = '22023';
  END IF;

  v_status := CASE p_outcome
    WHEN 'ticket_accepted' THEN 'awaiting_receipt'
    WHEN 'retryable' THEN 'retryable_failure'
    ELSE 'terminal_failure'
  END;

  SELECT delivery.push_token_id INTO v_token_id
  FROM public.push_notification_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
    AND delivery.claim_id = p_claim_id
    AND delivery.status = 'claimed';

  IF NOT FOUND THEN
    -- A stale worker (its lease expired and another took the row) records
    -- nothing: the row's current state is someone else's to write.
    RETURN QUERY SELECT 'stale_claim'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  RETURN QUERY
  WITH written AS (
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = v_status,
      expo_ticket_id = CASE WHEN p_outcome = 'ticket_accepted' THEN p_expo_ticket_id ELSE delivery.expo_ticket_id END,
      error = CASE WHEN p_outcome = 'ticket_accepted' THEN NULL ELSE left(coalesce(p_error, p_outcome), 500) END,
      sent_at = NULL,
      claim_id = NULL,
      claim_expires_at = NULL,
      next_attempt_at = CASE WHEN p_outcome = 'retryable' THEN delivery.next_attempt_at ELSE NULL END,
      updated_at = now()
    WHERE delivery.id = p_delivery_id
      AND delivery.claim_id = p_claim_id
      AND delivery.status = 'claimed'
    -- After the retry trigger: a third failure comes back terminal, with no slot.
    RETURNING delivery.status AS final_status, delivery.next_attempt_at AS final_next
  )
  SELECT written.final_status, written.final_next
  FROM written;

  IF p_outcome = 'token_invalid' THEN
    UPDATE public.push_tokens AS device
    SET enabled = false, updated_at = now()
    WHERE device.id = v_token_id;
  END IF;
END;
$record$;

-- ---------------------------------------------------------------------------
-- 11. The Node fallback's two claims, with the same schedule and the same cap
-- ---------------------------------------------------------------------------
-- Same names, arguments and response shapes as before, so the sender on `main`
-- keeps working — and from now on is bound by the attempt cap, the retry slots
-- and the due time too, whatever it asks for.

CREATE OR REPLACE FUNCTION public.claim_push_notification_deliveries(
  p_rows JSONB,
  p_claim_id TEXT,
  p_claim_ttl_seconds INTEGER DEFAULT 900
)
RETURNS TABLE(push_token_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $claim$
#variable_conflict use_column
-- `push_token_id` is an output column and also a table column; the column is
-- always meant. Every other identifier is p_-/v_-prefixed (see 20260906080000).
DECLARE
  v_now TIMESTAMPTZ := now();
  v_ttl_seconds INTEGER := least(greatest(coalesce(p_claim_ttl_seconds, 900), 60), 840);
BEGIN
  IF p_claim_id IS NULL OR length(trim(p_claim_id)) = 0 THEN
    RAISE EXCEPTION 'claim id is required' USING ERRCODE = '22023';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN;
  END IF;

  PERFORM public.finalize_push_deliveries(v_now);

  INSERT INTO public.push_notification_deliveries (
    push_token_id,
    user_id,
    drop_date,
    notification_kind,
    status,
    target_at,
    scheduled_for,
    reader_timezone,
    edition_ready_at
  )
  SELECT
    candidate.push_token_id,
    candidate.user_id,
    candidate.drop_date,
    coalesce(candidate.notification_kind, 'edition_ready'),
    'pending',
    CASE WHEN coalesce(candidate.notification_kind, 'edition_ready') = 'edition_ready'
      THEN public.edition_ready_target_at(candidate.drop_date, zone.name)
      ELSE v_now END,
    -- The Node sender only asks for readers its gate (get_edition_ready_schedule)
    -- found due, so a missing due time means "now". Team notifications are
    -- immediate: scheduled now, never held for a time.
    CASE WHEN coalesce(candidate.notification_kind, 'edition_ready') = 'edition_ready'
      THEN coalesce(
        public.edition_ready_due_at(
          candidate.drop_date, zone.name, public.edition_notification_released_at(candidate.drop_date)
        ),
        v_now
      )
      ELSE v_now END,
    zone.name,
    CASE WHEN coalesce(candidate.notification_kind, 'edition_ready') = 'edition_ready'
      THEN public.edition_notification_released_at(candidate.drop_date)
      ELSE NULL END
  FROM jsonb_to_recordset(p_rows) AS candidate(
    push_token_id UUID,
    user_id UUID,
    drop_date DATE,
    notification_kind TEXT
  )
  LEFT JOIN public.profiles AS profile ON profile.id = candidate.user_id
  CROSS JOIN LATERAL (
    SELECT public.reader_notification_timezone(profile.timezone) AS name
  ) AS zone
  WHERE candidate.push_token_id IS NOT NULL
    AND candidate.user_id IS NOT NULL
    AND candidate.drop_date IS NOT NULL
  ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique DO NOTHING;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT
      candidate.push_token_id AS token_id,
      candidate.drop_date AS day,
      coalesce(candidate.notification_kind, 'edition_ready') AS kind
    FROM jsonb_to_recordset(p_rows) AS candidate(
      push_token_id UUID,
      user_id UUID,
      drop_date DATE,
      notification_kind TEXT
    )
    WHERE candidate.push_token_id IS NOT NULL
      AND candidate.drop_date IS NOT NULL
  ),
  leased AS (
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = 'claimed',
      claim_id = p_claim_id,
      claimed_at = v_now,
      claim_expires_at = v_now + make_interval(secs => v_ttl_seconds),
      attempt_count = delivery.attempt_count + 1,
      first_attempt_at = coalesce(delivery.first_attempt_at, v_now),
      last_attempt_at = v_now,
      next_attempt_at = CASE
        WHEN delivery.attempt_count + 1 < public.push_max_attempts()
          THEN coalesce(delivery.scheduled_for, delivery.created_at)
               + public.push_retry_step() * (delivery.attempt_count + 1)
        ELSE NULL
      END,
      error = NULL,
      updated_at = v_now
    FROM requested
    WHERE delivery.push_token_id = requested.token_id
      AND delivery.drop_date = requested.day
      AND delivery.notification_kind = requested.kind
      -- Whether an edition is ready is the Node gate's question on this path
      -- (get_edition_ready_schedule is NULL, never due, until verification);
      -- the Edge claim asks it again in SQL. What this adds is WHEN: never
      -- before the row's due time or retry slot, never a fourth attempt.
      AND public.push_delivery_attempt_due(
        delivery.status, delivery.attempt_count, delivery.next_attempt_at,
        delivery.scheduled_for, delivery.created_at, delivery.claim_expires_at, v_now
      )
    RETURNING delivery.push_token_id AS token_id
  )
  SELECT leased.token_id
  FROM leased;
END;
$claim$;

COMMENT ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) IS
  'Node fallback claim. Inserts rows with their schedule, then leases only rows whose attempt is due (scheduled time or retry slot reached, attempts left, inside the window). Leasing counts the attempt. Response shape unchanged: push_token_id per leased row.';

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
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_ttl_seconds INTEGER := least(greatest(coalesce(p_claim_ttl_seconds, 900), 60), 840);
  v_limit INTEGER := least(greatest(coalesce(p_limit, 500), 1), 1000);
BEGIN
  IF p_claim_id IS NULL OR length(trim(p_claim_id)) = 0 THEN
    RAISE EXCEPTION 'claim id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM public.prepare_edition_answer_reminders(v_now);
  PERFORM public.finalize_push_deliveries(v_now);

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
      AND public.push_delivery_attempt_due(
        delivery.status, delivery.attempt_count, delivery.next_attempt_at,
        delivery.scheduled_for, delivery.created_at, delivery.claim_expires_at, v_now
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
      attempt_count = delivery.attempt_count + 1,
      first_attempt_at = coalesce(delivery.first_attempt_at, v_now),
      last_attempt_at = v_now,
      next_attempt_at = CASE
        WHEN delivery.attempt_count + 1 < public.push_max_attempts()
          THEN coalesce(delivery.scheduled_for, delivery.created_at)
               + public.push_retry_step() * (delivery.attempt_count + 1)
        ELSE NULL
      END,
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

-- ---------------------------------------------------------------------------
-- 12. The probe, on the same window
-- ---------------------------------------------------------------------------
-- Same signature. The only change is the window: three hours, like every claim.

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
      AND p_now < schedule.due + INTERVAL '3 hours'
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

-- Everything a worker would do right now: readers not yet written, plus rows
-- whose attempt (initial or retry) is due.
CREATE OR REPLACE FUNCTION public.count_claimable_push_work(p_now TIMESTAMPTZ DEFAULT now())
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $work$
  SELECT
    coalesce((SELECT due.edition_ready_due + due.answer_reminders_due
              FROM public.count_due_edition_notifications(p_now) AS due), 0)
    + (
      SELECT count(*)
      FROM public.push_notification_deliveries AS delivery
      JOIN public.push_tokens AS device
        ON device.id = delivery.push_token_id
       AND device.enabled
      WHERE delivery.notification_kind IN ('edition_ready', 'edition_answer_reminder')
        AND public.push_delivery_attempt_due(
          delivery.status, delivery.attempt_count, delivery.next_attempt_at,
          delivery.scheduled_for, delivery.created_at, delivery.claim_expires_at, p_now
        )
    );
$work$;

-- ---------------------------------------------------------------------------
-- 13. The clock: pg_cron, every minute, wakes the Edge Function when due
-- ---------------------------------------------------------------------------
-- Fail-soft exactly like the GitHub dispatcher: without its two Vault secrets
-- it reports `not_configured` and the GitHub fallback keeps sending. A minute
-- with nothing due costs two indexed reads and no request.
--
-- SECRETS THIS EXPECTS (production Vault, never in the repository):
--   personews_push_worker_url    https://wkbviidrbmehmjbhvpeh.supabase.co/functions/v1/personews-push-notifications
--   personews_push_worker_token  the same value as the function's PERSONEWS_PUSH_WORKER_TOKEN secret

CREATE OR REPLACE FUNCTION public.invoke_push_worker()
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $invoke$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_work BIGINT := 0;
  v_url TEXT;
  v_token TEXT;
  v_request_id BIGINT;
BEGIN
  BEGIN
    PERFORM public.finalize_push_deliveries(v_now);
    v_work := public.count_claimable_push_work(v_now);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'push worker probe failed: %', SQLERRM;
      RETURN jsonb_build_object('fired', false, 'reason', 'probe_failed');
  END;

  IF coalesce(v_work, 0) = 0 THEN
    RETURN jsonb_build_object('fired', false, 'reason', 'no_due_work');
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'personews_push_worker_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'personews_push_worker_token'
  LIMIT 1;

  IF v_url IS NULL OR v_token IS NULL THEN
    RETURN jsonb_build_object('fired', false, 'reason', 'not_configured', 'due', v_work);
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object('reason', 'due_work', 'due', v_work),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || v_token
    ),
    timeout_milliseconds := 55000
  ) INTO v_request_id;

  INSERT INTO public.notification_dispatch_state AS state (
    dispatch_key, last_dispatched_at, last_payload, updated_at
  )
  VALUES ('push_worker', v_now, jsonb_build_object('due', v_work), v_now)
  ON CONFLICT (dispatch_key) DO UPDATE
  SET last_dispatched_at = excluded.last_dispatched_at,
      last_payload = excluded.last_payload,
      updated_at = excluded.updated_at;

  RETURN jsonb_build_object('fired', true, 'due', v_work);
END;
$invoke$;

COMMENT ON FUNCTION public.invoke_push_worker() IS
  'Every minute from pg_cron: wakes the personews-push-notifications Edge Function when a notification or a retry is due, and does nothing otherwise. Inert until its two Vault secrets exist.';

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'personews-push-worker';

SELECT cron.schedule(
  'personews-push-worker',
  '* * * * *',
  $cron$select public.invoke_push_worker();$cron$
);

-- ---------------------------------------------------------------------------
-- 14. Observability: what happened, for one edition, without a single token
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_push_delivery_timeline(p_drop_date DATE)
RETURNS TABLE(
  timeline_reader TEXT,
  timeline_device TEXT,
  timeline_kind TEXT,
  timeline_timezone TEXT,
  timeline_target_local TEXT,
  timeline_target_utc TIMESTAMPTZ,
  timeline_edition_ready_at TIMESTAMPTZ,
  timeline_blocked_until_ready BOOLEAN,
  timeline_scheduled_for TIMESTAMPTZ,
  timeline_first_attempt_at TIMESTAMPTZ,
  timeline_last_attempt_at TIMESTAMPTZ,
  timeline_attempts INTEGER,
  timeline_next_attempt_at TIMESTAMPTZ,
  timeline_status TEXT,
  timeline_sent_at TIMESTAMPTZ,
  timeline_error TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $timeline$
  SELECT
    left(md5(delivery.user_id::TEXT), 8),
    left(delivery.push_token_id::TEXT, 8),
    delivery.notification_kind,
    delivery.reader_timezone,
    CASE WHEN delivery.target_at IS NULL THEN NULL
      ELSE to_char(
        delivery.target_at AT TIME ZONE public.reader_notification_timezone(delivery.reader_timezone),
        'YYYY-MM-DD HH24:MI'
      )
    END,
    delivery.target_at,
    delivery.edition_ready_at,
    coalesce(delivery.edition_ready_at > delivery.target_at, false),
    delivery.scheduled_for,
    delivery.first_attempt_at,
    delivery.last_attempt_at,
    delivery.attempt_count,
    delivery.next_attempt_at,
    delivery.status,
    delivery.sent_at,
    left(delivery.error, 200)
  FROM public.push_notification_deliveries AS delivery
  WHERE delivery.drop_date = p_drop_date
  ORDER BY delivery.notification_kind, delivery.scheduled_for NULLS LAST, delivery.created_at;
$timeline$;

COMMENT ON FUNCTION public.get_push_delivery_timeline(DATE) IS
  'For one edition: target (local and UTC), reader zone, edition ready time, whether the send was blocked until ready, attempts and their times, next retry and result. Reader and device are truncated hashes; no token is ever returned.';

-- ---------------------------------------------------------------------------
-- 15. Privileges
-- ---------------------------------------------------------------------------

DO $grants$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.push_max_attempts()',
    'public.push_retry_step()',
    'public.edition_ready_target_at(DATE, TEXT)',
    'public.edition_ready_due_at(DATE, TEXT, TIMESTAMPTZ)',
    'public.edition_answer_reminder_target_at(DATE, TEXT)',
    'public.push_delivery_attempt_due(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ)',
    'public.schedule_push_delivery_retry()',
    'public.finalize_push_deliveries(TIMESTAMPTZ)',
    'public.prepare_edition_ready_deliveries(TIMESTAMPTZ)',
    'public.prepare_edition_answer_reminders(TIMESTAMPTZ)',
    'public.claim_due_push_notifications(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)',
    'public.record_push_delivery_attempt(UUID, TEXT, TEXT, TEXT, TEXT)',
    'public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER)',
    'public.claim_edition_answer_reminders(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)',
    'public.count_due_edition_notifications(TIMESTAMPTZ)',
    'public.count_claimable_push_work(TIMESTAMPTZ)',
    'public.get_push_delivery_timeline(DATE)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;

  REVOKE ALL ON FUNCTION public.invoke_push_worker() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.invoke_push_worker() FROM anon;
  REVOKE ALL ON FUNCTION public.invoke_push_worker() FROM authenticated;
  GRANT EXECUTE ON FUNCTION public.invoke_push_worker() TO postgres, service_role;
END;
$grants$;

COMMIT;

NOTIFY pgrst, 'reload schema';
