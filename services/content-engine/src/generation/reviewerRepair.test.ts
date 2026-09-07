import { describe, expect, it } from "vitest";

import {
  applyReviewerQuestionRepair,
  contentSurvivedRevision,
  expectedRolesForContentType,
  type GenerationOutput
} from "./reviewerRepair.js";
import { MAX_GENERATION_ATTEMPTS, decideReview, reviewFinding } from "./questionRevisionScope.js";

/**
 * The third pass, end to end.
 *
 * `questionRevisionScope.test.ts` proves the DECISION is right — attempt 1 and 2
 * ask for a scoped revision, attempt 3 repairs a shape defect instead of asking
 * for a fourth generation that will not happen. This file proves the other half:
 * that the repair which comes back is actually a repair, and that a good article
 * survives every one of these paths byte-for-byte.
 *
 * That last property is the one worth defending with tests. Every failure here
 * is silent in production: an edition where the Reviewer also "improved" a
 * paragraph publishes cleanly, passes verification, and is simply not the
 * article that was approved.
 */

const BODY =
  "Le marché a intégré la décision en deux séances, ce qui dit quelque chose " +
  "de la profondeur du carnet plutôt que de la nouvelle elle-même.";

function question(input: {
  id: string;
  role: string;
  prompt: string;
  texts: [string, string, string, string];
  tiers?: [number, number, number, number];
}): Record<string, unknown> {
  const tiers = input.tiers ?? [1000, 600, 300, 0];

  return {
    id: input.id,
    role: input.role,
    question: input.prompt,
    rationale: {
      decision_criterion: "Which reading survives the constraint stated in the second paragraph.",
      excellent_reason: "Names the mechanism and the constraint that produced the move.",
      good_limitation: "Names the mechanism but not the constraint that bounded it.",
      average_limitation: "Restates the outcome without naming any mechanism.",
      bad_failure: "Contradicts what the second paragraph establishes."
    },
    options: input.texts.map((textValue, index) => ({
      id: `${input.id}-o${index + 1}`,
      text: textValue,
      score_milli: tiers[index],
      feedback: `Pourquoi cette réponse vaut ${tiers[index]}.`
    }))
  };
}

/** A newsletter output whose questions are valid in both languages. */
function healthyOutput(): GenerationOutput {
  return {
    fr: {
      content_type: "newsletter_article",
      language: "fr",
      title: "Le carnet plus que la nouvelle",
      summary: "Ce que la réaction du marché révèle.",
      body_md: BODY,
      source_urls: ["https://example.test/a"],
      questions: [
        question({
          id: "q1",
          role: "interpretation",
          prompt: "Quel mécanisme explique la réaction observée en séance ?",
          texts: [
            "La profondeur du carnet a absorbé le flux",
            "Les vendeurs ont attendu la clôture",
            "Le flux acheteur a simplement dominé",
            "La nouvelle avait déjà fuité la veille"
          ]
        }),
        question({
          id: "q2",
          role: "application_decision",
          prompt: "Que faire de cette information la semaine prochaine ?",
          texts: [
            "Traiter la liquidité comme la variable à surveiller",
            "Suivre le volume avant de conclure quoi que ce soit",
            "Attendre la publication suivante sans agir",
            "Considérer que le mouvement est terminé"
          ]
        })
      ]
    },
    en: {
      content_type: "newsletter_article",
      language: "en",
      title: "The book, not the news",
      summary: "What the market reaction actually shows.",
      body_md: "The market absorbed the decision across two sessions.",
      source_urls: ["https://example.test/a"],
      questions: [
        question({
          id: "q1",
          role: "interpretation",
          prompt: "Which mechanism explains the reaction seen during the session?",
          texts: [
            "Order book depth absorbed the flow",
            "Sellers waited for the close",
            "Buying flow simply dominated",
            "The news had leaked the day before"
          ]
        }),
        question({
          id: "q2",
          role: "application_decision",
          prompt: "What should be done with this next week?",
          texts: [
            "Treat liquidity as the variable to watch",
            "Track volume before concluding anything",
            "Wait for the next print without acting",
            "Assume the move has finished"
          ]
        })
      ]
    }
  };
}

/** Deep copy, so a test that mutates one half cannot leak into another test. */
function clone(output: GenerationOutput): GenerationOutput {
  return JSON.parse(JSON.stringify(output)) as GenerationOutput;
}

function repairQuestionTwo(output: GenerationOutput, suffix: string): GenerationOutput {
  const next = clone(output);

  for (const language of ["fr", "en"] as const) {
    const questions = next[language].questions as Array<Record<string, unknown>>;
    const options = questions[1].options as Array<Record<string, unknown>>;
    options[3] = { ...options[3], text: `${options[3].text as string} ${suffix}` };
  }

  return next;
}

describe("the roles a content type must carry", () => {
  it("gives a mini case its three-step progression and everything else two", () => {
    expect(expectedRolesForContentType("mini_case")).toEqual([
      "method_framework",
      "technical_application",
      "conclusion_decision"
    ]);
    expect(expectedRolesForContentType("newsletter_article")).toEqual([
      "interpretation",
      "application_decision"
    ]);
    expect(expectedRolesForContentType("business_story")).toEqual([
      "interpretation",
      "application_decision"
    ]);
  });
});

describe("a repair that is a repair", () => {
  it("approves a scoped fix and republishes the same article", () => {
    const original = healthyOutput();
    const repaired = repairQuestionTwo(original, "pour l'instant");

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired,
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("approved");
    expect(outcome.violations).toEqual([]);
    expect(outcome.output).not.toBeNull();

    // THE ASSERTION THIS FILE EXISTS FOR.
    expect(outcome.output?.fr.body_md).toBe(original.fr.body_md);
    expect(outcome.output?.en.body_md).toBe(original.en.body_md);
    expect(outcome.output?.fr.title).toBe(original.fr.title);
    expect(outcome.output?.fr.summary).toBe(original.fr.summary);
  });

  it("ignores key order, because key order is not content", () => {
    const original = healthyOutput();
    const repaired = clone(original);
    // Same values, re-emitted in a different order — what a model round trip does.
    repaired.fr = {
      questions: repaired.fr.questions,
      source_urls: repaired.fr.source_urls,
      body_md: repaired.fr.body_md,
      summary: repaired.fr.summary,
      title: repaired.fr.title,
      language: repaired.fr.language,
      content_type: repaired.fr.content_type
    };

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired,
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("approved");
  });
});

describe("a repair that is a rewrite", () => {
  it("refuses a repair that touched the article", () => {
    const original = healthyOutput();
    const repaired = repairQuestionTwo(original, "pour l'instant");
    repaired.fr.body_md = `${BODY} Une phrase de plus.`;

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired,
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("failed");
    expect(outcome.violations.map((violation) => violation.code)).toContain("content_mutated");
    expect(outcome.output).toBeNull();
  });

  it("refuses a repair that also improved the question nobody asked about", () => {
    const original = healthyOutput();
    const repaired = repairQuestionTwo(original, "pour l'instant");
    const frQuestions = repaired.fr.questions as Array<Record<string, unknown>>;
    frQuestions[0] = { ...frQuestions[0], question: "Une formulation plus élégante de la même chose ?" };

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired,
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("failed");
    expect(outcome.violations.map((violation) => violation.code)).toContain(
      "untouched_question_mutated"
    );
  });

  it("refuses a repair aimed at the content scope, whatever it contains", () => {
    const original = healthyOutput();

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired: clone(original),
      repairScopes: ["content", "question_2"]
    });

    expect(outcome.verdict).toBe("failed");
    expect(outcome.violations.map((violation) => violation.code)).toContain("repair_out_of_scope");
  });

  it("refuses a repair offered before the final attempt", () => {
    const original = healthyOutput();

    const outcome = applyReviewerQuestionRepair({
      attempt: 1,
      contentType: "newsletter_article",
      original,
      repaired: repairQuestionTwo(original, "x"),
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("failed");
    expect(outcome.violations.map((violation) => violation.code)).toContain("not_final_attempt");
  });
});

describe("a repair that did not fix anything", () => {
  it("refuses when the repaired question still fails the same validator", () => {
    const original = healthyOutput();
    const repaired = clone(original);

    // The defect the Reviewer was asked to fix: the tier set is no longer one of
    // each. A "repair" leaving it broken must not become an approval.
    for (const language of ["fr", "en"] as const) {
      const questions = repaired[language].questions as Array<Record<string, unknown>>;
      const options = questions[1].options as Array<Record<string, unknown>>;
      options[3] = { ...options[3], score_milli: 600 };
    }

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired,
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("failed");
    expect(outcome.violations.map((violation) => violation.code)).toContain(
      "question_still_invalid"
    );
  });

  it("refuses a repair applied to one language only", () => {
    const original = healthyOutput();
    const repaired = clone(original);
    const enQuestions = repaired.en.questions as Array<Record<string, unknown>>;
    const options = enQuestions[1].options as Array<Record<string, unknown>>;
    // Re-grading in English alone: the two languages stop being one game.
    options[0] = { ...options[0], score_milli: 600 };
    options[1] = { ...options[1], score_milli: 1000 };

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired,
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("failed");
    expect(outcome.violations.map((violation) => violation.code)).toContain("parity_broken");
  });

  it("refuses a repair that dropped a question", () => {
    const original = healthyOutput();
    const repaired = clone(original);
    repaired.fr.questions = (repaired.fr.questions as unknown[]).slice(0, 1);

    const outcome = applyReviewerQuestionRepair({
      attempt: MAX_GENERATION_ATTEMPTS,
      contentType: "newsletter_article",
      original,
      repaired,
      repairScopes: ["question_2"]
    });

    expect(outcome.verdict).toBe("failed");
    expect(outcome.violations.map((violation) => violation.code)).toContain(
      "question_count_changed"
    );
  });
});

describe("the three attempts, walked once", () => {
  it("revises Q2 twice, repairs it on the third pass, and never asks for a fourth", () => {
    const finding = reviewFinding({
      scope: "question_2",
      code: "question_option_length_asymmetric",
      message: "Options run 41-140 characters."
    });

    const first = decideReview({ attempt: 1, findings: [finding] });
    expect(first.verdict).toBe("revision_required");
    expect(first.targets).toEqual(["question_2"]);
    expect(first.regenerateContent).toBe(false);

    const second = decideReview({ attempt: 2, findings: [finding] });
    expect(second.verdict).toBe("revision_required");
    expect(second.targets).toEqual(["question_2"]);
    expect(second.regenerateContent).toBe(false);

    const third = decideReview({ attempt: 3, findings: [finding] });
    expect(third.verdict).toBe("reviewer_repair");
    expect(third.repairTargets).toEqual(["question_2"]);

    // And the repair itself is checked, not assumed.
    const original = healthyOutput();
    const outcome = applyReviewerQuestionRepair({
      attempt: 3,
      contentType: "newsletter_article",
      original,
      repaired: repairQuestionTwo(original, "cette semaine"),
      repairScopes: third.repairTargets
    });

    expect(outcome.verdict).toBe("approved");
    expect(outcome.output?.fr.body_md).toBe(BODY);
  });

  it("fails rather than approving a factual problem at the last pass", () => {
    const hallucination = reviewFinding({
      scope: "content",
      code: "source_grounding_fail",
      message: "The figure in paragraph two is in no cited source."
    });

    const decision = decideReview({ attempt: 3, findings: [hallucination] });

    expect(decision.verdict).toBe("failed");
    expect(decision.repairTargets).toEqual([]);
  });
});

describe("a question-only revision by the generator", () => {
  it("reports the article as untouched when only the questions moved", () => {
    const before = healthyOutput();
    const after = repairQuestionTwo(before, "d'ici la publication");

    expect(contentSurvivedRevision({ before, after })).toEqual({
      unchanged: true,
      changedLanguages: []
    });
  });

  it("names the language whose article was rewritten", () => {
    const before = healthyOutput();
    const after = repairQuestionTwo(before, "d'ici la publication");
    after.en.body_md = "A tighter opening sentence.";

    expect(contentSurvivedRevision({ before, after })).toEqual({
      unchanged: false,
      changedLanguages: ["en"]
    });
  });
});
