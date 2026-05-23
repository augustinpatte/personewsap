CREATE TABLE IF NOT EXISTS public.business_story_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID REFERENCES public.content_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  main_company TEXT NOT NULL,
  companies_mentioned TEXT[] NOT NULL DEFAULT '{}',
  industry TEXT NOT NULL,
  key_mechanism TEXT NOT NULL,
  secondary_mechanisms TEXT[] NOT NULL DEFAULT '{}',
  strategic_angle TEXT NOT NULL,
  core_takeaway TEXT NOT NULL,
  year_period TEXT NOT NULL,
  language TEXT NOT NULL,
  published_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_story_history_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT business_story_history_slug_not_blank CHECK (length(trim(slug)) > 0),
  CONSTRAINT business_story_history_entity_name_not_blank CHECK (length(trim(entity_name)) > 0),
  CONSTRAINT business_story_history_main_company_not_blank CHECK (length(trim(main_company)) > 0),
  CONSTRAINT business_story_history_industry_not_blank CHECK (length(trim(industry)) > 0),
  CONSTRAINT business_story_history_key_mechanism_not_blank CHECK (length(trim(key_mechanism)) > 0),
  CONSTRAINT business_story_history_strategic_angle_not_blank CHECK (length(trim(strategic_angle)) > 0),
  CONSTRAINT business_story_history_core_takeaway_not_blank CHECK (length(trim(core_takeaway)) > 0),
  CONSTRAINT business_story_history_year_period_not_blank CHECK (length(trim(year_period)) > 0),
  CONSTRAINT business_story_history_entity_type_check CHECK (
    entity_type IN ('founder', 'ceo', 'investor', 'company', 'product', 'crisis', 'acquisition', 'strategy', 'other')
  ),
  CONSTRAINT business_story_history_language_check CHECK (language IN ('fr', 'en'))
);

CREATE UNIQUE INDEX IF NOT EXISTS business_story_history_slug_unique
ON public.business_story_history(slug);

CREATE UNIQUE INDEX IF NOT EXISTS business_story_history_content_item_id_unique
ON public.business_story_history(content_item_id)
WHERE content_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_story_history_language_date
ON public.business_story_history(language, published_date DESC);

CREATE INDEX IF NOT EXISTS idx_business_story_history_entity_cooldown
ON public.business_story_history(language, lower(entity_name), published_date DESC);

CREATE INDEX IF NOT EXISTS idx_business_story_history_company_cooldown
ON public.business_story_history(language, lower(main_company), published_date DESC);

CREATE INDEX IF NOT EXISTS idx_business_story_history_mechanism_cooldown
ON public.business_story_history(language, lower(key_mechanism), published_date DESC);

CREATE INDEX IF NOT EXISTS idx_business_story_history_industry_cooldown
ON public.business_story_history(language, lower(industry), published_date DESC);

CREATE INDEX IF NOT EXISTS idx_business_story_history_angle_cooldown
ON public.business_story_history(language, lower(strategic_angle), published_date DESC);

ALTER TABLE public.business_story_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.business_story_history IS
  'Service-role editorial memory for business-story freshness. No user-facing RLS policies are defined.';

COMMENT ON COLUMN public.business_story_history.slug IS
  'Stable normalized title slug. Unique forever to prevent repeated business-story framing.';
