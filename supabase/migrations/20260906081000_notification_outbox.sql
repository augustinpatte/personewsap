-- Notifications become event-driven.
--
-- WHAT WAS WRONG WITH THE CLOCK
--
-- Until now the only thing that caused a notification to be attempted was a
-- GitHub Actions cron at 19:10 Europe/Paris, ten minutes after the publisher.
-- That is a guess dressed as a schedule. It is wrong in both directions:
--
--   * publication is slow tonight, the cron finds no edition, and the readers
--     are told nothing at all — the workflow is green, because finding nothing
--     to announce is a legitimate outcome and indistinguishable from this one;
--   * publication never happened, the cron runs anyway, and the only reason
--     nobody is told about a missing edition is that the sender re-derives the
--     eligibility rules and finds no published drop.
--
-- Neither is a failure anyone would see. This table replaces the guess with the
-- fact: an edition being published writes an event, in the same transaction
-- that publishes it, and the sender's work comes from the event.
--
-- WHY AN OUTBOX AND NOT A DIRECT CALL
--
-- The publisher cannot call Expo. It runs inside `publish_scheduled_staging_payload`,
-- one transaction that writes the whole edition, and an HTTP call from inside
-- that transaction would either block the commit or — worse — succeed for a
-- transaction that then rolls back, telling every reader about an edition that
-- does not exist. Writing a row in the same transaction has neither problem:
-- the event exists if and only if the edition exists, which is the entire point
-- of an outbox.
--
-- PUBLICATION NEVER FAILS BECAUSE OF THIS
--
-- The trigger body is wrapped in an exception block. If the outbox is missing,
-- full, locked, or broken in some way nobody predicted, the edition still
-- publishes and the fallback schedules still send the notifications. A
-- notification is worth a great deal and it is worth strictly less than the
-- edition it announces.
--
-- PUBLICATION IS NOT THE SAME BOUNDARY AS VERIFICATION
--
-- `publish_scheduled_staging_payload` committing means production holds the
-- edition. It does not yet mean the edition is *correct*: the scheduled
-- publisher calls `verify_scheduled_edition` afterwards, from staging, in a
-- separate request, and only a passing verification produces a receipt. An
-- edition that publishes and then fails verification is a real outcome — that is
-- why the verify step exists — and readers must not have been told about it.
--
-- So the trigger does not create a dispatchable event. It creates the durable
-- record in the publishing transaction, where it belongs, in a state nothing
-- will act on: `awaiting_verification`. `release_verified_edition_notifications`
-- moves it to `pending`, and that call is the verification success boundary.
--
--   edition written, not yet verified   → awaiting_verification → nobody woken
--   edition written and verified        → pending               → dispatchable
--
-- Nothing in either step can fail the publication: the enqueue is wrapped, and
-- the release happens after production has already committed and been read back.
--
-- Strictly additive: one new table, its trigger on an existing table's write
-- path, and three service-role functions. No existing column, constraint, policy
-- or row is modified.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  -- The day the event is about. For 'edition_published' this is the edition
  -- date, which is what the sender needs to find the drops.
  event_date DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Not 'pending'. A row is born unverified, and only the verification success
  -- boundary makes it dispatchable. Defaulting the other way would mean any
  -- future insert that forgets to say so announces an unverified edition.
  status TEXT NOT NULL DEFAULT 'awaiting_verification',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT,
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  -- When production verification succeeded for this edition. NULL means the
  -- edition has been written but not yet read back and found complete.
  verified_at TIMESTAMPTZ,
  -- When a dispatcher last woke a worker for this event. Bounds how often the
  -- same event can be re-announced to the outside world; it says nothing about
  -- whether the work was done, which is what `status` is for.
  dispatched_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_event_type_check
    CHECK (event_type IN ('edition_published')),
  CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('awaiting_verification', 'pending', 'claimed', 'processed', 'failed')),
  CONSTRAINT notification_outbox_attempts_check
    CHECK (attempt_count >= 0),
  CONSTRAINT notification_outbox_processed_check
    CHECK (status <> 'processed' OR processed_at IS NOT NULL)
);

-- One event per thing that happened. An edition published in one transaction
-- that writes nine readers' drops is one event, not nine, and a republication
-- of the same edition date is not a second announcement.
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_identity_unique
  ON public.notification_outbox (event_type, event_date);

DO $promote$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.notification_outbox'::regclass
      AND conname = 'notification_outbox_identity_unique'
  ) THEN
    ALTER TABLE public.notification_outbox
      ADD CONSTRAINT notification_outbox_identity_unique
      UNIQUE USING INDEX notification_outbox_identity_unique;
  END IF;
END;
$promote$;

CREATE INDEX IF NOT EXISTS idx_notification_outbox_claimable
  ON public.notification_outbox (created_at)
  WHERE status IN ('pending', 'claimed');

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- No policy, deliberately, exactly as push_notification_deliveries: this is
-- operational data written by triggers and read by the service role, and no
-- client key may see a single row of it.

DROP TRIGGER IF EXISTS set_notification_outbox_updated_at ON public.notification_outbox;
CREATE TRIGGER set_notification_outbox_updated_at
BEFORE UPDATE ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION public.set_push_notification_updated_at();

COMMENT ON TABLE public.notification_outbox IS
  'Durable record that something happened which readers should be told about. Written in the publishing transaction, so an event exists if and only if the edition does.';

-- ---------------------------------------------------------------------------
-- 2. The edition-written boundary
-- ---------------------------------------------------------------------------
-- `daily_drops.status = 'published'` is where the DURABLE RECORD is created, and
-- it is the right place for that: it is the last thing
-- `publish_scheduled_staging_payload` writes, it is what the sender itself reads
-- to decide who is eligible, and it is what the reader's app reads to show an
-- edition. Anything earlier would record an edition that can still roll back.
--
-- It is NOT where the notification becomes dispatchable. The row is written
-- `awaiting_verification`, and section 3 is the only thing that releases it.
--
-- A STATEMENT trigger with a transition table, not a row trigger: the publisher
-- writes one statement per reader, and a row trigger would do this work once per
-- reader per edition for no gain. PostgreSQL does not allow one transition-table
-- trigger to cover several events, so INSERT and UPDATE get one each — both are
-- needed, because the publisher's `INSERT … ON CONFLICT DO UPDATE` writes new
-- readers through the first and returning readers through the second.

CREATE OR REPLACE FUNCTION public.enqueue_published_edition_notification_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $enqueue$
BEGIN
  BEGIN
    INSERT INTO public.notification_outbox (event_type, event_date, status, payload)
    SELECT
      'edition_published',
      published.drop_date,
      -- Durable, and deliberately not dispatchable. The edition exists; whether
      -- it is complete is a question only verification answers.
      'awaiting_verification',
      jsonb_build_object(
        'edition_date', to_char(published.drop_date, 'YYYY-MM-DD'),
        'source', TG_TABLE_NAME || '.' || lower(TG_OP)
      )
    FROM (
      SELECT DISTINCT changed.drop_date
      FROM new_rows AS changed
      WHERE changed.status = 'published'
    ) AS published
    ON CONFLICT ON CONSTRAINT notification_outbox_identity_unique DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      -- THE EDITION OUTRANKS THE ANNOUNCEMENT. Whatever went wrong here, the
      -- publishing transaction commits. The GitHub Actions fallback schedules
      -- exist for exactly this case and will send the notifications late rather
      -- than never.
      RAISE WARNING 'notification outbox enqueue failed, edition still published: %', SQLERRM;
  END;

  RETURN NULL;
END;
$enqueue$;

REVOKE ALL ON FUNCTION public.enqueue_published_edition_notification_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_published_edition_notification_events() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_published_edition_notification_events() FROM authenticated;

DROP TRIGGER IF EXISTS trg_daily_drops_enqueue_notification_insert ON public.daily_drops;
CREATE TRIGGER trg_daily_drops_enqueue_notification_insert
AFTER INSERT ON public.daily_drops
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.enqueue_published_edition_notification_events();

DROP TRIGGER IF EXISTS trg_daily_drops_enqueue_notification_update ON public.daily_drops;
CREATE TRIGGER trg_daily_drops_enqueue_notification_update
AFTER UPDATE ON public.daily_drops
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.enqueue_published_edition_notification_events();

-- ---------------------------------------------------------------------------
-- 3. The verification success boundary
-- ---------------------------------------------------------------------------
-- Called by `personews-task-publisher` after `verify_scheduled_edition` has read
-- production back and answered ok. That is the exact moment the product means by
-- "the edition succeeded", and it is the moment — not one earlier — at which
-- readers may be told.
--
-- It is a promotion, not an insert: the event already exists, written by the
-- publishing transaction. If verification never passes, the row simply stays
-- `awaiting_verification` and no dispatcher, no claim and no sender will ever
-- look at it.
--
-- Releasing twice is a no-op. Only `awaiting_verification` moves, so a second
-- verification of the same edition cannot resurrect an event that has already
-- been processed, nor reset one a worker currently holds.

CREATE OR REPLACE FUNCTION public.release_verified_edition_notifications(
  p_edition_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $release$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_released INTEGER := 0;
BEGIN
  IF p_edition_date IS NULL THEN
    RAISE EXCEPTION 'edition date is required' USING ERRCODE = '22023';
  END IF;

  WITH promoted AS (
    UPDATE public.notification_outbox AS outbox
    SET
      status = 'pending',
      verified_at = v_now,
      updated_at = v_now
    WHERE outbox.event_type = 'edition_published'
      AND outbox.event_date = p_edition_date
      AND outbox.status = 'awaiting_verification'
    RETURNING outbox.id
  )
  SELECT count(*)::INTEGER INTO v_released FROM promoted;

  RETURN jsonb_build_object(
    'edition_date', to_char(p_edition_date, 'YYYY-MM-DD'),
    'released', v_released,
    -- What the row looks like now, so a caller that released nothing can tell
    -- "already released" from "no event was ever written".
    'status', coalesce(
      (SELECT outbox.status FROM public.notification_outbox AS outbox
       WHERE outbox.event_type = 'edition_published' AND outbox.event_date = p_edition_date),
      'no_event')
  );
END;
$release$;

REVOKE ALL ON FUNCTION public.release_verified_edition_notifications(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_verified_edition_notifications(DATE) FROM anon;
REVOKE ALL ON FUNCTION public.release_verified_edition_notifications(DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_verified_edition_notifications(DATE) TO service_role;

COMMENT ON FUNCTION public.release_verified_edition_notifications(DATE) IS
  'The verification success boundary. Promotes an edition_published event from awaiting_verification to pending, which is the first moment anything may wake a sender for it.';

-- ---------------------------------------------------------------------------
-- 4. Draining the outbox
-- ---------------------------------------------------------------------------
-- Same leasing discipline as the delivery claim, and for the same reason: two
-- senders may run at once — the event-driven one and a fallback schedule — and
-- both must be able to run without either announcing an edition twice. The
-- delivery table is still the exactly-once guarantee; this lease is what keeps
-- them from doing redundant work and racing on the same event row.

CREATE OR REPLACE FUNCTION public.claim_notification_events(
  p_claim_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_claim_ttl_seconds INTEGER DEFAULT 900
)
RETURNS TABLE(
  claimed_event_id UUID,
  claimed_event_type TEXT,
  claimed_event_date DATE,
  claimed_attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $claim_events$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_ttl_seconds INTEGER := greatest(coalesce(p_claim_ttl_seconds, 900), 60);
  v_limit INTEGER := least(greatest(coalesce(p_limit, 10), 1), 100);
BEGIN
  IF p_claim_id IS NULL OR length(trim(p_claim_id)) = 0 THEN
    RAISE EXCEPTION 'claim id is required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT outbox.id
    FROM public.notification_outbox AS outbox
    WHERE outbox.status = 'pending'
       OR (
         outbox.status = 'claimed'
         AND (outbox.claim_expires_at IS NULL OR outbox.claim_expires_at <= v_now)
       )
    ORDER BY outbox.created_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  leased AS (
    UPDATE public.notification_outbox AS outbox
    SET
      status = 'claimed',
      claim_id = p_claim_id,
      claimed_at = v_now,
      claim_expires_at = v_now + make_interval(secs => v_ttl_seconds),
      attempt_count = outbox.attempt_count + 1,
      updated_at = v_now
    FROM claimable
    WHERE outbox.id = claimable.id
    RETURNING outbox.id AS event_id,
              outbox.event_type AS type,
              outbox.event_date AS day,
              outbox.attempt_count AS attempts
  )
  SELECT leased.event_id, leased.type, leased.day, leased.attempts
  FROM leased;
END;
$claim_events$;

REVOKE ALL ON FUNCTION public.claim_notification_events(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_notification_events(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_notification_events(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_events(TEXT, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_notification_event(
  p_event_id UUID,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $complete$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  -- A failed event goes back to 'pending' rather than to 'failed' while it is
  -- still worth retrying. It is only given up on after enough attempts that the
  -- cause is clearly not transient, and even then the delivery table remains the
  -- record of what each device was actually told.
  UPDATE public.notification_outbox AS outbox
  SET
    status = CASE
      WHEN p_succeeded THEN 'processed'
      WHEN outbox.attempt_count >= 10 THEN 'failed'
      ELSE 'pending'
    END,
    processed_at = CASE WHEN p_succeeded THEN v_now ELSE outbox.processed_at END,
    last_error = CASE WHEN p_succeeded THEN NULL ELSE left(coalesce(p_error, 'unknown error'), 500) END,
    claim_id = NULL,
    claim_expires_at = NULL,
    updated_at = v_now
  WHERE outbox.id = p_event_id;
END;
$complete$;

REVOKE ALL ON FUNCTION public.complete_notification_event(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_event(UUID, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_notification_event(UUID, BOOLEAN, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_event(UUID, BOOLEAN, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. What operations looks at
-- ---------------------------------------------------------------------------
-- One question, one answer: for a given edition, how many devices were told, how
-- many are still waiting on a receipt, how many failed and how many were never
-- attempted at all. That last number is the one that was silently 9 out of 9 for
-- every edition this product has ever published.

CREATE OR REPLACE FUNCTION public.get_edition_notification_health(
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
  outbox_status TEXT
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
  eligible AS (
    SELECT count(DISTINCT token.id) AS devices
    FROM target
    JOIN public.daily_drops AS edition_drop
      ON edition_drop.drop_date = target.day AND edition_drop.status = 'published'
    JOIN public.user_preferences AS preference
      ON preference.user_id = edition_drop.user_id AND preference.notifications_enabled
    JOIN public.push_tokens AS token
      ON token.user_id = edition_drop.user_id AND token.enabled
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
    eligible.devices,
    delivered.total,
    delivered.sent,
    delivered.awaiting,
    delivered.retryable,
    delivered.terminal,
    greatest(eligible.devices - delivered.total, 0),
    coalesce(
      (SELECT outbox.status FROM public.notification_outbox AS outbox
       WHERE outbox.event_type = 'edition_published' AND outbox.event_date = target.day),
      'no_event'
    )
  FROM target, eligible, delivered;
$health$;

REVOKE ALL ON FUNCTION public.get_edition_notification_health(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_edition_notification_health(DATE) FROM anon;
REVOKE ALL ON FUNCTION public.get_edition_notification_health(DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_edition_notification_health(DATE) TO service_role;

COMMENT ON FUNCTION public.get_edition_notification_health(DATE) IS
  'Notification health for one edition. never_attempted > 0 means devices that should have been told were not: the symptom the claim bug produced silently for months.';

COMMIT;

NOTIFY pgrst, 'reload schema';
