import { describe, expect, it } from "vitest";

import {
  MINI_CASE_QUESTION_ROLES,
  OPTIONS_PER_QUESTION,
  QUESTION_COUNT_BY_CONTENT_TYPE,
  QUESTION_SCORE_TIERS,
  QUESTION_TIME_LIMIT_SECONDS,
  READING_QUESTION_ROLES,
  compareQuestionParity,
  gradeBandForTier,
  hasExactTierSet,
  normalizeQuestion,
  normalizeQuestionOptions,
  tierForGradeBand,
  validateGradedQuestion,
  validateOptionShapeNeutrality,
  validateQuestionRationale,
  validateQuestionSet,
  type GradedQuestionOption,
  type QuestionRole
} from "./gradedQuestions.js";

/**
 * The graded question contract.
 *
 * Two families of case here, and they are doing different jobs. The structural
 * ones pin the scale itself — four options, one per tier, integers only — which
 * is what makes a score meaningful at all. The shape ones pin the property that
 * is easy to lose without noticing: that the best answer cannot be picked out
 * by looking at it. That failure does not break anything; it just quietly turns
 * the product into a pattern-matching game, which is exactly how the correct
 * answer ended up being B twenty-five times out of thirty in the launch catalog.
 */

function option(overrides: Partial<GradedQuestionOption> = {}): GradedQuestionOption {
  return {
    id: "a",
    text: "Compare the margin impact against the volume commitment",
    score_milli: 1000,
    feedback: "Right: the constraint is margin, not volume.",
    ...overrides
  };
}

/** Four options of deliberately similar length, one per tier. */
function fourOptions(): GradedQuestionOption[] {
  return [
    option({ id: "a", text: "Compare the margin impact against the volume commitment", score_milli: 1000 }),
    option({ id: "b", text: "Compare the volume commitment against last quarter demand", score_milli: 600 }),
    option({ id: "c", text: "Compare the headline price against the nearest competitor", score_milli: 300 }),
    option({ id: "d", text: "Compare the press coverage against the previous announcement", score_milli: 0 })
  ];
}

function question(overrides: Record<string, unknown> = {}) {
  return normalizeQuestion(
    {
      id: "q1",
      role: "interpretation",
      question: "Why does the discount reduce contribution rather than revenue?",
      options: fourOptions(),
      rationale: {
        decision_criterion: "Which quantity the discount actually moves first",
        excellent_reason: "Names margin as the binding quantity",
        good_limitation: "Right quantity, wrong time horizon",
        average_limitation: "Compares a price, not a mechanism",
        bad_failure: "Uses attention as a proxy for economics"
      },
      ...overrides
    },
    0
  );
}

describe("the scale", () => {
  it("is four integer tiers and nothing else", () => {
    expect(QUESTION_SCORE_TIERS).toEqual([0, 300, 600, 1000]);

    for (const tier of QUESTION_SCORE_TIERS) {
      expect(Number.isInteger(tier), `${tier} must be an integer`).toBe(true);
    }
  });

  it("maps each tier to exactly one band, both ways", () => {
    expect(gradeBandForTier(0)).toBe("bad");
    expect(gradeBandForTier(300)).toBe("average");
    expect(gradeBandForTier(600)).toBe("good");
    expect(gradeBandForTier(1000)).toBe("excellent");

    expect(tierForGradeBand("bad")).toBe(0);
    expect(tierForGradeBand("excellent")).toBe(1000);
    expect(tierForGradeBand("outstanding")).toBeNull();
    // No float ever becomes a band, so no float can enter persistence by this route.
    expect(gradeBandForTier(0.3)).toBeNull();
    expect(gradeBandForTier(750)).toBeNull();
  });

  it("fixes the per-surface question counts", () => {
    expect(QUESTION_COUNT_BY_CONTENT_TYPE.newsletter_article).toBe(2);
    expect(QUESTION_COUNT_BY_CONTENT_TYPE.business_story).toBe(2);
    // The one that must not drift: a Mini Case is three questions, always.
    expect(QUESTION_COUNT_BY_CONTENT_TYPE.mini_case).toBe(3);
    expect(OPTIONS_PER_QUESTION).toBe(4);
    expect(QUESTION_TIME_LIMIT_SECONDS).toBe(20);
  });

  it("keeps the mini-case pedagogical progression in order", () => {
    expect(MINI_CASE_QUESTION_ROLES).toEqual([
      "method_framework",
      "technical_application",
      "conclusion_decision"
    ]);
    expect(READING_QUESTION_ROLES).toEqual(["interpretation", "application_decision"]);
  });
});

describe("hasExactTierSet", () => {
  it("accepts exactly one option per tier", () => {
    expect(hasExactTierSet(fourOptions())).toBe(true);
  });

  it("rejects two excellent answers", () => {
    const options = fourOptions();
    options[1].score_milli = 1000;

    // Two answers worth 1000 makes the question unanswerable: whoever picks the
    // "wrong" 1000 is right and still feels cheated.
    expect(hasExactTierSet(options)).toBe(false);
  });

  it("rejects a question with no winner", () => {
    const options = fourOptions();
    options[0].score_milli = 600;

    expect(hasExactTierSet(options)).toBe(false);
  });

  it("rejects three options", () => {
    expect(hasExactTierSet(fourOptions().slice(0, 3))).toBe(false);
  });
});

describe("validateGradedQuestion", () => {
  it("passes a well-formed question", () => {
    expect(validateGradedQuestion(question(), "interpretation")).toEqual([]);
  });

  it("catches the wrong role", () => {
    const issues = validateGradedQuestion(question(), "application_decision");

    expect(issues.map((issue) => issue.code)).toContain("question_role_invalid");
  });

  it("catches a duplicated tier", () => {
    const options = fourOptions();
    options[1].score_milli = 1000;

    const issues = validateGradedQuestion(question({ options }), "interpretation");

    expect(issues.map((issue) => issue.code)).toContain("question_score_tier_set_invalid");
  });

  it("catches a score outside the scale", () => {
    const options = fourOptions();
    (options[1] as unknown as Record<string, unknown>).score_milli = 750;

    const issues = validateGradedQuestion(question({ options }), "interpretation");
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain("question_score_tier_invalid");
    expect(codes).toContain("question_score_tier_set_invalid");
  });

  it("catches duplicated option ids and duplicated option text", () => {
    const options = fourOptions();
    options[1].id = "a";
    options[2].text = options[0].text;

    const codes = validateGradedQuestion(question({ options }), "interpretation").map(
      (issue) => issue.code
    );

    expect(codes).toContain("question_option_id_duplicated");
    expect(codes).toContain("question_option_text_duplicated");
  });

  it("treats punctuation and case as the same answer", () => {
    const options = fourOptions();
    options[2].text = "compare the MARGIN impact, against the volume commitment!";

    const codes = validateGradedQuestion(question({ options }), "interpretation").map(
      (issue) => issue.code
    );

    expect(codes).toContain("question_option_text_duplicated");
  });

  it("requires a post-answer explanation on every option", () => {
    const options = fourOptions();
    options[3].feedback = "";

    const codes = validateGradedQuestion(question({ options }), "interpretation").map(
      (issue) => issue.code
    );

    expect(codes).toContain("question_feedback_missing");
  });

  it("stops at the option count rather than piling on derived findings", () => {
    // One cause, one finding. Three options is a single structural defect, and
    // reporting the missing tier set and the shape checks on top of it makes the
    // reviewer feedback harder to act on, not easier.
    const issues = validateGradedQuestion(question({ options: fourOptions().slice(0, 3) }), "interpretation");

    expect(issues.map((issue) => issue.code)).toEqual(["question_option_count_invalid"]);
  });
});

describe("the ranking has to be defensible", () => {
  it("fails when the reviewer has nothing to check", () => {
    const issues = validateQuestionRationale(
      question({ rationale: { decision_criterion: "", excellent_reason: "", good_limitation: "", average_limitation: "", bad_failure: "" } })
    );

    expect(issues.map((issue) => issue.code)).toContain("question_rationale_incomplete");
  });

  it("fails a criterion that only restates the task", () => {
    // "Pick the best answer" separates nothing, which is what gets written when
    // there is no real axis between the four options.
    for (const criterion of ["The best answer is the one that is correct", "Choose the best option available"]) {
      const issues = validateQuestionRationale(
        question({
          rationale: {
            decision_criterion: criterion,
            excellent_reason: "Names the binding constraint",
            good_limitation: "Right idea, wrong horizon",
            average_limitation: "Compares a price",
            bad_failure: "Uses attention as a proxy"
          }
        })
      );

      expect(issues.map((issue) => issue.code), criterion).toContain(
        "question_rationale_criterion_vague"
      );
    }
  });

  it("accepts a criterion that names an axis", () => {
    expect(validateQuestionRationale(question())).toEqual([]);
  });
});

describe("the answer must not be visible from its shape", () => {
  it("passes four options of similar build", () => {
    expect(validateOptionShapeNeutrality(fourOptions())).toEqual([]);
  });

  it("catches the option that towers over the rest", () => {
    const options = fourOptions();
    options[0].text =
      "Compare the margin impact against the volume commitment, then check whether the "
      + "discount is recoverable within the contract term and whether the customer has "
      + "any alternative supplier at that price point";

    const issues = validateOptionShapeNeutrality(options);

    expect(issues.map((issue) => issue.code)).toContain("question_option_length_asymmetric");
    expect(issues[0].optionIndex).toBe(0);
  });

  it("catches the best answer being the only one with a figure", () => {
    const options = fourOptions();
    options[0].text = "Compare the 12-point margin impact with the volume commitment";

    expect(validateOptionShapeNeutrality(options).map((issue) => issue.code)).toContain(
      "question_best_option_only_numeric"
    );
  });

  it("allows figures when they are not a tell", () => {
    const options = fourOptions();
    options[0].text = "Compare the 12-point margin impact with the volume commitment";
    options[2].text = "Compare the 4-week price move with the nearest competitor";

    expect(validateOptionShapeNeutrality(options).map((issue) => issue.code)).not.toContain(
      "question_best_option_only_numeric"
    );
  });

  it("catches the best answer being the only one that states a condition", () => {
    const options = fourOptions();
    options[0].text = "Compare margin against volume, unless the contract is renegotiated";

    expect(validateOptionShapeNeutrality(options).map((issue) => issue.code)).toContain(
      "question_best_option_only_conditional"
    );
  });

  it("catches the French conditional too", () => {
    const options = fourOptions();
    options[0].text = "Comparer la marge au volume, sauf si le contrat est renégocié";

    expect(validateOptionShapeNeutrality(options).map((issue) => issue.code)).toContain(
      "question_best_option_only_conditional"
    );
  });

  it("says nothing when a distractor is the odd one out", () => {
    // The tell only matters when it points AT the answer. A long or hedged
    // distractor is a style problem, not a way to win without reading.
    const options = fourOptions();
    options[3].text = "Compare the press coverage, unless the announcement was pre-briefed";

    expect(validateOptionShapeNeutrality(options).map((issue) => issue.code)).not.toContain(
      "question_best_option_only_conditional"
    );
  });
});

describe("validateQuestionSet", () => {
  const readingRoles = READING_QUESTION_ROLES as readonly QuestionRole[];

  it("requires exactly two questions for a reading", () => {
    const issues = validateQuestionSet([question()], readingRoles);

    expect(issues[0].code).toBe("question_option_count_invalid");
    expect(issues[0].message).toContain("Expected exactly 2 questions, got 1");
  });

  it("requires the roles in order", () => {
    const issues = validateQuestionSet(
      [question({ role: "application_decision" }), question({ id: "q2", role: "interpretation" })],
      readingRoles
    );

    expect(issues.filter((issue) => issue.code === "question_role_invalid")).toHaveLength(2);
  });

  it("passes a well-formed pair", () => {
    expect(
      validateQuestionSet(
        [question(), question({ id: "q2", role: "application_decision" })],
        readingRoles
      )
    ).toEqual([]);
  });

  it("requires three questions in order for a mini case", () => {
    const roles = MINI_CASE_QUESTION_ROLES as readonly QuestionRole[];
    const issues = validateQuestionSet(
      [
        question({ role: "method_framework" }),
        question({ id: "q2", role: "technical_application" })
      ],
      roles
    );

    // Two questions is a Mini Case that lost its conclusion step.
    expect(issues[0].message).toContain("Expected exactly 3 questions, got 2");
  });
});

describe("reading legacy questions", () => {
  it("reads the binary catalog without crashing", () => {
    const { options, graded } = normalizeQuestionOptions([
      { id: "a", text: "First", is_correct: true, feedback: "yes" },
      { id: "b", text: "Second", is_correct: false, feedback: "no" },
      { id: "c", text: "Third", is_correct: false, feedback: "no" },
      { id: "d", text: "Fourth", is_correct: false, feedback: "no" }
    ]);

    expect(graded).toBe(false);
    expect(options.map((entry) => entry.score_milli)).toEqual([1000, 0, 0, 0]);
  });

  it("does not invent a middle grade for a binary option", () => {
    // is_correct: false carries no information about whether an answer was
    // nearly right or hopeless. Mapping it to 300 or 600 would be fabricating an
    // editorial judgement nobody made, so it stays 0 and `graded` reports false.
    const { options } = normalizeQuestionOptions([
      { id: "a", text: "First", is_correct: false, feedback: "no" },
      { id: "b", text: "Second", is_correct: true, feedback: "yes" }
    ]);

    expect(options.map((entry) => entry.score_milli)).toEqual([0, 1000]);
  });

  it("reads the mobile outcome shape", () => {
    const { options, graded } = normalizeQuestionOptions([
      { id: "a", label: "First", outcome: "best", feedback: "yes" },
      { id: "b", label: "Second", outcome: "viable", feedback: "partly" },
      { id: "c", label: "Third", outcome: "weak", feedback: "no" }
    ]);

    expect(graded).toBe(false);
    expect(options.map((entry) => entry.score_milli)).toEqual([1000, 600, 0]);
    expect(options[0].text).toBe("First");
  });

  it("reports a graded question as graded", () => {
    const { graded } = normalizeQuestionOptions(fourOptions());

    expect(graded).toBe(true);
  });

  it("survives a malformed question without throwing", () => {
    for (const input of [null, undefined, {}, { options: null }, { options: "nope" }]) {
      expect(() => normalizeQuestion(input, 0)).not.toThrow();
    }

    expect(normalizeQuestion(null, 3).id).toBe("question-4");
  });
});

describe("bilingual logical parity", () => {
  function frQuestions() {
    return [
      {
        id: "q1",
        role: "interpretation",
        question: "Pourquoi la remise réduit-elle la contribution ?",
        options: [
          { id: "a", text: "Comparer l'effet sur la marge au volume engagé", score_milli: 1000, feedback: "ok" },
          { id: "b", text: "Comparer le volume engagé à la demande passée", score_milli: 600, feedback: "ok" },
          { id: "c", text: "Comparer le prix affiché à celui du concurrent", score_milli: 300, feedback: "ok" },
          { id: "d", text: "Comparer la couverture presse à l'annonce précédente", score_milli: 0, feedback: "ok" }
        ],
        rationale: {
          decision_criterion: "Quelle grandeur bouge en premier",
          excellent_reason: "Nomme la marge",
          good_limitation: "Bon axe, mauvais horizon",
          average_limitation: "Compare un prix",
          bad_failure: "Prend l'attention pour un signal"
        }
      }
    ];
  }

  function enQuestions() {
    return [
      {
        id: "q1",
        role: "interpretation",
        question: "Why does the discount reduce contribution?",
        options: [
          { id: "a", text: "Compare the margin impact against the volume commitment", score_milli: 1000, feedback: "ok" },
          { id: "b", text: "Compare the volume commitment against past demand", score_milli: 600, feedback: "ok" },
          { id: "c", text: "Compare the headline price against the competitor", score_milli: 300, feedback: "ok" },
          { id: "d", text: "Compare the press coverage against the last announcement", score_milli: 0, feedback: "ok" }
        ],
        rationale: {
          decision_criterion: "Which quantity moves first",
          excellent_reason: "Names margin",
          good_limitation: "Right axis, wrong horizon",
          average_limitation: "Compares a price",
          bad_failure: "Uses attention as a signal"
        }
      }
    ];
  }

  it("accepts two renderings of the same logical question", () => {
    expect(compareQuestionParity(frQuestions(), enQuestions())).toEqual([]);
  });

  it("catches a score that differs between languages", () => {
    // The failure that matters most: a French reader and an English reader in
    // the same team answering the same question on different scales.
    const fr = frQuestions();
    fr[0].options[1].score_milli = 300;
    fr[0].options[2].score_milli = 600;

    const problems = compareQuestionParity(fr, enQuestions());

    expect(problems.join(" ")).toContain("option b scores 300 in fr and 600 in en");
  });

  it("catches a different option id", () => {
    const fr = frQuestions();
    fr[0].options[0].id = "z";

    expect(compareQuestionParity(fr, enQuestions()).join(" ")).toContain(
      "question 1 option z is missing in en"
    );
  });

  it("catches a different question count", () => {
    expect(compareQuestionParity(frQuestions(), []).join(" ")).toContain("question count differs");
  });

  it("catches an untranslated option", () => {
    // Identical text on both sides means one language was copied rather than
    // written — parity that looks like parity.
    const fr = frQuestions();
    fr[0].options[0].text = "Compare the margin impact against the volume commitment";

    expect(compareQuestionParity(fr, enQuestions()).join(" ")).toContain(
      "option a has identical fr and en text"
    );
  });

  it("does not require the wording to match", () => {
    expect(compareQuestionParity(frQuestions(), enQuestions())).toEqual([]);
  });
});
