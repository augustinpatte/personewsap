/**
 * Presentation order of a Mini Case's answer options, decided at delivery.
 *
 * The content engine orders options when it generates a case. That fixes new
 * content and does nothing for what is already in the database — and the launch
 * catalog is 80 versions written before the ordering existed, 50 of which are
 * Mini Case versions kept exactly as they are. Their correct answer sits at B on
 * question 1 and D on question 3, which is a pattern a reader learns in an
 * afternoon.
 *
 * Rewriting those rows to shuffle four strings would be a migration over
 * reviewed editorial content, for a purely presentational property. So the order
 * is applied here instead, on the way to the reader: the stored row is never
 * touched, and old and new content are served the same way.
 *
 * Nothing a reader's answer depends on moves. Option ids are preserved, and both
 * grading (`scoreMiniCaseSelections`) and feedback resolve an option by id, so a
 * result stored before this existed still reads back correctly.
 *
 * MIRRORS `services/content-engine/src/miniCase/optionOrder.ts`. The two must
 * agree exactly — the engine writes content in this order and this re-derives it
 * — so both suites pin the same vector, and a divergence fails a test rather
 * than quietly showing two different orders.
 */

export type OrderableOption = { id: string };
export type OrderableQuestion<Option extends OrderableOption> = { options: Option[] };

/** The fields that identify a case regardless of the language it is written in. */
export type MiniCaseOrderSeedFields = {
  product_topic?: unknown;
  scenario_type?: unknown;
  decision_type?: unknown;
  concept_tested?: unknown;
  question_pattern?: unknown;
  correct_answer_pattern?: unknown;
  source_urls?: unknown;
};

export function miniCaseOptionOrderSeedFrom(fields: MiniCaseOrderSeedFields): string {
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

/**
 * Reorder each question's options.
 *
 * Idempotent, because it sorts by a key rather than permuting: a case the engine
 * already ordered comes out of this unchanged, so the stored order and the
 * displayed order are the same thing.
 */
export function orderMiniCaseQuestionOptions<
  Option extends OrderableOption,
  Question extends OrderableQuestion<Option>
>(questions: Question[], fields: MiniCaseOrderSeedFields): Question[] {
  if (questions.length === 0) {
    return questions;
  }

  const seed = miniCaseOptionOrderSeedFrom(fields);

  return questions.map((question, index) => {
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
  });
}

function optionSortKey(questionSeed: string, optionId: string): string {
  return optionOrderHash(`${questionSeed}::${optionId}`);
}

/** FNV-1a twice, with the engine's offsets. See the note at the top of the file. */
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

function readSeedField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
