import { describe, expect, it } from "vitest";

import {
  MAX_GENERATION_ATTEMPTS,
  decideReview,
  formatRevisionInstruction,
  isReviewerRepairableCode,
  questionScope,
  reviewFinding,
  scopesForQuestionCount
} from "./questionRevisionScope.js";

/**
 * What a review verdict costs.
 *
 * The property under test is narrower than it looks: it is that a defective
 * question can never cost a good article. The newsletter pipeline currently
 * produces all 16 articles correctly on the first try, and the fastest way to
 * lose that would be to let "Q2's distractors are weak" trigger a full
 * regeneration of prose that was already right.
 */

const contentFinding = reviewFinding({
  scope: "content",
  code: "materiality_fail",
  message: "The event does not clear the materiality gate."
});

const repairableQuestionFinding = reviewFinding({
  scope: "question_2",
  code: "question_option_length_asymmetric",
  message: "Options run 41-140 characters."
});

const judgementQuestionFinding = reviewFinding({
  scope: "question_2",
  code: "question_rationale_criterion_vague",
  message: "decision_criterion restates the task."
});

describe("scopes", () => {
  it("names one scope per question plus the content", () => {
    expect(scopesForQuestionCount(2)).toEqual(["content", "question_1", "question_2"]);
    // A Mini Case reviews four separable things, not three.
    expect(scopesForQuestionCount(3)).toEqual([
      "content",
      "question_1",
      "question_2",
      "question_3"
    ]);
  });

  it("maps a question index to its scope", () => {
    expect(questionScope(0)).toBe("question_1");
    expect(questionScope(2)).toBe("question_3");
  });
});

describe("what a reviewer may repair itself", () => {
  it("accepts shape defects with a mechanical remedy", () => {
    for (const code of [
      "question_option_text_duplicated",
      "question_score_tier_set_invalid",
      "question_feedback_missing",
      "question_option_length_asymmetric",
      "question_best_option_only_numeric"
    ]) {
      expect(isReviewerRepairableCode(code), code).toBe(true);
    }
  });

  it("refuses judgement defects", () => {
    // If the ranking itself is indefensible, no minimal edit fixes it and
    // approving it anyway would be worse than publishing nothing.
    for (const code of [
      "question_rationale_criterion_vague",
      "question_rationale_incomplete",
      "mini_case_distractor_offtopic",
      "materiality_fail"
    ]) {
      expect(isReviewerRepairableCode(code), code).toBe(false);
    }
  });

  it("never marks a content finding repairable, whatever its code", () => {
    // A rewrite is not a repair. Even a code that would be repairable on a
    // question is not repairable on the article.
    const finding = reviewFinding({
      scope: "content",
      code: "question_option_length_asymmetric",
      message: "n/a"
    });

    expect(finding.repairable).toBe(false);
  });
});

describe("attempt 1", () => {
  it("approves when nothing failed", () => {
    const decision = decideReview({ attempt: 1, findings: [] });

    expect(decision.verdict).toBe("approved");
    expect(decision.targets).toEqual([]);
  });

  it("asks for revision of the failing scopes only", () => {
    const decision = decideReview({ attempt: 1, findings: [repairableQuestionFinding] });

    expect(decision.verdict).toBe("revision_required");
    expect(decision.targets).toEqual(["question_2"]);
    // THE regression this whole module exists to prevent.
    expect(decision.regenerateContent).toBe(false);
  });

  it("regenerates the content only when the content is what failed", () => {
    const decision = decideReview({ attempt: 1, findings: [contentFinding] });

    expect(decision.verdict).toBe("revision_required");
    expect(decision.regenerateContent).toBe(true);
    expect(decision.targets).toEqual(["content"]);
  });

  it("reports scopes in a stable order", () => {
    const decision = decideReview({
      attempt: 1,
      findings: [
        reviewFinding({ scope: "question_3", code: "question_feedback_missing", message: "x" }),
        contentFinding,
        repairableQuestionFinding
      ]
    });

    expect(decision.targets).toEqual(["content", "question_2", "question_3"]);
  });
});

describe("attempt 2", () => {
  it("behaves exactly like attempt 1", () => {
    const decision = decideReview({ attempt: 2, findings: [repairableQuestionFinding] });

    expect(decision.verdict).toBe("revision_required");
    expect(decision.targets).toEqual(["question_2"]);
    expect(decision.regenerateContent).toBe(false);
  });

  it("still never widens the scope to untouched parts", () => {
    const decision = decideReview({
      attempt: 2,
      findings: [judgementQuestionFinding]
    });

    expect(decision.targets).toEqual(["question_2"]);
    expect(decision.regenerateContent).toBe(false);
  });
});

describe("attempt 3", () => {
  it("repairs the questions in place rather than asking for a fourth generation", () => {
    const decision = decideReview({ attempt: 3, findings: [repairableQuestionFinding] });

    expect(decision.verdict).toBe("reviewer_repair");
    expect(decision.repairTargets).toEqual(["question_2"]);
    expect(decision.regenerateContent).toBe(false);
  });

  it("repairs several questions at once", () => {
    const decision = decideReview({
      attempt: 3,
      findings: [
        repairableQuestionFinding,
        reviewFinding({ scope: "question_1", code: "question_feedback_too_long", message: "x" })
      ]
    });

    expect(decision.verdict).toBe("reviewer_repair");
    expect(decision.repairTargets).toEqual(["question_1", "question_2"]);
  });

  it("fails rather than letting a reviewer rewrite an article", () => {
    const decision = decideReview({ attempt: 3, findings: [contentFinding] });

    expect(decision.verdict).toBe("failed");
    expect(decision.repairTargets).toEqual([]);
    expect(decision.reason).toContain("may not rewrite");
  });

  it("fails when the content and the questions are both still broken", () => {
    const decision = decideReview({
      attempt: 3,
      findings: [contentFinding, repairableQuestionFinding]
    });

    expect(decision.verdict).toBe("failed");
  });

  it("fails when the remaining question defect is a judgement call", () => {
    const decision = decideReview({ attempt: 3, findings: [judgementQuestionFinding] });

    expect(decision.verdict).toBe("failed");
    expect(decision.reason).toContain("cannot be repaired by a minimal edit");
  });

  it("approves at the last attempt when nothing is left", () => {
    expect(decideReview({ attempt: 3, findings: [] }).verdict).toBe("approved");
  });
});

describe("there is no attempt 4", () => {
  it("caps the attempt count at three", () => {
    expect(MAX_GENERATION_ATTEMPTS).toBe(3);
  });

  it("never returns revision_required at or beyond the last attempt", () => {
    for (const attempt of [3, 4, 9]) {
      for (const findings of [
        [contentFinding],
        [repairableQuestionFinding],
        [judgementQuestionFinding],
        [contentFinding, repairableQuestionFinding]
      ]) {
        const decision = decideReview({ attempt, findings });

        expect(decision.verdict, `attempt ${attempt}`).not.toBe("revision_required");
      }
    }
  });
});

describe("the instruction handed back to the generator", () => {
  it("names what to fix and what to resubmit untouched", () => {
    const findings = [repairableQuestionFinding];
    const decision = decideReview({ attempt: 1, findings });

    const instruction = formatRevisionInstruction({
      decision,
      allScopes: scopesForQuestionCount(2),
      findings
    });

    expect(instruction).toContain("VERDICT: revision_required");
    expect(instruction).toContain("SCOPES TO FIX: question_2");
    // Without this line, "fix Q2" and "here is the whole output again" read the
    // same way to a generator.
    expect(instruction).toContain("DO NOT REGENERATE: content, question_1");
    expect(instruction).toContain("resubmit these byte-for-byte");
    expect(instruction).toContain("[question_option_length_asymmetric]");
  });

  it("says so when everything has to be redone", () => {
    const findings = [
      contentFinding,
      repairableQuestionFinding,
      reviewFinding({ scope: "question_1", code: "question_feedback_missing", message: "x" })
    ];
    const instruction = formatRevisionInstruction({
      decision: decideReview({ attempt: 1, findings }),
      allScopes: scopesForQuestionCount(2),
      findings
    });

    expect(instruction).toContain("DO NOT REGENERATE: none");
  });
});
