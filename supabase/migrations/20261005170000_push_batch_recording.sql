-- Batch recording of push attempts — PRODUCTION.
--
-- WHAT WAS SLOW
--
-- The push worker records what Expo said about each delivery through
-- record_push_delivery_attempt: one awaited RPC per delivery. A 100-message
-- Expo chunk is one HTTP call to Expo and then 100 sequential round trips to the
-- database. That, not Expo and not the claim, is the worker's throughput ceiling.
--
-- WHAT THIS ADDS
--
-- record_push_delivery_attempts(p_claim_id, p_results): every result of a chunk
-- in one call, applied with one UPDATE. Each record gets exactly the treatment
-- record_push_delivery_attempt gives it:
--
--   ticket_accepted  -> awaiting_receipt (ticket id kept), never leased again
--   retryable        -> retryable_failure; the retry trigger
--                       (schedule_push_delivery_retry) sets the next slot, or
--                       terminal_failure once the attempt cap is reached
--   permanent        -> terminal_failure
--   token_invalid    -> terminal_failure, and the device is disabled
--
-- WHAT IT CANNOT DO
--
-- Write anything the caller does not hold. A row is written only when it is
-- still 'claimed' under THIS claim id — the same lease test as the single-row
-- function — so a record naming someone else's delivery, an expired lease taken
-- over by another worker, or a delivery already recorded is reported
-- ('stale_claim') and left exactly as it is. A record that is not an object,
-- has no valid uuid or names an unknown outcome is 'invalid_record'; a second
-- record for the same delivery in one batch is 'duplicate_in_batch'. Neither
-- writes. Only a malformed CALL (no claim id, not an array, over 1000 records)
-- raises.
--
-- The single-row record_push_delivery_attempt stays, unchanged, as intentional
-- compatibility: the deployed worker calls it until it is redeployed, and the
-- new worker falls back to it while this migration is not yet applied.
--
-- Leases, the attempt cap, retry timing and delivery identity are untouched.
-- Forward-only, additive.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_push_delivery_attempts(
  p_claim_id TEXT,
  p_results JSONB
)
RETURNS TABLE(
  recorded_delivery_id UUID,
  recorded_status TEXT,
  recorded_next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $record_batch$
#variable_conflict use_column
BEGIN
  IF p_claim_id IS NULL OR length(trim(p_claim_id)) = 0 THEN
    RAISE EXCEPTION 'claim id is required' USING ERRCODE = '22023';
  END IF;

  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' THEN
    RAISE EXCEPTION 'p_results must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_results) > 1000 THEN
    RAISE EXCEPTION 'at most 1000 results per call, got %', jsonb_array_length(p_results)
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH input AS (
    SELECT
      entry.ordinality AS ord,
      CASE
        WHEN jsonb_typeof(entry.value) = 'object'
         AND entry.value->>'delivery_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (entry.value->>'delivery_id')::UUID
      END AS delivery_id,
      CASE WHEN jsonb_typeof(entry.value) = 'object' THEN entry.value->>'outcome' END AS outcome,
      CASE WHEN jsonb_typeof(entry.value) = 'object' THEN nullif(entry.value->>'expo_ticket_id', '') END AS ticket_id,
      CASE WHEN jsonb_typeof(entry.value) = 'object' THEN entry.value->>'error' END AS error_text
    FROM jsonb_array_elements(p_results) WITH ORDINALITY AS entry(value, ordinality)
  ),
  well_formed AS (
    SELECT input.*
    FROM input
    WHERE input.delivery_id IS NOT NULL
      AND input.outcome IN ('ticket_accepted', 'retryable', 'permanent', 'token_invalid')
  ),
  -- One record per delivery: the first one wins, later ones are reported.
  chosen AS (
    SELECT DISTINCT ON (well_formed.delivery_id) well_formed.*
    FROM well_formed
    ORDER BY well_formed.delivery_id, well_formed.ord
  ),
  written AS (
    UPDATE public.push_notification_deliveries AS delivery
    SET
      status = CASE chosen.outcome
        WHEN 'ticket_accepted' THEN 'awaiting_receipt'
        WHEN 'retryable' THEN 'retryable_failure'
        ELSE 'terminal_failure'
      END,
      expo_ticket_id = CASE WHEN chosen.outcome = 'ticket_accepted' THEN chosen.ticket_id ELSE delivery.expo_ticket_id END,
      error = CASE WHEN chosen.outcome = 'ticket_accepted' THEN NULL ELSE left(coalesce(chosen.error_text, chosen.outcome), 500) END,
      sent_at = NULL,
      claim_id = NULL,
      claim_expires_at = NULL,
      next_attempt_at = CASE WHEN chosen.outcome = 'retryable' THEN delivery.next_attempt_at ELSE NULL END,
      updated_at = now()
    FROM chosen
    WHERE delivery.id = chosen.delivery_id
      -- The lease test. Nothing else is ever written.
      AND delivery.claim_id = p_claim_id
      AND delivery.status = 'claimed'
    -- After the retry trigger: a failure at the cap comes back terminal.
    RETURNING
      delivery.id AS written_id,
      delivery.status AS final_status,
      delivery.next_attempt_at AS final_next,
      delivery.push_token_id AS token_id,
      chosen.outcome AS outcome
  ),
  disabled_devices AS (
    UPDATE public.push_tokens AS device
    SET enabled = false, updated_at = now()
    FROM written
    WHERE written.outcome = 'token_invalid'
      AND device.id = written.token_id
    RETURNING device.id
  )
  SELECT
    input.delivery_id,
    CASE
      WHEN input.delivery_id IS NULL
        OR input.outcome IS NULL
        OR input.outcome NOT IN ('ticket_accepted', 'retryable', 'permanent', 'token_invalid')
        THEN 'invalid_record'
      WHEN NOT EXISTS (SELECT 1 FROM chosen WHERE chosen.ord = input.ord)
        THEN 'duplicate_in_batch'
      WHEN written.written_id IS NULL
        THEN 'stale_claim'
      ELSE written.final_status
    END,
    CASE WHEN EXISTS (SELECT 1 FROM chosen WHERE chosen.ord = input.ord) THEN written.final_next END
  FROM input
  LEFT JOIN written ON written.written_id = input.delivery_id
  ORDER BY input.ord;
END;
$record_batch$;

COMMENT ON FUNCTION public.record_push_delivery_attempts(TEXT, JSONB) IS
  'Records the outcomes of one Expo chunk in one call: [{delivery_id, outcome, expo_ticket_id?, error?}]. Same per-row rules as record_push_delivery_attempt; writes only rows still claimed under p_claim_id. Returns one row per input record, in order: the recorded status, or stale_claim / invalid_record / duplicate_in_batch.';

REVOKE ALL ON FUNCTION public.record_push_delivery_attempts(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_push_delivery_attempts(TEXT, JSONB) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
