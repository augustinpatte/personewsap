-- Store mini-case topic interests independently from newsletter topic depth.
-- Keep user_preferences.mini_case_topic_id as a legacy compatibility signal only.

CREATE TABLE IF NOT EXISTS public.user_mini_case_topic_preferences (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id),
  CONSTRAINT user_mini_case_topic_preferences_topic_id_check
    CHECK (topic_id IN (
      'law',
      'finance_economy',
      'artificial_intelligence',
      'stock_market',
      'engineering',
      'health',
      'entrepreneurship',
      'career'
    )),
  CONSTRAINT user_mini_case_topic_preferences_position_check
    CHECK (position IS NULL OR position BETWEEN 1 AND 8)
);

CREATE INDEX IF NOT EXISTS idx_user_mini_case_topic_preferences_user
ON public.user_mini_case_topic_preferences(user_id);

ALTER TABLE public.user_mini_case_topic_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences;

CREATE POLICY "Users can insert their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences
FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences;

CREATE POLICY "Users can read their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences;

CREATE POLICY "Users can update their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences;

CREATE POLICY "Users can delete their own mini-case topic preferences"
ON public.user_mini_case_topic_preferences
FOR DELETE
USING (user_id = auth.uid());

WITH compat_topic AS (
  SELECT
    preferences.user_id,
    CASE preferences.mini_case_topic_id
      WHEN 'law' THEN 'law'
      WHEN 'finance' THEN 'finance_economy'
      WHEN 'tech_ai' THEN 'artificial_intelligence'
      WHEN 'business' THEN 'stock_market'
      WHEN 'medicine' THEN 'health'
      WHEN 'engineering' THEN 'engineering'
      WHEN 'sport_business' THEN 'entrepreneurship'
      WHEN 'culture_media' THEN 'career'
      ELSE NULL
    END AS topic_id
  FROM public.user_preferences AS preferences
)
INSERT INTO public.user_mini_case_topic_preferences (
  user_id,
  topic_id,
  enabled,
  position
)
SELECT
  user_id,
  topic_id,
  true,
  1
FROM compat_topic
WHERE topic_id IS NOT NULL
ON CONFLICT (user_id, topic_id)
DO UPDATE SET
  enabled = true,
  position = 1,
  updated_at = now();
