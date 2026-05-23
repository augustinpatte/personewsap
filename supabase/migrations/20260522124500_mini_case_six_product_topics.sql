-- Align mini-case preferences to the six product-ready categories.
-- Newsletter topics remain stored separately in user_topic_preferences.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS newsletter_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_stories_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mini_cases_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.user_mini_case_topic_preferences
  DROP CONSTRAINT IF EXISTS user_mini_case_topic_preferences_topic_id_check;

WITH mapped_preferences AS (
  SELECT
    ctid,
    user_id,
    CASE topic_id
      WHEN 'finance' THEN 'finance_economy'
      WHEN 'tech_ai' THEN 'ai'
      WHEN 'artificial_intelligence' THEN 'ai'
      WHEN 'medicine' THEN 'health_pharma'
      WHEN 'health' THEN 'health_pharma'
      WHEN 'law' THEN 'law_compliance'
      WHEN 'engineering' THEN 'engineering_operations'
      WHEN 'market' THEN 'stock_market'
      WHEN 'business' THEN 'stock_market'
      WHEN 'entrepreneurship' THEN 'stock_market'
      WHEN 'career' THEN 'engineering_operations'
      ELSE topic_id
    END AS mapped_topic_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id,
      CASE topic_id
        WHEN 'finance' THEN 'finance_economy'
        WHEN 'tech_ai' THEN 'ai'
        WHEN 'artificial_intelligence' THEN 'ai'
        WHEN 'medicine' THEN 'health_pharma'
        WHEN 'health' THEN 'health_pharma'
        WHEN 'law' THEN 'law_compliance'
        WHEN 'engineering' THEN 'engineering_operations'
        WHEN 'market' THEN 'stock_market'
        WHEN 'business' THEN 'stock_market'
        WHEN 'entrepreneurship' THEN 'stock_market'
        WHEN 'career' THEN 'engineering_operations'
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
  WHEN 'tech_ai' THEN 'ai'
  WHEN 'artificial_intelligence' THEN 'ai'
  WHEN 'medicine' THEN 'health_pharma'
  WHEN 'health' THEN 'health_pharma'
  WHEN 'law' THEN 'law_compliance'
  WHEN 'engineering' THEN 'engineering_operations'
  WHEN 'market' THEN 'stock_market'
  WHEN 'business' THEN 'stock_market'
  WHEN 'entrepreneurship' THEN 'stock_market'
  WHEN 'career' THEN 'engineering_operations'
  ELSE topic_id
END;

DELETE FROM public.user_mini_case_topic_preferences
WHERE topic_id NOT IN (
  'finance_economy',
  'stock_market',
  'ai',
  'law_compliance',
  'health_pharma',
  'engineering_operations'
);

ALTER TABLE public.user_mini_case_topic_preferences
  ADD CONSTRAINT user_mini_case_topic_preferences_topic_id_check
  CHECK (topic_id IN (
    'finance_economy',
    'stock_market',
    'ai',
    'law_compliance',
    'health_pharma',
    'engineering_operations'
  ));
