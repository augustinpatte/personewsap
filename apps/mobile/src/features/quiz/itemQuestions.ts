import type { DailyDropContentItem } from "../today/contentTypes";
import type { QuizQuestionRef } from "./useQuizFlow";
import type { TeamRef } from "./teamMerge";

/**
 * What a content item knows about its own questions and Teams.
 *
 * The questions are the item's `logical_questions`, which the data layer reads
 * from `public.logical_questions` by THIS item's content type and logical key.
 * RLS only returns questions the reader was actually assigned — personally or
 * through a Team — so the list is exactly the questions owed for this reading,
 * shared by its FR and EN renderings, and never another item's.
 *
 * Reads defensively and returns empty on anything it does not recognise, which
 * is the property that keeps legacy content working: content that predates
 * scored questions has no `logical_questions` field at all, and must open, read
 * and complete exactly as it always did.
 */

type QuestionCarrier = {
  logical_questions?: unknown;
  teams?: unknown;
};

function readQuestions(raw: unknown): QuizQuestionRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries = raw
    .map((entry, position) => {
      const value = (entry ?? {}) as Record<string, unknown>;
      const id =
        typeof value.logical_question_id === "string"
          ? value.logical_question_id
          : typeof value.id === "string"
            ? value.id
            : "";
      const sequence =
        typeof value.question_sequence === "number" && Number.isFinite(value.question_sequence)
          ? value.question_sequence
          : Number.MAX_SAFE_INTEGER;

      return { id, sequence, position };
    })
    .filter((entry) => entry.id.length > 0)
    // The answering order is the pedagogical one (interpretation before
    // application; method, then application, then conclusion) — never an
    // accident of row order.
    .sort((a, b) => a.sequence - b.sequence || a.position - b.position);

  // One logical question is ONE question, however many routes (Solo, Team A,
  // Team B) it reached the reader through. It is answered once.
  const seen = new Set<string>();

  return entries
    .filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }

      seen.add(entry.id);
      return true;
    })
    .map((entry) => ({ logicalQuestionId: entry.id }));
}

function readTeams(raw: unknown): TeamRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const value = (entry ?? {}) as Record<string, unknown>;
      return {
        id: typeof value.id === "string" ? value.id : "",
        // Null rather than a placeholder: a moderated name is hidden, and the
        // badge decides what to render in its place.
        name: typeof value.name === "string" ? value.name : null
      };
    })
    .filter((team) => team.id.length > 0);
}

export function readItemQuestions(item: DailyDropContentItem | null | undefined): {
  questions: QuizQuestionRef[];
  teams: TeamRef[];
} {
  const carrier = (item ?? {}) as unknown as QuestionCarrier;

  return {
    questions: readQuestions(carrier.logical_questions),
    teams: readTeams(carrier.teams)
  };
}

/**
 * Does this reading still owe the reader questions?
 *
 * Used by Today to decide whether to offer "Continue challenge" next to an
 * article that is already marked read. Content with no questions is never
 * pending — a legacy article must not grow a challenge it does not have.
 */
export function itemHasQuestions(item: DailyDropContentItem | null | undefined): boolean {
  return readItemQuestions(item).questions.length > 0;
}

/**
 * The main button at the end of a reading.
 *
 * Decided from the data, not from a date: a reading with assigned questions
 * leads to them; one without — legacy content — keeps the button it always had.
 */
export type ReadingCta = "go_to_questions" | "mark_read" | "back";

export function resolveReadingCta(input: { questionCount: number; completed: boolean }): ReadingCta {
  if (input.questionCount > 0) {
    return "go_to_questions";
  }

  return input.completed ? "back" : "mark_read";
}

/**
 * "Go to questions", pressed.
 *
 * The article is marked read through the canonical `markItemsComplete` — the
 * same write "Mark as read" uses, started FIRST so it can never be skipped — and
 * the questions open immediately rather than after the network round-trip.
 * The write keeps running after navigation (the reader stays mounted), and a
 * failure is reported, never swallowed silently.
 */
export function goToQuestionsAfterReading(input: {
  completed: boolean;
  markRead: () => Promise<void>;
  openQuestions: () => void;
  onMarkReadError?: (error: unknown) => void;
}): Promise<void> {
  const write = input.completed ? Promise.resolve() : input.markRead();

  input.openQuestions();

  return write.catch((error: unknown) => {
    input.onMarkReadError?.(error);
  });
}
