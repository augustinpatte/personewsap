import { normalizeSupabaseError, supabase, type NormalizedSupabaseError } from "../../lib/supabase";
import { submitWithDeadlineRetry as runSubmitWithDeadlineRetry } from "./quizSubmitPolicy";
import type {
  QuestionGradeBand,
  QuestionScoreTier,
  QuizOption,
  StartedAttempt,
  SubmittedAnswer
} from "./quizSession";

/**
 * The two RPCs a scored question runs on.
 *
 * `start_question_attempt` and `submit_question_answer` are the only way a score
 * is ever written. The client sends a question id and, later, an option id; it
 * never sends a score, a timestamp or a duration, and there is deliberately no
 * function in this file that could.
 *
 * NOTHING HERE FALLS BACK TO A LOCAL CLOCK. If the start call fails, the caller
 * shows Retry — a locally-timed question would either be unwinnable (the server
 * never opened an attempt, so the submit will be refused) or a lie about a
 * deadline that does not exist. The one rule the whole feature rests on is that
 * the deadline belongs to Postgres.
 */

export type QuizRpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NormalizedSupabaseError };

function configurationError(): NormalizedSupabaseError {
  return normalizeSupabaseError({
    code: "missing_supabase_config",
    message: "Scored questions are not configured for this build."
  });
}

function readOptions(raw: unknown): QuizOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const option = (entry ?? {}) as Record<string, unknown>;
      const optionId = typeof option.option_id === "string" ? option.option_id : "";
      const label = typeof option.label === "string" ? option.label : "";
      return { optionId, label };
    })
    .filter((option) => option.optionId.length > 0);
}

function readTier(value: unknown): QuestionScoreTier {
  // The server constrains this to the four tiers; anything else means the row
  // is not what this client understands, and zero is the safe reading.
  return value === 300 || value === 600 || value === 1000 ? value : 0;
}

function readBand(value: unknown): QuestionGradeBand {
  return value === "average" || value === "good" || value === "excellent" ? value : "bad";
}

/**
 * Open — or resume — the caller's single attempt at a question.
 *
 * Resuming is the same call: the RPC is idempotent per (user, logical question),
 * so reopening the app returns the ORIGINAL started_at and deadline rather than
 * a fresh twenty seconds, and the stable option order comes back unchanged.
 */
export async function startQuestionAttempt(
  logicalQuestionId: string
): Promise<QuizRpcResult<StartedAttempt>> {
  if (!supabase) {
    return { ok: false, error: configurationError() };
  }

  try {
    const { data, error } = await supabase
      .rpc("start_question_attempt", { p_logical_question_id: logicalQuestionId })
      .maybeSingle();

    if (error) {
      return { ok: false, error: normalizeSupabaseError(error) };
    }

    if (!data) {
      return {
        ok: false,
        error: normalizeSupabaseError({
          code: "question_unavailable",
          message: "This question is not available."
        })
      };
    }

    const row = data as Record<string, unknown>;

    return {
      ok: true,
      data: {
        attemptId: String(row.attempt_id ?? ""),
        serverNow: String(row.server_now ?? ""),
        startedAt: String(row.started_at ?? ""),
        deadlineAt: String(row.deadline_at ?? ""),
        timeLimitSeconds: Number(row.time_limit_seconds ?? 20),
        alreadySubmitted: row.already_submitted === true,
        prompt: typeof row.prompt === "string" ? row.prompt : "",
        options: readOptions(row.options)
      }
    };
  } catch (error) {
    return { ok: false, error: normalizeSupabaseError(error) };
  }
}

export async function submitQuestionAnswer(input: {
  attemptId: string;
  /** Null is an explicit skip, worth zero. Not an abandoned attempt. */
  selectedOptionId: string | null;
}): Promise<QuizRpcResult<SubmittedAnswer>> {
  if (!supabase) {
    return { ok: false, error: configurationError() };
  }

  try {
    const { data, error } = await supabase
      .rpc("submit_question_answer", {
        p_attempt_id: input.attemptId,
        p_selected_option_id: input.selectedOptionId
      })
      .maybeSingle();

    if (error) {
      return { ok: false, error: normalizeSupabaseError(error) };
    }

    const row = (data ?? {}) as Record<string, unknown>;

    return {
      ok: true,
      data: {
        attemptId: String(row.attempt_id ?? input.attemptId),
        scoreMilli: readTier(row.score_milli),
        gradeBand: readBand(row.grade_band),
        expired: row.expired === true,
        skipped: row.skipped === true,
        selectedOptionId:
          typeof row.selected_option_id === "string" ? row.selected_option_id : null
      }
    };
  } catch (error) {
    return { ok: false, error: normalizeSupabaseError(error) };
  }
}

/**
 * The explanation, released only after the answer is in.
 *
 * `get_question_feedback` refuses a caller with no submitted attempt, which is
 * why there is no way to prefetch this alongside the question: doing so would be
 * requesting the answer key.
 */
export type QuestionFeedbackEntry = {
  optionId: string;
  isSelected: boolean;
  scoreMilli: QuestionScoreTier;
  gradeBand: QuestionGradeBand;
  feedback: string | null;
};

/**
 * The retry policy, bound to the real RPC.
 *
 * The policy itself lives in quizSubmitPolicy.ts, free of any Supabase import,
 * so it can be tested without a network. This is only the wiring.
 */
export function submitAnswerWithRetry(input: {
  attemptId: string;
  selectedOptionId: string | null;
  deadlineAt: string;
}) {
  return runSubmitWithDeadlineRetry({
    ...input,
    submit: (request) => submitQuestionAnswer(request)
  });
}

export async function fetchQuestionFeedback(
  logicalQuestionId: string
): Promise<QuizRpcResult<QuestionFeedbackEntry[]>> {
  if (!supabase) {
    return { ok: false, error: configurationError() };
  }

  try {
    const { data, error } = await supabase.rpc("get_question_feedback", {
      p_logical_question_id: logicalQuestionId
    });

    if (error) {
      return { ok: false, error: normalizeSupabaseError(error) };
    }

    const rows = Array.isArray(data) ? data : [];

    return {
      ok: true,
      data: rows.map((entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        return {
          optionId: String(row.option_id ?? ""),
          isSelected: row.is_selected === true,
          scoreMilli: readTier(row.score_milli),
          gradeBand: readBand(row.grade_band),
          feedback: typeof row.feedback_md === "string" ? row.feedback_md : null
        };
      })
    };
  } catch (error) {
    return { ok: false, error: normalizeSupabaseError(error) };
  }
}
