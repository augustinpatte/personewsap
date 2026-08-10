-- Synchronize the user's current profile language with the active Learning Path.
-- Existing learning_sessions.language values stay immutable historical records.

CREATE OR REPLACE FUNCTION public.update_profile_language(p_language TEXT)
RETURNS TABLE (
  id UUID,
  language TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update profile language'
      USING ERRCODE = '28000';
  END IF;

  IF p_language NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'Profile language must be fr or en'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    language = p_language,
    updated_at = now()
  WHERE profiles.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found for authenticated user'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.user_learning_paths
  SET
    language = p_language,
    updated_at = now()
  WHERE user_id = v_user_id
    AND status = 'active';

  RETURN QUERY
  SELECT profiles.id, profiles.language, profiles.updated_at
  FROM public.profiles
  WHERE profiles.id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_language(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_profile_language(TEXT) TO authenticated;
