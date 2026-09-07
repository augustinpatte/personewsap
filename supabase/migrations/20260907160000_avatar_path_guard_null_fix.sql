-- The avatar impersonation guard was open for the one path it named.
--
-- WHAT WAS WRONG
--
-- 20260907140000 added the check that stops a reader pointing their profile at
-- somebody else's avatar object:
--
--   IF v_avatar IS NOT NULL AND NOT public.is_own_avatar_path(v_avatar, v_user_id) THEN
--     RAISE EXCEPTION 'An avatar path must be your own: <user id>/<file>';
--   END IF;
--
-- and is_own_avatar_path ends in
--
--   AND public.avatar_object_owner(p_path) = p_user_id
--
-- avatar_object_owner returns NULL — deliberately, so it can be used inside an
-- RLS policy without raising — for every path that is not exactly
-- `<uuid>/<file>`. NULL = <uuid> is NULL, so the whole conjunction is NULL, so
-- is_own_avatar_path returns NULL rather than false. `NOT NULL` is NULL, and
-- plpgsql treats an IF on NULL as not-taken.
--
-- The guard therefore fired only for paths that were the right SHAPE but the
-- wrong OWNER, and let every malformed path through untouched. The migration's
-- own comment names the case it misses:
--
--   'avatars/<my id>/x.jpg'   -- three segments, owner NULL, accepted
--
-- and so are '../', a bare filename, and a signed URL with a scheme — the two
-- regex guards above sit in the same conjunction and their result is discarded
-- along with everything else the moment the last term goes NULL.
--
-- WHAT IT COST
--
-- profiles.avatar_path could be set to any string that is not a valid avatar
-- path. Storage RLS still refused to serve those objects, so no face was
-- stolen; what a caller got was a profile row pointing at a path nothing can
-- resolve — a broken avatar for every team-mate, persisted, and set by a
-- request the server had promised to reject. The contract suite's check I3
-- asserts the rejection and has failed since the check was written.
--
-- THE FIX, IN BOTH PLACES
--
-- 1. is_own_avatar_path answers the question it is named for: true or false,
--    never NULL. A predicate that a caller negates must not have a third
--    answer.
-- 2. The caller stops trusting that. `IS NOT TRUE` treats NULL as "not
--    permitted", so the guard fires even if some future edit reintroduces a
--    NULL. A security check should fail closed on an answer it does not
--    understand.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_own_avatar_path(p_path TEXT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- COALESCE is the fix. avatar_object_owner() returns NULL for every path that
  -- is not <uuid>/<file>, and `NULL = p_user_id` is NULL, not false — so
  -- without this the answer to "is this path yours?" for a malformed path was
  -- "unknown", and every caller that negated it read the unknown as a pass.
  SELECT COALESCE(
    p_path IS NOT NULL
    AND p_user_id IS NOT NULL
    -- No scheme: a signed URL must never be stored. It expires, so the row
    -- rots, and it is a bearer token sitting in a column team-mates read.
    AND p_path !~* '^[a-z][a-z0-9+.-]*:'
    AND p_path !~ '\.\.'
    AND public.avatar_object_owner(p_path) = p_user_id,
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_own_avatar_path(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_own_avatar_path(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_own_avatar_path(TEXT, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_own_avatar_path(TEXT, UUID) IS
  'True when the path is <user id>/<file> and the user id is this reader''s; false for everything else, including malformed paths — never NULL, because every caller negates it. Shares public.avatar_object_owner with the Storage policies on purpose: the profile write and the object write must agree on what "yours" means, or the gap between them is the impersonation.';

CREATE OR REPLACE FUNCTION public.set_player_identity(
  p_username TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_avatar_path TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  username TEXT,
  country_code TEXT,
  avatar_path TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_username TEXT := nullif(btrim(p_username), '');
  v_country TEXT := nullif(btrim(upper(p_country_code)), '');
  v_avatar TEXT := nullif(btrim(p_avatar_path), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to set player identity'
      USING ERRCODE = '28000';
  END IF;

  IF v_username IS NOT NULL
     AND v_username !~ '^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$' THEN
    RAISE EXCEPTION 'Username must be 3-20 characters, letters, digits, dot or underscore, starting and ending with a letter or digit'
      USING ERRCODE = '22023';
  END IF;

  -- THE CHECKS THE CLIENT WAS DOING ALONE. A rewritten binary skips them; this
  -- does not.
  IF v_username IS NOT NULL AND public.is_reserved_username(v_username) THEN
    RAISE EXCEPTION 'That username is reserved'
      USING ERRCODE = '22023';
  END IF;

  IF v_username IS NOT NULL AND public.has_blocked_fragment(v_username) THEN
    RAISE EXCEPTION 'That username is not allowed'
      USING ERRCODE = '22023';
  END IF;

  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Country must be an ISO 3166-1 alpha-2 code'
      USING ERRCODE = '22023';
  END IF;

  -- THE IMPERSONATION FIX.
  --
  -- Storage RLS stops a caller writing an object into another reader's folder.
  -- It has nothing to say about which path a PROFILE ROW points at, and until
  -- 20260907140000 neither did this function: `<victim id>/<their file>.jpg`
  -- was accepted, the roster served it, and the storage read policy allowed it
  -- because the victim is a team-mate. The attacker then appeared on the
  -- leaderboard wearing the victim's face.
  --
  -- Checked against auth.uid() rather than against a caller-supplied id, in the
  -- same statement that writes, so there is nothing to race.
  --
  -- IS NOT TRUE, not NOT. The predicate is fixed above to answer false rather
  -- than NULL, and this is the second half of the same fix: a guard that reads
  -- an unexpected NULL as permission is how the first version of this check
  -- came to accept every malformed path it was written to reject.
  IF v_avatar IS NOT NULL AND public.is_own_avatar_path(v_avatar, v_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'An avatar path must be your own: <user id>/<file>'
      USING ERRCODE = '42501';
  END IF;

  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles taken
    WHERE lower(taken.username) = lower(v_username)
      AND taken.id <> v_user_id
  ) THEN
    RAISE EXCEPTION 'Username already taken'
      USING ERRCODE = '23505';
  END IF;

  -- COALESCE, so a caller sending only a country does not erase the username.
  -- Clearing a field is a separate, explicit action rather than a side effect
  -- of a partial update.
  UPDATE public.profiles AS p
  SET
    username = COALESCE(v_username, p.username),
    country_code = COALESCE(v_country, p.country_code),
    avatar_path = COALESCE(v_avatar, p.avatar_path),
    updated_at = now()
  WHERE p.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found for authenticated user'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.country_code, p.avatar_path
  FROM public.profiles p
  WHERE p.id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
