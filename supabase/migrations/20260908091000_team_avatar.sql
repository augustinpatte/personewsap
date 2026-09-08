-- A Team may have a photo of its own — PRODUCTION project.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
--
-- One nullable column, one private bucket, four Storage policies and one
-- owner-only RPC. Nothing about scoring, assignment, eligibility, editions,
-- invites or moderation is touched, and no existing row changes: every Team
-- alive today keeps working with `avatar_path IS NULL`, which is also what the
-- majority of Teams will look like forever. A Team photo is decoration on a
-- private league between four friends; it must never become a thing a Team
-- needs before it can be played.
--
-- WHY A SECOND BUCKET RATHER THAN A FOLDER IN `avatars`
--
-- Because the RULES are different, and a rule that different does not belong
-- behind a path convention nobody can see from SQL:
--
--   an `avatars` object is owned by the PERSON whose id is its first path
--   segment. `auth.uid()` decides who may write it, and "a team-mate" decides
--   who may read it.
--
--   a `team-avatars` object is owned by a TEAM whose id is its first path
--   segment. `public.is_team_owner()` decides who may write it — a fact about
--   a row in public.teams, not about the caller alone — and
--   `public.is_active_team_member()` decides who may read it.
--
-- Collapsing both into one bucket would mean a single set of policies whose
-- predicates branch on the shape of a path. The branch that was wrong would be
-- the one nobody tested, and being wrong in either direction means one reader
-- writing over another's picture.
--
-- PRIVATE, like `avatars`, and for the same reason: a public bucket makes every
-- Team's photo readable by anyone who can guess a team id, forever, with no way
-- to revoke it. Reads go through a short-lived signed URL, and only a member
-- can ask for one.
--
-- SUPABASE FREE HAS NO IMAGE TRANSFORMATIONS. Whatever the phone uploads is
-- byte-for-byte what every member downloads on every render, so the bucket
-- carries the same 400 KB ceiling as `avatars` behind the same on-device
-- compression (apps/mobile/src/features/teams/avatarPolicy.ts).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- NULLABLE with no default and no backfill: "this Team has no photo" is the
-- normal state, not a migration that has not finished.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS avatar_path TEXT;

-- Shape only. That the path names THIS team is enforced by set_team_avatar,
-- which is the only writer; this stops a path that could never resolve — a
-- signed URL, a traversal, a bare filename — from being stored at all, in a
-- predicate simple enough to be a CHECK.
DO $$
BEGIN
  ALTER TABLE public.teams
    ADD CONSTRAINT teams_avatar_path_shape_check
    CHECK (avatar_path IS NULL OR avatar_path ~ '^[0-9a-fA-F-]{36}/[^/]+$');
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;

COMMENT ON COLUMN public.teams.avatar_path IS
  'Optional. Storage path inside the private team-avatars bucket, <team id>/<file>.jpg, or NULL. Never a URL: a signed URL expires, and persisting one would put a bearer token in a column every member reads.';

-- ---------------------------------------------------------------------------
-- 2. Which team an object belongs to
-- ---------------------------------------------------------------------------
-- The mirror of public.avatar_object_owner, and separate from it on purpose:
-- the two answer questions about different things, and a shared helper would be
-- one edit away from letting a person's id authorise a Team's object.
--
-- Returns NULL rather than raising for anything that is not the expected shape,
-- because it runs inside Storage RLS policies where an exception is a 500 the
-- caller cannot interpret. Every policy below compares the result to a
-- membership predicate, and both `is_team_owner(NULL)` and
-- `is_active_team_member(NULL)` are false — so a malformed path fails closed.

CREATE OR REPLACE FUNCTION public.team_avatar_object_team(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_segments TEXT[];
BEGIN
  v_segments := string_to_array(p_name, '/');

  -- Exactly two segments: <team id>/<file>. Anything deeper is not a path this
  -- product writes, and anything shallower is unownable.
  IF array_length(v_segments, 1) <> 2 THEN
    RETURN NULL;
  END IF;

  IF v_segments[1] !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;

  RETURN v_segments[1]::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.team_avatar_object_team(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_avatar_object_team(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_avatar_object_team(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.team_avatar_object_team(TEXT) IS
  'The team id encoded in a team-avatars object path, or NULL when the path is not the <uuid>/<file> shape. Returns NULL rather than raising: it runs inside storage RLS policies, and both membership predicates read NULL as false.';

-- Is this path one that team may hold?
--
-- True or false, never NULL. The lesson of 20260907160000: a predicate a caller
-- negates must not have a third answer, because `NOT NULL` is NULL and plpgsql
-- treats an IF on NULL as not-taken — which is how a guard written to reject
-- every malformed path came to accept them all.
CREATE OR REPLACE FUNCTION public.is_team_avatar_path(p_path TEXT, p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    p_path IS NOT NULL
    AND p_team_id IS NOT NULL
    -- No scheme: a signed URL must never be stored. It expires, so the row
    -- rots, and it is a bearer token sitting in a column members read.
    AND p_path !~* '^[a-z][a-z0-9+.-]*:'
    AND p_path !~ '\.\.'
    AND public.team_avatar_object_team(p_path) = p_team_id,
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_team_avatar_path(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_team_avatar_path(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_team_avatar_path(TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_team_avatar_path(TEXT, UUID) IS
  'True when the path is <team id>/<file> for this team; false for everything else, including malformed paths — never NULL, because the caller negates it. Shares public.team_avatar_object_team with the Storage policies on purpose: the row write and the object write must agree on what "this team''s" means, or the gap between them is the impersonation.';

-- ---------------------------------------------------------------------------
-- 3. The bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-avatars',
  'team-avatars',
  FALSE,
  -- 400 KB, the same ceiling as `avatars`: the client targets 200 KB and
  -- refuses above this, and the bucket refuses too, so a client that skipped
  -- its own check still cannot land a camera-roll original in a bucket every
  -- Teams list reads from.
  409600,
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 4. Policies
-- ---------------------------------------------------------------------------
-- storage.objects already has RLS enabled by Supabase. These are additive and
-- scoped to the team-avatars bucket, so no existing bucket's rules change.
--
-- INSERT, UPDATE and DELETE are three policies rather than one FOR ALL: FOR ALL
-- would let a caller move an object out of one Team's folder into another's in
-- a single statement, because only the WITH CHECK half would be consulted for
-- the destination.

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Owners upload a team avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Owners upload a team avatar"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'team-avatars'
      AND public.is_team_owner(public.team_avatar_object_team(name))
    )
  $policy$;

  EXECUTE 'DROP POLICY IF EXISTS "Owners replace a team avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Owners replace a team avatar"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'team-avatars'
      AND public.is_team_owner(public.team_avatar_object_team(name))
    )
    WITH CHECK (
      bucket_id = 'team-avatars'
      AND public.is_team_owner(public.team_avatar_object_team(name))
    )
  $policy$;

  EXECUTE 'DROP POLICY IF EXISTS "Owners delete a team avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Owners delete a team avatar"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'team-avatars'
      AND public.is_team_owner(public.team_avatar_object_team(name))
    )
  $policy$;

  -- Read: the Team's own active members, and nobody else. That is the whole
  -- audience — the photo exists to identify a private league to the people
  -- inside it. `is_active_team_member` is the same predicate the roster and the
  -- directory use, so a member who leaves loses the photo at exactly the moment
  -- they lose the leaderboard.
  --
  -- is_team_owner is deliberately NOT part of this: an owner is an active
  -- member, so adding them would be a second way to say the same thing and a
  -- second thing to keep in step.
  EXECUTE 'DROP POLICY IF EXISTS "Team members can read a team avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Team members can read a team avatar"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'team-avatars'
      AND public.is_active_team_member(public.team_avatar_object_team(name))
    )
  $policy$;
EXCEPTION
  WHEN insufficient_privilege THEN
    -- Fail closed: with no policy, nobody can read or write the bucket at all.
    RAISE NOTICE 'not permitted to create storage.objects policies here; the team-avatars bucket stays closed until a privileged role applies them';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Setting, replacing and removing the photo
-- ---------------------------------------------------------------------------
-- The only writer of teams.avatar_path. `authenticated` holds no privilege on
-- public.teams at all, so there is no second route to this column.

CREATE OR REPLACE FUNCTION public.set_team_avatar(
  p_team_id UUID,
  p_avatar_path TEXT DEFAULT NULL,
  p_clear_avatar BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_avatar TEXT := nullif(btrim(p_avatar_path), '');
  -- COALESCE because a client may send NULL for a boolean argument, and
  -- `IF NULL THEN` is not taken — which would silently ignore a removal.
  v_clear BOOLEAN := COALESCE(p_clear_avatar, FALSE);
BEGIN
  -- Owner-only, checked in the same statement that writes so there is nothing
  -- to race. is_team_owner also requires status = 'active', so an archived
  -- Team's picture is frozen along with everything else about it.
  IF NOT public.is_team_owner(p_team_id) THEN
    RAISE EXCEPTION 'Only the team owner can change the team photo'
      USING ERRCODE = '42501';
  END IF;

  IF v_clear AND v_avatar IS NOT NULL THEN
    RAISE EXCEPTION 'Send either an avatar path or p_clear_avatar, not both'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_clear AND v_avatar IS NULL THEN
    RAISE EXCEPTION 'Send an avatar path, or p_clear_avatar to remove the photo'
      USING ERRCODE = '22023';
  END IF;

  -- IS NOT TRUE, not NOT: the predicate answers false rather than NULL for a
  -- malformed path, and this reads an unexpected NULL as "not permitted"
  -- anyway. A security check must fail closed on an answer it does not
  -- understand.
  IF v_avatar IS NOT NULL AND public.is_team_avatar_path(v_avatar, p_team_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'A team avatar path must belong to this team: <team id>/<file>'
      USING ERRCODE = '42501';
  END IF;

  -- avatar_path and updated_at only. name and name_status are absent from this
  -- statement, so setting a photo can never be used to rename a Team or to lift
  -- a moderation decision — the same rule rename_team follows in reverse.
  UPDATE public.teams AS t
  SET avatar_path = CASE WHEN v_clear THEN NULL ELSE v_avatar END,
      updated_at = now()
  WHERE t.id = p_team_id;

  RETURN CASE WHEN v_clear THEN NULL ELSE v_avatar END;
END;
$$;

REVOKE ALL ON FUNCTION public.set_team_avatar(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_team_avatar(UUID, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_team_avatar(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_team_avatar(UUID, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.set_team_avatar(UUID, TEXT, BOOLEAN) IS
  'Owner-only. Sets, replaces or (with p_clear_avatar) removes teams.avatar_path, and writes nothing else — name and name_status are absent from the statement, so a photo change can never rename a Team or clear a moderation decision.';

-- ---------------------------------------------------------------------------
-- 6. The member-safe projection learns about the photo
-- ---------------------------------------------------------------------------
-- DROP and CREATE, not CREATE OR REPLACE: adding a column to a view through
-- REPLACE is allowed only at the end of the list, and the ordering here is a
-- readability decision rather than something to be constrained by. The view is
-- recreated with the same owner rights and the same access rule in the same
-- transaction, so no caller ever sees it missing.
--
-- `authenticated` still holds nothing on public.teams — the invite code and the
-- unmoderated name are in the same row — so this remains the only door.

DROP VIEW IF EXISTS public.team_directory;

CREATE VIEW public.team_directory AS
SELECT
  t.id,
  CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END AS display_name,
  -- Hidden by the SAME flag as the name. A Team under moderation has its
  -- identity suppressed, and its photo is part of that identity — a moderated
  -- name beside the picture that provoked the report would be the decision
  -- half-applied.
  CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.avatar_path END AS avatar_path,
  t.name_status,
  t.status,
  t.archived_at,
  (t.owner_id = auth.uid()) AS is_owner,
  (t.invite_disabled_at IS NULL) AS invite_open,
  t.created_at,
  t.updated_at
FROM public.teams t
WHERE public.is_active_team_member(t.id);

-- Owner rights, stated rather than inherited from the server default. The view
-- runs with its owner's rights because `authenticated` holds nothing on
-- public.teams, which means the teams RLS policy is NOT consulted and the
-- WHERE clause above IS the access rule.
ALTER VIEW public.team_directory SET (security_invoker = false);

COMMENT ON VIEW public.team_directory IS
  'The member-safe projection of public.teams: no invite code, no owner id, and a display_name and avatar_path already resolved through moderation. Owner rights, because authenticated holds nothing on public.teams — so the is_active_team_member predicate in the view IS the access rule, not a convenience.';

REVOKE ALL ON public.team_directory FROM PUBLIC, anon;
GRANT SELECT ON public.team_directory TO authenticated;
GRANT SELECT ON public.team_directory TO service_role;

-- ---------------------------------------------------------------------------
-- 7. And so does the detail RPC
-- ---------------------------------------------------------------------------
-- DROP and recreate rather than REPLACE: Postgres refuses to change a
-- RETURNS TABLE through CREATE OR REPLACE (42P13). Same transaction, same
-- signature, same authorisation.

DROP FUNCTION IF EXISTS public.get_team_detail(UUID);

CREATE OR REPLACE FUNCTION public.get_team_detail(p_team_id UUID)
RETURNS TABLE (
  team_id UUID,
  display_name TEXT,
  avatar_path TEXT,
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
    CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.avatar_path END,
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
  'One team as its own member may see it, now including the optional photo path. Returns no invite code and no owner id; the membership join is the authorisation, so a non-member gets no row rather than an error.';

COMMIT;

NOTIFY pgrst, 'reload schema';
