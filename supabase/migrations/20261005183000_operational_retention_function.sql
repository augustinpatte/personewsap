-- Operational retention: a function, not a schedule — PRODUCTION.
--
-- Two operational tables grow without bound and are only ever read while
-- fresh: push_notification_deliveries (one row per device per notification)
-- and job_runs (the legacy daily job's run log). This adds the means to trim
-- them. It does NOT schedule anything: there is no retention policy yet, and a
-- destructive job deserves a decision, not a default. Until someone runs it (or
-- schedules it), nothing is deleted.
--
-- purge_operational_history(p_keep_days, p_dry_run):
--   - p_dry_run defaults to TRUE: it reports what it WOULD delete.
--   - p_keep_days is floored at 90, whatever is passed.
--   - push_notification_deliveries: only rows in a final state ('sent',
--     'terminal_failure', 'failed') untouched for p_keep_days. A row still
--     pending, claimed, retrying or awaiting its receipt is never touched; an
--     old edition date is never re-prepared, so a deleted row cannot resend.
--   - job_runs: only finished runs ('completed', 'partial_failed', 'failed')
--     completed more than p_keep_days ago. A running row is never touched.
--
-- NEVER touched, by design: daily_drops, daily_drop_items, editions, content and
-- its sources, generation_runs (content_items.generation_run_id points at them:
-- provenance), question attempts and scores, interactions, mini-case responses,
-- notification_outbox (one row per edition, and the release instant of that
-- edition), Teams. pending_registrations already has
-- cleanup_expired_pending_registrations().
--
-- Service role only. Forward-only, additive.

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_operational_history(
  p_keep_days INTEGER DEFAULT 180,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $purge$
DECLARE
  v_keep_days INTEGER := greatest(coalesce(p_keep_days, 180), 90);
  v_cutoff TIMESTAMPTZ := now() - make_interval(days => greatest(coalesce(p_keep_days, 180), 90));
  v_deliveries BIGINT;
  v_job_runs BIGINT;
BEGIN
  IF coalesce(p_dry_run, TRUE) THEN
    SELECT count(*) INTO v_deliveries
    FROM public.push_notification_deliveries AS delivery
    WHERE delivery.status IN ('sent', 'terminal_failure', 'failed')
      AND delivery.updated_at < v_cutoff;

    SELECT count(*) INTO v_job_runs
    FROM public.job_runs AS run
    WHERE run.status IN ('completed', 'partial_failed', 'failed')
      AND run.completed_at < v_cutoff;
  ELSE
    WITH removed AS (
      DELETE FROM public.push_notification_deliveries AS delivery
      WHERE delivery.status IN ('sent', 'terminal_failure', 'failed')
        AND delivery.updated_at < v_cutoff
      RETURNING 1
    )
    SELECT count(*) INTO v_deliveries FROM removed;

    WITH removed AS (
      DELETE FROM public.job_runs AS run
      WHERE run.status IN ('completed', 'partial_failed', 'failed')
        AND run.completed_at < v_cutoff
      RETURNING 1
    )
    SELECT count(*) INTO v_job_runs FROM removed;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', coalesce(p_dry_run, TRUE),
    'keep_days', v_keep_days,
    'cutoff', v_cutoff,
    'push_notification_deliveries', v_deliveries,
    'job_runs', v_job_runs
  );
END;
$purge$;

COMMENT ON FUNCTION public.purge_operational_history(INTEGER, BOOLEAN) IS
  'Trims finished push deliveries and finished legacy job runs older than p_keep_days (floor 90). Dry run by default. Not scheduled: run it deliberately. Never touches editions, drops, content, attempts, interactions or the outbox.';

REVOKE ALL ON FUNCTION public.purge_operational_history(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_operational_history(INTEGER, BOOLEAN) TO service_role;

COMMIT;
