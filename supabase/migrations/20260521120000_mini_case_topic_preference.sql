-- Legacy compatibility column for the previous one-topic mini-case preference model.
-- Runtime selection now uses user_mini_case_topic_preferences instead.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS mini_case_topic_id TEXT REFERENCES public.topics(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_user_preferences_mini_case_topic
ON public.user_preferences(mini_case_topic_id);
