-- Mini-case results: cross-device persistence.
--
-- Mini-case scores were kept only in on-device storage, so a reader lost their
-- history when switching phone or reinstalling. public.mini_case_responses
-- already exists with the right ownership model and RLS; it was missing
--   * a uniqueness key, so a reopened case would append a new row every time,
--   * the structured result of a multiple-choice case (which option per
--     question, and the score denominator).
--
-- Strictly additive: new nullable columns and one unique index. No column is
-- dropped or retyped, no row is deleted, no RLS policy is loosened. The
-- existing policies keep every read and write scoped to
--   user_id = auth.uid() AND user_has_assigned_content(content_item_id).

ALTER TABLE public.mini_case_responses
  ADD COLUMN IF NOT EXISTS selections JSONB,
  ADD COLUMN IF NOT EXISTS score_max SMALLINT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mini_case_responses_selections_object_check'
  ) THEN
    ALTER TABLE public.mini_case_responses
      ADD CONSTRAINT mini_case_responses_selections_object_check
      CHECK (selections IS NULL OR jsonb_typeof(selections) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mini_case_responses_score_max_check'
  ) THEN
    ALTER TABLE public.mini_case_responses
      ADD CONSTRAINT mini_case_responses_score_max_check
      CHECK (score_max IS NULL OR score_max BETWEEN 0 AND 50);
  END IF;
END;
$$;

-- One stored result per reader per mini case. This is what makes the client
-- upsert idempotent: reopening a completed case can never create a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS mini_case_responses_user_content_unique
  ON public.mini_case_responses(user_id, content_item_id);

COMMENT ON COLUMN public.mini_case_responses.selections IS
  'Chosen option id per question id, e.g. {"question-1":"option-b"}.';
COMMENT ON COLUMN public.mini_case_responses.score_max IS
  'Number of scored questions; score stays the 0-1 ratio.';
COMMENT ON COLUMN public.mini_case_responses.completed_at IS
  'When the reader finished the case on the device that recorded it.';
