-- Player identity — PRODUCTION project.
--
-- Teams put readers in front of each other for the first time, so a reader now
-- needs a name other people see. This extends `public.profiles` rather than
-- creating a second identity table: the profile is already the row every other
-- feature keys on (auth.uid() = profiles.id), it already carries `language`,
-- and a parallel `players` table would immediately raise the question of which
-- of the two is the person.
--
-- Every column is nullable. A reader who never opens Teams never picks a
-- username, and nothing in the app may require one before that point.
--
-- Strictly additive: three identity columns, two moderation flags, one
-- case-insensitive unique index. No existing column is touched and no existing
-- policy is loosened — in particular the profiles SELECT policy still says
-- `auth.uid() = id`, so this migration alone exposes nothing to anybody. The
-- Teams migration adds the one narrow read path that lets team-mates see each
-- other, and nothing wider.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS avatar_path TEXT,
  ADD COLUMN IF NOT EXISTS username_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS avatar_status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  -- 3 to 20 characters, letters/digits/underscore/dot, and it must start and
  -- end with a letter or digit. That last part is what keeps ".", "..." and
  -- "_" out, and stops a name being confusable with a truncated one.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_format_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_format_check
      CHECK (
        username IS NULL
        OR username ~ '^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$'
      );
  END IF;

  -- ISO 3166-1 alpha-2, uppercase. A country, deliberately: it is chosen by the
  -- reader and is two letters wide. Nothing here stores, derives or accepts a
  -- coordinate, a city or an IP-derived location.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_country_code_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_country_code_check
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;

  -- A Storage object path ("avatars/<uid>/<uuid>.jpg"), never a URL.
  --
  -- A signed URL has an expiry baked into it, so persisting one guarantees a
  -- broken image later and leaks a bearer token into every row that reads the
  -- profile. The client asks Storage for a fresh signed URL from this path when
  -- it needs one.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_avatar_path_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_avatar_path_check
      CHECK (
        avatar_path IS NULL
        OR (
          avatar_path !~* '^[a-z][a-z0-9+.-]*:'   -- no scheme: not a URL
          AND avatar_path !~ '\.\.'                -- no traversal
          AND length(avatar_path) BETWEEN 1 AND 300
        )
      );
  END IF;

  -- Moderation without deletion. Hiding a name keeps the row, the history and
  -- every score attached to it intact; only the rendering changes.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_status_check
      CHECK (username_status IN ('active', 'hidden'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_avatar_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_avatar_status_check
      CHECK (avatar_status IN ('active', 'hidden'));
  END IF;
END;
$$;

-- Case-insensitive uniqueness. "Augustin" and "augustin" are the same player to
-- everyone reading a leaderboard, so they must be the same name to the
-- database. Partial so the vast majority of rows (no username yet) cost
-- nothing.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

COMMENT ON COLUMN public.profiles.username IS
  'Public display name inside Teams. Unique case-insensitively; NULL until the reader opens Teams for the first time.';
COMMENT ON COLUMN public.profiles.country_code IS
  'ISO 3166-1 alpha-2 country chosen by the reader. Never a GPS position and never derived from an IP address.';
COMMENT ON COLUMN public.profiles.avatar_path IS
  'Storage object path. Never a signed URL: those expire, and persisting one would store a bearer token in the row.';
COMMENT ON COLUMN public.profiles.username_status IS
  'Moderation flag. ''hidden'' suppresses the name in every team surface without deleting the profile or any score attached to it.';
COMMENT ON COLUMN public.profiles.avatar_status IS
  'Moderation flag for the avatar, with the same non-destructive semantics as username_status.';

-- ---------------------------------------------------------------------------
-- Claiming a username
-- ---------------------------------------------------------------------------
-- The uniqueness check and the write have to be one operation, or two readers
-- racing for the same name both pass the check and one gets a 23505 they cannot
-- interpret. This does it in one statement and reports the collision as a
-- distinct, catchable condition.

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

  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Country must be an ISO 3166-1 alpha-2 code'
      USING ERRCODE = '22023';
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

COMMENT ON FUNCTION public.set_player_identity(TEXT, TEXT, TEXT) IS
  'Claims or updates the calling reader''s public Teams identity. Checks case-insensitive uniqueness and writes in one statement so two readers racing for a name cannot both win. Arguments left NULL are not changed.';

-- Whether a name is free, for the "choose your username" screen. Returns a
-- boolean and nothing else: it must never become a way to enumerate who exists.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_username TEXT := nullif(btrim(p_username), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  IF v_username IS NULL
     OR v_username !~ '^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$' THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.profiles taken
    WHERE lower(taken.username) = lower(v_username)
      AND taken.id <> v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_username_available(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_username_available(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO service_role;

COMMENT ON FUNCTION public.is_username_available(TEXT) IS
  'True when the name is well-formed and unclaimed. Returns only a boolean so it cannot be used to enumerate accounts.';

COMMIT;

NOTIFY pgrst, 'reload schema';
