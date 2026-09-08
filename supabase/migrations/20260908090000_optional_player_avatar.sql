-- A player photo is optional, and can be taken off again — PRODUCTION project.
--
-- WHAT WAS WRONG, AND IT WAS A PRODUCT DECISION BEFORE IT WAS A BUG
--
-- Teams asked for three things before it would show a leaderboard: a username,
-- a country and a photo. The photo was argued for on the grounds that a
-- leaderboard of grey discs is a spreadsheet rather than a list of people.
-- What it actually did was put an iOS photo-library permission dialog between
-- somebody and the first Team a friend invited them to, and turn "I would
-- rather my face were not in this app" into a refusal to play at all.
--
-- `profiles.avatar_path` was always NULLABLE and every read surface already
-- copes with NULL — the roster, the leaderboard and the badge RPCs all return
-- it as-is and the client draws a placeholder. So nothing in the schema
-- required the photo. The requirement lived in the client, and it is being
-- removed there.
--
-- WHAT THIS MIGRATION IS FOR, THEN
--
-- The half of "optional" the database DID own: there was no way to remove a
-- photo once set.
--
--   UPDATE public.profiles SET avatar_path = COALESCE(v_avatar, p.avatar_path)
--
-- The COALESCE is deliberate and stays: it is what stops a caller who sends
-- only a country from erasing a username. But under that rule NULL means
-- "leave this alone", which leaves no value that can mean "remove it". A
-- reader could add a photo and replace it, and never take it off.
--
-- So removal becomes its own explicit intent, `p_clear_avatar`, rather than
-- being smuggled into an argument that already means something else. It is
-- refused alongside a path, because "set this and also clear it" is not a
-- request the server should have to guess at.
--
-- ADDITIVE AND NON-DESTRUCTIVE, INCLUDING FOR BUILDS ALREADY ON PHONES.
--
-- No column changes, no data touched, every existing row keeps whatever
-- avatar_path it has. And NOTHING IS DROPPED: the 3-argument signature that
-- the TestFlight build in people's hands calls today survives this migration
-- and keeps working, unchanged, for as long as that build exists.
--
-- WHY THE FOURTH ARGUMENT HAS NO DEFAULT, AND WHY THAT IS THE WHOLE TRICK
--
-- PostgREST resolves an overload by the SET OF ARGUMENT NAMES in the request
-- body, not by arity. Two candidates are ambiguous when a request could satisfy
-- both — which is exactly what `p_clear_avatar BOOLEAN DEFAULT FALSE` would
-- create: a body carrying {p_username, p_country_code, p_avatar_path} would
-- satisfy the 3-argument function AND the 4-argument one with its default
-- filled in, and PostgREST would refuse the call (PGRST203) rather than guess.
-- Every installed build would break at once.
--
-- With NO default on p_clear_avatar the two signatures are disjoint:
--
--   3 names  → only the wrapper can accept it     (old build)
--   4 names  → only the canonical function can    (new build)
--
-- There is no request either way that both could serve, so there is nothing to
-- resolve. That is why the default is absent, and it must stay absent.
--
-- ONE IMPLEMENTATION, NOT TWO. The wrapper holds no rules of its own: it calls
-- the canonical function with p_clear_avatar => false, which is precisely what
-- the old body did — its UPDATE could not write NULL to avatar_path. So the
-- authentication check, the username validation, the country validation, the
-- reserved/blocked-name checks and the avatar ownership guard are one copy,
-- reached identically from both entrances. A wrapper that restated them would
-- be a second place for a security check to drift, which is the only thing
-- worse than not having one.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The canonical function
-- ---------------------------------------------------------------------------

-- NO DEFAULTS ANYWHERE IN THIS SIGNATURE, and the fourth argument is the reason.
--
-- Postgres requires every parameter after a defaulted one to be defaulted too
-- (42P13), so `p_clear_avatar` having no default means none of them may have
-- one. That is a constraint, not a preference — and it costs nothing: every
-- caller of this signature sends all four arguments, by name from PostgREST and
-- positionally from SQL. Defaults live on the 3-argument wrapper below, which
-- is where a partial call is supposed to land.
CREATE OR REPLACE FUNCTION public.set_player_identity(
  p_username TEXT,
  p_country_code TEXT,
  p_avatar_path TEXT,
  -- NO DEFAULT. See the header: it is what keeps this signature and the
  -- 3-argument one disjoint for PostgREST, and therefore what keeps every
  -- installed build working.
  p_clear_avatar BOOLEAN
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
  -- COALESCE because a client may send NULL for a boolean argument, and
  -- `IF NULL THEN` is not taken — which would silently ignore the request.
  v_clear BOOLEAN := COALESCE(p_clear_avatar, FALSE);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to set player identity'
      USING ERRCODE = '28000';
  END IF;

  -- Set and clear in one call is not a request with an answer. Refused rather
  -- than resolved by precedence, because either precedence would be a rule
  -- nobody reading the call site could predict.
  IF v_clear AND v_avatar IS NOT NULL THEN
    RAISE EXCEPTION 'Send either an avatar path or p_clear_avatar, not both'
      USING ERRCODE = '22023';
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

  -- THE IMPERSONATION GUARD, unchanged from 20260907160000 and restated here
  -- rather than dropped, because this function is being recreated wholesale.
  --
  -- Storage RLS stops a caller writing an object into another reader's folder.
  -- It has nothing to say about which path a PROFILE ROW points at:
  -- `<victim id>/<their file>.jpg` was once accepted, the roster served it, and
  -- the attacker appeared on the leaderboard wearing the victim's face.
  --
  -- IS NOT TRUE, not NOT: is_own_avatar_path answers false rather than NULL for
  -- a malformed path, and this is the second half of that fix — a guard that
  -- reads an unexpected NULL as permission is how the first version of this
  -- check came to accept every malformed path it was written to reject.
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
  -- The avatar is the one field with a second way to be written: NULL still
  -- means "leave it alone", and only the explicit flag sets it to NULL.
  UPDATE public.profiles AS p
  SET
    username = COALESCE(v_username, p.username),
    country_code = COALESCE(v_country, p.country_code),
    avatar_path = CASE
      WHEN v_clear THEN NULL
      ELSE COALESCE(v_avatar, p.avatar_path)
    END,
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

REVOKE ALL ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT, BOOLEAN) IS
  'Claims or updates the player identity. Username and country are what Teams requires; the avatar is optional and always was NULLABLE. p_clear_avatar is the only way to set avatar_path back to NULL, because NULL in p_avatar_path means "leave it alone" — the COALESCE that stops a partial update erasing a username. Sending both is refused rather than resolved by precedence. It carries NO DEFAULT on purpose: that is what keeps this signature disjoint from the 3-argument one PostgREST also serves.';

-- ---------------------------------------------------------------------------
-- 2. The 3-argument signature the installed build still calls
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE, not DROP: this function is in production use RIGHT NOW by
-- a TestFlight build that cannot be updated retroactively. Dropping it would
-- break the profile screen of every phone that has it, for as long as that
-- build lives. It is replaced in place, keeping its name, its argument list and
-- its return shape, so an in-flight call sees no difference at all.
--
-- WHAT IT DOES: exactly what its old body did, by delegation.
--
-- The old body's UPDATE was
--   avatar_path = COALESCE(v_avatar, p.avatar_path)
-- which cannot write NULL. `p_clear_avatar => false` is that same statement,
-- so an old client keeps its old semantics precisely: it can set an avatar, it
-- can replace one, and it CANNOT remove one. Removal is a capability only the
-- 4-argument entrance has, which is correct — the old build has no button for
-- it and must not be able to trigger it by accident.
--
-- SECURITY INVOKER, deliberately. It adds no privilege of its own; every guard
-- lives in the SECURITY DEFINER function it calls, which reads auth.uid()
-- itself. A definer wrapper would be a second privileged surface to audit for
-- no gain. The search_path is still pinned, because an unqualified name
-- resolved through a caller's search_path is a hazard in any function.
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
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  -- Aliased and qualified. Every output column of a RETURNS TABLE is also a
  -- parameter name inside the body, and an unqualified `username` here would
  -- resolve to the OUT parameter rather than to the column (42702) — the trap
  -- 20260904120000 was written to fix.
  SELECT identity.id, identity.username, identity.country_code, identity.avatar_path
  FROM public.set_player_identity(
    p_username,
    p_country_code,
    p_avatar_path,
    -- The old body could not write NULL to avatar_path. This is that, said out
    -- loud.
    false
  ) AS identity;
$$;

REVOKE ALL ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) IS
  'Backward-compatible entrance for builds shipped before p_clear_avatar existed. Delegates to the 4-argument function with p_clear_avatar => false, which is exactly the old semantics: an old client can set and replace an avatar and can never remove one. Holds no rules of its own — every guard lives in the function it calls.';

COMMIT;

NOTIFY pgrst, 'reload schema';
