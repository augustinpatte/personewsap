-- Mobile push notification readiness.
-- This is token capture only: no backend sender or scheduler is added here.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS preferred_notification_time TEXT NOT NULL DEFAULT '08:00';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_preferences_preferred_notification_time_check'
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_preferred_notification_time_check
      CHECK (preferred_notification_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'unknown',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_push_token),
  CONSTRAINT push_tokens_token_not_blank CHECK (length(trim(expo_push_token)) > 0),
  CONSTRAINT push_tokens_platform_check CHECK (platform IN ('ios', 'android', 'web', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_enabled
ON public.push_tokens(user_id, enabled);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own push tokens" ON public.push_tokens;
DROP POLICY IF EXISTS "Users can insert their own push tokens" ON public.push_tokens;
DROP POLICY IF EXISTS "Users can update their own push tokens" ON public.push_tokens;
DROP POLICY IF EXISTS "Users can delete their own push tokens" ON public.push_tokens;

CREATE POLICY "Users can read their own push tokens"
ON public.push_tokens
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own push tokens"
ON public.push_tokens
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own push tokens"
ON public.push_tokens
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own push tokens"
ON public.push_tokens
FOR DELETE
USING (user_id = auth.uid());
