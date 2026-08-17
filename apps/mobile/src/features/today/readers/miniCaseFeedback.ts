import type {
  MiniCaseChallenge,
  MiniCaseOption,
  MiniCaseQuestion
} from "../contentTypes";

/**
 * Which feedback belongs inside which option card.
 *
 * The explanation used to sit in one block under the list, so a reader had to
 * look away from the answer they picked to find out why it was wrong. Feedback
 * is now attached to the option itself:
 *
 *   - the option you picked says whether it was right, and why;
 *   - when you picked a wrong one, the correct option also explains itself,
 *     so the mistaken reasoning and the sound reasoning are visible together.
 *
 * Pure so both the live quiz and the historical review share one behaviour.
 */

export type MiniCaseFeedbackTone = "correct" | "incorrect" | "reveal";

export type MiniCaseOptionFeedback = {
  tone: MiniCaseFeedbackTone;
  /** "Correct" / "Not quite" / "Correct answer" — resolved by the caller's copy. */
  labelKey: "correct" | "incorrect" | "correctAnswer";
  body: string;
};

export type MiniCaseFeedbackCopy = {
  feedbackFallback: string;
};

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export function findBestOption(question: MiniCaseQuestion): MiniCaseOption | null {
  return question.options.find((option) => option.outcome === "best") ?? null;
}

/**
 * Feedback to render inside one option card, or null when that card stays
 * silent (an unpicked, non-correct option).
 */
export function resolveOptionFeedback(input: {
  challenge: MiniCaseChallenge;
  question: MiniCaseQuestion;
  option: MiniCaseOption;
  /** null before an answer, or when a historical result was never stored. */
  selectedId: string | null;
  answered: boolean;
  copy: MiniCaseFeedbackCopy;
}): MiniCaseOptionFeedback | null {
  const { answered, challenge, copy, option, question, selectedId } = input;

  if (!answered) {
    return null;
  }

  const isSelected = option.id === selectedId;
  const isBest = option.outcome === "best";
  const selectedOption =
    question.options.find((candidate) => candidate.id === selectedId) ?? null;
  const answeredCorrectly = selectedOption?.outcome === "best";

  if (isSelected && isBest) {
    return {
      tone: "correct",
      labelKey: "correct",
      body:
        firstNonEmpty(
          option.feedback,
          question.explanation,
          challenge.final_takeaway,
          challenge.expected_reasoning[0]
        ) ?? copy.feedbackFallback
    };
  }

  if (isSelected && !isBest) {
    return {
      tone: "incorrect",
      labelKey: "incorrect",
      body: firstNonEmpty(option.feedback) ?? copy.feedbackFallback
    };
  }

  // The correct option explains itself whenever the reader did not pick it —
  // including a review with no stored answer, where nothing was selected.
  if (isBest && !answeredCorrectly) {
    return {
      tone: "reveal",
      labelKey: "correctAnswer",
      body:
        firstNonEmpty(
          option.feedback,
          question.explanation,
          challenge.final_takeaway,
          challenge.expected_reasoning[0]
        ) ?? copy.feedbackFallback
    };
  }

  return null;
}

/** Score of a completed multi-question case: one point per best answer. */
export function scoreMiniCaseSelections(
  questions: MiniCaseQuestion[],
  selections: Record<string, string>
): number {
  return questions.reduce((score, question) => {
    const selectedId = selections[question.id];
    const option = question.options.find((candidate) => candidate.id === selectedId);

    return option?.outcome === "best" ? score + 1 : score;
  }, 0);
}
