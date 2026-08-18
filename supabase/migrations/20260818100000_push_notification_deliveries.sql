-- Edition notification deliveries.
--
-- PersoNewsAP sends exactly one notification per published edition, per device:
-- four a week, nothing on a quiet day. The guarantee that a re-run of the daily
-- job — a GitHub Actions replay, a manual dispatch, a retry after an Expo
-- outage — never notifies the same device twice for the same edition is this
-- table's unique key, not a flag held in memory by the sender.
--
-- Identity: (push_token_id, drop_date, notification_kind). The device is the
-- unit, not the account: a reader with a phone and a tablet is told once on
-- each, and retiring one device never suppresses the other.
--
-- Strictly additive: one new table, its indexes and its RLS. No existing table,
-- column, policy or row is touched.

CREATE TABLE IF NOT EXISTS public.push_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  push_token_id UUID NOT NULL REFERENCES public.push_tokens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  drop_date DATE NOT NULL,
  notification_kind TEXT NOT NULL DEFAULT 'edition_ready',
  status TEXT NOT NULL DEFAULT 'pending',
  expo_ticket_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_notification_deliveries_status_check
    CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT push_notification_deliveries_kind_check
    CHECK (notification_kind IN ('edition_ready')),
  CONSTRAINT push_notification_deliveries_attempts_check
    CHECK (attempt_count >= 0),
  -- A row may only claim to have been sent with a timestamp to prove it.
  CONSTRAINT push_notification_deliveries_sent_at_check
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

-- The idempotency key. Insert-with-ignore against this index is what makes the
-- sender safe to replay.
CREATE UNIQUE INDEX IF NOT EXISTS push_notification_deliveries_identity_unique
  ON public.push_notification_deliveries(push_token_id, drop_date, notification_kind);

-- The sender's own lookup: "what has already been handled for this edition".
CREATE INDEX IF NOT EXISTS idx_push_notification_deliveries_date_kind
  ON public.push_notification_deliveries(drop_date, notification_kind, status);

CREATE INDEX IF NOT EXISTS idx_push_notification_deliveries_user
  ON public.push_notification_deliveries(user_id, drop_date DESC);

ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;

-- Deliberately no policy for authenticated readers: this is operational data
-- written only by the server-side sender, which uses the service role and
-- bypasses RLS. With RLS enabled and no policy, no client key can read or write
-- a single row, which is exactly the intent.

-- The schema has no shared updated_at trigger function, so this migration
-- brings its own rather than depending on one that does not exist.
CREATE OR REPLACE FUNCTION public.set_push_notification_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_push_notification_deliveries_updated_at
  ON public.push_notification_deliveries;
CREATE TRIGGER set_push_notification_deliveries_updated_at
BEFORE UPDATE ON public.push_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_push_notification_updated_at();

COMMENT ON TABLE public.push_notification_deliveries IS
  'One row per device per published edition. The unique index on (push_token_id, drop_date, notification_kind) is what makes edition notifications exactly-once.';
COMMENT ON COLUMN public.push_notification_deliveries.status IS
  'pending: never delivered, retryable by the next run. sent: terminal. failed: terminal (bad message/credentials, or a token retired after DeviceNotRegistered).';
