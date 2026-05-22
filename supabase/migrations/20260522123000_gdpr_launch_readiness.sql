-- Minimum GDPR/commercial launch readiness hardening.
-- Adds user-controlled deletion policies for personal interaction rows,
-- removes unused profile fields, and gives pending registrations a TTL path.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS birth_year;

DROP POLICY IF EXISTS "Users can delete own interactions for assigned content" ON public.content_interactions;
DROP POLICY IF EXISTS "Users can delete their own interactions" ON public.content_interactions;

CREATE POLICY "Users can delete their own interactions"
ON public.content_interactions
FOR DELETE
USING (
  user_id = auth.uid()
);

DROP POLICY IF EXISTS "Users can delete own mini-case responses for assigned content" ON public.mini_case_responses;
DROP POLICY IF EXISTS "Users can delete their own mini-case responses" ON public.mini_case_responses;

CREATE POLICY "Users can delete their own mini-case responses"
ON public.mini_case_responses
FOR DELETE
USING (
  user_id = auth.uid()
);

ALTER TABLE public.pending_registrations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.pending_registrations
SET expires_at = created_at + INTERVAL '14 days'
WHERE expires_at IS NULL;

ALTER TABLE public.pending_registrations
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '14 days');

CREATE INDEX IF NOT EXISTS idx_pending_registrations_expires_at
ON public.pending_registrations(expires_at);

CREATE OR REPLACE FUNCTION public.cleanup_expired_pending_registrations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.pending_registrations
  WHERE expires_at IS NOT NULL
    AND expires_at < now();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_pending_registrations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_pending_registrations() TO service_role;
