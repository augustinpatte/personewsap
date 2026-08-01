-- Learning Paths complete additive repair.
-- Creates the learning path foundation from a project with no learning tables,
-- and repairs the earlier lifecycle-only migration when it already ran.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_learning_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS learning_path_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS learning_path_choice_completed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.learning_domains (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label_fr TEXT NOT NULL,
  label_en TEXT NOT NULL,
  description_fr TEXT NOT NULL,
  description_en TEXT NOT NULL,
  position SMALLINT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_domains_id_not_blank CHECK (length(trim(id)) > 0),
  CONSTRAINT learning_domains_slug_not_blank CHECK (length(trim(slug)) > 0),
  CONSTRAINT learning_domains_id_slug_match CHECK (id = slug),
  CONSTRAINT learning_domains_label_fr_not_blank CHECK (length(trim(label_fr)) > 0),
  CONSTRAINT learning_domains_label_en_not_blank CHECK (length(trim(label_en)) > 0),
  CONSTRAINT learning_domains_description_fr_not_blank CHECK (length(trim(description_fr)) > 0),
  CONSTRAINT learning_domains_description_en_not_blank CHECK (length(trim(description_en)) > 0)
);

CREATE TABLE IF NOT EXISTS public.learning_objectives (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES public.learning_domains(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL,
  label_fr TEXT NOT NULL,
  label_en TEXT NOT NULL,
  description_fr TEXT NOT NULL,
  description_en TEXT NOT NULL,
  position SMALLINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_objectives_id_not_blank CHECK (length(trim(id)) > 0),
  CONSTRAINT learning_objectives_slug_not_blank CHECK (length(trim(slug)) > 0),
  CONSTRAINT learning_objectives_label_fr_not_blank CHECK (length(trim(label_fr)) > 0),
  CONSTRAINT learning_objectives_label_en_not_blank CHECK (length(trim(label_en)) > 0),
  CONSTRAINT learning_objectives_description_fr_not_blank CHECK (length(trim(description_fr)) > 0),
  CONSTRAINT learning_objectives_description_en_not_blank CHECK (length(trim(description_en)) > 0),
  UNIQUE (domain_id, slug),
  UNIQUE (domain_id, position),
  UNIQUE (id, domain_id)
);

INSERT INTO public.learning_domains (id, slug, position, label_fr, label_en, description_fr, description_en, active)
VALUES
  ('computer_science', 'computer_science', 1, 'Informatique', 'Computer Science', 'Comprendre les systèmes, les réseaux, les algorithmes et la logique du code.', 'Understand systems, networks, algorithms and the logic behind code.', true),
  ('artificial_intelligence', 'artificial_intelligence', 2, 'Intelligence artificielle', 'Artificial Intelligence', 'Apprendre comment les modèles apprennent, raisonnent et arrivent dans les produits.', 'Learn how models learn, reason and reach real products.', true),
  ('blockchain', 'blockchain', 3, 'Blockchain', 'Blockchain', 'Lire les réseaux décentralisés avec une logique technique, économique et juridique.', 'Read decentralized networks through technical, economic and legal logic.', true),
  ('quantum_physics', 'quantum_physics', 4, 'Physique quantique', 'Quantum Physics', 'Construire les bases pour comprendre états, mesures, qubits et applications.', 'Build the foundations for states, measurement, qubits and applications.', true),
  ('mathematics', 'mathematics', 5, 'Mathématiques', 'Mathematics', 'Renforcer les outils de raisonnement qui soutiennent la science, le logiciel et la finance.', 'Strengthen the reasoning tools behind science, software and finance.', true),
  ('cybersecurity', 'cybersecurity', 6, 'Cybersécurité', 'Cybersecurity', 'Comprendre les attaques, les défenses et les décisions de sécurité.', 'Understand attacks, defenses and security decisions.', true),
  ('human_biology_medicine', 'human_biology_medicine', 7, 'Biologie humaine et médecine', 'Human Biology and Medicine', 'Relier biologie, essais cliniques, preuves et décisions médicales générales.', 'Connect biology, clinical trials, evidence and general medical decisions.', true)
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug,
    position = EXCLUDED.position,
    label_fr = EXCLUDED.label_fr,
    label_en = EXCLUDED.label_en,
    description_fr = EXCLUDED.description_fr,
    description_en = EXCLUDED.description_en,
    active = EXCLUDED.active,
    updated_at = now();

INSERT INTO public.learning_objectives (id, domain_id, slug, position, label_fr, label_en, description_fr, description_en, active)
VALUES
  ('cs_systems', 'computer_science', 'systems', 1, 'Comprendre les systèmes', 'Understand computer systems', 'Découvrir ce qui se passe sous le code : processeurs, mémoire, systèmes d’exploitation, Internet et réseaux.', 'Learn what happens beneath the code: processors, memory, operating systems, the Internet and networks.', true),
  ('cs_programming', 'computer_science', 'programming', 2, 'Programmer et raisonner', 'Program and reason', 'Apprendre à décomposer un problème, écrire des algorithmes et produire du code fiable.', 'Learn to break down problems, design algorithms and produce reliable code.', true),
  ('cs_software_data', 'computer_science', 'software_data', 3, 'Construire des logiciels et gérer les données', 'Build software and manage data', 'Comprendre les bases de données, les API, l’architecture logicielle et la qualité d’un système.', 'Understand databases, APIs, software architecture and system quality.', true),
  ('ai_foundations', 'artificial_intelligence', 'foundations', 1, 'Comprendre l’intelligence artificielle', 'Understand artificial intelligence', 'Comprendre comment les modèles apprennent, produisent des résultats, échouent et sont évalués.', 'Understand how models learn, produce outputs, fail and are evaluated.', true),
  ('ai_machine_learning', 'artificial_intelligence', 'machine_learning', 2, 'Maîtriser les fondements du machine learning', 'Master machine learning foundations', 'Étudier les données, les statistiques, l’entraînement, les métriques et les principaux algorithmes.', 'Study data, statistics, training, metrics and the main algorithms.', true),
  ('ai_building', 'artificial_intelligence', 'building', 3, 'Construire avec l’intelligence artificielle', 'Build with artificial intelligence', 'Apprendre à utiliser des modèles, des API, le RAG, les agents et les bonnes architectures produit.', 'Learn to use models, APIs, RAG, agents and strong product architectures.', true),
  ('blockchain_foundations', 'blockchain', 'foundations', 1, 'Comprendre les fondements', 'Understand the foundations', 'Comprendre la cryptographie, les réseaux distribués, le consensus et le fonctionnement de Bitcoin.', 'Understand cryptography, distributed networks, consensus and how Bitcoin works.', true),
  ('blockchain_ecosystem', 'blockchain', 'ecosystem', 2, 'Explorer l’écosystème et la DeFi', 'Explore the ecosystem and DeFi', 'Comprendre Ethereum, les tokens, les stablecoins, la finance décentralisée et leurs risques.', 'Understand Ethereum, tokens, stablecoins, decentralized finance and their risks.', true),
  ('blockchain_building', 'blockchain', 'building', 3, 'Construire sur une blockchain', 'Build on a blockchain', 'Découvrir les smart contracts, les outils de développement, les tests et la sécurité.', 'Discover smart contracts, developer tools, testing and security.', true),
  ('quantum_intuition', 'quantum_physics', 'intuition', 1, 'Développer une intuition quantique', 'Develop quantum intuition', 'Comprendre les grandes idées de la physique quantique avant d’entrer dans le formalisme avancé.', 'Understand the big ideas of quantum physics before advanced formalism.', true),
  ('quantum_mathematics', 'quantum_physics', 'mathematics', 2, 'Comprendre le formalisme mathématique', 'Understand the mathematical formalism', 'Relier les états quantiques, les probabilités, les opérateurs et les mesures aux mathématiques nécessaires.', 'Connect quantum states, probabilities, operators and measurement to the required mathematics.', true),
  ('quantum_computing', 'quantum_physics', 'computing', 3, 'Découvrir le calcul quantique', 'Discover quantum computing', 'Comprendre les qubits, les portes quantiques, les algorithmes et les limites des ordinateurs quantiques.', 'Understand qubits, quantum gates, algorithms and the limits of quantum computers.', true),
  ('math_foundations', 'mathematics', 'foundations', 1, 'Renforcer les fondements et le raisonnement', 'Strengthen foundations and reasoning', 'Travailler l’algèbre, les fonctions, la logique, les démonstrations et la résolution de problèmes.', 'Work on algebra, functions, logic, proofs and problem solving.', true),
  ('math_probability', 'mathematics', 'probability', 2, 'Comprendre les probabilités et les statistiques', 'Understand probability and statistics', 'Apprendre à raisonner sous incertitude, analyser des données et interpréter correctement les résultats.', 'Learn to reason under uncertainty, analyze data and interpret results correctly.', true),
  ('math_technology', 'mathematics', 'technology', 3, 'Maîtriser les mathématiques de la technologie', 'Master the mathematics of technology', 'Étudier l’algèbre linéaire, le calcul différentiel et les mathématiques discrètes utiles en informatique, IA et physique.', 'Study linear algebra, calculus and discrete mathematics useful in computer science, AI and physics.', true),
  ('cyber_foundations', 'cybersecurity', 'foundations', 1, 'Comprendre les menaces et les protections', 'Understand threats and protections', 'Comprendre les attaques courantes, l’identité, la cryptographie et les règles essentielles de sécurité numérique.', 'Understand common attacks, identity, cryptography and essential digital security rules.', true),
  ('cyber_network_defense', 'cybersecurity', 'network_defense', 2, 'Défendre les réseaux et les systèmes', 'Defend networks and systems', 'Étudier les réseaux, la surveillance, les vulnérabilités, les incidents et les méthodes de défense.', 'Study networks, monitoring, vulnerabilities, incidents and defense methods.', true),
  ('cyber_app_cloud', 'cybersecurity', 'app_cloud', 3, 'Sécuriser les applications et le cloud', 'Secure applications and cloud', 'Comprendre la sécurité web, les API, les permissions, le cloud et la conception sécurisée.', 'Understand web security, APIs, permissions, cloud and secure design.', true),
  ('medicine_body', 'human_biology_medicine', 'body', 1, 'Comprendre le corps humain', 'Understand the human body', 'Étudier l’anatomie, la physiologie et le fonctionnement coordonné des principaux systèmes du corps.', 'Study anatomy, physiology and the coordinated function of major body systems.', true),
  ('medicine_disease', 'human_biology_medicine', 'disease', 2, 'Comprendre les mécanismes des maladies', 'Understand disease mechanisms', 'Découvrir comment les maladies apparaissent, progressent et sont étudiées, sans produire de diagnostic personnel.', 'Discover how diseases appear, progress and are studied, without producing a personal diagnosis.', true),
  ('medicine_evidence', 'human_biology_medicine', 'evidence', 3, 'Comprendre les médicaments et les preuves médicales', 'Understand medicines and medical evidence', 'Étudier la pharmacologie, les essais cliniques, les risques, la santé publique et la qualité des preuves.', 'Study pharmacology, clinical trials, risks, public health and evidence quality.', true)
ON CONFLICT (id) DO UPDATE
SET domain_id = EXCLUDED.domain_id,
    slug = EXCLUDED.slug,
    position = EXCLUDED.position,
    label_fr = EXCLUDED.label_fr,
    label_en = EXCLUDED.label_en,
    description_fr = EXCLUDED.description_fr,
    description_en = EXCLUDED.description_en,
    active = EXCLUDED.active,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.user_learning_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL REFERENCES public.learning_domains(id) ON DELETE RESTRICT,
  objective_id TEXT NOT NULL REFERENCES public.learning_objectives(id) ON DELETE RESTRICT,
  current_level SMALLINT NOT NULL,
  target_level SMALLINT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT user_learning_paths_current_level_check CHECK (current_level BETWEEN 1 AND 7),
  CONSTRAINT user_learning_paths_target_level_check CHECK (target_level BETWEEN 1 AND 5),
  CONSTRAINT user_learning_paths_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT user_learning_paths_status_check CHECK (status IN ('active', 'archived', 'completed')),
  CONSTRAINT user_learning_paths_objective_domain_fk FOREIGN KEY (objective_id, domain_id)
    REFERENCES public.learning_objectives(id, domain_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_learning_paths_one_active_per_user
ON public.user_learning_paths(user_id)
WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_user_learning_paths_user_status ON public.user_learning_paths(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_learning_paths_domain ON public.user_learning_paths(domain_id);
CREATE INDEX IF NOT EXISTS idx_user_learning_paths_user_created ON public.user_learning_paths(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.learning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id UUID NOT NULL REFERENCES public.user_learning_paths(id) ON DELETE CASCADE,
  daily_drop_id UUID REFERENCES public.daily_drops(id) ON DELETE SET NULL,
  curriculum_step_key TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  adaptation_mode TEXT NOT NULL DEFAULT 'normal',
  language TEXT NOT NULL,
  title_fr TEXT,
  title_en TEXT,
  summary_fr TEXT,
  summary_en TEXT,
  objectives_fr JSONB NOT NULL DEFAULT '[]'::jsonb,
  objectives_en JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_text TEXT,
  generation_status TEXT NOT NULL DEFAULT 'queued',
  generation_attempts SMALLINT NOT NULL DEFAULT 0,
  generation_locked_at TIMESTAMPTZ,
  model_name TEXT,
  prompt_version TEXT,
  input_hash TEXT,
  generated_at TIMESTAMPTZ,
  last_generation_error TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  available_on DATE,
  opened_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_sessions_session_number_check CHECK (session_number >= 1),
  CONSTRAINT learning_sessions_adaptation_mode_check CHECK (adaptation_mode IN ('normal', 'reinforce', 'accelerate', 'context_shift', 'prerequisite')),
  CONSTRAINT learning_sessions_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT learning_sessions_generation_status_check CHECK (generation_status IN ('queued', 'generating', 'ready', 'failed')),
  CONSTRAINT learning_sessions_generation_attempts_check CHECK (generation_attempts >= 0),
  CONSTRAINT learning_sessions_status_check CHECK (status IN ('available', 'opened', 'started', 'completed')),
  CONSTRAINT learning_sessions_curriculum_step_key_not_blank CHECK (length(trim(curriculum_step_key)) > 0),
  CONSTRAINT learning_sessions_ready_prompt_check CHECK (generation_status <> 'ready' OR length(trim(coalesce(prompt_text, ''))) > 0),
  CONSTRAINT learning_sessions_objectives_fr_array_check CHECK (jsonb_typeof(objectives_fr) = 'array'),
  CONSTRAINT learning_sessions_objectives_en_array_check CHECK (jsonb_typeof(objectives_en) = 'array'),
  CONSTRAINT learning_sessions_opened_at_check CHECK ((status = 'available') OR opened_at IS NOT NULL),
  CONSTRAINT learning_sessions_started_at_check CHECK ((status IN ('available', 'opened')) OR started_at IS NOT NULL),
  UNIQUE (path_id, session_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS learning_sessions_one_ready_unstarted_per_path
ON public.learning_sessions(path_id)
WHERE generation_status = 'ready' AND status IN ('available', 'opened');
CREATE INDEX IF NOT EXISTS idx_learning_sessions_path_status ON public.learning_sessions(path_id, generation_status, status, session_number DESC);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_daily_drop ON public.learning_sessions(daily_drop_id);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_step ON public.learning_sessions(curriculum_step_key);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_available_on ON public.learning_sessions(available_on DESC);

CREATE TABLE IF NOT EXISTS public.learning_session_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES public.learning_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  comprehension_rating SMALLINT NOT NULL CHECK (comprehension_rating BETWEEN 1 AND 5),
  explainability_rating SMALLINT NOT NULL CHECK (explainability_rating BETWEEN 1 AND 5),
  interest_rating SMALLINT NOT NULL CHECK (interest_rating BETWEEN 1 AND 5),
  difficulty_rating SMALLINT NOT NULL CHECK (difficulty_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_session_feedback_user_created
ON public.learning_session_feedback(user_id, created_at DESC);

DROP TRIGGER IF EXISTS set_learning_domains_updated_at ON public.learning_domains;
CREATE TRIGGER set_learning_domains_updated_at
BEFORE UPDATE ON public.learning_domains
FOR EACH ROW EXECUTE FUNCTION public.set_learning_updated_at();
DROP TRIGGER IF EXISTS set_learning_objectives_updated_at ON public.learning_objectives;
CREATE TRIGGER set_learning_objectives_updated_at
BEFORE UPDATE ON public.learning_objectives
FOR EACH ROW EXECUTE FUNCTION public.set_learning_updated_at();
DROP TRIGGER IF EXISTS set_user_learning_paths_updated_at ON public.user_learning_paths;
CREATE TRIGGER set_user_learning_paths_updated_at
BEFORE UPDATE ON public.user_learning_paths
FOR EACH ROW EXECUTE FUNCTION public.set_learning_updated_at();
DROP TRIGGER IF EXISTS set_learning_sessions_updated_at ON public.learning_sessions;
CREATE TRIGGER set_learning_sessions_updated_at
BEFORE UPDATE ON public.learning_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_learning_updated_at();
DROP TRIGGER IF EXISTS set_learning_session_feedback_updated_at ON public.learning_session_feedback;
CREATE TRIGGER set_learning_session_feedback_updated_at
BEFORE UPDATE ON public.learning_session_feedback
FOR EACH ROW EXECUTE FUNCTION public.set_learning_updated_at();

UPDATE public.user_preferences
SET learning_path_choice_completed = true
WHERE learning_path_choice_completed = false;

UPDATE public.user_preferences preferences
SET learning_path_enabled = true
WHERE EXISTS (
  SELECT 1
  FROM public.user_learning_paths paths
  WHERE paths.user_id = preferences.user_id
    AND paths.status = 'active'
);

CREATE OR REPLACE FUNCTION public.start_learning_path(
  p_domain_id TEXT,
  p_objective_id TEXT,
  p_current_level SMALLINT,
  p_target_level SMALLINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_language TEXT;
  v_new_path_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to start a learning path' USING ERRCODE = '28000';
  END IF;

  IF p_current_level NOT BETWEEN 1 AND 7 OR p_target_level NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Learning levels are outside allowed bounds' USING ERRCODE = '22023';
  END IF;

  SELECT language INTO v_language
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_language NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'Authenticated profile is missing a supported language' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.learning_domains WHERE id = p_domain_id AND active = true) THEN
    RAISE EXCEPTION 'Learning domain is not active or does not exist' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.learning_objectives
    WHERE id = p_objective_id
      AND domain_id = p_domain_id
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Learning objective is not active or does not belong to the selected domain' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_learning_paths
  SET status = 'archived',
      archived_at = COALESCE(archived_at, now())
  WHERE user_id = v_user_id
    AND status = 'active';

  UPDATE public.learning_sessions sessions
  SET generation_status = CASE WHEN generation_status = 'generating' THEN 'failed' ELSE generation_status END,
      last_generation_error = CASE WHEN generation_status = 'generating' THEN 'Superseded by a new active learning path.' ELSE last_generation_error END
  FROM public.user_learning_paths paths
  WHERE sessions.path_id = paths.id
    AND paths.user_id = v_user_id
    AND paths.status = 'archived'
    AND sessions.status IN ('available', 'opened');

  INSERT INTO public.user_learning_paths (
    user_id, domain_id, objective_id, current_level, target_level, language, status
  )
  VALUES (
    v_user_id, p_domain_id, p_objective_id, p_current_level, p_target_level, v_language, 'active'
  )
  RETURNING id INTO v_new_path_id;

  INSERT INTO public.user_preferences (user_id, learning_path_enabled, learning_path_choice_completed)
  VALUES (v_user_id, true, true)
  ON CONFLICT (user_id) DO UPDATE
  SET learning_path_enabled = true,
      learning_path_choice_completed = true,
      updated_at = now();

  RETURN v_new_path_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_learning_path()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to disable a learning path' USING ERRCODE = '28000';
  END IF;

  UPDATE public.user_learning_paths
  SET status = 'archived',
      archived_at = COALESCE(archived_at, now())
  WHERE user_id = v_user_id
    AND status = 'active';

  INSERT INTO public.user_preferences (user_id, learning_path_enabled, learning_path_choice_completed)
  VALUES (v_user_id, false, true)
  ON CONFLICT (user_id) DO UPDATE
  SET learning_path_enabled = false,
      learning_path_choice_completed = true,
      updated_at = now();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_learning_session(p_session_id UUID)
RETURNS public.learning_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session public.learning_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to open a learning session' USING ERRCODE = '28000';
  END IF;

  SELECT sessions.* INTO v_session
  FROM public.learning_sessions sessions
  JOIN public.user_learning_paths paths ON paths.id = sessions.path_id
  WHERE sessions.id = p_session_id
    AND paths.user_id = v_user_id
    AND sessions.generation_status = 'ready';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning session not found for authenticated user' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'available' THEN
    UPDATE public.learning_sessions
    SET status = 'opened',
        opened_at = COALESCE(opened_at, now())
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  END IF;

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_learning_session(p_session_id UUID)
RETURNS public.learning_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session public.learning_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to start a learning session' USING ERRCODE = '28000';
  END IF;

  SELECT sessions.* INTO v_session
  FROM public.learning_sessions sessions
  JOIN public.user_learning_paths paths ON paths.id = sessions.path_id
  WHERE sessions.id = p_session_id
    AND paths.user_id = v_user_id
    AND sessions.generation_status = 'ready';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning session not found for authenticated user' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status IN ('available', 'opened') THEN
    UPDATE public.learning_sessions
    SET status = 'started',
        opened_at = COALESCE(opened_at, now()),
        started_at = COALESCE(started_at, now())
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  END IF;

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_learning_session_feedback(
  p_session_id UUID,
  p_comprehension_rating SMALLINT,
  p_explainability_rating SMALLINT,
  p_interest_rating SMALLINT,
  p_difficulty_rating SMALLINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session public.learning_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit learning feedback' USING ERRCODE = '28000';
  END IF;

  IF p_comprehension_rating NOT BETWEEN 1 AND 5
    OR p_explainability_rating NOT BETWEEN 1 AND 5
    OR p_interest_rating NOT BETWEEN 1 AND 5
    OR p_difficulty_rating NOT BETWEEN 1 AND 5
  THEN
    RAISE EXCEPTION 'Learning feedback ratings must all be between 1 and 5' USING ERRCODE = '22023';
  END IF;

  SELECT sessions.* INTO v_session
  FROM public.learning_sessions sessions
  JOIN public.user_learning_paths paths ON paths.id = sessions.path_id
  WHERE sessions.id = p_session_id
    AND paths.user_id = v_user_id
    AND sessions.generation_status = 'ready';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning session not found for authenticated user' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status <> 'started' THEN
    RAISE EXCEPTION 'Learning session must be started before feedback can be submitted' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.learning_session_feedback (
    session_id, user_id, comprehension_rating, explainability_rating, interest_rating, difficulty_rating
  )
  VALUES (
    p_session_id, v_user_id, p_comprehension_rating, p_explainability_rating, p_interest_rating, p_difficulty_rating
  )
  ON CONFLICT (session_id) DO UPDATE
  SET comprehension_rating = EXCLUDED.comprehension_rating,
      explainability_rating = EXCLUDED.explainability_rating,
      interest_rating = EXCLUDED.interest_rating,
      difficulty_rating = EXCLUDED.difficulty_rating;

  UPDATE public.learning_sessions
  SET status = 'completed',
      opened_at = COALESCE(opened_at, now()),
      started_at = COALESCE(started_at, now()),
      completed_at = COALESCE(completed_at, now())
  WHERE id = p_session_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.learning_paths_healthcheck()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'schema_version', '1.0',
    'domain_count', (SELECT count(*) FROM public.learning_domains WHERE active),
    'objective_count', (SELECT count(*) FROM public.learning_objectives WHERE active),
    'start_rpc_ready', true,
    'session_lifecycle_ready', true
  );
$$;

REVOKE ALL ON FUNCTION public.start_learning_path(TEXT, TEXT, SMALLINT, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_learning_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_learning_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_learning_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_learning_session_feedback(UUID, SMALLINT, SMALLINT, SMALLINT, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_paths_healthcheck() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_learning_path(TEXT, TEXT, SMALLINT, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_learning_path() TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_learning_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_learning_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_learning_session_feedback(UUID, SMALLINT, SMALLINT, SMALLINT, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.learning_paths_healthcheck() TO authenticated;
GRANT EXECUTE ON FUNCTION public.learning_paths_healthcheck() TO service_role;

ALTER TABLE public.learning_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_session_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read active learning domains" ON public.learning_domains;
CREATE POLICY "Authenticated users can read active learning domains"
ON public.learning_domains FOR SELECT
USING (auth.role() = 'authenticated' AND active = true);

DROP POLICY IF EXISTS "Authenticated users can read active learning objectives" ON public.learning_objectives;
CREATE POLICY "Authenticated users can read active learning objectives"
ON public.learning_objectives FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND active = true
  AND EXISTS (
    SELECT 1 FROM public.learning_domains domains
    WHERE domains.id = learning_objectives.domain_id
      AND domains.active = true
  )
);

DROP POLICY IF EXISTS "Users can read own learning paths" ON public.user_learning_paths;
CREATE POLICY "Users can read own learning paths"
ON public.user_learning_paths FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read ready own learning sessions" ON public.learning_sessions;
CREATE POLICY "Users can read ready own learning sessions"
ON public.learning_sessions FOR SELECT
USING (
  generation_status = 'ready'
  AND EXISTS (
    SELECT 1 FROM public.user_learning_paths paths
    WHERE paths.id = learning_sessions.path_id
      AND paths.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can read own learning feedback" ON public.learning_session_feedback;
CREATE POLICY "Users can read own learning feedback"
ON public.learning_session_feedback FOR SELECT
USING (user_id = auth.uid());
