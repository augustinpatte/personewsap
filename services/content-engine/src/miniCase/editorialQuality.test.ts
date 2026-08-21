import { describe, expect, it } from "vitest";

import { validateMiniCaseDistractorQuality } from "./distractorQuality.js";
import {
  miniCaseSemanticText,
  validateMiniCaseTaxonomyCompatibility
} from "./taxonomyCompatibility.js";

/**
 * Two ways the launch catalog passed every validator and still shipped work a
 * reader can see through.
 *
 * Taxonomy: an AI cyber-operations case filed as a `clinical_trial_decision`
 * testing a `trial_endpoint`, and a warehouse-robot case filed as
 * `privacy_compliance`. Spelled correctly, structurally valid, and nonsense —
 * and the taxonomy is what editorial memory rotation and the Learning Path
 * group cases by, so the damage is not cosmetic.
 *
 * Distractors: options like "count news articles" and "choose based on public
 * visibility", which let a reader answer by picking the only professional-
 * looking option without reading the case.
 */

const AI_CYBER_CASE = miniCaseSemanticText({
  title: "A payments firm loses two hours of transaction processing",
  context:
    "An operations team at a payments firm sees its fraud model start rejecting valid transactions after an upstream data feed changes format overnight.",
  challenge: "The team must decide whether to roll back the model or hold and gather more data.",
  question: "Which signal decides it?",
  final_takeaway: "Rollbacks trade a known cost for an unknown one.",
  questions: [
    {
      question: "What should the on-call engineer check first?",
      options: [
        { text: "The rejection rate against last week's baseline.", feedback: "Right." },
        { text: "The size of the queue waiting to be processed.", feedback: "Partial." }
      ]
    }
  ]
});

const PHARMA_AI_CASE = miniCaseSemanticText({
  title: "An AI triage tool is proposed for a phase III oncology trial",
  context:
    "A biotech wants to use a model to pre-screen patients for a phase III trial. The trial's primary endpoint is progression-free survival, and the cohort must stay representative.",
  challenge: "The team must decide whether the model can select patients without biasing the endpoint.",
  question: "What decides whether the tool is admissible?",
  final_takeaway: "A screening tool that shifts the cohort shifts the endpoint.",
  questions: []
});

const WAREHOUSE_ROBOT_CASE = miniCaseSemanticText({
  title: "A warehouse operator delays its second robot line",
  context:
    "An operator running one automated picking line wants a second. Throughput on the first is below plan because the bottleneck moved to packing, and the capital is committed for the quarter.",
  challenge: "The team must decide whether to add the line or fix the packing constraint.",
  question: "Where does the capacity actually bind?",
  final_takeaway: "Adding capacity behind a bottleneck buys nothing.",
  questions: []
});

describe("taxonomy has to describe the case it is attached to", () => {
  it("refuses a clinical-trial scenario on an AI cyber-operations case", () => {
    const issues = validateMiniCaseTaxonomyCompatibility({
      productTopic: "ai",
      scenarioType: "clinical_trial_decision",
      conceptTested: "margin",
      caseText: AI_CYBER_CASE
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("scenario_type");
    expect(issues[0].message).toContain("clinical trial");
  });

  it("refuses a trial_endpoint concept on that same case", () => {
    const issues = validateMiniCaseTaxonomyCompatibility({
      productTopic: "ai",
      scenarioType: "ai_build_vs_buy",
      conceptTested: "trial_endpoint",
      caseText: AI_CYBER_CASE
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("concept_tested");
  });

  it("refuses privacy_compliance on an engineering case with no personal data", () => {
    const issues = validateMiniCaseTaxonomyCompatibility({
      productTopic: "engineering_operations",
      scenarioType: "capacity_planning",
      conceptTested: "privacy_compliance",
      caseText: WAREHOUSE_ROBOT_CASE
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("concept_tested");
  });

  it("refuses a regulatory concept on a market-demand case with no regulator in it", () => {
    const demandCase = miniCaseSemanticText({
      title: "A retailer weighs a listing against slowing demand",
      context:
        "A fashion retailer preparing to list sees order volume flatten in its two largest markets while its cost per acquired customer keeps rising.",
      challenge: "The team must decide whether to price the listing on current demand or wait.",
      questions: []
    });

    const issues = validateMiniCaseTaxonomyCompatibility({
      productTopic: "stock_market",
      scenarioType: "market_entry",
      conceptTested: "regulatory_risk",
      caseText: demandCase
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].value).toBe("regulatory_risk");
  });

  it("still allows a genuine cross-domain case", () => {
    // An AI case really about a clinical trial. The mechanism is in the text, so
    // the taxonomy is earned rather than borrowed.
    expect(
      validateMiniCaseTaxonomyCompatibility({
        productTopic: "ai",
        scenarioType: "clinical_trial_decision",
        conceptTested: "trial_endpoint",
        caseText: PHARMA_AI_CASE
      })
    ).toEqual([]);
  });

  it("leaves general business mechanisms alone in every topic", () => {
    for (const concept of ["margin", "unit_economics", "opportunity_cost", "bottleneck"]) {
      expect(
        validateMiniCaseTaxonomyCompatibility({
          productTopic: "engineering_operations",
          scenarioType: "capacity_planning",
          conceptTested: concept,
          caseText: WAREHOUSE_ROBOT_CASE
        })
      ).toEqual([]);
    }
  });

  it("asks nothing of a case in the value's home topic", () => {
    expect(
      validateMiniCaseTaxonomyCompatibility({
        productTopic: "health_pharma",
        scenarioType: "clinical_trial_decision",
        conceptTested: "trial_endpoint",
        caseText: "Un cas de santé sans vocabulaire particulier."
      })
    ).toEqual([]);
  });
});

describe("a question must not be answerable by elimination", () => {
  const plausible = [
    { id: "A", text: "Compare the rejection rate against last week's baseline.", is_correct: true },
    { id: "B", text: "Roll back to the previous model version immediately.", is_correct: false },
    { id: "C", text: "Hold the model and widen the manual review queue.", is_correct: false },
    { id: "D", text: "Escalate to the vendor before changing anything live.", is_correct: false }
  ];

  it("accepts four options from the same decision space", () => {
    expect(validateMiniCaseDistractorQuality(plausible, AI_CYBER_CASE)).toEqual([]);
  });

  it("refuses a media-attention distractor in a case that is not about attention", () => {
    const issues = validateMiniCaseDistractorQuality(
      [
        plausible[0],
        plausible[1],
        { id: "C", text: "Count the number of news articles covering the incident.", is_correct: false },
        plausible[3]
      ],
      AI_CYBER_CASE
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("mini_case_distractor_offtopic");
    expect(issues[0].optionIndex).toBe(2);
  });

  it("refuses a fund-launch-date distractor", () => {
    const issues = validateMiniCaseDistractorQuality(
      [
        plausible[0],
        { id: "B", text: "Use the fund launch date to rank the two options.", is_correct: false },
        plausible[2],
        plausible[3]
      ],
      AI_CYBER_CASE
    );

    expect(issues.map((issue) => issue.code)).toEqual(["mini_case_distractor_offtopic"]);
  });

  it("refuses public visibility and biggest-promise distractors", () => {
    const issues = validateMiniCaseDistractorQuality(
      [
        plausible[0],
        { id: "B", text: "Choose based on public visibility of each provider.", is_correct: false },
        { id: "C", text: "Choose whichever provider makes the biggest promise.", is_correct: false },
        plausible[3]
      ],
      AI_CYBER_CASE
    );

    expect(issues).toHaveLength(2);
  });

  it("allows those signals when the case genuinely turns on them", () => {
    const reputationCase = miniCaseSemanticText({
      title: "A boycott campaign reaches a retailer's largest market",
      context:
        "A retailer faces an organised boycott. Brand sentiment is falling in its largest market and the communications team must choose what to measure.",
      challenge: "The team must decide which signal tells them whether the campaign is working.",
      questions: []
    });

    expect(
      validateMiniCaseDistractorQuality(
        [
          plausible[0],
          { id: "B", text: "Count the number of news articles covering the boycott.", is_correct: false },
          plausible[2],
          plausible[3]
        ],
        reputationCase
      )
    ).toEqual([]);
  });

  it("refuses a correct answer that towers over its distractors", () => {
    const issues = validateMiniCaseDistractorQuality(
      [
        {
          id: "A",
          text: "Compare the rejection rate against last week's baseline, isolate the changed field in the upstream feed, and hold the rollback until the two agree.",
          is_correct: true
        },
        { id: "B", text: "Roll back now.", is_correct: false },
        { id: "C", text: "Widen the queue.", is_correct: false },
        { id: "D", text: "Call the vendor.", is_correct: false }
      ],
      AI_CYBER_CASE
    );

    expect(issues.map((issue) => issue.code)).toEqual(["mini_case_correct_answer_too_dominant"]);
  });

  it("does not complain about ordinary length differences", () => {
    expect(
      validateMiniCaseDistractorQuality(
        [
          { id: "A", text: "Compare the rejection rate against last week's baseline.", is_correct: true },
          { id: "B", text: "Roll back to the previous version.", is_correct: false },
          { id: "C", text: "Hold and widen manual review.", is_correct: false },
          { id: "D", text: "Escalate to the vendor first.", is_correct: false }
        ],
        AI_CYBER_CASE
      )
    ).toEqual([]);
  });
});
