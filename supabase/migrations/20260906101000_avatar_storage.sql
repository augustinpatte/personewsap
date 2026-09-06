-- Avatars — PRODUCTION project.
--
-- One private bucket, and three policies that all turn on the same fact: the
-- FIRST path segment of an object is the id of the user who owns it.
--
--     avatars/<user id>/<file>.jpg
--
-- That shape is what makes "you may only touch your own avatar" enforceable at
-- all. A flat `avatars/<random>.jpg` would be unownable, and any authenticated
-- user could overwrite any other's picture — which, on a leaderboard where the
-- avatar is how people recognise each other, is an impersonation vector rather
-- than a storage detail.
--
-- PRIVATE, not public. A public bucket makes every avatar readable by anyone
-- who can guess a user id, forever, with no way to revoke it. Reads go through
-- a short-lived signed URL the client asks for, and only a team-mate can ask.
--
-- Supabase Free has no Image Transformations, so nothing here resizes anything:
-- whatever the phone uploads is exactly what every team-mate downloads on every
-- render. The size limit below is the last line of defence behind the on-device
-- compression in apps/mobile/src/features/teams/avatarPolicy.ts.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  FALSE,
  -- 400 KB. The client targets 200 KB and refuses above this; the bucket
  -- refuses too, so a client that skipped its own check still cannot land a
  -- camera-roll original in a bucket every leaderboard render reads from.
  409600,
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Who owns an object
-- ---------------------------------------------------------------------------
-- `storage.foldername(name)` returns the path segments; element 1 is the owner.
-- Wrapped in a function so the three policies below cannot drift from each
-- other, and so a malformed path is a refusal rather than a 22P02 raised inside
-- a policy.

CREATE OR REPLACE FUNCTION public.avatar_object_owner(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_segments TEXT[];
BEGIN
  v_segments := string_to_array(p_name, '/');

  -- Exactly two segments: <user id>/<file>. Anything deeper is not a path this
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

REVOKE ALL ON FUNCTION public.avatar_object_owner(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avatar_object_owner(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.avatar_object_owner(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.avatar_object_owner(TEXT) IS
  'The user id encoded in an avatar object path, or NULL when the path is not the avatars/<uuid>/<file> shape. Returns NULL rather than raising: it runs inside storage RLS policies.';

-- ---------------------------------------------------------------------------
-- 3. Policies
-- ---------------------------------------------------------------------------
-- storage.objects already has RLS enabled by Supabase. These are additive and
-- scoped to the avatars bucket, so no existing bucket's rules change.

DO $$
BEGIN
  -- Write your own, and only your own. INSERT and UPDATE are separate policies
  -- because Postgres needs WITH CHECK on one and USING plus WITH CHECK on the
  -- other; collapsing them into FOR ALL would let a caller move an object out
  -- of their own folder in a single statement.
  EXECUTE 'DROP POLICY IF EXISTS "Readers upload their own avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Readers upload their own avatar"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'avatars'
      AND public.avatar_object_owner(name) = auth.uid()
    )
  $policy$;

  EXECUTE 'DROP POLICY IF EXISTS "Readers replace their own avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Readers replace their own avatar"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'avatars'
      AND public.avatar_object_owner(name) = auth.uid()
    )
    WITH CHECK (
      bucket_id = 'avatars'
      AND public.avatar_object_owner(name) = auth.uid()
    )
  $policy$;

  EXECUTE 'DROP POLICY IF EXISTS "Readers delete their own avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Readers delete their own avatar"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'avatars'
      AND public.avatar_object_owner(name) = auth.uid()
    )
  $policy$;

  -- Read: yourself, plus anyone you currently share a Team with. That is the
  -- whole audience for an avatar — it exists to be recognised on a leaderboard,
  -- and nobody outside the league has any reason to fetch it.
  --
  -- `shares_active_team_with` is the same predicate get_team_roster uses, so a
  -- member who leaves loses avatar access at exactly the moment they lose the
  -- roster. A moderated avatar is separately suppressed at read time by the
  -- roster/leaderboard functions, which return NULL for the path.
  EXECUTE 'DROP POLICY IF EXISTS "Team mates can read an avatar" ON storage.objects';
  EXECUTE $policy$
    CREATE POLICY "Team mates can read an avatar"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'avatars'
      AND (
        public.avatar_object_owner(name) = auth.uid()
        OR public.shares_active_team_with(public.avatar_object_owner(name))
      )
    )
  $policy$;
EXCEPTION
  WHEN insufficient_privilege THEN
    -- Fail closed: with no policy, nobody can read or write the bucket at all.
    RAISE NOTICE 'not permitted to create storage.objects policies here; the avatars bucket stays closed until a privileged role applies them';
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
