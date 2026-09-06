-- Private realtime channels, and the minimum safety surface — PRODUCTION.
--
-- REALTIME BUDGET (§17). PersoNewsAP runs on Supabase Free: 200 concurrent
-- Realtime connections, 2M messages a month, 100 messages a second. The
-- architecture below is shaped by those numbers rather than apologising for
-- them afterwards:
--
--   * no Presence. It is the single most expensive feature per connected
--     client and answers a question ("who is looking right now") the product
--     does not ask.
--
--   * no realtime on the timer. The deadline is a timestamp the client already
--     holds; counting down is arithmetic, not a subscription.
--
--   * no subscription on the Teams list. That screen is a plain query. A user
--     in eight teams would otherwise open eight channels to render one list.
--
--   * one channel, opened only while a Team Detail is actually on screen, and
--     Broadcast rather than Postgres Changes — Postgres Changes pushes row
--     payloads for every write a subscriber is entitled to and is what makes a
--     message budget disappear.
--
-- SAFETY (§19). Blocks and reports, and a way to hide a name without deleting
-- the person. Deliberately not a social network: there is no chat, no follow,
-- no feed, and nothing here creates one.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Who may listen on a team channel
-- ---------------------------------------------------------------------------
-- Parsing is done defensively: a topic is a client-supplied string, and
-- `split_part(topic, ':', 2)::uuid` on a malformed one raises 22P02 inside a
-- policy, which is a much worse outcome than returning false.

CREATE OR REPLACE FUNCTION public.can_read_team_topic(p_topic TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team_id UUID;
BEGIN
  IF p_topic IS NULL OR p_topic !~ '^team:[0-9a-fA-F-]{36}:leaderboard$' THEN
    RETURN FALSE;
  END IF;

  BEGIN
    v_team_id := split_part(p_topic, ':', 2)::UUID;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN FALSE;
  END;

  RETURN public.is_active_team_member(v_team_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_read_team_topic(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_team_topic(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_read_team_topic(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_read_team_topic(TEXT) IS
  'Authorizes a subscription to team:<uuid>:leaderboard. Returns false for anything malformed rather than raising, because it runs inside an RLS policy on realtime.messages.';

-- Realtime Authorization is RLS on realtime.messages. Two things make this
-- fail-closed, which is the property that matters:
--
--   * with no policy, nobody can subscribe. So if the block below cannot run —
--     realtime not provisioned, or the migration role not permitted to create a
--     policy in that schema — the outcome is "no private channels", never "open
--     channels".
--
--   * there is deliberately no INSERT policy. Clients receive on this channel
--     and can never send on it, so a member cannot forge a leaderboard event.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime.messages not present; private team channels are not authorized (subscriptions stay denied)';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Team members can receive leaderboard broadcasts" ON realtime.messages';
  EXECUTE $policy$
    CREATE POLICY "Team members can receive leaderboard broadcasts"
    ON realtime.messages
    FOR SELECT
    TO authenticated
    USING (
      realtime.messages.extension = 'broadcast'
      AND public.can_read_team_topic(realtime.topic())
    )
  $policy$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'not permitted to create the realtime.messages policy here; private team channels stay denied until it is applied by a privileged role';
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Blocks
-- ---------------------------------------------------------------------------
-- A block is one reader's own list. It does not remove anybody from a team and
-- does not change a score: it is a rendering instruction the client applies,
-- and a signal moderation can weigh. Scores are facts about a competition and
-- must not become negotiable between participants.

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self_check CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks(blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Readers manage their own block list" ON public.user_blocks;
CREATE POLICY "Readers manage their own block list"
ON public.user_blocks
FOR SELECT
USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Readers can add to their own block list" ON public.user_blocks;
CREATE POLICY "Readers can add to their own block list"
ON public.user_blocks
FOR INSERT
WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Readers can remove from their own block list" ON public.user_blocks;
CREATE POLICY "Readers can remove from their own block list"
ON public.user_blocks
FOR DELETE
USING (blocker_id = auth.uid());

-- Only SELECT is granted to the blocked side by omission: there is no policy
-- letting anyone see who has blocked them, which is the whole point.
REVOKE ALL ON TABLE public.user_blocks FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_blocks TO authenticated;
GRANT ALL ON TABLE public.user_blocks TO service_role;

COMMENT ON TABLE public.user_blocks IS
  'One reader''s personal block list. Never affects scores or membership; a block is a rendering and moderation signal, not a way to remove a competitor.';

-- ---------------------------------------------------------------------------
-- 3. Reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_reports_reason_check CHECK (
    reason IN ('inappropriate_username', 'inappropriate_avatar', 'inappropriate_team_name', 'harassment', 'other')
  ),
  CONSTRAINT user_reports_status_check CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  CONSTRAINT user_reports_details_length_check CHECK (details IS NULL OR length(details) <= 2000),
  CONSTRAINT user_reports_target_check CHECK (
    reported_user_id IS NOT NULL OR team_id IS NOT NULL
  ),
  CONSTRAINT user_reports_not_self_check CHECK (
    reported_user_id IS NULL OR reported_user_id <> reporter_id
  )
);

CREATE INDEX IF NOT EXISTS idx_user_reports_open
  ON public.user_reports (status, created_at DESC)
  WHERE status IN ('open', 'reviewing');

CREATE INDEX IF NOT EXISTS idx_user_reports_reported_user
  ON public.user_reports (reported_user_id);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reporters can read their own reports" ON public.user_reports;
CREATE POLICY "Reporters can read their own reports"
ON public.user_reports
FOR SELECT
USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Reporters can file a report" ON public.user_reports;
CREATE POLICY "Reporters can file a report"
ON public.user_reports
FOR INSERT
WITH CHECK (
  reporter_id = auth.uid()
  -- You may only report someone you can actually see: a team-mate, or a team
  -- you are in. Without this the table is an open channel to any account id.
  AND (
    (reported_user_id IS NOT NULL AND public.shares_active_team_with(reported_user_id))
    OR (team_id IS NOT NULL AND public.is_active_team_member(team_id))
  )
);

-- No UPDATE policy: a reporter cannot reopen or reclassify their own report,
-- and nobody can mark a report about themselves as dismissed. Triage is
-- service-role work.
REVOKE ALL ON TABLE public.user_reports FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.user_reports TO authenticated;
GRANT ALL ON TABLE public.user_reports TO service_role;

COMMENT ON TABLE public.user_reports IS
  'Reports about a team-mate or a team the reporter belongs to. Triage (status, resolved_at) is service-role only; a reporter can file and read their own, and nothing else.';

-- ---------------------------------------------------------------------------
-- 4. Hiding without deleting
-- ---------------------------------------------------------------------------
-- The moderation action the product needs on day one: take an offensive name or
-- avatar out of every surface, immediately, without touching the account, its
-- history or any leaderboard it appears in. Reversible, and auditable because
-- the original value is still in the row.
--
-- Service-role only. There is no admin claim in this database yet, and
-- inventing one here — a boolean on profiles, a role string — would be a
-- privilege system nothing else uses and everything would then have to trust.

CREATE OR REPLACE FUNCTION public.moderate_player_identity(
  p_user_id UUID,
  p_username_status TEXT DEFAULT NULL,
  p_avatar_status TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_username_status IS NOT NULL AND p_username_status NOT IN ('active', 'hidden') THEN
    RAISE EXCEPTION 'username_status must be active or hidden' USING ERRCODE = '22023';
  END IF;

  IF p_avatar_status IS NOT NULL AND p_avatar_status NOT IN ('active', 'hidden') THEN
    RAISE EXCEPTION 'avatar_status must be active or hidden' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles p
  SET username_status = COALESCE(p_username_status, p.username_status),
      avatar_status = COALESCE(p_avatar_status, p.avatar_status),
      updated_at = now()
  WHERE p.id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_team_name(
  p_team_id UUID,
  p_name_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_name_status NOT IN ('active', 'hidden') THEN
    RAISE EXCEPTION 'name_status must be active or hidden' USING ERRCODE = '22023';
  END IF;

  UPDATE public.teams t
  SET name_status = p_name_status, updated_at = now()
  WHERE t.id = p_team_id;
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_player_identity(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderate_player_identity(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.moderate_player_identity(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_player_identity(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.moderate_team_name(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderate_team_name(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.moderate_team_name(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_team_name(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.moderate_player_identity(UUID, TEXT, TEXT) IS
  'Hides or restores a reader''s username and avatar across every team surface. Non-destructive: the stored values and every score they earned are untouched.';

-- A team name is read straight from public.teams by the client, so hiding it
-- has to be applied where the client reads it. This view is what the Teams list
-- should select from; the underlying table keeps the original value.
CREATE OR REPLACE VIEW public.team_directory AS
SELECT
  t.id,
  CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END AS name,
  t.owner_id,
  t.status,
  t.created_at
FROM public.teams t;

ALTER VIEW public.team_directory SET (security_invoker = true);

REVOKE ALL ON public.team_directory FROM PUBLIC;
REVOKE ALL ON public.team_directory FROM anon;
GRANT SELECT ON public.team_directory TO authenticated;
GRANT SELECT ON public.team_directory TO service_role;

COMMENT ON VIEW public.team_directory IS
  'The Teams list as a client should read it: moderation applied, invite_code never selected. security_invoker, so the caller''s own RLS on public.teams still decides which teams are visible.';

COMMIT;

NOTIFY pgrst, 'reload schema';
