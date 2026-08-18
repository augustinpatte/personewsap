-- Harden edition notification delivery.
--
-- Adds a genuine claim lease before Expo send and tracks receipt reconciliation
-- separately from ticket acceptance. This is additive and keeps the original
-- device/date/kind idempotency key intact.

ALTER TABLE public.push_notification_deliveries
  ADD COLUMN IF NOT EXISTS claim_id TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expo_receipt_checked_at TIMESTAMPTZ;

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
      'failed'
    )
  );

CREATE INDEX IF NOT EXISTS idx_push_notification_deliveries_awaiting_receipt
  ON public.push_notification_deliveries(last_attempt_at, expo_ticket_id)
  WHERE status IN ('ticket_accepted', 'awaiting_receipt') AND expo_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_notification_deliveries_claim_expiry
  ON public.push_notification_deliveries(claim_expires_at)
  WHERE status IN ('claimed', 'sending');

CREATE OR REPLACE FUNCTION public.claim_push_notification_deliveries(
  p_rows JSONB,
  p_claim_id TEXT,
  p_claim_ttl_seconds INTEGER DEFAULT 900
)
RETURNS TABLE(push_token_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_ttl_seconds INTEGER := greatest(coalesce(p_claim_ttl_seconds, 900), 60);
BEGIN
  IF p_claim_id IS NULL OR length(trim(p_claim_id)) = 0 THEN
    RAISE EXCEPTION 'claim id is required';
  END IF;

  INSERT INTO public.push_notification_deliveries (
    push_token_id,
    user_id,
    drop_date,
    notification_kind,
    status
  )
  SELECT
    row.push_token_id,
    row.user_id,
    row.drop_date,
    row.notification_kind,
    'pending'
  FROM jsonb_to_recordset(p_rows) AS row(
    push_token_id UUID,
    user_id UUID,
    drop_date DATE,
    notification_kind TEXT
  )
  ON CONFLICT (push_token_id, drop_date, notification_kind) DO NOTHING;

  RETURN QUERY
  WITH requested AS (
    SELECT
      row.push_token_id,
      row.drop_date,
      row.notification_kind
    FROM jsonb_to_recordset(p_rows) AS row(
      push_token_id UUID,
      user_id UUID,
      drop_date DATE,
      notification_kind TEXT
    )
  ),
  claimed AS (
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = 'claimed',
      claim_id = p_claim_id,
      claimed_at = v_now,
      claim_expires_at = v_now + make_interval(secs => v_ttl_seconds),
      error = NULL,
      updated_at = v_now
    FROM requested
    WHERE delivery.push_token_id = requested.push_token_id
      AND delivery.drop_date = requested.drop_date
      AND delivery.notification_kind = requested.notification_kind
      AND (
        delivery.status IN ('pending', 'retryable_failure')
        OR (
          delivery.status IN ('claimed', 'sending')
          AND (
            delivery.claim_expires_at IS NULL
            OR delivery.claim_expires_at <= v_now
          )
        )
      )
    RETURNING delivery.push_token_id
  )
  SELECT claimed.push_token_id
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) IS
  'Atomically leases edition notification delivery rows. Only returned token ids may be sent to Expo; expired claims become retryable.';

COMMENT ON COLUMN public.push_notification_deliveries.status IS
  'pending/retryable_failure: can be claimed. claimed/sending: leased. awaiting_receipt: Expo ticket accepted, final receipt pending. sent/terminal_failure/failed: final.';
