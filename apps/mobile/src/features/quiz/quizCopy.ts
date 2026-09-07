import { localized } from "../../lib/i18n";
import type { ContentLanguage } from "../today/contentTypes";

/**
 * Everything a scored question says out loud.
 *
 * Held together in one place because most of it is read under time pressure and
 * the register has to be consistent: short, calm, never congratulatory and
 * never scolding. A wrong answer in a five-minute learning product is a normal
 * move, so nothing here says "Wrong" — the score says what happened and the
 * explanation says why.
 *
 * Note what is absent: no streak language, no "Great job!", no exclamation
 * marks. The design pass this sits inside is editorial and premium, and the
 * quickest way to lose that is copy that sounds like a mobile game.
 */
export function getQuizCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        eyebrow: "Question",
        progress: (current: number, total: number) => `Question ${current} of ${total}`,
        secondsLeft: (seconds: number) => `${seconds}s left`,
        // The timer must never be the only way to know time is short (§15).
        timeRunningOut: "Less than five seconds left",
        timeUp: "Time is up",
        skip: "Skip",
        skipHint: "Scores zero and moves on",
        continueLabel: "Continue",
        finish: "Finish",
        answerHint: "Choose one answer",
        locked: "Answer recorded",
        points: (value: string) => `${value} point${value === "1" ? "" : "s"}`,
        expiredTitle: "Time is up",
        expiredBody: "This question scored zero. The explanation is below.",
        skippedTitle: "Skipped",
        skippedBody: "This question scored zero. The explanation is below.",
        startFailedTitle: "Could not start this question",
        startFailedBody:
          "A scored question needs a connection so the timer can come from the server.",
        retry: "Retry",
        submitFailed: "The answer could not be sent. Retrying…",
        quizIntro: "Two questions, twenty seconds each.",
        quizIntroMiniCase: "Three questions, twenty seconds each.",
        startQuiz: "Start the questions",
        continueChallenge: "Continue challenge",
        continueChallengeHint: (remaining: number) =>
          remaining === 1 ? "1 question left" : `${remaining} questions left`,
        completeTitle: "Questions complete",
        completeScore: (earned: string, total: string) => `${earned} of ${total} points`,
        reviewOnly: "Already answered — review only",
        teamBadge: "Team",
        // Compact on screen; spoken in full, because "plus two" is not a
        // sentence and a VoiceOver reader gets no other cue.
        teamMore: (count: number) => `+${count}`,
        teamMoreSpoken: (count: number) =>
          count === 1 ? "and 1 more team" : `and ${count} more teams`,
        teamHidden: "Team"
      },
      fr: {
        eyebrow: "Question",
        progress: (current: number, total: number) => `Question ${current} sur ${total}`,
        secondsLeft: (seconds: number) => `${seconds} s restantes`,
        timeRunningOut: "Moins de cinq secondes restantes",
        timeUp: "Temps écoulé",
        skip: "Passer",
        skipHint: "Vaut zéro et passe à la suite",
        continueLabel: "Continuer",
        finish: "Terminer",
        answerHint: "Choisissez une réponse",
        locked: "Réponse enregistrée",
        points: (value: string) => `${value} point${value === "1" ? "" : "s"}`,
        expiredTitle: "Temps écoulé",
        expiredBody: "Cette question vaut zéro. L'explication est ci-dessous.",
        skippedTitle: "Passée",
        skippedBody: "Cette question vaut zéro. L'explication est ci-dessous.",
        startFailedTitle: "Impossible de démarrer cette question",
        startFailedBody:
          "Une question notée nécessite une connexion : le chronomètre vient du serveur.",
        retry: "Réessayer",
        submitFailed: "La réponse n'a pas pu être envoyée. Nouvel essai…",
        quizIntro: "Deux questions, vingt secondes chacune.",
        quizIntroMiniCase: "Trois questions, vingt secondes chacune.",
        startQuiz: "Commencer les questions",
        continueChallenge: "Continuer le défi",
        continueChallengeHint: (remaining: number) =>
          remaining === 1 ? "1 question restante" : `${remaining} questions restantes`,
        completeTitle: "Questions terminées",
        completeScore: (earned: string, total: string) => `${earned} points sur ${total}`,
        reviewOnly: "Déjà répondu — relecture uniquement",
        teamBadge: "Team",
        teamMore: (count: number) => `+${count}`,
        teamMoreSpoken: (count: number) =>
          count === 1 ? "et 1 autre team" : `et ${count} autres teams`,
        teamHidden: "Team"
      }
    },
    language
  );
}

/**
 * The accessible description of one answer option.
 *
 * The visual state — locked, selected, scored — has to reach VoiceOver as
 * words, because none of the colour or the border weight does.
 */
export function describeOptionForAccessibility(input: {
  label: string;
  index: number;
  total: number;
  selected: boolean;
  revealed: boolean;
  points?: string;
  copy: ReturnType<typeof getQuizCopy>;
}): string {
  const position = `${input.index + 1}/${input.total}`;
  const parts = [`${position}. ${input.label}`];

  if (input.selected) {
    parts.push(input.copy.locked);
  }

  if (input.revealed && input.points !== undefined) {
    parts.push(input.copy.points(input.points));
  }

  return parts.join(". ");
}
