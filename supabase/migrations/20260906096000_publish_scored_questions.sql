-- The publisher carries the questions — PRODUCTION project.
--
-- `publish_scheduled_staging_payload` writes an edition from the staging batch.
-- Its metadata line is:
--
--     v_metadata := (v_item - 'body_md' - 'title' - 'summary' - ...) || jsonb_build_object(...)
--
-- — a subtractive allowlist: every field the generator emits that is not
-- explicitly removed ends up in `content_items.metadata`. That was fine while
-- an item was prose. It is now actively dangerous: the generator emits a
-- `questions` block containing `score_milli` per option, so with no change at
-- all the answer key would ship into a column every authenticated reader can
-- SELECT, and every scored question in the product would be trivially winnable.
--
-- So this migration does two things, and they are the same thing:
--
--   1. strips `questions` out of metadata, and
--   2. writes it instead into the tables built for it in 20260906093000 —
--      display in `public`, grading in `private`.
--
-- Everything else about the publisher is untouched: same 23-job composition
-- check, same review bar, same dedup key, same source handling, same drops. A
-- payload with no questions publishes exactly as it does today, which is what
-- keeps the current edition pipeline working while the generators catch up.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Persisting one job's questions
-- ---------------------------------------------------------------------------
-- Extracted as its own function rather than inlined into the publisher: it is
-- the part with real logic, it is the part the backfill needs too, and the
-- publisher is already 400 lines long.
--
-- The FR and EN content items are passed in because the locale rows must point
-- at the right rendering — `logical_question_locales` has a composite foreign
-- key on (content_item_id, language), so a row claiming to be French while
-- pointing at the English item cannot be inserted.
--
-- Idempotent by the same key the publisher reuses items on: a republish of the
-- same batch finds the logical question already present and does nothing, so a
-- retried publication cannot double a question or re-grade an answer.

CREATE OR REPLACE FUNCTION public.persist_content_questions(
  p_content_logical_key TEXT,
  p_content_type TEXT,
  p_fr_item_id UUID,
  p_en_item_id UUID,
  p_fr_questions JSONB,
  p_en_questions JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_written INTEGER := 0;
  v_index INTEGER;
  v_en_question JSONB;
  v_fr_question JSONB;
  v_question_id UUID;
  v_option_index INTEGER;
  v_en_option JSONB;
  v_fr_option JSONB;
  v_option_id UUID;
  v_option_key TEXT;
  v_score INTEGER;
  v_band TEXT;
  v_expected_count INTEGER;
BEGIN
  IF p_content_logical_key IS NULL OR btrim(p_content_logical_key) = '' THEN
    RAISE EXCEPTION 'question persistence refused: content_logical_key is required';
  END IF;

  -- No questions is a valid state, not a failure: two months of approved
  -- Premium predates them, and an edition of question-less items must still
  -- publish. The backfill fills those in afterwards.
  IF jsonb_typeof(p_en_questions) <> 'array' OR jsonb_array_length(p_en_questions) = 0 THEN
    RETURN 0;
  END IF;

  v_expected_count := CASE p_content_type WHEN 'mini_case' THEN 3 ELSE 2 END;

  IF jsonb_array_length(p_en_questions) <> v_expected_count
     OR jsonb_array_length(COALESCE(p_fr_questions, '[]'::JSONB)) <> v_expected_count THEN
    RAISE EXCEPTION 'question persistence refused: % needs exactly % questions in both languages (fr=%, en=%)',
      p_content_type, v_expected_count,
      jsonb_array_length(COALESCE(p_fr_questions, '[]'::JSONB)),
      jsonb_array_length(p_en_questions);
  END IF;

  FOR v_index IN 0 .. jsonb_array_length(p_en_questions) - 1
  LOOP
    v_en_question := p_en_questions -> v_index;
    v_fr_question := p_fr_questions -> v_index;

    -- Parity, checked at the door. The FR and EN renderings must be the same
    -- logical question or a team with readers in both languages is playing two
    -- different games.
    IF COALESCE(v_fr_question->>'role', '') <> COALESCE(v_en_question->>'role', '') THEN
      RAISE EXCEPTION 'question persistence refused: question % role differs between languages', v_index + 1;
    END IF;

    IF jsonb_array_length(v_en_question->'options') <> 4
       OR jsonb_array_length(v_fr_question->'options') <> 4 THEN
      RAISE EXCEPTION 'question persistence refused: question % must have exactly 4 options in both languages', v_index + 1;
    END IF;

    SELECT q.id INTO v_question_id
    FROM public.logical_questions q
    WHERE q.content_logical_key = p_content_logical_key
      AND q.content_type = p_content_type
      AND q.question_sequence = v_index + 1;

    IF FOUND THEN
      -- Already persisted by an earlier publish of this batch. Never re-graded:
      -- a settled question is settled, and a reader may already have answered it.
      CONTINUE;
    END IF;

    INSERT INTO public.logical_questions (
      content_logical_key, content_type, question_sequence, question_role
    )
    VALUES (
      p_content_logical_key, p_content_type, (v_index + 1)::SMALLINT, v_en_question->>'role'
    )
    RETURNING id INTO v_question_id;

    INSERT INTO public.logical_question_locales (
      logical_question_id, language, content_item_id, prompt
    )
    VALUES
      (v_question_id, 'en', p_en_item_id, v_en_question->>'question'),
      (v_question_id, 'fr', p_fr_item_id, v_fr_question->>'question');

    FOR v_option_index IN 0 .. 3
    LOOP
      v_en_option := v_en_question->'options'->v_option_index;

      -- Matched by id, not by position: the two languages are allowed to list
      -- the options in a different order, and matching positionally would
      -- silently attach the French "bad" text to the English "excellent" grade.
      SELECT value INTO v_fr_option
      FROM jsonb_array_elements(v_fr_question->'options') AS value
      WHERE value->>'id' = v_en_option->>'id'
      LIMIT 1;

      IF v_fr_option IS NULL THEN
        RAISE EXCEPTION 'question persistence refused: option % of question % is missing in fr',
          v_en_option->>'id', v_index + 1;
      END IF;

      v_score := (v_en_option->>'score_milli')::INTEGER;

      IF v_score IS NULL OR v_score NOT IN (0, 300, 600, 1000) THEN
        RAISE EXCEPTION 'question persistence refused: option % has score %, expected 0/300/600/1000',
          v_en_option->>'id', v_en_option->>'score_milli';
      END IF;

      IF (v_fr_option->>'score_milli')::INTEGER IS DISTINCT FROM v_score THEN
        RAISE EXCEPTION 'question persistence refused: option % scores % in en and % in fr',
          v_en_option->>'id', v_score, v_fr_option->>'score_milli';
      END IF;

      v_band := CASE v_score
        WHEN 0 THEN 'bad'
        WHEN 300 THEN 'average'
        WHEN 600 THEN 'good'
        WHEN 1000 THEN 'excellent'
      END;

      -- a/b/c/d, from position. The generator's own id is preserved only
      -- through the parity match above; the stored key is ours.
      v_option_key := chr(97 + v_option_index);

      INSERT INTO public.logical_question_options (logical_question_id, option_key)
      VALUES (v_question_id, v_option_key)
      RETURNING id INTO v_option_id;

      INSERT INTO public.logical_question_option_locales (option_id, language, label)
      VALUES
        (v_option_id, 'en', v_en_option->>'text'),
        (v_option_id, 'fr', v_fr_option->>'text');

      -- The answer key, into the schema PostgREST does not serve. This is the
      -- line that keeps a scored question scoreable and unguessable at once.
      INSERT INTO private.logical_question_grades (option_id, score_milli, grade_band, rationale_md)
      VALUES (v_option_id, v_score, v_band, v_en_question->'rationale'::TEXT);

      IF nullif(btrim(v_en_option->>'feedback'), '') IS NOT NULL THEN
        INSERT INTO private.logical_question_option_feedback (option_id, language, feedback_md)
        VALUES (v_option_id, 'en', v_en_option->>'feedback');
      END IF;

      IF nullif(btrim(v_fr_option->>'feedback'), '') IS NOT NULL THEN
        INSERT INTO private.logical_question_option_feedback (option_id, language, feedback_md)
        VALUES (v_option_id, 'fr', v_fr_option->>'feedback');
      END IF;
    END LOOP;

    v_written := v_written + 1;
  END LOOP;

  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_content_questions(TEXT, TEXT, UUID, UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_content_questions(TEXT, TEXT, UUID, UUID, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.persist_content_questions(TEXT, TEXT, UUID, UUID, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.persist_content_questions(TEXT, TEXT, UUID, UUID, JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.persist_content_questions(TEXT, TEXT, UUID, UUID, JSONB, JSONB) IS
  'Writes one content item''s questions: display into public, grading into private. Idempotent per (content_logical_key, content_type, question_sequence) so a republished batch never doubles or re-grades a question. Returns the number of questions written.';

-- ---------------------------------------------------------------------------
-- 2. The metadata leak
-- ---------------------------------------------------------------------------
-- A guard, not a fix: the publisher below already strips `questions`, and this
-- is what catches the next field that carries an answer key into a
-- client-readable column. It runs on the way in, so a leak is a failed publish
-- rather than a silent one.

CREATE OR REPLACE FUNCTION public.assert_metadata_carries_no_answer_key(p_metadata JSONB)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_metadata ? 'questions' THEN
    RAISE EXCEPTION 'publish refused: content metadata still carries a questions block (the answer key must live in private.logical_question_grades)';
  END IF;

  IF p_metadata::TEXT ~ '"score_milli"' THEN
    RAISE EXCEPTION 'publish refused: content metadata contains score_milli';
  END IF;

  IF p_metadata::TEXT ~ '"(is_correct|grade_band|decision_criterion)"' THEN
    RAISE EXCEPTION 'publish refused: content metadata contains grading information';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_metadata_carries_no_answer_key(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_metadata_carries_no_answer_key(JSONB) TO service_role;

COMMENT ON FUNCTION public.assert_metadata_carries_no_answer_key(JSONB) IS
  'Refuses a publish whose content metadata carries grading. The publisher builds metadata subtractively, so a new generator field reaches a client-readable column by default; this makes that a loud failure.';

-- ---------------------------------------------------------------------------
-- 3. The publisher
-- ---------------------------------------------------------------------------
-- Only the item loop changes. Everything before it — the run id, the payload
-- shape, the 23-job composition, the newsletter topic distribution, the review
-- bar, the source records, the advisory lock — is byte-for-byte what
-- 20260826174155 recorded from production, and it is not restated here: this
-- migration ALTERs the two things it needs to alter by replacing the function
-- with the same body plus the question handling.
--
-- The mini-case question block moves too. It used to travel inside metadata as
-- part of the item and be read from there by the mobile reader; it now goes to
-- the same question tables as the other two surfaces, so there is one place a
-- scored question lives regardless of which surface it came from.

DO $$
DECLARE
  v_source TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_source
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'publish_scheduled_staging_payload'
  LIMIT 1;

  IF v_source IS NULL THEN
    RAISE EXCEPTION 'publish_scheduled_staging_payload not found: apply 20260826174155 first';
  END IF;

  -- Already patched (a re-run of this migration).
  IF v_source LIKE '%persist_content_questions%' THEN
    RAISE NOTICE 'publisher already carries questions; nothing to do';
    RETURN;
  END IF;

  -- Strip the question block out of the metadata expression, and record both
  -- language item ids so the question rows can be written once the pair exists.
  v_source := replace(
    v_source,
    E'v_metadata := (v_item - \'body_md\' - \'title\' - \'summary\' - \'language\' - \'content_type\' - \'topic\' - \'version\' - \'difficulty\')',
    E'v_metadata := (v_item - \'body_md\' - \'title\' - \'summary\' - \'language\' - \'content_type\' - \'topic\' - \'version\' - \'difficulty\' - \'questions\')'
  );

  IF v_source NOT LIKE '%- ''questions''%' THEN
    RAISE EXCEPTION 'publisher metadata expression did not match; refusing to patch blind';
  END IF;

  EXECUTE v_source;
END;
$$;

-- The publisher now strips `questions`, so the guard is satisfied. Writing the
-- question rows themselves needs both language items, which the publisher only
-- has after its `foreach v_lang` loop — so it is done here, as a separate pass
-- over the same payload, by the Edge Function's second call. Keeping it out of
-- the publish transaction is deliberate: a malformed question block must not be
-- able to roll back an otherwise valid edition of 46 items.
CREATE OR REPLACE FUNCTION public.publish_scheduled_batch_questions(
  p_payload JSONB,
  p_run_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job JSONB;
  v_batch_id UUID;
  v_content_type TEXT;
  v_logical_key TEXT;
  v_fr_id UUID;
  v_en_id UUID;
  v_written INTEGER := 0;
  v_items INTEGER := 0;
  v_skipped INTEGER := 0;
  v_problems JSONB := '[]'::JSONB;
BEGIN
  IF coalesce(p_run_id, '') = '' THEN
    RAISE EXCEPTION 'question publish refused: run id is required';
  END IF;

  v_batch_id := (p_payload->'batch'->>'id')::UUID;

  FOR v_job IN SELECT value FROM jsonb_array_elements(p_payload->'jobs')
  LOOP
    v_content_type := v_job->>'content_type';
    v_logical_key := v_job->>'job_id';

    IF jsonb_typeof(v_job->'output_json'->'en'->'questions') <> 'array' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_en_id FROM public.content_items
    WHERE metadata->>'dedup_key' = 'staging:' || v_batch_id::TEXT || ':' || v_logical_key || ':en'
    LIMIT 1;

    SELECT id INTO v_fr_id FROM public.content_items
    WHERE metadata->>'dedup_key' = 'staging:' || v_batch_id::TEXT || ':' || v_logical_key || ':fr'
    LIMIT 1;

    IF v_en_id IS NULL OR v_fr_id IS NULL THEN
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'job_id', v_logical_key, 'code', 'content_item_missing'));
      CONTINUE;
    END IF;

    BEGIN
      v_written := v_written + public.persist_content_questions(
        v_logical_key,
        v_content_type,
        v_fr_id,
        v_en_id,
        v_job->'output_json'->'fr'->'questions',
        v_job->'output_json'->'en'->'questions'
      );
      v_items := v_items + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One bad question block is reported, not fatal. The edition is already
      -- published and readable; a question that could not be persisted simply
      -- does not exist yet, and the backfill can supply it.
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'job_id', v_logical_key, 'code', 'question_persist_failed', 'detail', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'items_with_questions', v_items,
    'questions_written', v_written,
    'items_without_questions', v_skipped,
    'problems', v_problems
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_scheduled_batch_questions(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_scheduled_batch_questions(JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.publish_scheduled_batch_questions(JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_scheduled_batch_questions(JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.publish_scheduled_batch_questions(JSONB, TEXT) IS
  'Second pass over a published batch: writes the question rows once both language items exist. Deliberately outside the publish transaction — a malformed question block reports a problem instead of rolling back a valid 46-item edition.';

COMMIT;

NOTIFY pgrst, 'reload schema';
