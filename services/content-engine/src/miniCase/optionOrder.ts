import type { DailyDropPayload, GeneratedContentItem, MiniCaseChallenge } from "../domain.js";

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
  return miniCaseOptionOrderSeedFrom(item);
}

/**
 * The same seed, built from loose fields.
 *
 * The mobile app holds a persisted case as `content_items.metadata`, not as a
 * `MiniCaseChallenge`, and has to reach the identical seed from it. Keeping one
 * function for both shapes is what stops the two sides drifting apart.
 */
export function miniCaseOptionOrderSeedFrom(fields: {
  product_topic?: unknown;
  scenario_type?: unknown;
  decision_type?: unknown;
  concept_tested?: unknown;
  question_pattern?: unknown;
  correct_answer_pattern?: unknown;
  source_urls?: unknown;
}): string {
  const urls = Array.isArray(fields.source_urls) ? fields.source_urls : [];
  const sources = [
    ...new Set(
      urls
        .filter((url): url is string => typeof url === "string")
        .map((url) => url.trim())
        .filter(Boolean)
    )
  ].sort();

  return [
    readSeedField(fields.product_topic),
    readSeedField(fields.scenario_type),
    readSeedField(fields.decision_type),
    readSeedField(fields.concept_tested),
    readSeedField(fields.question_pattern),
    readSeedField(fields.correct_answer_pattern),
    sources.join(",")
  ].join("|");
}

function readSeedField(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  return optionOrderHash(`${questionSeed}::${optionId}`);
}

/**
 * The ordering hash.
 *
 * Deliberately not `sha256`: the mobile app has to compute the SAME order when
 * it serves a case persisted before this ordering existed, and it has no
 * node:crypto. This is FNV-1a run twice with different offsets — arithmetic that
 * behaves identically in every JavaScript runtime, using `Math.imul` and `>>> 0`
 * so the 32-bit wraparound is explicit rather than left to float precision.
 *
 * It is not a security primitive and does not need to be. It decides which of
 * four options is shown first.
 *
 * MIRRORED IN `apps/mobile/src/features/today/miniCaseOptionOrder.ts`. The two
 * implementations must agree exactly; both suites pin the same vector so a
 * divergence fails a test rather than silently showing two different orders.
 */
export function optionOrderHash(value: string): string {
  const first = fnv1a(value, 0x811c9dc5);
  const second = fnv1a(value, 0x9e3779b1);

  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}
