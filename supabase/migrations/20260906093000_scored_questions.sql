-- Scored questions: display and grading, kept apart — PRODUCTION project.
--
-- THE CONSTRAINT THIS FILE EXISTS FOR (Prompt 1 §8): the mobile client must
-- never be able to fetch the mapping
--
--     option -> 0 | 300 | 600 | 1000
--
-- Today's mini cases fail that test by construction: the whole case, including
-- each option's `outcome` ("best"/"viable"/"weak") and its feedback, is embedded
-- in `content_items.metadata` and handed to the app in one read. That is fine
-- for a self-marked exercise and impossible for a competitive one.
--
-- So scored questions are modelled separately, in three layers:
--
--   logical      — the question itself, language-independent
--   localized    — what a French or English reader sees
--   private      — what it is worth, in a schema PostgREST does not serve
--
-- The `private` schema is the load-bearing part. Supabase exposes only the
-- schemas listed in its API settings (public, graphql_public, storage); a table
-- in `private` has no REST route at all. Privileges are revoked on top of that,
-- so the separation survives someone adding a schema to that list by accident.
--
-- BILINGUAL FAIRNESS (§9): the logical layer is shared between the FR and the
-- EN rendering of a story, and so is the grade. Two team-mates reading in
-- different languages answer the same question, scored on the same scale — and
-- because an attempt is unique per *logical* question, neither can answer in
-- French and then replay in English.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. A composite key on content_items, so a locale row cannot lie
-- ---------------------------------------------------------------------------
-- (id, language) is trivially unique — id is the primary key — but a UNIQUE
-- constraint is what lets a foreign key reference the pair. With it, a locale
-- row claiming to be the French rendering must point at a content item that
-- really is French. Additive: one index, no behaviour change.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_items_id_language_key'
  ) THEN
    ALTER TABLE public.content_items
      ADD CONSTRAINT content_items_id_language_key UNIQUE (id, language);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. The logical question
-- ---------------------------------------------------------------------------
-- Anchored on `content_logical_key`, the key introduced by
-- 20260904121000_content_translation_access to tie the FR and EN renderings of
-- one editorial job together. Reusing it is the point: there is exactly one
-- notion of "the same content in the other language" in this database, and
-- questions ride on it rather than inventing a second one.

CREATE TABLE IF NOT EXISTS public.logical_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_logical_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  question_sequence SMALLINT NOT NULL,
  question_role TEXT,
  time_limit_seconds SMALLINT NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT logical_questions_key_unique
    UNIQUE (content_logical_key, content_type, question_sequence),

  -- The shape of a question set, per product surface (§2):
  --
  --   newsletter_article  2 questions   solo and team
  --   mini_case           3 questions   solo and team, fixed pedagogical order
  --   business_story      2 questions   solo only (enforced on the team
  --                                     assignment table further down)
  --
  -- The mini-case roles are not merely constrained to a list, they are pinned to
  -- their position: sequence 1 is always the method/framework question, 2 the
  -- technical application, 3 the conclusion/decision. That progression is the
  -- exercise, so the database holds it rather than trusting the generator.
  CONSTRAINT logical_questions_shape_check CHECK (
    (
      content_type = 'mini_case'
      AND question_sequence BETWEEN 1 AND 3
      AND question_role = (ARRAY[
        'method_framework',
        'technical_application',
        'conclusion_decision'
      ])[question_sequence]
    )
    OR (
      content_type IN ('newsletter_article', 'business_story')
      AND question_sequence BETWEEN 1 AND 2
      -- The two reading roles, named as the content engine names them
      -- (services/content-engine/src/generation/gradedQuestions.ts):
      -- interpretation asks what mechanism produced the outcome,
      -- application_decision asks what to do with it. NULL stays allowed for
      -- the questions backfilled onto content that predates the roles.
      AND (question_role IS NULL OR question_role IN ('interpretation', 'application_decision'))
    )
  ),

  -- 20 seconds is the product answer (§8/§11). The range leaves room to tune it
  -- without a migration while making a 0 or a 3600 impossible.
  CONSTRAINT logical_questions_time_limit_check CHECK (time_limit_seconds BETWEEN 5 AND 120)
);

-- Referenced by the composite foreign key on team_question_assignments, which
-- is how "a Business Story question can never be assigned to a Team" becomes a
-- referential fact instead of a trigger.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'logical_questions_id_content_type_key'
  ) THEN
    ALTER TABLE public.logical_questions
      ADD CONSTRAINT logical_questions_id_content_type_key UNIQUE (id, content_type);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_logical_questions_content
  ON public.logical_questions (content_logical_key, content_type, question_sequence);

COMMENT ON TABLE public.logical_questions IS
  'One row per question, independent of language. Tied to content through content_logical_key so the FR and EN renderings of a story share the question — and therefore the grading scale and the single-attempt rule.';
COMMENT ON COLUMN public.logical_questions.question_role IS
  'Mini cases keep the fixed pedagogical progression method_framework -> technical_application -> conclusion_decision, checked against question_sequence.';

-- ---------------------------------------------------------------------------
-- 2. The logical option
-- ---------------------------------------------------------------------------
-- An option's identity is also language-independent: option "b" is the same
-- answer whichever language it is read in, and it carries one grade.

CREATE TABLE IF NOT EXISTS public.logical_question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_question_id UUID NOT NULL REFERENCES public.logical_questions(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT logical_question_options_key_check CHECK (option_key ~ '^[a-z]$'),
  CONSTRAINT logical_question_options_unique UNIQUE (logical_question_id, option_key)
);

CREATE INDEX IF NOT EXISTS idx_logical_question_options_question
  ON public.logical_question_options (logical_question_id);

COMMENT ON TABLE public.logical_question_options IS
  'Language-independent answer identity. Deliberately carries no text and no score: the text is in the locale table, the score is in the private schema.';

-- ---------------------------------------------------------------------------
-- 3. The localized surface — what a reader is allowed to see
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.logical_question_locales (
  logical_question_id UUID NOT NULL REFERENCES public.logical_questions(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  content_item_id UUID NOT NULL,
  prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (logical_question_id, language),
  CONSTRAINT logical_question_locales_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT logical_question_locales_prompt_not_blank CHECK (length(btrim(prompt)) > 0),
  -- The composite reference: a row claiming to be French must point at the
  -- French content item, not at its twin.
  CONSTRAINT logical_question_locales_content_fkey
    FOREIGN KEY (content_item_id, language)
    REFERENCES public.content_items (id, language)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_logical_question_locales_content_item
  ON public.logical_question_locales (content_item_id);

CREATE TABLE IF NOT EXISTS public.logical_question_option_locales (
  option_id UUID NOT NULL REFERENCES public.logical_question_options(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, language),
  CONSTRAINT logical_question_option_locales_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT logical_question_option_locales_label_not_blank CHECK (length(btrim(label)) > 0)
);

COMMENT ON TABLE public.logical_question_option_locales IS
  'The option text a reader sees. Contains the label and nothing else — no outcome, no ordering hint, no explanation — because everything here is readable before the answer is given.';

-- ---------------------------------------------------------------------------
-- 4. The private surface — what a reader must not see
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

COMMENT ON SCHEMA private IS
  'Never exposed through PostgREST. Holds answer keys and editorial rationales: material that would invalidate a competitive question the moment a client could read it.';

CREATE TABLE IF NOT EXISTS private.logical_question_grades (
  option_id UUID PRIMARY KEY REFERENCES public.logical_question_options(id) ON DELETE CASCADE,
  score_milli INTEGER NOT NULL,
  grade_band TEXT NOT NULL,
  rationale_md TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT logical_question_grades_score_check CHECK (score_milli IN (0, 300, 600, 1000)),
  CONSTRAINT logical_question_grades_band_check CHECK (
    grade_band IN ('bad', 'average', 'good', 'excellent')
  ),
  -- The band is the score, named. Storing both and letting them disagree would
  -- make "which one is the truth" a question the Reviewer has to answer.
  CONSTRAINT logical_question_grades_band_matches_score_check CHECK (
    (score_milli = 0    AND grade_band = 'bad')
    OR (score_milli = 300  AND grade_band = 'average')
    OR (score_milli = 600  AND grade_band = 'good')
    OR (score_milli = 1000 AND grade_band = 'excellent')
  )
);

COMMENT ON TABLE private.logical_question_grades IS
  'The answer key: what each option is worth, plus the editorial rationale the Reviewer works from. Unreachable from any client key by construction — the schema has no REST route and no privileges are granted to anon or authenticated.';

-- The post-answer explanation. Localized, player-facing, and still private
-- until the player has actually answered: shown before the submit it would say
-- which option is right. public.get_question_feedback() below is the only way
-- out of here, and it checks for a submitted attempt first.
CREATE TABLE IF NOT EXISTS private.logical_question_option_feedback (
  option_id UUID NOT NULL REFERENCES public.logical_question_options(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  feedback_md TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, language),
  CONSTRAINT logical_question_option_feedback_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT logical_question_option_feedback_not_blank CHECK (length(btrim(feedback_md)) > 0)
);

COMMENT ON TABLE private.logical_question_option_feedback IS
  'Localized explanation shown after answering. Private rather than public because reading it beforehand reveals the answer; released by public.get_question_feedback() once the caller has submitted.';

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA private TO service_role;

-- Anything added to `private` later inherits the same answer.
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM authenticated;

-- RLS on top of the privilege revocation. Belt and braces: if a future
-- migration grants SELECT to authenticated by accident, there is still no
-- policy and therefore still no readable row.
ALTER TABLE private.logical_question_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.logical_question_option_feedback ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. Assignment — who is entitled to be asked
-- ---------------------------------------------------------------------------
-- Personal and Team assignments stay separate surfaces (§13). `daily_drop_items`
-- keeps meaning exactly what it means today — the reader's own edition — and
-- nothing writes Team content into it. The mobile client merges the two later.

CREATE TABLE IF NOT EXISTS public.solo_question_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  edition_date DATE NOT NULL,
  logical_question_id UUID NOT NULL REFERENCES public.logical_questions(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT solo_question_assignments_unique UNIQUE (user_id, edition_date, logical_question_id)
);

CREATE INDEX IF NOT EXISTS idx_solo_question_assignments_user_edition
  ON public.solo_question_assignments (user_id, edition_date);

CREATE INDEX IF NOT EXISTS idx_solo_question_assignments_question
  ON public.solo_question_assignments (logical_question_id, user_id);

CREATE TABLE IF NOT EXISTS public.team_question_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  edition_date DATE NOT NULL,
  logical_question_id UUID NOT NULL,
  -- Denormalized so the exclusion below can be a plain CHECK plus a composite
  -- foreign key. It cannot drift: the FK requires the pair to exist.
  content_type TEXT NOT NULL,
  -- The configuration this assignment was produced from. An edition's questions
  -- can therefore always be explained after the fact, even once the team has
  -- moved on to a newer config version.
  config_version_id UUID REFERENCES public.team_config_versions(id) ON DELETE SET NULL,
  position SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT team_question_assignments_unique
    UNIQUE (team_id, edition_date, logical_question_id),

  -- Business Stories are solo, always (§2). Not a policy, not a trigger, not a
  -- convention in the assignment job: a row that would break the rule cannot be
  -- inserted.
  CONSTRAINT team_question_assignments_no_business_story_check
    CHECK (content_type IN ('newsletter_article', 'mini_case')),

  CONSTRAINT team_question_assignments_question_fkey
    FOREIGN KEY (logical_question_id, content_type)
    REFERENCES public.logical_questions (id, content_type)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_question_assignments_team_edition
  ON public.team_question_assignments (team_id, edition_date);

CREATE INDEX IF NOT EXISTS idx_team_question_assignments_question
  ON public.team_question_assignments (logical_question_id, team_id, edition_date);

COMMENT ON TABLE public.team_question_assignments IS
  'The questions a Team is playing in an edition, snapshotted from the config version that was effective for it. Separate from daily_drop_items on purpose: a Team assignment is not a personal edition item.';

-- ---------------------------------------------------------------------------
-- 6. The entitlement predicate
-- ---------------------------------------------------------------------------
-- One answer to "may this reader be asked this question", used by every RLS
-- policy on the display tables and by the attempt RPCs. Mid-edition joiners are
-- excluded from their team's current edition (§5) by the eligibility date, so
-- they cannot even fetch the questions they might already have read.

CREATE OR REPLACE FUNCTION public.user_has_question_assignment(p_logical_question_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.solo_question_assignments s
    WHERE s.logical_question_id = p_logical_question_id
      AND s.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.team_question_assignments a
    JOIN public.team_members m
      ON m.team_id = a.team_id
     AND m.user_id = auth.uid()
     AND m.left_at IS NULL
     AND m.eligible_from_edition <= a.edition_date
    WHERE a.logical_question_id = p_logical_question_id
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_question_assignment(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_question_assignment(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_question_assignment(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.user_has_question_assignment(UUID) IS
  'True when the caller has been assigned the question, personally or through a team they were eligible for in that edition. The single gate in front of every question read.';

-- Which teams a submitted answer should count for. Used by the fanout at submit
-- time (§13): one question can be assigned to several of a reader''s teams, is
-- played once, and scores in each of them.
CREATE OR REPLACE FUNCTION public.teams_scoring_question(
  p_user_id UUID,
  p_logical_question_id UUID
)
RETURNS TABLE (team_id UUID, edition_date DATE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.team_id, a.edition_date
  FROM public.team_question_assignments a
  JOIN public.team_members m
    ON m.team_id = a.team_id
   AND m.user_id = p_user_id
   AND m.left_at IS NULL
   AND m.eligible_from_edition <= a.edition_date
  JOIN public.teams t
    ON t.id = a.team_id
   AND t.status = 'active'
  WHERE a.logical_question_id = p_logical_question_id
    -- Only editions still open: a late answer is recorded, and it does not
    -- reopen a settled leaderboard (§15).
    AND public.is_edition_open(a.edition_date);
$$;

REVOKE ALL ON FUNCTION public.teams_scoring_question(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teams_scoring_question(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.teams_scoring_question(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.teams_scoring_question(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS on the display surface
-- ---------------------------------------------------------------------------

ALTER TABLE public.logical_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logical_question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logical_question_locales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logical_question_option_locales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_question_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_question_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Assigned readers can read a question" ON public.logical_questions;
CREATE POLICY "Assigned readers can read a question"
ON public.logical_questions
FOR SELECT
USING (public.user_has_question_assignment(id));

DROP POLICY IF EXISTS "Assigned readers can read question options" ON public.logical_question_options;
CREATE POLICY "Assigned readers can read question options"
ON public.logical_question_options
FOR SELECT
USING (public.user_has_question_assignment(logical_question_id));

DROP POLICY IF EXISTS "Assigned readers can read a localized question" ON public.logical_question_locales;
CREATE POLICY "Assigned readers can read a localized question"
ON public.logical_question_locales
FOR SELECT
USING (public.user_has_question_assignment(logical_question_id));

DROP POLICY IF EXISTS "Assigned readers can read localized options" ON public.logical_question_option_locales;
CREATE POLICY "Assigned readers can read localized options"
ON public.logical_question_option_locales
FOR SELECT
USING (EXISTS (
  SELECT 1
  FROM public.logical_question_options o
  WHERE o.id = option_id
    AND public.user_has_question_assignment(o.logical_question_id)
));

DROP POLICY IF EXISTS "Readers can read their own solo assignments" ON public.solo_question_assignments;
CREATE POLICY "Readers can read their own solo assignments"
ON public.solo_question_assignments
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Members can read their team assignments" ON public.team_question_assignments;
CREATE POLICY "Members can read their team assignments"
ON public.team_question_assignments
FOR SELECT
USING (public.is_active_team_member(team_id));

-- No INSERT, UPDATE or DELETE policy on any of the six tables, and no write
-- privilege below: questions and assignments are written by the content engine
-- with the service role, never by a client.
REVOKE ALL ON TABLE public.logical_questions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.logical_question_options FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.logical_question_locales FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.logical_question_option_locales FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.solo_question_assignments FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.team_question_assignments FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.logical_questions TO authenticated;
GRANT SELECT ON TABLE public.logical_question_options TO authenticated;
GRANT SELECT ON TABLE public.logical_question_locales TO authenticated;
GRANT SELECT ON TABLE public.logical_question_option_locales TO authenticated;
GRANT SELECT ON TABLE public.solo_question_assignments TO authenticated;
GRANT SELECT ON TABLE public.team_question_assignments TO authenticated;

GRANT ALL ON TABLE public.logical_questions TO service_role;
GRANT ALL ON TABLE public.logical_question_options TO service_role;
GRANT ALL ON TABLE public.logical_question_locales TO service_role;
GRANT ALL ON TABLE public.logical_question_option_locales TO service_role;
GRANT ALL ON TABLE public.solo_question_assignments TO service_role;
GRANT ALL ON TABLE public.team_question_assignments TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
