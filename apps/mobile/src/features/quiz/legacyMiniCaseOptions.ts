import type { MiniCaseOption, MiniCaseOptionOutcome } from "../today/contentTypes";
import type { QuestionScoreTier } from "./quizSession";

/**
 * Reading a Mini Case written under a model the app no longer uses.
 *
 * THIS FILE IS THE WHOLE COMPATIBILITY LAYER, on purpose. Three generations of
 * option shape exist in the catalog and will keep existing — the launch catalog
 * is approved, published and in readers' archives, and nothing is going to be
 * regenerated to tidy up a field name:
 *
 *   graded    `score_milli: 0 | 300 | 600 | 1000`   the current model
 *   outcome   `outcome: "best" | "viable" | "weak"` the shape the reader renders
 *   binary    `is_correct: true | false`            the original engine shape
 *
 * Every one of them is normalised here and nowhere else. The alternative —
 * three branches in the reader, two in the scorer, one in the archive — is how
 * a compatibility shim becomes permanent spaghetti, and how the fourth shape
 * ends up handled in two places out of six.
 *
 * WHAT IS NOT DONE HERE: a binary option carries no information about whether a
 * wrong answer was nearly right or hopeless. Mapping `is_correct: false` onto
 * 300 or 600 would invent an editorial judgement nobody made, so it maps to 0
 * and `graded` reports false. A caller that needs to know whether it is looking
 * at a real four-tier ranking asks that flag.
 */

export type NormalizedMiniCaseOption = {
  id: string;
  label: string;
  scoreMilli: QuestionScoreTier;
  outcome: MiniCaseOptionOutcome;
  feedback: string;
};

export type NormalizedMiniCaseQuestion = {
  options: NormalizedMiniCaseOption[];
  /** False when the tiers were derived from a binary or outcome shape. */
  graded: boolean;
};

const OUTCOME_TIER: Record<MiniCaseOptionOutcome, QuestionScoreTier> = {
  best: 1000,
  viable: 600,
  weak: 0
};

/**
 * The band a tier renders as.
 *
 * The reader already draws `best` green, `viable` amber and `weak` red, and
 * that palette is part of the design pass being preserved. So a graded option
 * is mapped back onto it rather than given a fourth colour: 1000 is the call to
 * make, 600 and 300 are defensible, 0 is not.
 */
export function outcomeForTier(scoreMilli: number): MiniCaseOptionOutcome {
  if (scoreMilli >= 1000) {
    return "best";
  }

  return scoreMilli > 0 ? "viable" : "weak";
}

function readTier(value: unknown): QuestionScoreTier | null {
  return value === 0 || value === 300 || value === 600 || value === 1000 ? value : null;
}

export function normalizeMiniCaseOption(
  option: MiniCaseOption & { score_milli?: unknown; is_correct?: unknown },
  index: number
): { option: NormalizedMiniCaseOption; graded: boolean } {
  const id = typeof option.id === "string" && option.id ? option.id : `option-${index + 1}`;
  const label = typeof option.label === "string" ? option.label : "";
  const feedback = typeof option.feedback === "string" ? option.feedback : "";

  const tier = readTier(option.score_milli);

  if (tier !== null) {
    return {
      option: { id, label, scoreMilli: tier, outcome: outcomeForTier(tier), feedback },
      graded: true
    };
  }

  // An explicit outcome is the mobile/mock shape and carries three of the four
  // tiers honestly, so it is read before falling back to the binary marker.
  if (option.outcome === "best" || option.outcome === "viable" || option.outcome === "weak") {
    const outcomeTier = OUTCOME_TIER[option.outcome];
    return {
      option: { id, label, scoreMilli: outcomeTier, outcome: option.outcome, feedback },
      graded: false
    };
  }

  const binaryTier: QuestionScoreTier = option.is_correct === true ? 1000 : 0;

  return {
    option: {
      id,
      label,
      scoreMilli: binaryTier,
      outcome: outcomeForTier(binaryTier),
      feedback
    },
    graded: false
  };
}

export function normalizeMiniCaseOptions(
  options: MiniCaseOption[] | null | undefined
): NormalizedMiniCaseQuestion {
  const list = Array.isArray(options) ? options : [];
  let graded = list.length > 0;

  const normalized = list.map((option, index) => {
    const result = normalizeMiniCaseOption(option, index);

    if (!result.graded) {
      graded = false;
    }

    return result.option;
  });

  return { options: normalized, graded };
}

/**
 * Is this Mini Case scored by the server?
 *
 * Only a case whose options carry real tiers can be: the server grades from
 * `private.logical_question_grades`, and a legacy case has no rows there. A
 * legacy case therefore keeps its existing self-marked behaviour — three
 * questions, local score out of three, no timer, no Team points — and is not
 * pushed through a server round-trip that would fail.
 */
export function isServerScorableMiniCase(input: {
  hasLogicalQuestions: boolean;
  questions: Array<{ options: MiniCaseOption[] }>;
}): boolean {
  if (!input.hasLogicalQuestions || input.questions.length === 0) {
    return false;
  }

  return input.questions.every((question) => normalizeMiniCaseOptions(question.options).graded);
}
