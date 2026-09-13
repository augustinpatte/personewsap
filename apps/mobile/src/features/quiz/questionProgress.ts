import type { QuestionScoreTier } from "./quizSession";

/**
 * Where the reader stands on the questions of a reading — read from the SERVER.
 *
 * The source is the reader's own rows in `public.question_attempts` (RLS:
 * `user_id = auth.uid()`). There is one row per reader per LOGICAL question,
 * ever, whichever language and whichever route (Solo, Team A, Team B) it was
 * reached through. So one reading has one progress: the same in French and in
 * English, on any device, after any restart. Nothing here is derived from the
 * edition date, the read state, or anything stored on the device.
 *
 * The server knows two statuses, `in_progress` and `submitted`. The rest is read
 * off the row, never invented:
 *
 *   unanswered   no row: the question was never opened
 *   in_progress  an open attempt whose deadline is still ahead
 *   timed_out    submitted after its deadline (worth zero), or an open attempt
 *                whose deadline has passed — it can only ever be worth zero, and
 *                the server settles it the next time it is opened
 *   skipped      submitted in time with no option (worth zero)
 *   answered     submitted in time with an option
 */

export type AttemptRecord = {
  logicalQuestionId: string;
  status: "in_progress" | "submitted";
  deadlineAt: string | null;
  /** Submitted after its deadline: worth zero, whatever was chosen. */
  expired: boolean;
  selectedOptionId: string | null;
  /** Null until submitted: an open attempt has no score by construction. */
  scoreMilli: QuestionScoreTier | null;
};

export type QuestionProgressState =
  | "unanswered"
  | "in_progress"
  | "answered"
  | "skipped"
  | "timed_out";

export function resolveQuestionState(
  record: AttemptRecord | null | undefined,
  nowMs: number
): QuestionProgressState {
  if (!record) {
    return "unanswered";
  }

  if (record.status === "submitted") {
    if (record.expired) {
      return "timed_out";
    }

    return record.selectedOptionId === null ? "skipped" : "answered";
  }

  if (record.deadlineAt && Date.parse(record.deadlineAt) < nowMs) {
    return "timed_out";
  }

  return "in_progress";
}

/** Done: it will never be asked again, and it has its (possibly zero) score. */
export function isSettledState(state: QuestionProgressState): boolean {
  return state === "answered" || state === "skipped" || state === "timed_out";
}

export type ContentQuestionProgress = {
  total: number;
  settled: number;
  remaining: number;
  /**
   * none         the reading has no questions
   * not_started  none opened yet
   * partial      at least one opened or settled, at least one still owed
   * completed    every question settled
   */
  status: "none" | "not_started" | "partial" | "completed";
  states: QuestionProgressState[];
};

export function summarizeContentProgress(
  questionIds: string[],
  records: ReadonlyMap<string, AttemptRecord | null>,
  nowMs: number
): ContentQuestionProgress {
  // One logical question counts once, however many routes listed it.
  const ids = [...new Set(questionIds)];
  const states = ids.map((id) => resolveQuestionState(records.get(id), nowMs));
  const settled = states.filter(isSettledState).length;
  const started = states.some((state) => state !== "unanswered");
  const total = ids.length;

  return {
    total,
    settled,
    remaining: total - settled,
    status:
      total === 0
        ? "none"
        : settled === total
          ? "completed"
          : started
            ? "partial"
            : "not_started",
    states
  };
}

/** The questions button, from the real progress. */
export type QuestionsCta = "go_to_questions" | "continue_questions" | "questions_completed";

export function resolveQuestionsCta(progress: ContentQuestionProgress): QuestionsCta {
  if (progress.status === "completed") {
    return "questions_completed";
  }

  return progress.status === "partial" ? "continue_questions" : "go_to_questions";
}

/** A question the server has already settled, as the quiz flow restores it. */
export type SettledSeed = {
  scoreMilli: QuestionScoreTier;
  expired: boolean;
  skipped: boolean;
  selectedOptionId: string | null;
};

/**
 * The questions the flow must NOT start: every submitted attempt. An open
 * attempt past its deadline is not here — it is not settled yet, and opening it
 * is what lets the server settle it at zero.
 */
export function settledSeeds(
  questionIds: string[],
  records: ReadonlyMap<string, AttemptRecord | null>
): Record<string, SettledSeed> {
  const seeds: Record<string, SettledSeed> = {};

  for (const id of questionIds) {
    const record = records.get(id);

    if (record?.status !== "submitted") {
      continue;
    }

    seeds[id] = {
      scoreMilli: record.scoreMilli ?? 0,
      expired: record.expired,
      skipped: !record.expired && record.selectedOptionId === null,
      selectedOptionId: record.selectedOptionId
    };
  }

  return seeds;
}
