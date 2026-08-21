import { describe, expect, it } from "vitest";

import {
  miniCaseOptionOrderSeedFrom,
  optionOrderHash,
  orderMiniCaseQuestionOptions
} from "./miniCaseOptionOrder";

/**
 * The 25 KEEP pairs of the launch catalog are never regenerated, and their rows
 * are never rewritten. They were still written before the engine ordered its own
 * options, so their correct answer sits at B on question 1 and D on question 3 —
 * the pattern the editorial audit found.
 *
 * Ordering them at delivery is what fixes that without a migration over reviewed
 * editorial content. These tests pin the two things that make it safe: the
 * stored row is not modified, and nothing a stored answer depends on moves.
 */

/**
 * The exact vector the content engine's suite pins, with the same expected hash.
 *
 * If either implementation drifts, one of the two suites fails here rather than
 * the app quietly serving a different order than the one the engine wrote.
 */
const SHARED_HASH_VECTOR = "finance_economy|pricing_decision|choose_metric|margin#0::B";
const SHARED_HASH_RESULT = "02803eb0a76976dc";

/** A Mini Case as the launch catalog stored it: options in the model's own order. */
function storedQuestions() {
  return [0, 1, 2].map((index) => ({
    id: `q${index + 1}`,
    prompt: `Question ${index + 1}`,
    options: ["A", "B", "C", "D"].map((id) => ({
      id,
      label: `Option ${id}`,
      outcome: id === "B" ? ("best" as const) : ("weak" as const),
      feedback: `Feedback ${id}`
    }))
  }));
}

const STORED_METADATA = {
  product_topic: "finance_economy",
  scenario_type: "pricing_decision",
  decision_type: "choose_metric",
  concept_tested: "margin",
  question_pattern: "framework_then_apply_then_decide",
  correct_answer_pattern: "best_next_signal",
  source_urls: ["https://sources.test/finance/1"]
};

describe("a case stored before the ordering existed is ordered on the way out", () => {
  it("moves the correct answer off the position it was stored at", () => {
    const stored = storedQuestions();
    const delivered = orderMiniCaseQuestionOptions(stored, STORED_METADATA);

    const storedPositions = stored.map((question) =>
      question.options.findIndex((option) => option.outcome === "best")
    );
    const deliveredPositions = delivered.map((question) =>
      question.options.findIndex((option) => option.outcome === "best")
    );

    // Stored: B on every question, which is the catalog's actual pattern.
    expect(storedPositions).toEqual([1, 1, 1]);
    expect(new Set(deliveredPositions).size).toBeGreaterThan(1);
  });

  it("does not mutate the stored content it was given", () => {
    const stored = storedQuestions();
    const before = JSON.stringify(stored);

    orderMiniCaseQuestionOptions(stored, STORED_METADATA);

    // No migration, no write, not even an in-place edit of the parsed row.
    expect(JSON.stringify(stored)).toBe(before);
  });

  it("keeps every option's id bound to its own label, outcome and feedback", () => {
    const delivered = orderMiniCaseQuestionOptions(storedQuestions(), STORED_METADATA);

    for (const question of delivered) {
      expect(question.options).toHaveLength(4);

      for (const option of question.options) {
        expect(option.label).toBe(`Option ${option.id}`);
        expect(option.feedback).toBe(`Feedback ${option.id}`);
        expect(option.outcome).toBe(option.id === "B" ? "best" : "weak");
      }
    }
  });

  it("leaves a stored answer resolving to the same option", () => {
    const delivered = orderMiniCaseQuestionOptions(storedQuestions(), STORED_METADATA);
    // What mini_case_responses.selections holds, written before the reorder.
    const stored: Record<string, string> = { q1: "B", q2: "A" };

    const score = delivered.reduce((total, question, index) => {
      const selected = question.options.find((option) => option.id === stored[`q${index + 1}`]);
      return selected?.outcome === "best" ? total + 1 : total;
    }, 0);

    expect(score).toBe(1);
  });

  it("is idempotent, so content the engine already ordered is unchanged", () => {
    const once = orderMiniCaseQuestionOptions(storedQuestions(), STORED_METADATA);
    const twice = orderMiniCaseQuestionOptions(once, STORED_METADATA);

    expect(twice).toEqual(once);
  });

  it("leaves a question with nothing to reorder alone", () => {
    const single = [{ id: "q1", prompt: "Only one", options: [{ id: "A" }] }];

    expect(orderMiniCaseQuestionOptions(single, STORED_METADATA)).toEqual(single);
    expect(orderMiniCaseQuestionOptions([], STORED_METADATA)).toEqual([]);
  });
});

describe("both languages of one pair are served in the same order", () => {
  it("derives the same order from either version", () => {
    // The seed reads only fields that are byte-identical across a pair, so the
    // two versions agree without either knowing about the other.
    const french = orderMiniCaseQuestionOptions(storedQuestions(), STORED_METADATA);
    const english = orderMiniCaseQuestionOptions(
      storedQuestions().map((question) => ({
        ...question,
        prompt: `English ${question.prompt}`,
        options: question.options.map((option) => ({ ...option, label: `English ${option.label}` }))
      })),
      STORED_METADATA
    );

    french.forEach((question, index) => {
      expect(question.options.map((option) => option.id)).toEqual(
        english[index].options.map((option) => option.id)
      );
    });
  });

  it("ignores the fields that legitimately differ between languages", () => {
    // Title and prose are not part of the seed; taxonomy and sources are.
    expect(miniCaseOptionOrderSeedFrom({ ...STORED_METADATA, title: "Autre titre" } as never)).toBe(
      miniCaseOptionOrderSeedFrom(STORED_METADATA)
    );
    expect(miniCaseOptionOrderSeedFrom({ ...STORED_METADATA, concept_tested: "cash_flow" })).not.toBe(
      miniCaseOptionOrderSeedFrom(STORED_METADATA)
    );
  });
});

describe("the ordering agrees with the content engine", () => {
  it("hashes the shared vector to the value the engine's suite pins", () => {
    expect(optionOrderHash(SHARED_HASH_VECTOR)).toBe(SHARED_HASH_RESULT);
  });

  it("builds the seed the engine builds", () => {
    expect(miniCaseOptionOrderSeedFrom(STORED_METADATA)).toBe(
      "finance_economy|pricing_decision|choose_metric|margin|framework_then_apply_then_decide|best_next_signal|https://sources.test/finance/1"
    );
  });
});
