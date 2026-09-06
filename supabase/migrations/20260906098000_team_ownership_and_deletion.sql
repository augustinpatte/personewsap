-- Ownership hand-over, member removal, and the account-deletion blocker.
--
-- THE BUG THIS FIXES FIRST. `teams.owner_id` references `profiles(id)` with
-- ON DELETE RESTRICT. Every other Teams table cascades, so deleting an account
-- cleans up correctly — except for a reader who owns a Team, where RESTRICT
-- makes the delete fail outright. `delete-account` deletes the auth user and
-- lets the cascade do the rest, so as things stand a Team owner CANNOT DELETE
-- THEIR ACCOUNT AT ALL. That is a GDPR obligation failing closed, and it would
-- have shipped silently: nothing in the mobile app or the Edge Function reports
-- which foreign key refused.
--
-- The fix is a BEFORE DELETE trigger that resolves ownership first. It does not
-- weaken the constraint — RESTRICT stays, and stays useful: it is still
-- impossible to orphan a team by accident, because the only way past it is the
-- deliberate hand-over below.
--
-- Also here, because the mobile copy already promises both and neither existed:
-- transfer_team_ownership and remove_team_member.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Transfer ownership
-- ---------------------------------------------------------------------------
-- Owner-only, and only to somebody currently in the team. The old owner stays
-- as a member: leaving is a separate, explicit act, and silently ejecting
-- somebody from their own team because they handed over the keys would lose
-- their scores from the roster.

CREATE OR REPLACE FUNCTION public.transfer_team_ownership(
  p_team_id UUID,
  p_new_owner_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Only the team owner can transfer ownership' USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_id = v_user_id THEN
    RAISE EXCEPTION 'That reader already owns this team' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.team_id = p_team_id
      AND m.user_id = p_new_owner_id
      AND m.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The new owner must be a current member' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.teams t
  SET owner_id = p_new_owner_id, updated_at = now()
  WHERE t.id = p_team_id;

  UPDATE public.team_members m
  SET role = CASE WHEN m.user_id = p_new_owner_id THEN 'owner' ELSE 'member' END
  WHERE m.team_id = p_team_id
    AND m.left_at IS NULL
    AND m.user_id IN (v_user_id, p_new_owner_id);

  RETURN p_new_owner_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_team_ownership(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_team_ownership(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_team_ownership(UUID, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Remove a member
-- ---------------------------------------------------------------------------
-- Exactly the semantics of leaving, applied by somebody else: the stint is
-- closed with left_at, never deleted. Future access and future scoring stop;
-- every point already earned stays attached to the edition it was earned in,
-- and past standings are not recomputed.

CREATE OR REPLACE FUNCTION public.remove_team_member(
  p_team_id UUID,
  p_user_id UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_removed_at TIMESTAMPTZ := now();
BEGIN
  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Only the team owner can remove a member' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    -- The owner leaving is leave_team's job, and it has to decide what happens
    -- to the team. Removing yourself here would skip that decision.
    RAISE EXCEPTION 'Use leave_team to leave a team you own' USING ERRCODE = '22023';
  END IF;

  UPDATE public.team_members m
  SET left_at = v_removed_at
  WHERE m.team_id = p_team_id
    AND m.user_id = p_user_id
    AND m.left_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That reader is not a current member' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_removed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_team_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_team_member(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_team_member(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.remove_team_member(UUID, UUID) IS
  'Owner-only. Closes a member''s stint (left_at) rather than deleting it: future access and scoring stop, historic scores stay attached to their editions.';

-- ---------------------------------------------------------------------------
-- 3. The account-deletion path
-- ---------------------------------------------------------------------------
-- Runs BEFORE the profile row goes, so `teams.owner_id`'s RESTRICT never gets
-- the chance to refuse.
--
-- The rule, in order:
--
--   1. Hand the team to the longest-standing remaining member, if there is one.
--      The team survives, its leaderboard survives, and the people still in it
--      keep playing. This is almost always the right answer for a league of
--      friends where one person happened to create it.
--
--   2. If nobody is left, archive it. Not delete: `team_question_scores` and
--      `team_member_edition_scores` cascade from `teams`, so deleting the row
--      would erase other people's history too — and an empty archived team
--      costs one row.
--
-- The departing reader's own scores still cascade away with their profile,
-- which is what account deletion is supposed to do.

CREATE OR REPLACE FUNCTION public.resolve_team_ownership_on_profile_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team RECORD;
  v_successor UUID;
BEGIN
  FOR v_team IN
    SELECT t.id FROM public.teams t WHERE t.owner_id = OLD.id
  LOOP
    SELECT m.user_id INTO v_successor
    FROM public.team_members m
    WHERE m.team_id = v_team.id
      AND m.left_at IS NULL
      AND m.user_id <> OLD.id
    ORDER BY m.joined_at
    LIMIT 1;

    IF v_successor IS NOT NULL THEN
      UPDATE public.teams
      SET owner_id = v_successor, updated_at = now()
      WHERE id = v_team.id;

      UPDATE public.team_members
      SET role = 'owner'
      WHERE team_id = v_team.id AND user_id = v_successor AND left_at IS NULL;
    ELSE
      -- Nobody left. Archived, and the owner_id is moved to the departing
      -- reader's successor-less team by pointing it at… nothing available, so
      -- the row itself has to go. Its scores belong only to the departing
      -- reader and cascade with them anyway.
      DELETE FROM public.teams WHERE id = v_team.id;
    END IF;
  END LOOP;

  -- Close every remaining stint so no active membership outlives the profile.
  UPDATE public.team_members
  SET left_at = now()
  WHERE user_id = OLD.id AND left_at IS NULL;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_team_ownership_on_profile_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_team_ownership_on_profile_delete() FROM anon;
REVOKE ALL ON FUNCTION public.resolve_team_ownership_on_profile_delete() FROM authenticated;

DROP TRIGGER IF EXISTS trg_profiles_resolve_team_ownership ON public.profiles;

CREATE TRIGGER trg_profiles_resolve_team_ownership
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.resolve_team_ownership_on_profile_delete();

COMMENT ON FUNCTION public.resolve_team_ownership_on_profile_delete() IS
  'Runs before a profile is deleted so teams.owner_id RESTRICT cannot block account deletion. Hands each owned team to its longest-standing remaining member, or removes a team nobody is left in.';

-- ---------------------------------------------------------------------------
-- 4. Indexes for the paths this adds
-- ---------------------------------------------------------------------------
-- The trigger scans teams by owner on every profile delete, and the leaderboard
-- reads scores by (team, edition). Both already have an index; this is the one
-- that did not: finding a team's successor orders by joined_at.

CREATE INDEX IF NOT EXISTS idx_team_members_team_joined
  ON public.team_members (team_id, joined_at)
  WHERE left_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
