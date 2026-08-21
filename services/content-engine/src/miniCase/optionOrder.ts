import type { DailyDropPayload, GeneratedContentItem, MiniCaseChallenge } from "../domain.js";
import { sha256 } from "../utils/hash.js";

/**
 * Where the correct answer sits among the four options.
 *
 * The launch catalog was answerable without reading it. Across thirty cases the
 * correct answer was B on question 1 twenty-five times, and D on question 3
 * twenty-seven times. A reader who notices that stops reasoning and starts
 * pattern-matching, and the product stops teaching anything.
 *
 * Asking the model to "randomize A/B/C/D" does not fix this. A model asked for
 * randomness produces its own bias, and the bias is invisible until the catalog
 * is finished. So the order is decided in code, from a hash, and the model's
 * preference stops mattering.
 *
 * Two properties make this safe to apply anywhere in the pipeline:
 *
 *  - It is an ORDERING, not a shuffle: options are sorted by a key derived from
 *    the case and the option id. Applying it twice changes nothing, so a
 *    counterpart generated from an already-ordered reference lands identically.
 *  - The seed is language-independent, so the French and English versions of one
 *    pair sort the same way without having to be aware of each other.
 *
 * Option ids are never rewritten. They are what stored answers, grading and
 * analytics key on (`mini_case_responses.selections` maps question id to option
 * id, and `scoreMiniCaseSelections` looks the option up by id), so only the
 * array order changes — which is exactly what a reader sees.
 */

/**
 * The editorial identity of a case, independent of the language it is written
 * in.
 *
 * Every field here is already required to be byte-identical across the two
 * versions of a pair: the taxonomy fields by `validateSharedLogic`, the sources
 * by `validateSharedSources`. That is what lets each version compute the same
 * order on its own, with no shared state and no catalog id to thread through —
 * so it works for daily production content exactly as it does for the catalog.
 */
export function miniCaseOptionOrderSeed(item: MiniCaseChallenge): string {
  const sources = [...new Set((item.source_urls ?? []).map((url) => url.trim()).filter(Boolean))].sort();

  return [
    item.product_topic ?? "",
    item.scenario_type ?? "",
    item.decision_type ?? "",
    item.concept_tested ?? "",
    item.question_pattern ?? "",
    item.correct_answer_pattern ?? "",
    sources.join(",")
  ].join("|");
}

/**
 * Reorder every question's options into their presentation order.
 *
 * Questions are keyed by index rather than by id: the index is what
 * `validateSharedLogic` aligns across a pair, so it is guaranteed to match in
 * both languages, and a model is free to invent whatever question ids it likes.
 */
export function orderMiniCaseOptions<Item extends MiniCaseChallenge>(item: Item): Item {
  const questions = Array.isArray(item.questions) ? item.questions : [];

  if (questions.length === 0) {
    return item;
  }

  const seed = miniCaseOptionOrderSeed(item);

  return {
    ...item,
    questions: questions.map((question, index) => {
      const options = Array.isArray(question.options) ? question.options : [];

      if (options.length < 2) {
        return question;
      }

      const questionSeed = `${seed}#${index}`;

      return {
        ...question,
        options: [...options].sort((left, right) =>
          optionSortKey(questionSeed, left.id).localeCompare(optionSortKey(questionSeed, right.id))
        )
      };
    })
  };
}

/** Apply the ordering to every mini case in a payload, leaving the rest alone. */
export function orderMiniCaseOptionsInPayload(payload: DailyDropPayload): DailyDropPayload {
  return {
    ...payload,
    items: payload.items.map((item) =>
      item.content_type === "mini_case" ? orderMiniCaseOptions(item) : item
    )
  };
}

/** Where the correct answer ended up. Exported for the distribution tests. */
export function correctAnswerPositions(item: GeneratedContentItem): number[] {
  if (item.content_type !== "mini_case") {
    return [];
  }

  return (Array.isArray(item.questions) ? item.questions : []).map((question) =>
    (Array.isArray(question.options) ? question.options : []).findIndex((option) => option.is_correct)
  );
}

function optionSortKey(questionSeed: string, optionId: string): string {
  return sha256(`${questionSeed}::${optionId}`);
}
