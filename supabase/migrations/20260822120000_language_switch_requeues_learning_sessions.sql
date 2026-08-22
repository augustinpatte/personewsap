-- Changing the reading language must change the Learning Path prompt too.
--
-- `update_profile_language` already re-pointed the active path's language, so
-- every FUTURE session was authored in the new language. What it did not do was
-- touch the sessions that already existed: their `prompt_text` is a single
-- column, rendered server-side in the language the path had at the time, and
-- there is no French/English pair to switch between.
--
-- That is the bug a reader sees. They switch to English, the path title and
-- summary turn English — those are stored in both languages — and the prompt
-- they actually copy into their tutor is still French.
--
-- So a session that has not been completed is put back in the queue. The
-- orchestrator treats `queued` as reclaimable (see generationLock.ts) and
-- regenerates it in the path's current language.
--
-- Completed sessions are deliberately left alone. Their prompt is a record of
-- work the reader already did with their tutor; rewriting it in another language
-- would falsify their history, and the display copy around it (title, summary,
-- objectives) is bilingual and switches anyway.

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

  -- Sessions still ahead of the reader, authored in the language they just left.
  --
  -- `prompt_text` is cleared with the requeue: a French prompt sitting on an
  -- English session is worse than none, and the check constraint only requires
  -- a prompt once the row is `ready` again. The reader sees the generating state
  -- for as long as the orchestrator takes, and then an English prompt.
  UPDATE public.learning_sessions
  SET
    language = p_language,
    generation_status = 'queued',
    generation_locked_at = NULL,
    prompt_text = NULL,
    updated_at = now()
  WHERE path_id IN (
      SELECT paths.id
      FROM public.user_learning_paths AS paths
      WHERE paths.user_id = v_user_id
        AND paths.status = 'active'
    )
    AND language IS DISTINCT FROM p_language
    AND status <> 'completed'
    AND completed_at IS NULL;

  RETURN QUERY
  SELECT profiles.id, profiles.language, profiles.updated_at
  FROM public.profiles
  WHERE profiles.id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_language(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_profile_language(TEXT) TO authenticated;
