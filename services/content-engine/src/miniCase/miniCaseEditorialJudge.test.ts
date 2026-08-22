import { describe, expect, it } from "vitest";

import { validateMiniCaseDistractorQuality } from "./distractorQuality.js";
import { miniCaseSemanticText } from "./taxonomyCompatibility.js";
import {
  judgeRejectionReasons,
  parseJudgeVerdict,
  type MiniCaseJudgeVerdict
} from "./miniCaseEditorialJudge.js";

/**
 * Real distractors from the first repair batch that the deterministic guard let
 * through:
 *
 *   stock_market-05 Q2   brand age · packaging color · number of countries sold in
 *   finance_economy-05   media coverage · exact date the threshold was crossed ·
 *                        debt levels of other countries
 *
 * Every miss had the same cause: the guard was an allowlist of three narrowly
 * worded phrasings, so it could only catch what somebody had already imagined.
 * The families below are the observed classes. What a string matcher still
 * cannot do — decide whether an unanticipated option is a credible professional
 * choice, or whether option B means the same mistake in French and English — is
 * what the Luna judge is for.
 */

const STOCK_CASE = miniCaseSemanticText({
  title: "A listed drinks group weighs a price rise against volume",
  context:
    "A drinks group has held its shelf price for six quarters while input costs rose. Volume is flat and the retailer is pushing back on any increase.",
  challenge: "The team must decide which signal tells them whether a price rise would hold.",
  questions: []
});

const DEBT_CASE = miniCaseSemanticText({
  title: "A finance ministry passes a debt threshold",
  context:
    "A finance ministry has crossed the debt ratio written into its own fiscal rule. The spread against the benchmark has widened by 30 basis points since the announcement.",
  challenge: "The team must decide which signal indicates real financing stress.",
  questions: []
});

describe("the distractors the first batch shipped are now refused", () => {
  const correct = {
    id: "A",
    text: "Test the price rise on a single region before rolling it out.",
    is_correct: true
  };

  it("refuses brand age, packaging colour and country count together", () => {
    const issues = validateMiniCaseDistractorQuality(
      [
        correct,
        { id: "B", text: "Compare the brand age against the challenger's.", is_correct: false },
        { id: "C", text: "Look at the packaging colour on the new range.", is_correct: false },
        {
          id: "D",
          text: "Count the number of countries where the brand is sold.",
          is_correct: false
        }
      ],
      STOCK_CASE
    );

    expect(issues.filter((issue) => issue.code === "mini_case_distractor_offtopic")).toHaveLength(3);
    expect(issues.map((issue) => issue.optionIndex).sort()).toEqual([1, 2, 3]);
  });

  it("refuses bare media coverage, an exact date and other countries' debt", () => {
    const issues = validateMiniCaseDistractorQuality(
      [
        { id: "A", text: "Watch the spread against the benchmark over the next month.", is_correct: true },
        { id: "B", text: "Decide based on media coverage of the announcement.", is_correct: false },
        { id: "C", text: "Use the exact date the debt threshold was crossed.", is_correct: false },
        { id: "D", text: "Compare the debt levels of other countries in the bloc.", is_correct: false }
      ],
      DEBT_CASE
    );

    expect(issues.filter((issue) => issue.code === "mini_case_distractor_offtopic")).toHaveLength(3);
  });

  it("still accepts four options from the same decision space", () => {
    expect(
      validateMiniCaseDistractorQuality(
        [
          correct,
          { id: "B", text: "Raise the price across the whole range at once.", is_correct: false },
          { id: "C", text: "Absorb the input cost for another two quarters.", is_correct: false },
          { id: "D", text: "Trade the price rise for a wider shelf listing.", is_correct: false }
        ],
        STOCK_CASE
      )
    ).toEqual([]);
  });

  it("still allows a signal the case genuinely turns on", () => {
    const jurisdictionCase = miniCaseSemanticText({
      title: "A retailer plans a market entry",
      context:
        "A retailer is choosing which markets to enter next. Each additional jurisdiction adds a separate regulatory filing and its own distribution contract.",
      challenge: "The team must decide how to sequence the expansion.",
      questions: []
    });

    expect(
      validateMiniCaseDistractorQuality(
        [
          correct,
          {
            id: "B",
            text: "Rank the options by the number of countries each would open.",
            is_correct: false
          },
          { id: "C", text: "Enter the largest market first regardless of cost.", is_correct: false },
          { id: "D", text: "Delay every entry until the filings are cheaper.", is_correct: false }
        ],
        jurisdictionCase
      )
    ).toEqual([]);
  });
});

describe("the semantic judge decides what a regex cannot", () => {
  const passing: MiniCaseJudgeVerdict = {
    pass: true,
    questions: [
      { id: "q1", plausible_wrong_options: 3, obviously_irrelevant_options: [], correct_answer_too_obvious: false },
      { id: "q2", plausible_wrong_options: 3, obviously_irrelevant_options: [], correct_answer_too_obvious: false }
    ],
    pair_semantic_parity: true,
    taxonomy_semantic_fit: true,
    topic_promise_fit: true,
    topic_promise_reason: "The decision turns on the rule's applicability.",
    tested_domain_mechanism: "scope of a procurement threshold",
    reasons: []
  };

  it("accepts a pair where every wrong answer is a real mistake", () => {
    expect(judgeRejectionReasons(passing)).toEqual([]);
  });

  it("refuses an option a reader can dismiss without the case", () => {
    const reasons = judgeRejectionReasons({
      ...passing,
      pass: false,
      questions: [
        {
          id: "q2",
          plausible_wrong_options: 2,
          obviously_irrelevant_options: ["C"],
          correct_answer_too_obvious: false
        }
      ]
    });

    expect(reasons.join(" ")).toContain("q2: option(s) C can be dismissed");
    expect(reasons.join(" ")).toContain("only 2 of the 3 wrong options");
  });

  it("refuses a correct answer identifiable without the case", () => {
    expect(
      judgeRejectionReasons({
        ...passing,
        questions: [
          {
            id: "q1",
            plausible_wrong_options: 3,
            obviously_irrelevant_options: [],
            correct_answer_too_obvious: true
          }
        ]
      }).join(" ")
    ).toContain("identifiable without the case");
  });

  it("refuses a pair whose option ids mean different mistakes in each language", () => {
    // The real stock_market-02 failure: FR option B was "number of articles
    // after the release" while EN option B was "management view on capital
    // needs". Same id, different exercise — and pair validation passed it.
    const reasons = judgeRejectionReasons({ ...passing, pair_semantic_parity: false });

    expect(reasons.join(" ")).toContain("same reasoning exercise");
  });

  it("refuses taxonomy the case does not contain", () => {
    expect(judgeRejectionReasons({ ...passing, taxonomy_semantic_fit: false }).join(" ")).toContain(
      "mechanism the case does not contain"
    );
  });

  it("does not believe a pass that contradicts its own detail", () => {
    // A model that reports an irrelevant option and still says pass has
    // contradicted itself. The detail wins.
    expect(
      judgeRejectionReasons({
        ...passing,
        pass: true,
        questions: [
          {
            id: "q3",
            plausible_wrong_options: 3,
            obviously_irrelevant_options: ["D"],
            correct_answer_too_obvious: false
          }
        ]
      })
    ).not.toEqual([]);
  });
});

describe("an unusable answer from the judge is a refusal, not a pass", () => {
  it("rejects a malformed payload", () => {
    for (const payload of [null, undefined, "nope", {}, { pass: "yes" }]) {
      const verdict = parseJudgeVerdict(payload);

      expect(verdict.pass).toBe(false);
      expect(judgeRejectionReasons(verdict)).not.toEqual([]);
    }
  });

  it("parses a well-formed verdict", () => {
    const verdict = parseJudgeVerdict({
      pass: true,
      questions: [
        {
          id: "q1",
          plausible_wrong_options: 3,
          obviously_irrelevant_options: [],
          correct_answer_too_obvious: false
        }
      ],
      pair_semantic_parity: true,
      taxonomy_semantic_fit: true,
      topic_promise_fit: true,
      topic_promise_reason: "ok",
      tested_domain_mechanism: "scope of a rule",
      reasons: []
    });

    expect(verdict.pass).toBe(true);
    expect(verdict.questions).toHaveLength(1);
    expect(judgeRejectionReasons(verdict)).toEqual([]);
  });
});
