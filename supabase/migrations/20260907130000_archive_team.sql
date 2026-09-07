-- Archiving a team, explicitly — PRODUCTION project.
--
-- WHAT WAS MISSING. `leave_team` archives a team as a side effect when the
-- owner is the last person in it, and that is the only way a team could ever
-- stop. An owner with four members had no way to end a league they had started:
-- Manage offered "Archive the Team", and there was no function behind it.
--
-- Leaving and archiving stay two different decisions, as they became in
-- 20260906092000. This adds the second one rather than widening the first, so
-- `leave_team` keeps refusing an owner who still has company and keeps telling
-- them to transfer ownership — the case where somebody wants OUT of a league
-- that should carry on without them.
--
-- ARCHIVE IS A SOFT DELETE AND MUST STAY ONE. Every scoring table cascades from
-- `public.teams`, so a DELETE here would erase the recorded standings of people
-- who left months before the owner made this decision. Archiving stops future
-- editions, closes every open stint, and kills the invite code, while leaving
-- every past leaderboard reconstructible.

BEGIN;

CREATE OR REPLACE FUNCTION public.archive_team(p_team_id UUID)
-- Deliberately not named `archived_at`: every RETURNS TABLE output is also a
-- PL/pgSQL variable, and this body writes a column of that name. An unqualified
-- reference would raise 42702 at plan time — the bug 20260904120000 had to fix
-- in update_profile_language, not repeated here.
RETURNS TABLE (
  team_id UUID,
  closed_at TIMESTAMPTZ,
  members_closed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_at TIMESTAMPTZ := now();
  v_closed INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to archive a team'
      USING ERRCODE = '28000';
  END IF;

  -- `is_team_owner` requires an ACTIVE team, so archiving an archived team is
  -- refused here rather than silently re-stamping archived_at. It also gives a
  -- non-owner the same answer as a non-member, which is the point: a distinct
  -- refusal would confirm a team exists to anybody who guessed an id.
  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Team not found'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.teams
  SET status = 'archived',
      archived_at = COALESCE(archived_at, v_at),
      -- The invite dies with the team. Reopening is impossible for the same
      -- reason: set_team_invite_open goes through is_team_owner, which an
      -- archived team never satisfies.
      invite_disabled_at = COALESCE(invite_disabled_at, v_at),
      updated_at = v_at
  WHERE id = p_team_id
    AND status = 'active';

  -- Every stint closes, the owner's included. A member whose stint stayed open
  -- on an archived team would keep matching `is_active_team_member`, which is
  -- what team content entitlement, avatar reads and the Realtime channel all
  -- turn on.
  UPDATE public.team_members m
  SET left_at = v_at
  WHERE m.team_id = p_team_id
    AND m.left_at IS NULL;

  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN QUERY SELECT p_team_id, v_at, v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_team(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_team(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_team(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_team(UUID) TO service_role;

COMMENT ON FUNCTION public.archive_team(UUID) IS
  'Owner-only. Ends a team: status archived, invite disabled, every open membership stint closed. A soft delete on purpose — every scoring table cascades from public.teams, so a DELETE would erase the standings of people who left long before. Distinct from leave_team, which is one person walking out of a league that carries on.';

COMMIT;

NOTIFY pgrst, 'reload schema';
