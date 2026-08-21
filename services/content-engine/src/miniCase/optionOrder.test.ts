import { describe, expect, it } from "vitest";

import type { Language, MiniCaseChallenge } from "../domain.js";
import {
  correctAnswerPositions,
  miniCaseOptionOrderSeed,
  orderMiniCaseOptions
} from "./optionOrder.js";

/**
 * The catalog was answerable without reading it.
 *
 * Across the thirty finished Mini Cases the correct answer was B on question 1
 * in 25 of them, and D on question 3 in 27. That is not a quiz; it is a pattern
 * a reader learns in an afternoon, after which the product teaches nothing.
 *
 * The fix is not a prompt instruction. A model asked to randomize produces its
 * own bias, and the bias is only visible once the catalog is finished and paid
 * for. The order is decided from a hash instead, and what the model prefers
 * stops mattering.
 */

const CORRECT_ID = "B";

/**
 * How a stored answer is graded: look the option up BY ID and read its own
 * correctness. Position never enters into it — which is precisely what makes
 * reordering the array safe. This mirrors the mobile grader
 * (`scoreMiniCaseSelections`, which resolves `selections[question.id]` against
 * `option.id`); the mobile side has its own test that the real one is
 * position-independent too.
 */
function scoreBySelections(
  questions: MiniCaseChallenge["questions"],
  selections: Record<string, string>
): number {
  return questions.reduce((score, question) => {
    const option = question.options.find((candidate) => candidate.id === selections[question.id]);
    return option?.is_correct ? score + 1 : score;
  }, 0);
}

function miniCase(overrides: Partial<MiniCaseChallenge> = {}): MiniCaseChallenge {
  const language: Language = (overrides.language as Language) ?? "fr";

  return {
    content_type: "mini_case",
    slot: "mini_case",
    topic: "finance",
    product_topic: "finance_economy",
    language,
    title: language === "fr" ? "Un cas de trésorerie" : "A cash-flow case",
    scenario_type: "pricing_decision",
    decision_type: "choose_metric",
    concept_tested: "margin",
    mechanism: "pricing power",
    question_pattern: "framework_then_apply_then_decide",
    correct_answer_pattern: "best_next_signal",
    core_takeaway: "Selection defends margin.",
    difficulty: "intro",
    context: "Context.",
    challenge: "Challenge.",
    constraints: [],
    question: "Question?",
    questions: ["method_framework", "technical_application", "conclusion_decision"].map(
      (role, index) => ({
        id: `q${index + 1}`,
        role: role as MiniCaseChallenge["questions"][number]["role"],
        question: `Question ${index + 1}?`,
        options: ["A", "B", "C", "D"].map((id) => ({
          id,
          text: `Option ${id} text`,
          is_correct: id === CORRECT_ID,
          feedback: `Feedback for ${id}`
        }))
      })
    ),
    expected_reasoning: ["Reason."],
    sample_answer: "Sample.",
    conclusion: "Conclusion.",
    final_takeaway: "Takeaway.",
    score_max: 3,
    body_md: "Body.",
    source_urls: ["https://sources.test/finance/1"],
    version: 1,
    ...overrides
  } as MiniCaseChallenge;
}

/** Same editorial identity, different case content — one per seed variation. */
function caseWithSources(index: number): MiniCaseChallenge {
  return miniCase({ source_urls: [`https://sources.test/finance/${index}`] });
}

describe("the correct answer does not sit in a learnable position", () => {
  it("moves the correct answer off the position the model chose", () => {
    const ordered = orderMiniCaseOptions(miniCase());

    // Every question started with the correct answer at index 1 (B).
    expect(correctAnswerPositions(miniCase())).toEqual([1, 1, 1]);
    // After ordering they no longer all sit there.
    expect(new Set(correctAnswerPositions(ordered)).size).toBeGreaterThan(1);
  });

  it("reaches every one of the four positions across a catalog-sized batch", () => {
    const positions = new Set<number>();

    for (let index = 0; index < 40; index += 1) {
      for (const position of correctAnswerPositions(orderMiniCaseOptions(caseWithSources(index)))) {
        positions.add(position);
      }
    }

    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
  });

  it("spreads them without a dominant position", () => {
    const counts = [0, 0, 0, 0];

    // 30 cases x 3 questions, the size of the real Mini Case catalog.
    for (let index = 0; index < 30; index += 1) {
      for (const position of correctAnswerPositions(orderMiniCaseOptions(caseWithSources(index)))) {
        counts[position] += 1;
      }
    }

    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(90);

    // The catalog's real distribution was 25/30 and 27/30 on a single letter.
    // Nothing here may come near that: every position is used, and none takes
    // more than double its fair share.
    for (const count of counts) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan((total / 4) * 2);
    }
  });

  it("gives different questions of one case different orders", () => {
    const ordered = orderMiniCaseOptions(miniCase());
    const orders = ordered.questions.map((question) => question.options.map((option) => option.id).join(""));

    expect(new Set(orders).size).toBeGreaterThan(1);
  });
});

describe("both languages of one pair present the same order", () => {
  it("derives the same order from either version, with no shared state", () => {
    // Everything the seed reads is already required to be identical across a
    // pair: taxonomy by validateSharedLogic, sources by validateSharedSources.
    const french = miniCase({ language: "fr", title: "Un cas de trésorerie" });
    const english = miniCase({
      language: "en",
      title: "A cash-flow case",
      questions: miniCase().questions.map((question) => ({
        ...question,
        question: `English ${question.question}`,
        options: question.options.map((option) => ({ ...option, text: `English ${option.text}` }))
      }))
    });

    expect(miniCaseOptionOrderSeed(french)).toBe(miniCaseOptionOrderSeed(english));

    const orderedFr = orderMiniCaseOptions(french);
    const orderedEn = orderMiniCaseOptions(english);

    orderedFr.questions.forEach((question, index) => {
      expect(question.options.map((option) => option.id)).toEqual(
        orderedEn.questions[index].options.map((option) => option.id)
      );
    });
  });

  it("is idempotent, so a counterpart built from an ordered reference matches", () => {
    const once = orderMiniCaseOptions(miniCase());
    const twice = orderMiniCaseOptions(once);

    expect(twice).toEqual(once);
  });
});

describe("nothing a reader's answer depends on moves", () => {
  it("keeps the correct option correct, with its own feedback", () => {
    const ordered = orderMiniCaseOptions(miniCase());

    for (const question of ordered.questions) {
      const correct = question.options.filter((option) => option.is_correct);

      expect(correct).toHaveLength(1);
      expect(correct[0].id).toBe(CORRECT_ID);
      expect(correct[0].text).toBe(`Option ${CORRECT_ID} text`);
      expect(correct[0].feedback).toBe(`Feedback for ${CORRECT_ID}`);
    }
  });

  it("keeps every option's id bound to its own text and feedback", () => {
    const ordered = orderMiniCaseOptions(miniCase());

    for (const question of ordered.questions) {
      expect(question.options).toHaveLength(4);

      for (const option of question.options) {
        expect(option.text).toBe(`Option ${option.id} text`);
        expect(option.feedback).toBe(`Feedback for ${option.id}`);
      }
    }
  });

  it("leaves grading and stored answers working, because they key on the id", () => {
    const ordered = orderMiniCaseOptions(miniCase());
    // What mini_case_responses.selections stores: question id -> option id.
    // Written before the reorder, read after it.
    const storedSelections = { q1: "B", q2: "B", q3: "B" };
    const wrongSelections = { q1: "A", q2: "C", q3: "D" };

    expect(scoreBySelections(ordered.questions, storedSelections)).toBe(3);
    expect(scoreBySelections(ordered.questions, wrongSelections)).toBe(0);
    // Same score before and after: position never entered into it.
    expect(scoreBySelections(miniCase().questions, storedSelections)).toBe(3);
  });

  it("does not touch the question text or the case itself", () => {
    const original = miniCase();
    const ordered = orderMiniCaseOptions(original);

    expect(ordered.title).toBe(original.title);
    expect(ordered.challenge).toBe(original.challenge);
    expect(ordered.questions.map((question) => question.question)).toEqual(
      original.questions.map((question) => question.question)
    );
    expect(ordered.questions.map((question) => question.role)).toEqual(
      original.questions.map((question) => question.role)
    );
  });
});
