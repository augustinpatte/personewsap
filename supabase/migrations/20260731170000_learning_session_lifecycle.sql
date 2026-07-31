-- Learning session lifecycle hardening.
-- Exact user-facing lifecycle: available -> opened -> started -> completed.

ALTER TABLE IF EXISTS public.learning_sessions
ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.learning_sessions
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

DO $$
BEGIN
  IF to_regclass('public.learning_sessions') IS NOT NULL THEN
    UPDATE public.learning_sessions
    SET status = CASE
      WHEN status IN ('available', 'opened', 'started', 'completed') THEN status
      WHEN status IN ('in_progress') THEN 'started'
      ELSE 'available'
    END
    WHERE status NOT IN ('available', 'opened', 'started', 'completed');

    UPDATE public.learning_sessions
    SET opened_at = COALESCE(opened_at, created_at, now())
    WHERE status IN ('opened', 'started', 'completed')
      AND opened_at IS NULL;

    UPDATE public.learning_sessions
    SET started_at = COALESCE(started_at, opened_at, created_at, now())
    WHERE status IN ('started', 'completed')
      AND started_at IS NULL;

    ALTER TABLE public.learning_sessions
    DROP CONSTRAINT IF EXISTS learning_sessions_status_check;

    ALTER TABLE public.learning_sessions
    ADD CONSTRAINT learning_sessions_status_check
    CHECK (status IN ('available', 'opened', 'started', 'completed'));

    ALTER TABLE public.learning_sessions
    DROP CONSTRAINT IF EXISTS learning_sessions_started_at_check;

    ALTER TABLE public.learning_sessions
    ADD CONSTRAINT learning_sessions_started_at_check
    CHECK (
      (status IN ('started', 'completed') AND started_at IS NOT NULL)
      OR status IN ('available', 'opened')
    );

    ALTER TABLE public.learning_sessions
    DROP CONSTRAINT IF EXISTS learning_sessions_opened_at_check;

    ALTER TABLE public.learning_sessions
    ADD CONSTRAINT learning_sessions_opened_at_check
    CHECK (
      (status IN ('opened', 'started', 'completed') AND opened_at IS NOT NULL)
      OR status = 'available'
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.learning_session_feedback') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS learning_session_feedback_session_unique
    ON public.learning_session_feedback(session_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.learning_sessions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'learning_sessions'
        AND column_name = 'path_id'
    ) THEN
      CREATE UNIQUE INDEX IF NOT EXISTS learning_sessions_one_unstarted_per_path
      ON public.learning_sessions(path_id)
      WHERE status IN ('available', 'opened');
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'learning_sessions'
        AND column_name = 'user_learning_path_id'
    ) THEN
      CREATE UNIQUE INDEX IF NOT EXISTS learning_sessions_one_unstarted_per_path
      ON public.learning_sessions(user_learning_path_id)
      WHERE status IN ('available', 'opened');
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.learning_sessions') IS NOT NULL THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.open_learning_session(p_session_id UUID)
      RETURNS public.learning_sessions
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_user_id UUID := auth.uid();
        v_session public.learning_sessions%ROWTYPE;
        v_path_column TEXT;
      BEGIN
        IF v_user_id IS NULL THEN
          RAISE EXCEPTION 'Authentication required to open a learning session'
            USING ERRCODE = '28000';
        END IF;

        SELECT column_name
        INTO v_path_column
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'learning_sessions'
          AND column_name IN ('path_id', 'user_learning_path_id')
        ORDER BY CASE column_name WHEN 'path_id' THEN 1 ELSE 2 END
        LIMIT 1;

        IF v_path_column IS NULL THEN
          RAISE EXCEPTION 'learning_sessions path column is missing'
            USING ERRCODE = '42703';
        END IF;

        EXECUTE format(
          'SELECT learning_sessions.*
           FROM public.learning_sessions
           JOIN public.user_learning_paths
             ON user_learning_paths.id = learning_sessions.%I
           WHERE learning_sessions.id = $1
             AND user_learning_paths.user_id = $2',
          v_path_column
        )
        INTO v_session
        USING p_session_id, v_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Learning session not found for authenticated user'
            USING ERRCODE = 'P0002';
        END IF;

        IF v_session.status = 'available' THEN
          UPDATE public.learning_sessions
          SET
            status = 'opened',
            opened_at = COALESCE(opened_at, now()),
            updated_at = now()
          WHERE id = p_session_id
          RETURNING *
          INTO v_session;
        END IF;

        RETURN v_session;
      END;
      $body$;
    $function$;

    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.start_learning_session(p_session_id UUID)
      RETURNS public.learning_sessions
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_user_id UUID := auth.uid();
        v_session public.learning_sessions%ROWTYPE;
        v_path_column TEXT;
      BEGIN
        IF v_user_id IS NULL THEN
          RAISE EXCEPTION 'Authentication required to start a learning session'
            USING ERRCODE = '28000';
        END IF;

        SELECT column_name
        INTO v_path_column
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'learning_sessions'
          AND column_name IN ('path_id', 'user_learning_path_id')
        ORDER BY CASE column_name WHEN 'path_id' THEN 1 ELSE 2 END
        LIMIT 1;

        IF v_path_column IS NULL THEN
          RAISE EXCEPTION 'learning_sessions path column is missing'
            USING ERRCODE = '42703';
        END IF;

        EXECUTE format(
          'SELECT learning_sessions.*
           FROM public.learning_sessions
           JOIN public.user_learning_paths
             ON user_learning_paths.id = learning_sessions.%I
           WHERE learning_sessions.id = $1
             AND user_learning_paths.user_id = $2',
          v_path_column
        )
        INTO v_session
        USING p_session_id, v_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Learning session not found for authenticated user'
            USING ERRCODE = 'P0002';
        END IF;

        IF v_session.status IN ('available', 'opened') THEN
          UPDATE public.learning_sessions
          SET
            status = 'started',
            opened_at = COALESCE(opened_at, now()),
            started_at = COALESCE(started_at, now()),
            updated_at = now()
          WHERE id = p_session_id
          RETURNING *
          INTO v_session;
        END IF;

        RETURN v_session;
      END;
      $body$;
    $function$;

    REVOKE ALL ON FUNCTION public.open_learning_session(UUID) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.start_learning_session(UUID) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION public.open_learning_session(UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.start_learning_session(UUID) TO authenticated;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.learning_sessions') IS NOT NULL THEN
    EXECUTE $function$
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
      AS $body$
      DECLARE
        v_user_id UUID := auth.uid();
        v_session public.learning_sessions%ROWTYPE;
        v_path_column TEXT;
      BEGIN
        IF v_user_id IS NULL THEN
          RAISE EXCEPTION 'Authentication required to submit learning feedback'
            USING ERRCODE = '28000';
        END IF;

        IF p_comprehension_rating NOT BETWEEN 1 AND 5
          OR p_explainability_rating NOT BETWEEN 1 AND 5
          OR p_interest_rating NOT BETWEEN 1 AND 5
          OR p_difficulty_rating NOT BETWEEN 1 AND 5
        THEN
          RAISE EXCEPTION 'Learning feedback ratings must all be between 1 and 5'
            USING ERRCODE = '22023';
        END IF;

        SELECT column_name
        INTO v_path_column
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'learning_sessions'
          AND column_name IN ('path_id', 'user_learning_path_id')
        ORDER BY CASE column_name WHEN 'path_id' THEN 1 ELSE 2 END
        LIMIT 1;

        IF v_path_column IS NULL THEN
          RAISE EXCEPTION 'learning_sessions path column is missing'
            USING ERRCODE = '42703';
        END IF;

        EXECUTE format(
          'SELECT learning_sessions.*
           FROM public.learning_sessions
           JOIN public.user_learning_paths
             ON user_learning_paths.id = learning_sessions.%I
           WHERE learning_sessions.id = $1
             AND user_learning_paths.user_id = $2',
          v_path_column
        )
        INTO v_session
        USING p_session_id, v_user_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Learning session not found for authenticated user'
            USING ERRCODE = 'P0002';
        END IF;

        IF v_session.status <> 'started' THEN
          RAISE EXCEPTION 'Learning session must be started before feedback can be submitted'
            USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.learning_session_feedback (
          session_id,
          user_id,
          comprehension_rating,
          explainability_rating,
          interest_rating,
          difficulty_rating
        )
        VALUES (
          p_session_id,
          v_user_id,
          p_comprehension_rating,
          p_explainability_rating,
          p_interest_rating,
          p_difficulty_rating
        )
        ON CONFLICT (session_id) DO UPDATE
        SET
          user_id = EXCLUDED.user_id,
          comprehension_rating = EXCLUDED.comprehension_rating,
          explainability_rating = EXCLUDED.explainability_rating,
          interest_rating = EXCLUDED.interest_rating,
          difficulty_rating = EXCLUDED.difficulty_rating;

        UPDATE public.learning_sessions
        SET
          status = 'completed',
          completed_at = COALESCE(completed_at, now()),
          updated_at = now()
        WHERE id = p_session_id;

        RETURN true;
      END;
      $body$;
    $function$;
  END IF;
END;
$$;
