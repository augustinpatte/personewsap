import type { DailyDropContentItem } from "../today/contentTypes";
import type { QuizQuestionRef } from "./useQuizFlow";
import type { TeamRef } from "./teamMerge";

/**
 * What a content item knows about its own questions and Teams.
 *
 * Reads defensively and returns empty on anything it does not recognise, which
 * is the property that keeps legacy content working: two months of approved
 * Premium has no `logical_questions` field at all, and an article that predates
 * the feature must open, read and complete exactly as it does today rather than
 * throwing on a missing array.
 *
 * `readItemQuestions(legacyArticle)` returning `{ questions: [], teams: [] }` is
 * what makes every "no quiz" branch in the readers fall out for free — there is
 * no `hasQuiz` flag to forget to check.
 */

type QuestionCarrier = {
  logical_questions?: unknown;
  teams?: unknown;
};

function readQuestions(raw: unknown): QuizQuestionRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const value = (entry ?? {}) as Record<string, unknown>;
      const id =
        typeof value.logical_question_id === "string"
          ? value.logical_question_id
          : typeof value.id === "string"
            ? value.id
            : "";

      return { logicalQuestionId: id };
    })
    .filter((question) => question.logicalQuestionId.length > 0);
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
