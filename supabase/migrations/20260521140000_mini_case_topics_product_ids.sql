-- Ensure mini-case preferences use product mini-case topic IDs, not newsletter/content topic IDs.
-- Runtime code must not infer these from user_topic_preferences.

ALTER TABLE IF EXISTS public.user_mini_case_topic_preferences
  DROP CONSTRAINT IF EXISTS user_mini_case_topic_preferences_topic_id_fkey;

WITH mapped_preferences AS (
  SELECT
    ctid,
    user_id,
    CASE topic_id
      WHEN 'finance' THEN 'finance_economy'
      WHEN 'tech_ai' THEN 'artificial_intelligence'
      WHEN 'business' THEN 'stock_market'
      WHEN 'medicine' THEN 'health'
      WHEN 'sport_business' THEN 'entrepreneurship'
      WHEN 'culture_media' THEN 'career'
      ELSE topic_id
    END AS mapped_topic_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id,
      CASE topic_id
        WHEN 'finance' THEN 'finance_economy'
        WHEN 'tech_ai' THEN 'artificial_intelligence'
        WHEN 'business' THEN 'stock_market'
        WHEN 'medicine' THEN 'health'
        WHEN 'sport_business' THEN 'entrepreneurship'
        WHEN 'culture_media' THEN 'career'
        ELSE topic_id
      END
      ORDER BY enabled DESC, position NULLS LAST, topic_id
    ) AS duplicate_rank
  FROM public.user_mini_case_topic_preferences
)
DELETE FROM public.user_mini_case_topic_preferences AS preferences
USING mapped_preferences
WHERE preferences.ctid = mapped_preferences.ctid
  AND mapped_preferences.duplicate_rank > 1;

UPDATE public.user_mini_case_topic_preferences
SET topic_id = CASE topic_id
  WHEN 'finance' THEN 'finance_economy'
  WHEN 'tech_ai' THEN 'artificial_intelligence'
  WHEN 'business' THEN 'stock_market'
  WHEN 'medicine' THEN 'health'
  WHEN 'sport_business' THEN 'entrepreneurship'
  WHEN 'culture_media' THEN 'career'
  ELSE topic_id
END
WHERE topic_id IN (
  'finance',
  'tech_ai',
  'business',
  'medicine',
  'sport_business',
  'culture_media'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_mini_case_topic_preferences_topic_id_check'
  ) THEN
    ALTER TABLE public.user_mini_case_topic_preferences
      ADD CONSTRAINT user_mini_case_topic_preferences_topic_id_check
      CHECK (topic_id IN (
        'law',
        'finance_economy',
        'artificial_intelligence',
        'stock_market',
        'engineering',
        'health',
        'entrepreneurship',
        'career'
      ));
  END IF;
END $$;
