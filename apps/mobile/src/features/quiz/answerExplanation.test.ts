import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildAnswerExplanation,
  formatPointsFor,
  getExplanationCopy,
  type AnswerExplanationView,
  type QuestionExplanation
} from "./answerExplanation";
import type { QuestionScoreTier, QuizOption } from "./quizSession";

/**
 * What a reader is taught after a settled question.
 *
 * The explanations are the server's; these tests pin the frame around them:
 * the chosen answer, what its score means and why, then the answer worth the
 * full point and why — once, never twice, and never before settlement.
 */

const options: QuizOption[] = [
  { optionId: "a", label: "Protect the margin before the volume" },
  { optionId: "b", label: "Match the competitor's price" },
  { optionId: "c", label: "Wait for the next quarter" },
  { optionId: "d", label: "Cut the marketing budget" }
];

const FEEDBACK: Record<string, string> = {
  a: "Why A works.",
  b: "Why B falls short.",
  c: "Why C is only partial.",
  d: "Why D fails."
};

const TIERS: Record<string, QuestionScoreTier> = { a: 1000, b: 600, c: 300, d: 0 };

function served(selected: string | null, outcome: QuestionExplanation["outcome"]): QuestionExplanation {
  return {
    outcome,
    selected: selected
      ? { optionId: selected, label: `server ${selected}`, scoreMilli: TIERS[selected], feedback: FEEDBACK[selected] }
      : null,
    best: { optionId: "a", label: "server a", scoreMilli: 1000, feedback: FEEDBACK.a }
  };
}

function answered(language: "en" | "fr", selected: string): AnswerExplanationView {
  return buildAnswerExplanation({
    language,
    outcome: "answered",
    scoreMilli: TIERS[selected],
    selectedOptionId: selected,
    options,
    explanation: served(selected, "answered")
  });
}

function unanswered(language: "en" | "fr", outcome: "expired" | "skipped"): AnswerExplanationView {
  return buildAnswerExplanation({
    language,
    outcome,
    scoreMilli: 0,
    selectedOptionId: null,
    options,
    explanation: served(null, outcome)
  });
}

describe("0.3: what held, what was missing, and the answer worth 1", () => {
  it("explains the chosen answer, then shows the best answer and why", () => {
    const view = answered("en", "c");
    const [yours, best] = view.blocks;

    expect(view.blocks.map((block) => block.kind)).toEqual(["yours", "best"]);
    expect(yours).toMatchObject({
      eyebrow: "Your answer",
      points: "0.3 points",
      label: "Wait for the next quarter",
      whyHeading: "Why this answer earns 0.3 points",
      body: "Why C is only partial.",
      best: false
    });
    expect(yours.verdict).toMatch(/^Partial — part of the reasoning is right/);
    expect(yours.verdict).toMatch(/central point is missing or misapplied/);
    expect(yours.verdict).toMatch(/partial credit only/);
    expect(best).toMatchObject({
      eyebrow: "Best answer",
      points: "1 point",
      label: "Protect the margin before the volume",
      whyHeading: "Why it earns the full point",
      body: "Why A works.",
      best: true
    });
  });

  it("says the same in French, with a decimal comma", () => {
    const [yours, best] = answered("fr", "c").blocks;

    expect(yours).toMatchObject({
      eyebrow: "Votre réponse",
      points: "0,3 point",
      whyHeading: "Pourquoi cette réponse vaut 0,3 point"
    });
    expect(yours.verdict).toMatch(/^Partiel — une partie du raisonnement est juste/);
    expect(best).toMatchObject({ eyebrow: "Meilleure réponse", points: "1 point", whyHeading: "Pourquoi elle vaut 1 point" });
  });
});

describe("0.6: what it understands, and what it lacks to reach 1", () => {
  it("names the missing element and shows the best answer", () => {
    const view = answered("en", "b");

    expect(view.blocks[0].points).toBe("0.6 points");
    expect(view.blocks[0].verdict).toBe(
      "Good — the logic holds, but an important element is missing to reach 1 point."
    );
    expect(view.blocks[0].body).toBe("Why B falls short.");
    expect(view.blocks[1]).toMatchObject({ kind: "best", body: "Why A works." });
  });

  it("in French", () => {
    const view = answered("fr", "b");

    expect(view.blocks[0].points).toBe("0,6 point");
    expect(view.blocks[0].verdict).toMatch(/^Bon — la logique tient, mais il manque un élément important/);
  });
});

describe("0: the error, never just 'Incorrect'", () => {
  it("states the failed reasoning, then the best answer and its logic", () => {
    const view = answered("en", "d");

    expect(view.blocks[0]).toMatchObject({ points: "0 points", body: "Why D fails." });
    expect(view.blocks[0].verdict).toBe("Miss — the main reasoning does not hold.");
    expect(JSON.stringify(view)).not.toMatch(/Incorrect|Wrong/);
    expect(view.blocks[1]).toMatchObject({ kind: "best", label: "Protect the margin before the volume" });
  });

  it("in French", () => {
    expect(answered("fr", "d").blocks[0].verdict).toBe("Manqué — le raisonnement principal ne tient pas.");
  });
});

describe("1: the best answer, shown once", () => {
  it("does not repeat the option; one block, marked as the best answer", () => {
    const view = answered("en", "a");

    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({
      kind: "yours_best",
      eyebrow: "Your answer · Best answer",
      points: "1 point",
      whyHeading: "Why it earns the full point",
      body: "Why A works.",
      best: true
    });
    expect(view.blocks[0].verdict).toMatch(/^Excellent reasoning\./);
    expect(JSON.stringify(view).split("Protect the margin before the volume")).toHaveLength(2);
  });

  it("in French", () => {
    const view = answered("fr", "a");

    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0].eyebrow).toBe("Votre réponse · Meilleure réponse");
    expect(view.blocks[0].verdict).toMatch(/^Excellent raisonnement\./);
  });
});

describe("timeout and skip: zero, and still the best answer", () => {
  it("says time expired before an answer was submitted, then teaches the best answer", () => {
    const view = unanswered("en", "expired");

    expect(view.blocks[0]).toMatchObject({
      kind: "yours",
      points: "0 points",
      label: null,
      verdict: "Time expired before an answer was submitted.",
      whyHeading: null,
      body: null
    });
    expect(view.blocks[1]).toMatchObject({ kind: "best", body: "Why A works." });
  });

  it("in French", () => {
    const view = unanswered("fr", "expired");

    expect(view.blocks[0]).toMatchObject({
      points: "0 point",
      verdict: "Le temps s'est écoulé avant qu'une réponse soit envoyée."
    });
    expect(view.blocks[1].eyebrow).toBe("Meilleure réponse");
  });

  it("names a skip as a skip", () => {
    expect(unanswered("en", "skipped").blocks[0].verdict).toBe("You skipped this question.");
    expect(unanswered("fr", "skipped").blocks[0].verdict).toBe("Vous avez passé cette question.");
  });
});

describe("before the explanation arrives, and if it never does", () => {
  it("shows the local part while loading — never a best answer the phone could not know", () => {
    const view = buildAnswerExplanation({
      language: "en",
      outcome: "answered",
      scoreMilli: 300,
      selectedOptionId: "c",
      options,
      explanation: undefined
    });

    expect(view.loading).toBe(true);
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({ label: "Wait for the next quarter", body: null, whyHeading: null });
  });

  it("says it could not be loaded, and keeps the score", () => {
    const view = buildAnswerExplanation({
      language: "fr",
      outcome: "answered",
      scoreMilli: 600,
      selectedOptionId: "b",
      options,
      explanation: null
    });

    expect(view.loading).toBe(false);
    expect(view.notice).toBe(getExplanationCopy("fr").unavailable);
    expect(view.blocks.map((block) => block.kind)).toEqual(["yours"]);
    expect(view.blocks[0].points).toBe("0,6 point");
  });
});

describe("the explanations are the server's, never the phone's", () => {
  it("every body is exactly a stored feedback, or nothing", () => {
    const stored = new Set(Object.values(FEEDBACK));
    const views = [
      ...(["a", "b", "c", "d"] as const).flatMap((key) => [answered("en", key), answered("fr", key)]),
      unanswered("en", "expired"),
      unanswered("fr", "skipped")
    ];

    for (const view of views) {
      for (const block of view.blocks) {
        expect(block.body === null || stored.has(block.body), block.body ?? "").toBe(true);
      }
    }
  });

  it("uses the labels exactly as shown, and the server's only when the screen has none", () => {
    const view = buildAnswerExplanation({
      language: "en",
      outcome: "answered",
      scoreMilli: 300,
      selectedOptionId: "c",
      options: [],
      explanation: served("c", "answered")
    });

    expect(view.blocks.map((block) => block.label)).toEqual(["server c", "server a"]);
  });
});

describe("points, in both languages", () => {
  it("formats every tier", () => {
    expect([0, 300, 600, 1000].map((score) => formatPointsFor(score, "en"))).toEqual([
      "0 points",
      "0.3 points",
      "0.6 points",
      "1 point"
    ]);
    expect([0, 300, 600, 1000].map((score) => formatPointsFor(score, "fr"))).toEqual([
      "0 point",
      "0,3 point",
      "0,6 point",
      "1 point"
    ]);
  });
});

describe("the card", () => {
  const source = readFileSync(join(__dirname, "QuestionCard.tsx"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("shows the explanation only once the question is revealed, and fetches nothing itself", () => {
    expect(code.match(/<Outcome\b/g)).toHaveLength(1);
    expect(code.indexOf("{revealed ? (")).toBeGreaterThan(-1);
    expect(code.indexOf("{revealed ? (")).toBeLessThan(code.indexOf("<Outcome"));
    expect(code).not.toMatch(/supabase|fetchQuestion|rpc\(/);
  });

  it("never moves on by itself: Continue or Finish is the only way forward", () => {
    expect(code).toContain("label={isLast ? copy.finish : copy.continueLabel}");
    expect(code).not.toMatch(/setTimeout\([^)]*onContinue/);
  });
});
