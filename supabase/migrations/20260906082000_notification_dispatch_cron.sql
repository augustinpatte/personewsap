-- The clock stops being the trigger — PRODUCTION project (wkbviidrbmehmjbhvpeh).
--
-- 20260906081000 makes an edition being published write a durable event. This
-- file is what turns that event into work being started, so that the thing which
-- causes readers to be notified is the publication itself and not a cron
-- expression somebody guessed ten minutes ahead of it.
--
-- WHY THIS SHAPE
--
-- The sender is a Node service (services/content-engine). It cannot run inside
-- Postgres, and reimplementing it in an Edge Function would give this product
-- two senders with two sets of eligibility rules, two idempotency stories and
-- one of them quietly drifting. So the database does not send: it wakes the one
-- sender that exists, through a `repository_dispatch` to GitHub Actions.
--
-- What changes is which part is authoritative. Before: the schedule decided when
-- readers were told, and the database was consulted afterwards. After: the
-- database decides, within a minute or two of the edition existing, and the
-- schedules in .github/workflows are demoted to what they should always have
-- been — a fallback for the case where this path is down.
--
-- FAIL-SOFT BY CONSTRUCTION
--
-- Missing Vault secrets are not an error here. A cron job that raises every two
-- minutes produces a log nobody reads and no notification either; a cron job
-- that reports `not_configured` and does nothing leaves the fallback schedules
-- to do their job. Until the two secrets below exist, this migration is inert.
--
-- SECRETS THIS EXPECTS (create them in the production project's Vault, never in
-- a migration, never in the repository):
--
--   personews_notification_dispatch_url
--     https://api.github.com/repos/<owner>/<repo>/dispatches
--   personews_notification_dispatch_token
--     a fine-grained GitHub token whose only permission is Contents: read and
--     write on this one repository, which is the minimum `repository_dispatch`
--     accepts. Rotate it like any other production credential.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- The dispatcher
-- ---------------------------------------------------------------------------
-- It does not claim the event and does not mark it processed. It only says
-- "there is work" — the worker claims, does the work and completes it. That
-- separation is what makes a duplicate dispatch harmless: two wake-ups produce
-- one claim, and the delivery table would refuse a second announcement even if
-- they did not.

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
  v_url TEXT;
  v_token TEXT;
  v_event RECORD;
  v_request_id BIGINT;
  v_dispatched INTEGER := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.notification_outbox AS outbox
    WHERE outbox.status = 'pending'
      AND (outbox.dispatched_at IS NULL OR outbox.dispatched_at <= v_now - v_interval)
  ) THEN
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
    -- Inert, not broken. The GitHub schedules still send tonight's edition.
    RETURN jsonb_build_object('fired', false, 'reason', 'not_configured');
  END IF;

  -- One dispatcher at a time. Session-level, released when the cron worker's
  -- session ends, exactly as the staging publisher tick does it.
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

  PERFORM pg_advisory_unlock(hashtext('personews_notification_dispatch'));

  RETURN jsonb_build_object('fired', true, 'dispatched', v_dispatched);
END;
$dispatch$;

COMMENT ON FUNCTION public.dispatch_notification_events(INTEGER) IS
  'Wakes the notification sender when an edition has been published. Never sends anything itself, and is inert until its two Vault secrets exist.';

REVOKE ALL ON FUNCTION public.dispatch_notification_events(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_notification_events(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_notification_events(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_notification_events(INTEGER) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------
-- pg_cron speaks UTC. 19:00 Europe/Paris is 17:00 UTC in summer and 18:00 UTC in
-- winter, so the window is 17:00–22:59 UTC: it covers the publication hour under
-- either offset and stays open long enough to pick up an edition that published
-- late. Outside it the dispatcher would be answering `no_pending_events` to
-- nobody.
--
-- Every two minutes inside the window. The first statement is one indexed
-- existence check against a table that holds a handful of rows, so a tick that
-- finds nothing costs nothing.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'personews-notification-dispatch';

SELECT cron.schedule(
  'personews-notification-dispatch',
  '*/2 17-22 * * *',
  $cron$select public.dispatch_notification_events();$cron$
);

COMMIT;
