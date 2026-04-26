-- Mobile app foundation schema for PersoNewsAP.
-- This migration is additive: it leaves the existing newsletter tables intact.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_user_id UUID UNIQUE REFERENCES public.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  birth_year INTEGER CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT profiles_email_not_blank CHECK (length(trim(email)) > 0)
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal TEXT NOT NULL DEFAULT 'become_sharper_daily',
  frequency TEXT NOT NULL DEFAULT 'daily',
  newsletter_article_count INTEGER NOT NULL DEFAULT 8,
  notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_preferences_goal_check CHECK (
    goal IN (
      'understand_world',
      'prepare_career',
      'learn_business',
      'explore_stem',
      'become_sharper_daily'
    )
  ),
  CONSTRAINT user_preferences_frequency_check CHECK (
    frequency IN ('daily', 'weekdays', 'weekly')
  ),
  CONSTRAINT user_preferences_newsletter_article_count_check CHECK (
    newsletter_article_count BETWEEN 1 AND 24
  )
);

CREATE TABLE IF NOT EXISTS public.topics (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  label_fr TEXT NOT NULL,
  label_en TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT topics_id_check CHECK (
    id IN (
      'business',
      'finance',
      'tech_ai',
      'law',
      'medicine',
      'engineering',
      'sport_business',
      'culture_media'
    )
  )
);

INSERT INTO public.topics (id, position, label_fr, label_en, active)
VALUES
  ('business', 1, 'Business', 'Business', true),
  ('finance', 2, 'Finance', 'Finance', true),
  ('tech_ai', 3, 'Tech / IA', 'Tech / AI', true),
  ('law', 4, 'Droit', 'Law', true),
  ('medicine', 5, 'Médecine', 'Medicine', true),
  ('engineering', 6, 'Ingénierie', 'Engineering', true),
  ('sport_business', 7, 'Sport business', 'Sport Business', true),
  ('culture_media', 8, 'Culture / Médias', 'Culture / Media', true)
ON CONFLICT (id) DO UPDATE
SET
  position = EXCLUDED.position,
  label_fr = EXCLUDED.label_fr,
  label_en = EXCLUDED.label_en,
  active = EXCLUDED.active,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.user_topic_preferences (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE RESTRICT,
  articles_count INTEGER NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id),
  CONSTRAINT user_topic_preferences_articles_count_check CHECK (articles_count BETWEEN 1 AND 3)
);

-- quick_quiz is intentionally allowed as a generated content type for
-- reinforcement questions, but it is not a daily_drop slot yet. The daily
-- experience remains limited to newsletter, business story, mini-case, and concept.
CREATE TABLE IF NOT EXISTS public.generation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  content_type TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  model_name TEXT,
  prompt_version TEXT NOT NULL,
  generator_version TEXT,
  input_hash TEXT,
  output_hash TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT generation_runs_content_type_check CHECK (
    content_type IN ('newsletter_article', 'business_story', 'mini_case', 'concept', 'quick_quiz')
  ),
  CONSTRAINT generation_runs_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT generation_runs_status_check CHECK (
    status IN ('queued', 'running', 'generated', 'reviewed', 'published', 'failed')
  )
);

CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  publisher TEXT,
  author TEXT,
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  language TEXT,
  credibility_score NUMERIC,
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sources_language_check CHECK (language IS NULL OR language IN ('fr', 'en')),
  CONSTRAINT sources_url_not_blank CHECK (length(trim(url)) > 0),
  CONSTRAINT sources_credibility_score_check CHECK (
    credibility_score IS NULL OR credibility_score BETWEEN 0 AND 1
  )
);

CREATE TABLE IF NOT EXISTS public.content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE RESTRICT,
  language TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body_md TEXT NOT NULL,
  difficulty TEXT,
  estimated_read_seconds INTEGER,
  publication_date DATE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  generation_run_id UUID REFERENCES public.generation_runs(id) ON DELETE SET NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_items_content_type_check CHECK (
    content_type IN ('newsletter_article', 'business_story', 'mini_case', 'concept', 'quick_quiz')
  ),
  CONSTRAINT content_items_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT content_items_difficulty_check CHECK (
    difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')
  ),
  CONSTRAINT content_items_status_check CHECK (status IN ('draft', 'review', 'published', 'archived')),
  CONSTRAINT content_items_version_check CHECK (version >= 1),
  CONSTRAINT content_items_source_count_check CHECK (source_count >= 0),
  CONSTRAINT content_items_estimated_read_seconds_check CHECK (
    estimated_read_seconds IS NULL OR estimated_read_seconds > 0
  ),
  CONSTRAINT content_items_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT content_items_body_not_blank CHECK (length(trim(body_md)) > 0)
);

CREATE TABLE IF NOT EXISTS public.content_item_sources (
  content_item_id UUID NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE RESTRICT,
  claim TEXT,
  source_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (content_item_id, source_id),
  CONSTRAINT content_item_sources_source_order_check CHECK (source_order >= 0)
);

CREATE TABLE IF NOT EXISTS public.daily_drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  drop_date DATE NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, drop_date),
  CONSTRAINT daily_drops_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT daily_drops_status_check CHECK (status IN ('generated', 'published', 'read', 'archived'))
);

CREATE TABLE IF NOT EXISTS public.daily_drop_items (
  daily_drop_id UUID NOT NULL REFERENCES public.daily_drops(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES public.content_items(id) ON DELETE RESTRICT,
  slot TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (daily_drop_id, content_item_id),
  UNIQUE (daily_drop_id, slot, position),
  CONSTRAINT daily_drop_items_slot_check CHECK (
    slot IN ('newsletter', 'business_story', 'mini_case', 'concept')
  ),
  CONSTRAINT daily_drop_items_position_check CHECK (position >= 0)
);

CREATE TABLE IF NOT EXISTS public.content_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL,
  rating TEXT,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_interactions_interaction_type_check CHECK (
    interaction_type IN ('view', 'complete', 'save', 'share', 'feedback')
  ),
  CONSTRAINT content_interactions_rating_check CHECK (
    rating IS NULL OR rating IN ('good', 'average', 'bad')
  )
);

-- No broad uniqueness constraint is added here. Repeated view/complete/save events
-- can be useful for analytics, and users may send multiple feedback messages for
-- the same item. If product later needs idempotent saves/completions, add a partial
-- unique index scoped only to those interaction types.
CREATE TABLE IF NOT EXISTS public.mini_case_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  answer_md TEXT NOT NULL,
  ai_feedback_md TEXT,
  score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mini_case_responses_answer_not_blank CHECK (length(trim(answer_md)) > 0),
  CONSTRAINT mini_case_responses_score_check CHECK (score IS NULL OR score BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_topic_preferences_user ON public.user_topic_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_runs_date_type_language ON public.generation_runs(run_date, content_type, language);
CREATE INDEX IF NOT EXISTS idx_sources_content_hash ON public.sources(content_hash);
CREATE INDEX IF NOT EXISTS idx_content_items_publication_date ON public.content_items(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_content_items_topic_language_status ON public.content_items(topic_id, language, status);
CREATE INDEX IF NOT EXISTS idx_content_items_type_language_status ON public.content_items(content_type, language, status);
CREATE INDEX IF NOT EXISTS idx_content_item_sources_source ON public.content_item_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_daily_drops_user_date ON public.daily_drops(user_id, drop_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_drops_status_date ON public.daily_drops(status, drop_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_drop_items_content ON public.daily_drop_items(content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_interactions_user ON public.content_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_interactions_content ON public.content_interactions(content_item_id);
CREATE INDEX IF NOT EXISTS idx_mini_case_responses_user ON public.mini_case_responses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mini_case_responses_content ON public.mini_case_responses(content_item_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_topic_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_item_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_drop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_case_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own mobile profile"
ON public.profiles
FOR INSERT
WITH CHECK (
  auth.uid() = id
  AND lower(email) = lower(auth.email())
);

CREATE POLICY "Users can read their own mobile profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own mobile profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND lower(email) = lower(auth.email())
);

CREATE POLICY "Users can insert their own preferences"
ON public.user_preferences
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "Users can read their own preferences"
ON public.user_preferences
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own preferences"
ON public.user_preferences
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Anyone can read active topics"
ON public.topics
FOR SELECT
USING (active = true);

CREATE POLICY "Users can insert their own topic preferences"
ON public.user_topic_preferences
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "Users can read their own topic preferences"
ON public.user_topic_preferences
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own topic preferences"
ON public.user_topic_preferences
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own topic preferences"
ON public.user_topic_preferences
FOR DELETE
USING (user_id = auth.uid());

-- No anon/authenticated policies are added for generation_runs.
-- Generation/admin writes should happen only from trusted server-side jobs using service role.

CREATE POLICY "Authenticated users can read published content"
ON public.content_items
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND status = 'published'
);

CREATE POLICY "Authenticated users can read sources for published content"
ON public.sources
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.content_item_sources cis
    JOIN public.content_items ci ON ci.id = cis.content_item_id
    WHERE cis.source_id = sources.id
      AND ci.status = 'published'
  )
);

CREATE POLICY "Authenticated users can read source links for published content"
ON public.content_item_sources
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.content_items ci
    WHERE ci.id = content_item_sources.content_item_id
      AND ci.status = 'published'
  )
);

CREATE POLICY "Users can read their own published daily drops"
ON public.daily_drops
FOR SELECT
USING (
  status IN ('published', 'read', 'archived')
  AND user_id = auth.uid()
);

CREATE POLICY "Users can read items for their own published daily drops"
ON public.daily_drop_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.daily_drops dd
    JOIN public.content_items ci ON ci.id = daily_drop_items.content_item_id
    WHERE dd.id = daily_drop_items.daily_drop_id
      AND dd.user_id = auth.uid()
      AND dd.status IN ('published', 'read', 'archived')
      AND ci.status = 'published'
  )
);

CREATE POLICY "Users can read their own interactions"
ON public.content_interactions
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own interactions"
ON public.content_interactions
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.content_items ci
    WHERE ci.id = content_interactions.content_item_id
      AND ci.status = 'published'
  )
);

CREATE POLICY "Users can read their own mini-case responses"
ON public.mini_case_responses
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own mini-case responses"
ON public.mini_case_responses
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.content_items ci
    WHERE ci.id = mini_case_responses.content_item_id
      AND ci.status = 'published'
      AND ci.content_type = 'mini_case'
  )
);

CREATE POLICY "Users can update their own mini-case responses"
ON public.mini_case_responses
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
