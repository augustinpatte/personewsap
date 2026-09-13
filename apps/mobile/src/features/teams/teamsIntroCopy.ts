import { localized } from "../../lib/i18n";
import type { ContentLanguage } from "../today/contentTypes";
import { getTeamsCopy } from "./teamsCopy";

/**
 * The Teams introduction, in three parts.
 *
 * Short lines, not a rules page — Account → How scoring works is the rules
 * page. The middle part is the one that matters: PersoNews does not score right
 * or wrong, it scores the quality of the reasoning, and a reader who has not
 * been told that reads 0.3 as a bug.
 *
 * Same register as the rest of Teams: no exclamation marks, no emoji. The
 * leaderboard names are Teams' own, so the two can never disagree. "Live" is
 * said because it is true: Team Detail follows each answer over Realtime and
 * refetches the server's standing.
 */

export type TeamsIntroItem = { heading: string; body: string };

/** `share` is the part of the point, drawn as a filled bar. */
export type TeamsIntroTier = { value: string; name: string; body: string; share: number };

export function getTeamsIntroCopy(language: ContentLanguage) {
  const teams = getTeamsCopy(language);
  const ranges = `${teams.rangeEdition} · ${teams.rangeWeek} · ${teams.rangeAllTime}`;

  return localized(
    {
      en: {
        screenLabel: "Welcome to Teams",
        progress: (step: number, total: number) => `${step}/${total}`,
        progressSpoken: (step: number, total: number) => `Step ${step} of ${total}`,
        continueLabel: "Continue",
        back: "Back",
        getStarted: "Get started",
        done: "Done",
        close: "Close",
        howScoringWorks: "How scoring works",
        howScoringWorksHint: "Explains points and Teams",
        play: {
          eyebrow: "How to play",
          title: "Read, then answer",
          items: [
            { heading: "Read your edition", body: "Read PersoNews as you always do." },
            {
              heading: "Questions at the end",
              body: "Newsletter articles, Business Stories and Mini Cases end with a few questions."
            },
            { heading: "Twenty seconds", body: "Each question gives you 20 seconds once it starts." },
            {
              heading: "Played once",
              body: "A question is played only once. In French or in English, it is the same question."
            }
          ] as TeamsIntroItem[]
        },
        points: {
          eyebrow: "Points",
          title: "Not right or wrong: how well you reasoned",
          lede: "Every answer can be defended. Each one earns part of the point, by the quality of its reasoning.",
          tiers: [
            { value: "1", name: "Excellent", body: "The complete answer, with the strongest reasoning.", share: 1 },
            { value: "0.6", name: "Good", body: "Sound logic, but an important element is missing.", share: 0.6 },
            {
              value: "0.3",
              name: "Partial",
              body: "Part of the reasoning is right, but the answer falls short.",
              share: 0.3
            },
            { value: "0", name: "Miss", body: "The main reasoning does not hold.", share: 0 }
          ] as TeamsIntroTier[],
          timeout: {
            value: "0",
            name: "Time out",
            body: "No answer within 20 seconds scores zero. No retry.",
            share: 0
          } as TeamsIntroTier,
          after: "After each answer you see why it earned its score, and the answer worth the full point."
        },
        teams: {
          eyebrow: "Teams",
          title: "One answer, for you and your Team",
          items: [
            { heading: "Private", body: "Teams are private. Create one, or join one with an invitation." },
            {
              heading: "Answered once",
              body: "You answer each question once. When it was assigned to your Team, the same answer counts for your own score and for the Team. You never replay it for the Team."
            },
            { heading: "Three leaderboards", body: ranges },
            { heading: "Live", body: "Scores update live as your team answers." }
          ] as TeamsIntroItem[]
        }
      },
      fr: {
        screenLabel: "Bienvenue dans Teams",
        progress: (step: number, total: number) => `${step}/${total}`,
        progressSpoken: (step: number, total: number) => `Étape ${step} sur ${total}`,
        continueLabel: "Continuer",
        back: "Retour",
        getStarted: "Commencer",
        done: "Terminé",
        close: "Fermer",
        howScoringWorks: "Comment fonctionnent les points",
        howScoringWorksHint: "Les points et les Teams expliqués",
        play: {
          eyebrow: "Comment jouer",
          title: "Lire, puis répondre",
          items: [
            { heading: "Lisez votre édition", body: "Lisez PersoNews comme d'habitude." },
            {
              heading: "Des questions à la fin",
              body: "Les articles de la Newsletter, les Business Stories et les Mini cas se terminent par quelques questions."
            },
            { heading: "Vingt secondes", body: "Chaque question vous laisse 20 secondes une fois commencée." },
            {
              heading: "Une seule fois",
              body: "Une question ne se joue qu'une fois. En français ou en anglais, c'est la même question."
            }
          ] as TeamsIntroItem[]
        },
        points: {
          eyebrow: "Les points",
          title: "Pas juste ou faux : la qualité du raisonnement",
          lede: "Chaque réponse se défend. Chacune vaut une part du point, selon la qualité de son raisonnement.",
          tiers: [
            { value: "1", name: "Excellent", body: "La réponse complète, avec le meilleur raisonnement.", share: 1 },
            { value: "0,6", name: "Bon", body: "Bonne logique, mais il manque un élément important.", share: 0.6 },
            {
              value: "0,3",
              name: "Partiel",
              body: "Une partie du raisonnement est juste, mais la réponse reste insuffisante.",
              share: 0.3
            },
            { value: "0", name: "Manqué", body: "Le raisonnement principal ne tient pas.", share: 0 }
          ] as TeamsIntroTier[],
          timeout: {
            value: "0",
            name: "Temps écoulé",
            body: "Sans réponse en 20 secondes, la question vaut zéro. Pas de second essai.",
            share: 0
          } as TeamsIntroTier,
          after: "Après chaque réponse, vous voyez pourquoi elle vaut son score, et la réponse qui vaut le point entier."
        },
        teams: {
          eyebrow: "Teams",
          title: "Une réponse, pour vous et votre Team",
          items: [
            { heading: "Privées", body: "Les Teams sont privées. Créez-en une, ou rejoignez-en une sur invitation." },
            {
              heading: "Une seule réponse",
              body: "Vous répondez une fois à chaque question. Si elle a été attribuée à votre Team, la même réponse compte pour votre score et pour la Team. Vous ne la rejouez jamais pour la Team."
            },
            { heading: "Trois classements", body: ranges },
            { heading: "En direct", body: "Les scores se mettent à jour en direct pendant que votre Team répond." }
          ] as TeamsIntroItem[]
        }
      }
    },
    language
  );
}

export type TeamsIntroCopy = ReturnType<typeof getTeamsIntroCopy>;
