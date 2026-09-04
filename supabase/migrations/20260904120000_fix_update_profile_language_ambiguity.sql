-- Fix: the reading-language switch has been failing for every reader since
-- 20260822120000_language_switch_requeues_learning_sessions.
--
-- That migration added a third UPDATE to update_profile_language, on
-- learning_sessions, with this predicate:
--
--     AND language IS DISTINCT FROM p_language
--
-- The function is declared RETURNS TABLE (id, language, updated_at). In
-- PL/pgSQL every output column of RETURNS TABLE is also a variable, and the
-- default variable_conflict = error setting makes any unqualified reference
-- that matches both a variable and a table column raise 42702
-- ("column reference \"language\" is ambiguous") when the statement is planned
-- — on every single call, whether or not the reader has a learning path.
--
-- The profiles UPDATE earlier in the function body runs first, but the raise
-- aborts the whole transaction, so nothing is saved and the app reports
-- "Couldn't save your language. Your previous language was restored." Every
-- other preference write goes through plain table upserts, which is why only
-- the language switch was failing.
--
-- The fix is purely syntactic: qualify the column references inside the
-- learning_sessions UPDATE. Behavior is otherwise identical to 20260822120000.

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
  WHERE user_learning_paths.user_id = v_user_id
    AND user_learning_paths.status = 'active';

  -- Sessions still ahead of the reader, authored in the language they just left.
  --
  -- `prompt_text` is cleared with the requeue: a French prompt sitting on an
  -- English session is worse than none, and the check constraint only requires
  -- a prompt once the row is `ready` again. The reader sees the generating state
  -- for as long as the orchestrator takes, and then an English prompt.
  --
  -- Every column reference is table-qualified: `language` (and the rest) also
  -- name RETURNS TABLE outputs, and an unqualified reference here is what broke
  -- this function (42702) in 20260822120000.
  UPDATE public.learning_sessions
  SET
    language = p_language,
    generation_status = 'queued',
    generation_locked_at = NULL,
    prompt_text = NULL,
    updated_at = now()
  WHERE learning_sessions.path_id IN (
      SELECT paths.id
      FROM public.user_learning_paths AS paths
      WHERE paths.user_id = v_user_id
        AND paths.status = 'active'
    )
    AND learning_sessions.language IS DISTINCT FROM p_language
    AND learning_sessions.status <> 'completed'
    AND learning_sessions.completed_at IS NULL;

  RETURN QUERY
  SELECT profiles.id, profiles.language, profiles.updated_at
  FROM public.profiles
  WHERE profiles.id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_language(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_profile_language(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_profile_language(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile_language(TEXT) TO service_role;
