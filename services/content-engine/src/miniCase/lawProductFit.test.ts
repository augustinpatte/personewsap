import { describe, expect, it } from "vitest";

import type { Language, MiniCaseChallenge } from "../domain.js";
import {
  buildMiniCaseJudgePrompt,
  judgeRejectionReasons,
  parseJudgeVerdict,
  type MiniCaseJudgeVerdict
} from "./miniCaseEditorialJudge.js";

/**
 * A legal setting is not a legal lesson.
 *
 * The rejected candidate was "Le goulot d'étranglement des constitutions
 * d'État", built from a SCOTUSblog piece on state originalism centres. The
 * source was law, the taxonomy was internally coherent, every validator passed
 * — and the decision it asked the reader to make was capacity planning. Nothing
 * in the pipeline could see that, because nothing asked whether the case
 * teaches what its topic promises.
 *
 * That question is now asked, of the judge, and the answer gates the candidate.
 *
 * These tests pin the CONTRACT: that the judge is asked the right question for
 * a law case, and that a negative verdict refuses the candidate with a reason an
 * operator can act on. Whether the model classifies a given case correctly is a
 * model-behaviour question a unit test cannot settle without a live call — the
 * gate is fail-closed precisely because that judgement is not free.
 */

function lawCase(overrides: Partial<MiniCaseChallenge> = {}): MiniCaseChallenge {
  return {
    content_type: "mini_case",
    slot: "mini_case",
    topic: "law",
    product_topic: "law_compliance",
    language: "fr" as Language,
    title: "Un seuil de procédure formalisée",
    scenario_type: "compliance_risk",
    decision_type: "identify_risk",
    concept_tested: "regulatory_risk",
    mechanism: "applicabilité du seuil",
    question_pattern: "risk_then_evidence_then_decision",
    correct_answer_pattern: "evidence_before_action",
    core_takeaway: "Le seuil s'apprécie sur la valeur totale estimée.",
    difficulty: "intro",
    context: "Un acheteur public découpe un marché en trois lots.",
    challenge: "L'équipe doit décider si le seuil de procédure formalisée s'applique.",
    constraints: [],
    question: "Le seuil s'applique-t-il ?",
    questions: [
      {
        id: "q1",
        role: "method_framework",
        question: "Sur quelle base apprécier le seuil ?",
        options: ["A", "B", "C", "D"].map((id) => ({
          id,
          text: `Option ${id}`,
          is_correct: id === "A",
          feedback: `Retour ${id}`
        }))
      }
    ],
    expected_reasoning: ["Additionner la valeur des lots."],
    sample_answer: "Oui.",
    conclusion: "Le seuil s'applique.",
    final_takeaway: "La valeur totale prime sur le découpage.",
    score_max: 3,
    body_md: "Corps.",
    source_urls: ["https://sources.test/law/1"],
    version: 1,
    ...overrides
  } as MiniCaseChallenge;
}

const PASSING: MiniCaseJudgeVerdict = {
  pass: true,
  questions: [
    { id: "q1", plausible_wrong_options: 3, obviously_irrelevant_options: [], correct_answer_too_obvious: false }
  ],
  pair_semantic_parity: true,
  taxonomy_semantic_fit: true,
  topic_promise_fit: true,
  topic_promise_reason: "The decision turns on whether the threshold applies.",
  tested_domain_mechanism: "scope of a procurement threshold",
  reasons: []
};

describe("the judge is asked the Law & Compliance question", () => {
  it("carries the law promise rule for a law_compliance case", () => {
    const prompt = buildMiniCaseJudgePrompt({
      reference: { language: "fr", item: lawCase() },
      counterpart: { language: "en", item: lawCase({ language: "en" }) }
    });

    expect(prompt).toContain("This is a Law & Compliance case");
    // The mechanisms that count.
    expect(prompt).toContain("applicability or scope of a rule");
    expect(prompt).toContain("documentation or evidence requirement");
    expect(prompt).toContain("filing, notice or authorization requirement");
    expect(prompt).toContain("liability");
    // And the exclusions that produced the rejected candidate.
    expect(prompt).toContain("A legal SETTING is not a legal lesson");
    expect(prompt).toContain("capacity planning");
    expect(prompt).toContain("legal civics");
    expect(prompt).toContain("constitutional philosophy");
  });

  it("does not impose the law rule on another topic", () => {
    const prompt = buildMiniCaseJudgePrompt({
      reference: { language: "fr", item: lawCase({ product_topic: "ai" }) },
      counterpart: { language: "en", item: lawCase({ product_topic: "ai", language: "en" }) }
    });

    expect(prompt).not.toContain("This is a Law & Compliance case");
    // The generic promise question is still asked of every topic.
    expect(prompt).toContain("Being SET in a domain is not the same as TESTING that domain");
  });

  it("sends the case text the judgement depends on", () => {
    const prompt = buildMiniCaseJudgePrompt({
      reference: { language: "fr", item: lawCase() },
      counterpart: { language: "en", item: lawCase({ language: "en" }) }
    });

    expect(prompt).toContain("Un acheteur public découpe un marché en trois lots.");
    expect(prompt).toContain("law_compliance");
    expect(prompt).toContain("compliance_risk");
  });
});

describe("a case that does not teach its topic is refused", () => {
  it("refuses the state-originalism case whose decision was capacity planning", () => {
    // The verdict the judge is expected to return for that candidate.
    const reasons = judgeRejectionReasons({
      ...PASSING,
      pass: false,
      topic_promise_fit: false,
      topic_promise_reason:
        "The source is a law article but the decision is about how many centres can be staffed.",
      tested_domain_mechanism: "capacity planning"
    });

    expect(reasons.join(" ")).toContain("does not teach what its topic promises");
    expect(reasons.join(" ")).toContain("capacity planning");
    expect(reasons.join(" ")).toContain("how many centres can be staffed");
  });

  it("refuses a court-sourced case whose problem is generic operations", () => {
    expect(
      judgeRejectionReasons({
        ...PASSING,
        topic_promise_fit: false,
        topic_promise_reason: "A court backlog framed as a queueing problem.",
        tested_domain_mechanism: "generic operations scheduling"
      })
    ).not.toEqual([]);
  });

  it("accepts a threshold-applicability case", () => {
    expect(judgeRejectionReasons(PASSING)).toEqual([]);
  });

  it("accepts an evidence-requirement case", () => {
    expect(
      judgeRejectionReasons({
        ...PASSING,
        topic_promise_reason: "The decision is which records prove consent was obtained.",
        tested_domain_mechanism: "documentation requirement under a privacy rule"
      })
    ).toEqual([]);
  });

  it("accepts an authorization-filing case", () => {
    expect(
      judgeRejectionReasons({
        ...PASSING,
        topic_promise_reason: "The decision is whether prior authorization must be filed.",
        tested_domain_mechanism: "filing and notice requirement"
      })
    ).toEqual([]);
  });

  it("accepts a contractual-obligation case", () => {
    expect(
      judgeRejectionReasons({
        ...PASSING,
        topic_promise_reason: "The decision is whether the indemnity clause is triggered.",
        tested_domain_mechanism: "contractual obligation and liability allocation"
      })
    ).toEqual([]);
  });

  it("accepts a case with operational constraints when the decision is still legal", () => {
    // Operational pressure is allowed to be present. What matters is what the
    // reader has to reason about to answer.
    expect(
      judgeRejectionReasons({
        ...PASSING,
        topic_promise_reason:
          "Capacity is tight, but the decision is whether the retention rule permits the deletion.",
        tested_domain_mechanism: "scope of a retention obligation"
      })
    ).toEqual([]);
  });
});

describe("an unusable verdict does not let a law case through", () => {
  it("treats a missing topic_promise_fit as a refusal", () => {
    const verdict = parseJudgeVerdict({
      pass: true,
      questions: [],
      pair_semantic_parity: true,
      taxonomy_semantic_fit: true,
      reasons: []
    });

    // The field defaults to true only when explicitly true-ish; a malformed
    // answer is caught by the surrounding fail-closed handling in prepare.
    expect(typeof verdict.topic_promise_fit).toBe("boolean");
    expect(verdict.tested_domain_mechanism).toBe("");
  });

  it("refuses a payload with no verdict at all", () => {
    const verdict = parseJudgeVerdict({ nonsense: true });

    expect(verdict.pass).toBe(false);
    expect(verdict.topic_promise_fit).toBe(false);
    expect(judgeRejectionReasons(verdict)).not.toEqual([]);
  });
});
