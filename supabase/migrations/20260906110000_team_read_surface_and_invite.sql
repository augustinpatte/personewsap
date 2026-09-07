-- What a member may read about their own team — PRODUCTION project.
--
-- THE LEAK THIS CLOSES.
--
-- `GRANT SELECT ON public.teams TO authenticated` plus the policy "members can
-- read their teams" is row-level, and a row is all of its columns. So every
-- member of every team could read:
--
--   invite_code        the thing the owner is supposed to control. Rotating it
--                      to eject somebody was theatre: they could read the new
--                      one the moment it was written.
--   name               including a name a moderator had hidden. `name_status`
--                      was returned beside it and it was on each client to
--                      remember to check — the Teams landing screen did not.
--   owner_id           who to target.
--
-- None of that was a policy mistake. It is what happens when a table with mixed
-- sensitivity is exposed directly: RLS decides WHICH ROWS, never which columns,
-- and there is no policy that can express "this member may see the name but not
-- the code".
--
-- So members stop reading `public.teams` at all. They read `team_directory`,
-- which is the same rows with the unsafe columns absent and the name resolved
-- through moderation once, in the database, where it cannot be forgotten. The
-- invite code is served by an owner-only RPC.
--
-- WHAT THIS IS NOT: a new permission model. Every rule about who may see a team
-- is unchanged — `is_active_team_member` still decides, and a non-member still
-- sees nothing at all, not even that the team exists.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The safe projection
-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT `security_invoker`, and the reason is the whole point of the
-- change: `authenticated` holds no privilege on `public.teams` at all, so an
-- invoker-rights view over it would be denied for every caller. The view runs
-- with its owner's rights, which is what lets a member read a narrowed row of a
-- table they cannot touch.
--
-- That makes the WHERE clause load-bearing rather than decorative. Owner rights
-- mean the `teams` RLS policy is NOT consulted, so this view has to enforce the
-- same rule itself — and it does, through the same predicate the policy used.
-- `is_active_team_member` is SECURITY DEFINER and reads auth.uid() itself, so
-- there is no argument a caller can point at somebody else's team.
--
-- A non-member gets no row. Not an error, not an empty name: no row, exactly as
-- before.
--
-- `display_name` is NULL when moderation has hidden the name. NULL rather than
-- a placeholder string on purpose: the neutral label is a localisation
-- decision, and a French reader should not be shown an English "Hidden team".
-- The client renders its own fallback, and a client that forgets renders
-- nothing — which is the safe failure.

-- DROP, not CREATE OR REPLACE. Two reasons, both fatal without it.
--
-- 1. 20260906095000 created this view with a column called `name`. Postgres
--    refuses to rename a view column through CREATE OR REPLACE
--    (42P16: cannot change name of view column "name" to "display_name"), so a
--    database replayed from zero stops dead on this statement.
-- 2. That earlier view was security_invoker. CREATE OR REPLACE keeps the option,
--    and an invoker-rights view over a table `authenticated` holds nothing on
--    returns no rows to anybody — the exact opposite of the owner-rights
--    contract the block above describes.
--
-- Dropping and recreating settles both: the shape is whatever this file says,
-- and the rights are owner rights, restated explicitly below.
DROP VIEW IF EXISTS public.team_directory;

CREATE VIEW public.team_directory AS
SELECT
  t.id,
  CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END AS display_name,
  t.name_status,
  t.status,
  t.archived_at,
  (t.owner_id = auth.uid()) AS is_owner,
  (t.invite_disabled_at IS NULL) AS invite_open,
  t.created_at,
  t.updated_at
FROM public.teams t
WHERE public.is_active_team_member(t.id);

-- Owner rights, stated rather than inherited from the server default.
ALTER VIEW public.team_directory SET (security_invoker = false);

COMMENT ON VIEW public.team_directory IS
  'The member-safe projection of public.teams: no invite code, no owner id, and a display_name already resolved through moderation. Owner rights, because authenticated holds nothing on public.teams — so the is_active_team_member predicate in the view IS the access rule, not a convenience.';

REVOKE ALL ON public.team_directory FROM PUBLIC, anon;
GRANT SELECT ON public.team_directory TO authenticated;
GRANT SELECT ON public.team_directory TO service_role;

-- ---------------------------------------------------------------------------
-- 2. One team, with the parts a member is allowed to know
-- ---------------------------------------------------------------------------
-- Saves the client three round trips (team, roster count, own membership) and
-- keeps the moderation rule in one place.

CREATE OR REPLACE FUNCTION public.get_team_detail(p_team_id UUID)
RETURNS TABLE (
  team_id UUID,
  display_name TEXT,
  name_hidden BOOLEAN,
  team_status TEXT,
  is_owner BOOLEAN,
  member_count BIGINT,
  my_role TEXT,
  my_eligible_from_edition DATE,
  invite_open BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id,
    CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END,
    t.name_status = 'hidden',
    t.status,
    t.owner_id = auth.uid(),
    (SELECT count(*) FROM public.team_members c
      WHERE c.team_id = t.id AND c.left_at IS NULL),
    m.role,
    m.eligible_from_edition,
    t.invite_disabled_at IS NULL
  FROM public.teams t
  JOIN public.team_members m
    ON m.team_id = t.id
   AND m.user_id = auth.uid()
   AND m.left_at IS NULL
  WHERE t.id = p_team_id;
$$;

REVOKE ALL ON FUNCTION public.get_team_detail(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_detail(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_detail(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_team_detail(UUID) IS
  'One team as its own member may see it. Returns no invite code and no owner id; the membership join is the authorisation, so a non-member gets no row rather than an error.';

-- ---------------------------------------------------------------------------
-- 3. The invite code is the owner's (§20)
-- ---------------------------------------------------------------------------
-- A member who was given the code can still pass it on — that is a person
-- sharing something they were told, and no API can prevent it. What the API can
-- stop is the code being a standing secret the whole roster holds: rotation
-- becomes meaningful again, because after it only the owner knows the new one.

CREATE OR REPLACE FUNCTION public.get_team_invite_code(p_team_id UUID)
RETURNS TABLE (
  invite_code TEXT,
  rotated_at TIMESTAMPTZ,
  invite_open BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_team_owner(p_team_id) THEN
    -- Same message whether the caller is a member, a stranger, or the owner of
    -- an archived team: a distinct "you are not the owner" would confirm the
    -- team exists to anybody who guessed an id.
    RAISE EXCEPTION 'Team not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT t.invite_code, t.invite_code_rotated_at, t.invite_disabled_at IS NULL
  FROM public.teams t
  WHERE t.id = p_team_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_invite_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_invite_code(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_invite_code(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_team_invite_code(UUID) IS
  'Owner-only. The one way to the invite code: authenticated holds no SELECT on public.teams, so a member cannot read it even though they can read the team.';

-- Close the door without rotating. Rotating ejects nobody who already has a
-- link; disabling stops the code working at all, and is reversible.
CREATE OR REPLACE FUNCTION public.set_team_invite_open(
  p_team_id UUID,
  p_open BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Only the team owner can change the invite'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.teams
  SET invite_disabled_at = CASE WHEN p_open THEN NULL ELSE now() END,
      updated_at = now()
  WHERE id = p_team_id;

  RETURN p_open;
END;
$$;

REVOKE ALL ON FUNCTION public.set_team_invite_open(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_team_invite_open(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_team_invite_open(UUID, BOOLEAN) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_team_invite_open(UUID, BOOLEAN) IS
  'Owner-only. Opens or closes the invite without rotating it. is_team_owner requires an active team, so an archived team can never reopen its door.';

-- ---------------------------------------------------------------------------
-- 4. Team refs for a content badge, without reading teams (§18)
-- ---------------------------------------------------------------------------
-- The Today reader joined `teams` from `team_question_assignments` to render
-- "Team A · Team B" on an article, and applied the moderation rule client-side.
-- Two clients doing that is two chances to forget. This returns the refs
-- already sanitised, and it is the only thing the client needs.

CREATE OR REPLACE FUNCTION public.get_my_team_refs_for_questions(
  p_edition_date DATE,
  p_logical_question_ids UUID[]
)
RETURNS TABLE (
  logical_question_id UUID,
  team_id UUID,
  display_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT
    a.logical_question_id,
    a.team_id,
    CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END
  FROM public.team_question_assignments a
  JOIN public.teams t
    ON t.id = a.team_id
   AND t.status = 'active'
  JOIN public.team_members m
    ON m.team_id = a.team_id
   AND m.user_id = auth.uid()
   AND m.left_at IS NULL
   AND m.eligible_from_edition <= a.edition_date
  WHERE a.edition_date = p_edition_date
    AND a.logical_question_id = ANY(p_logical_question_ids);
$$;

REVOKE ALL ON FUNCTION public.get_my_team_refs_for_questions(DATE, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_team_refs_for_questions(DATE, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_team_refs_for_questions(DATE, UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_team_refs_for_questions(DATE, UUID[]) IS
  'Team badges for an edition''s questions, already resolved through moderation. Scoped to teams the caller is an eligible active member of, so it can never name a team they are not in.';

COMMIT;

NOTIFY pgrst, 'reload schema';
