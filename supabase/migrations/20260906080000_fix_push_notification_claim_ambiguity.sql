-- P0: edition notifications have never been delivered.
--
-- `claim_push_notification_deliveries` fails on every call with
--
--   42702  column reference "push_token_id" is ambiguous
--          It could refer to either a PL/pgSQL variable or a table column.
--
-- so the sender throws "Could not claim notification deliveries: …" before a
-- single message reaches Expo. `push_notification_deliveries` is empty for every
-- edition ever published, which is what that looks like from the outside: not a
-- delivery that failed, a delivery that was never attempted.
--
-- WHY POSTGRESQL SAYS THIS
--
-- Every output column of a `RETURNS TABLE (...)` is also an in-scope PL/pgSQL
-- variable. The function declares `RETURNS TABLE(push_token_id UUID)`, so
-- `push_token_id` names a variable for the whole body.
--
-- The `ON CONFLICT (push_token_id, drop_date, notification_kind)` clause is an
-- *index inference specification*, and inference accepts arbitrary expressions
-- because a unique index may be on an expression or partial. Being an expression
-- context, it is subject to PL/pgSQL variable substitution — unlike an INSERT
-- column list, which is a list of column names and is never substituted. So the
-- parser sees `push_token_id` there resolving to both the variable and the
-- target table's column, and refuses.
--
-- The proof is in the shape of the error rather than in a hypothesis: of the
-- three names in that clause only `push_token_id` is also an output column, and
-- `push_token_id` is exactly the one name PostgreSQL names. Every other
-- reference in the old body was already alias-qualified. Confirmed against
-- production with a zero-row call — `jsonb_to_recordset('[]')` yields no rows,
-- so nothing is inserted and nothing is updated, and the call still fails,
-- because the statement is planned before any row is seen.
--
-- THE FIX IS STRUCTURAL, AND THE PUBLISHED SHAPE DOES NOT MOVE
--
-- The output column stays `push_token_id`. Renaming it would have been the
-- shortest way to break the collision, and it would have made this migration
-- undeployable without a synchronised code release: `main`'s sender reads
-- `row.push_token_id`, and the moment this function returned
-- `claimed_push_token_id` instead, the running sender would claim rows and then
-- announce nothing, silently, because `undefined` is not an error. Between the
-- migration and the merge there would be a window in which the database and the
-- deployed code disagree. A P0 fix must not create one.
--
-- So the ambiguity is removed without touching the contract, in three layers:
--
--  1. `ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique`.
--     A constraint name is an identifier looked up in the catalog, not an
--     expression, so it is never variable-substituted. This is what fixes the
--     actual defect.
--
--  2. Every reference to a column that shares a name with an output column is
--     alias-qualified — `delivery.push_token_id`, `candidate.push_token_id` —
--     so no unqualified occurrence is left anywhere in an expression context.
--
--  3. `#variable_conflict use_column`. With the output column deliberately
--     keeping a name the table also uses, the collision is structural and
--     permanent, so the resolution rule is stated once for the whole body
--     instead of relying on nobody ever adding an unqualified reference again.
--     This is safe here because every local and every parameter in this function
--     is `v_`- or `p_`-prefixed and so cannot collide with a column; that
--     convention is now load-bearing and must be kept.
--
-- Layer 1 needs a named constraint, and the identity key was created as a bare
-- `CREATE UNIQUE INDEX`. It is promoted in place below.
--
-- This migration does NOT edit 20260818123000, which is already applied. It
-- replaces the function it created, with the same name, the same argument types
-- and the same return type.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Promote the identity index to a named constraint
-- ---------------------------------------------------------------------------
-- `USING INDEX` adopts the existing index rather than building a second one:
-- no rewrite, no duplicate storage, no window where the idempotency key is
-- unenforced. The constraint takes the index's own name, so the index is not
-- renamed and every existing plan stays valid.

DO $promote$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.push_notification_deliveries'::regclass
      AND conname = 'push_notification_deliveries_identity_unique'
  ) THEN
    ALTER TABLE public.push_notification_deliveries
      ADD CONSTRAINT push_notification_deliveries_identity_unique
      UNIQUE USING INDEX push_notification_deliveries_identity_unique;
  END IF;
END;
$promote$;

-- ---------------------------------------------------------------------------
-- 2. Notification kinds beyond the edition
-- ---------------------------------------------------------------------------
-- The delivery table was built for the one notification that existed, and the
-- CHECK pinned `notification_kind` to 'edition_ready'. Teams introduces
-- notifications that are not about an edition, and they have to be able to use
-- the same claim lease, the same idempotency key and the same receipt
-- reconciliation rather than growing a second delivery system beside this one.
--
-- The list stays explicit: a typo in a kind is a bug that would silently split
-- one notification's idempotency key in two, and a CHECK is what catches it.
-- Adding a kind is one line in one migration.

ALTER TABLE public.push_notification_deliveries
  DROP CONSTRAINT IF EXISTS push_notification_deliveries_kind_check;

ALTER TABLE public.push_notification_deliveries
  ADD CONSTRAINT push_notification_deliveries_kind_check
  CHECK (
    notification_kind IN (
      'edition_ready',
      'team_invite_received',
      'team_member_joined',
      'team_edition_result'
    )
  );

COMMENT ON COLUMN public.push_notification_deliveries.notification_kind IS
  'What the device was told about. Part of the idempotency key, so a Teams notification and an edition notification on the same day are two independent deliveries.';

-- `drop_date` is the edition date for 'edition_ready' and the calendar day the
-- event belongs to for every other kind. It is named for the first case and
-- keeps that name: renaming a column of a live table to improve a comment is
-- not worth the migration.
COMMENT ON COLUMN public.push_notification_deliveries.drop_date IS
  'The day this notification belongs to. The edition date for edition_ready; the event day for other kinds. Part of the idempotency key.';

-- ---------------------------------------------------------------------------
-- 3. The claim function
-- ---------------------------------------------------------------------------
-- Same name, same arguments, same `RETURNS TABLE(push_token_id UUID)` — so
-- `CREATE OR REPLACE` is legal, no DROP window exists, existing grants survive,
-- and a sender from either branch reads the same field off the same rows.
--
-- Same contract too: insert the missing rows, lease what may be sent, return
-- only the leased token ids. What changed is that it can now be called.

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
-- Layer 3, and it has to be the first line of the body: PL/pgSQL reads compiler
-- options before anything else. `push_token_id` is an output column and
-- therefore a variable, and it is also a column of the table this function
-- writes. Where the two could be confused the column is meant, always — this
-- function never reads its own output variable. Every other identifier here is
-- p_- or v_-prefixed and so cannot collide; that convention is load-bearing now.
DECLARE
  v_now TIMESTAMPTZ := now();
  v_ttl_seconds INTEGER := greatest(coalesce(p_claim_ttl_seconds, 900), 60);
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

  -- A row missing an identifier is dropped rather than inserted as NULL: the
  -- NOT NULL constraints would abort the whole batch, and one malformed entry
  -- must never cost every other device its notification.
  INSERT INTO public.push_notification_deliveries (
    push_token_id,
    user_id,
    drop_date,
    notification_kind,
    status
  )
  SELECT
    candidate.push_token_id,
    candidate.user_id,
    candidate.drop_date,
    coalesce(candidate.notification_kind, 'edition_ready'),
    'pending'
  FROM jsonb_to_recordset(p_rows) AS candidate(
    push_token_id UUID,
    user_id UUID,
    drop_date DATE,
    notification_kind TEXT
  )
  WHERE candidate.push_token_id IS NOT NULL
    AND candidate.user_id IS NOT NULL
    AND candidate.drop_date IS NOT NULL
  ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique DO NOTHING;

  RETURN QUERY
  WITH requested AS (
    -- DISTINCT because `UPDATE … FROM` would otherwise join one delivery row to
    -- several identical request rows and return it more than once.
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
      error = NULL,
      updated_at = v_now
    FROM requested
    WHERE delivery.push_token_id = requested.token_id
      AND delivery.drop_date = requested.day
      AND delivery.notification_kind = requested.kind
      AND (
        -- Never delivered, or failed in a way worth another attempt.
        delivery.status IN ('pending', 'retryable_failure')
        -- Or leased by a worker that died before recording anything. The lease
        -- expiring is what makes this safe: a live claim is never stolen, so
        -- two workers cannot both send to the same device for the same day.
        OR (
          delivery.status IN ('claimed', 'sending')
          AND (
            delivery.claim_expires_at IS NULL
            OR delivery.claim_expires_at <= v_now
          )
        )
      )
    RETURNING delivery.push_token_id AS token_id
  )
  SELECT leased.token_id
  FROM leased;
END;
$claim$;

REVOKE ALL ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_push_notification_deliveries(JSONB, TEXT, INTEGER) IS
  'Atomically leases notification delivery rows and returns push_token_id per leased row. Only returned token ids may be sent to Expo; a lease expires so a crashed worker does not strand a device, and a live lease is never stolen. The response shape is a published contract: senders on both branches read push_token_id.';

COMMIT;

NOTIFY pgrst, 'reload schema';
