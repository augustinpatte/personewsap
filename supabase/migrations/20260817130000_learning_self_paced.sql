-- Self-paced learning path.
--
-- Until now a learning session only came into existence when the content
-- engine's daily job ran, so progression was bound to the 4x/week edition
-- calendar: finishing a session meant waiting for the next edition to get the
-- next one. The path is an educational product, not an edition — a reader who
-- wants to do several sessions in one evening should be able to.
--
-- Two additive pieces:
--   1. public.learning_catalog_domains mirrors content/learning-paths/v1 so the
--      client can resolve the next curriculum step immediately. It is public
--      reference data (no user rows), readable by any authenticated reader and
--      writable only by the service role.
--   2. public.create_next_learning_session(...) materialises the next session
--      for the caller's own active path, server-validated.
--
-- Nothing is dropped, retyped or deleted, and no existing policy is loosened.
-- The engine keeps working unchanged: session_number stays unique per path and
-- the existing "one ready unstarted session per path" index still arbitrates,
-- so an engine run and an in-app advance can never double-create a session.

CREATE TABLE IF NOT EXISTS public.learning_catalog_domains (
  domain_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learning_catalog_domains_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT learning_catalog_domains_steps_array_check
    CHECK (jsonb_typeof(payload -> 'steps') = 'array')
);

ALTER TABLE public.learning_catalog_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated readers can read the learning catalog"
  ON public.learning_catalog_domains;
CREATE POLICY "Authenticated readers can read the learning catalog"
ON public.learning_catalog_domains FOR SELECT
TO authenticated
USING (true);

-- Curriculum content is shared reference data, so there is deliberately no
-- INSERT/UPDATE/DELETE policy: only the service role (which bypasses RLS)
-- seeds it.

/**
 * Materialise the next session of the caller's active learning path.
 *
 * The caller supplies the resolved curriculum step (the client owns the
 * curriculum walk, exactly as the content engine does); the database owns
 * everything that must not be forgeable: which path is written to, the
 * sequence number, and the one-session-at-a-time rule.
 *
 * Idempotent by construction. If a ready session is already waiting, that
 * session is returned instead of a new one, so a double tap, a retry, or a
 * concurrent engine run all converge on the same row.
 */
CREATE OR REPLACE FUNCTION public.create_next_learning_session(
  p_curriculum_step_key TEXT,
  p_skipped_step_key TEXT,
  p_adaptation_mode TEXT,
  p_title_fr TEXT,
  p_title_en TEXT,
  p_summary_fr TEXT,
  p_summary_en TEXT,
  p_objectives_fr JSONB,
  p_objectives_en JSONB,
  p_prompt_text TEXT
)
RETURNS public.learning_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_path public.user_learning_paths;
  v_existing public.learning_sessions;
  v_next_number INTEGER;
  v_session public.learning_sessions;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to continue a learning path'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_path
  FROM public.user_learning_paths
  WHERE user_id = v_user_id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_path.id IS NULL THEN
    RAISE EXCEPTION 'No active learning path for this reader' USING ERRCODE = '22023';
  END IF;

  IF p_adaptation_mode NOT IN
    ('normal', 'reinforce', 'accelerate', 'context_shift', 'prerequisite') THEN
    RAISE EXCEPTION 'Unsupported adaptation mode' USING ERRCODE = '22023';
  END IF;

  IF length(trim(coalesce(p_curriculum_step_key, ''))) = 0
     OR length(trim(coalesce(p_prompt_text, ''))) = 0 THEN
    RAISE EXCEPTION 'A session needs a curriculum step and a prompt'
      USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent advances for this path so two taps cannot both pass
  -- the "is a session already waiting" check.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_path.id::text, 0));

  SELECT * INTO v_existing
  FROM public.learning_sessions
  WHERE path_id = v_path.id
    AND generation_status = 'ready'
    AND status IN ('available', 'opened')
  ORDER BY session_number DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT coalesce(max(session_number), 0) + 1 INTO v_next_number
  FROM public.learning_sessions
  WHERE path_id = v_path.id;

  INSERT INTO public.learning_sessions (
    path_id,
    daily_drop_id,
    curriculum_step_key,
    skipped_step_key,
    session_number,
    adaptation_mode,
    language,
    title_fr,
    title_en,
    summary_fr,
    summary_en,
    objectives_fr,
    objectives_en,
    prompt_text,
    generation_status,
    generated_at,
    model_name,
    prompt_version,
    status,
    available_on
  )
  VALUES (
    v_path.id,
    -- Deliberately not tied to a daily drop: this session belongs to the
    -- reader's own pace, not to an edition.
    NULL,
    p_curriculum_step_key,
    nullif(trim(coalesce(p_skipped_step_key, '')), ''),
    v_next_number,
    p_adaptation_mode,
    v_path.language,
    p_title_fr,
    p_title_en,
    p_summary_fr,
    p_summary_en,
    coalesce(p_objectives_fr, '[]'::jsonb),
    coalesce(p_objectives_en, '[]'::jsonb),
    p_prompt_text,
    'ready',
    now(),
    'deterministic-learning-v1',
    'learning_v2',
    'available',
    NULL
  )
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.create_next_learning_session(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_next_learning_session(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT
) TO authenticated;

DROP TRIGGER IF EXISTS set_learning_catalog_domains_updated_at
  ON public.learning_catalog_domains;
CREATE TRIGGER set_learning_catalog_domains_updated_at
BEFORE UPDATE ON public.learning_catalog_domains
FOR EACH ROW EXECUTE FUNCTION public.set_learning_updated_at();

COMMENT ON TABLE public.learning_catalog_domains IS
  'Mirror of content/learning-paths/v1; regenerate with scripts/learning-catalog-sql.mjs.';
COMMENT ON FUNCTION public.create_next_learning_session(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT
) IS
  'Creates the next session of the caller''s active path, or returns the one already waiting.';
