import { localized } from "../../lib/i18n";
import type { ContentLanguage } from "../today/contentTypes";
import { earnedMilli, formatPointsLong, pointsFromMilli } from "./points";
import type { QuestionScoreTier, QuizOption } from "./quizSession";

/**
 * What a reader is taught once a question is settled.
 *
 * PersoNews scores 0, 30, 60 or 100 points. Partial credit is the unusual part
 * of the product, so the screen after an answer has to explain it: what the
 * chosen answer earned and why, then — unless it already was — the answer
 * worth full points and why. An answer settled after its edition's day earns
 * half (points.ts), and the screen says so in one line.
 *
 * NOTHING HERE IS WRITTEN ON THE PHONE. The explanations are the editorial
 * feedback stored with each option when the edition was generated, released by
 * `get_question_explanation` only after the attempt is settled. What this file
 * adds is the frame around them: the headings, and one fixed sentence per score
 * that says what that score means (the same scale the Teams introduction
 * teaches). It never paraphrases, extends or invents an explanation.
 */

export type ExplainedOption = {
  optionId: string | null;
  /** The server's label, in the reader's language. The screen prefers its own. */
  label: string | null;
  scoreMilli: QuestionScoreTier;
  feedback: string | null;
};

/** Exactly what the server releases after settlement: two options at most. */
export type QuestionExplanation = {
  outcome: "answered" | "expired" | "skipped" | null;
  selected: ExplainedOption | null;
  best: ExplainedOption | null;
};

export type ExplanationBlock = {
  kind: "yours" | "best" | "yours_best";
  eyebrow: string;
  points: string;
  /** The option's text, as the reader saw it. Null when no answer was given. */
  label: string | null;
  /** What this score means, in one fixed sentence. */
  verdict: string;
  /** Only present when there is an explanation under it. */
  whyHeading: string | null;
  body: string | null;
  /** The answer worth the full point. */
  best: boolean;
};

export type AnswerExplanationView = {
  blocks: ExplanationBlock[];
  /** True while the explanation is on its way; the blocks are the local part. */
  loading: boolean;
  /** Shown when the explanation could not be loaded. */
  notice: string | null;
  /** Present when the answer was settled late and earned half. */
  lateNote: string | null;
};

export function getExplanationCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        yourAnswer: "Your answer",
        bestAnswer: "Best answer",
        yourAnswerIsBest: "Your answer · Best answer",
        whyYours: (points: string) => `Why this answer earns ${points}`,
        whyBest: "Why it earns full points",
        verdicts: {
          1000: "Excellent — the complete answer, with the strongest reasoning.",
          600: "Good — the logic holds, but an important element is missing to reach full points.",
          300: "Partial — part of the reasoning is right, but the central point is missing or misapplied, so it earns partial credit only.",
          0: "Miss — the main reasoning does not hold."
        } as Record<QuestionScoreTier, string>,
        excellentReasoning: "Excellent reasoning. This is the answer worth full points.",
        late: "Answered after the edition day: late answers earn 50% of the normal points.",
        expired: "Time expired before an answer was submitted.",
        skipped: "You skipped this question.",
        loading: "Loading the explanation…",
        unavailable: "The explanation could not be loaded. Your score is recorded."
      },
      fr: {
        yourAnswer: "Votre réponse",
        bestAnswer: "Meilleure réponse",
        yourAnswerIsBest: "Votre réponse · Meilleure réponse",
        whyYours: (points: string) => `Pourquoi cette réponse vaut ${points}`,
        whyBest: "Pourquoi elle vaut tous les points",
        verdicts: {
          1000: "Excellent — la réponse complète, avec le meilleur raisonnement.",
          600: "Bon — la logique tient, mais il manque un élément important pour obtenir tous les points.",
          300: "Partiel — une partie du raisonnement est juste, mais le point central manque ou est mal appliqué : le crédit n'est que partiel.",
          0: "Manqué — le raisonnement principal ne tient pas."
        } as Record<QuestionScoreTier, string>,
        excellentReasoning: "Excellent raisonnement. C'est la réponse qui vaut tous les points.",
        late: "Réponse donnée après le jour de l'édition : les réponses tardives rapportent 50 % des points habituels.",
        expired: "Le temps s'est écoulé avant qu'une réponse soit envoyée.",
        skipped: "Vous avez passé cette question.",
        loading: "Chargement de l'explication…",
        unavailable: "L'explication n'a pas pu être chargée. Votre score est enregistré."
      }
    },
    language
  );
}

/** "30 points", "100 points"; "0 point" in French. Whole numbers only. */
export function formatPointsFor(scoreMilli: number, language: ContentLanguage): string {
  return formatPointsLong(pointsFromMilli(scoreMilli), language);
}

export function buildAnswerExplanation(input: {
  language: ContentLanguage;
  outcome: "answered" | "expired" | "skipped";
  scoreMilli: QuestionScoreTier;
  /** Settled after the edition's day (server-decided): earns half. */
  late?: boolean;
  selectedOptionId: string | null;
  /** The options exactly as they were shown, for their labels. */
  options: QuizOption[];
  /** undefined: still loading. null: could not be loaded. */
  explanation: QuestionExplanation | null | undefined;
}): AnswerExplanationView {
  const copy = getExplanationCopy(input.language);
  const explanation = input.explanation ?? null;
  const labelOf = (optionId: string | null, serverLabel: string | null) =>
    (optionId ? input.options.find((option) => option.optionId === optionId)?.label : undefined) ||
    serverLabel ||
    null;

  const blocks: ExplanationBlock[] = [];
  const answered = input.outcome === "answered";
  const late = input.late === true;
  // What THIS reader earned. The best answer below keeps its normal value:
  // it describes the answer, and the late note explains the difference.
  // A full point IS the best answer; the server agrees, and the screen does not
  // have to wait for it to say so.
  const choseBest =
    answered &&
    (input.scoreMilli === 1000 ||
      (explanation?.best?.optionId != null && explanation.best.optionId === input.selectedOptionId));

  if (choseBest) {
    const body = explanation?.best?.feedback ?? explanation?.selected?.feedback ?? null;

    blocks.push({
      kind: "yours_best",
      eyebrow: copy.yourAnswerIsBest,
      points: formatPointsFor(earnedMilli(1000, late), input.language),
      label: labelOf(input.selectedOptionId, explanation?.selected?.label ?? null),
      verdict: copy.excellentReasoning,
      whyHeading: body ? copy.whyBest : null,
      body,
      best: true
    });
  } else {
    const points = formatPointsFor(answered ? earnedMilli(input.scoreMilli, late) : 0, input.language);
    const body = answered ? explanation?.selected?.feedback ?? null : null;

    blocks.push({
      kind: "yours",
      eyebrow: copy.yourAnswer,
      points,
      label: answered ? labelOf(input.selectedOptionId, explanation?.selected?.label ?? null) : null,
      verdict: answered
        ? copy.verdicts[input.scoreMilli]
        : input.outcome === "expired"
          ? copy.expired
          : copy.skipped,
      whyHeading: body ? copy.whyYours(points) : null,
      body,
      best: false
    });

    const best = explanation?.best ?? null;

    if (best) {
      blocks.push({
        kind: "best",
        eyebrow: copy.bestAnswer,
        points: formatPointsFor(best.scoreMilli, input.language),
        label: labelOf(best.optionId, best.label),
        verdict: copy.verdicts[best.scoreMilli],
        whyHeading: best.feedback ? copy.whyBest : null,
        body: best.feedback,
        best: true
      });
    }
  }

  return {
    blocks,
    loading: input.explanation === undefined,
    notice: input.explanation === null ? copy.unavailable : null,
    lateNote: answered && late ? copy.late : null
  };
}
