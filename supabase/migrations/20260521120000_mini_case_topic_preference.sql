-- Store the one explicit topic a user wants for the daily mini-case.
-- Additive: preserves existing newsletter/user preference tables and backfills from
-- enabled topic preferences so existing mobile users remain assignment-eligible.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS mini_case_topic_id TEXT REFERENCES public.topics(id) ON DELETE RESTRICT;

WITH first_enabled_topic AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    topic_id
  FROM public.user_topic_preferences
  WHERE enabled = true
  ORDER BY user_id, position NULLS LAST, topic_id
)
UPDATE public.user_preferences AS preferences
SET mini_case_topic_id = first_enabled_topic.topic_id
FROM first_enabled_topic
WHERE preferences.user_id = first_enabled_topic.user_id
  AND preferences.mini_case_topic_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_preferences_mini_case_topic
ON public.user_preferences(mini_case_topic_id);
