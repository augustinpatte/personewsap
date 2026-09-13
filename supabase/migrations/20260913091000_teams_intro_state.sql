-- Teams introduction: shown once per reader, remembered across devices — PRODUCTION.
--
-- The first time a reader opens the Teams tab, the app explains how to play,
-- how points work (1 / 0.6 / 0.3 / 0) and how Teams count an answer. Once they
-- finish it, it never opens by itself again — on this phone, on a new phone, or
-- after a reinstall. That needs one fact per reader on the server.
--
-- It lives on public.profiles, the row every per-reader feature already keys
-- on, rather than in a new table: one nullable timestamp does not justify a
-- second place to look, and profiles is already owner-only (SELECT and UPDATE
-- policies say auth.uid() = id). Team-mates read each other through functions
-- that return named columns, so this one is exposed to nobody else.
--
-- Additive and safe for existing rows: NULL means "not finished yet". Every
-- existing reader sees the introduction once, on their next visit to Teams.
--
-- complete_teams_intro() is the only writer the app uses. It is idempotent and
-- monotonic: it stamps the first completion and returns it forever after, so a
-- reader reopening "How scoring works" by hand can never reset anything.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS teams_intro_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.teams_intro_completed_at IS
  'When the reader finished the Teams introduction. NULL until then: the Teams tab shows it once, on any device, and never again after.';

CREATE OR REPLACE FUNCTION public.complete_teams_intro()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $intro$
DECLARE
  v_user_id UUID := auth.uid();
  v_completed TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  -- The caller's own row, and only this column. The first completion wins.
  UPDATE public.profiles AS profile
  SET teams_intro_completed_at = coalesce(profile.teams_intro_completed_at, now())
  WHERE profile.id = v_user_id
  RETURNING profile.teams_intro_completed_at INTO v_completed;

  RETURN v_completed;
END;
$intro$;

REVOKE ALL ON FUNCTION public.complete_teams_intro() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_teams_intro() FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_teams_intro() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_teams_intro() TO service_role;

COMMENT ON FUNCTION public.complete_teams_intro() IS
  'Marks the Teams introduction finished for the caller. Idempotent: the first completion time is kept and returned on every later call.';

COMMIT;

NOTIFY pgrst, 'reload schema';
