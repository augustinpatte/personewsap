import { localized } from "../../lib/i18n";
import type { ContentLanguage } from "../today/contentTypes";

/**
 * The two explanations a scored, competitive product owes its readers.
 *
 * Somebody who loses 700 points because they hesitated for twenty-one seconds
 * deserves to have been told the rules beforehand — in the app, in their own
 * language, not in a store listing. Both pages are short and factual; neither
 * sells anything.
 *
 * These live in Account, not in Teams: Teams is where you manage a league, and
 * duplicating the rules there would mean two places to keep in step. Account is
 * where "how does this work" already lives, next to privacy and support.
 */
export function getHelpCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        scoringTitle: "How scoring works",
        scoringIntro:
          "PersoNewsAP questions test judgement, not recall. The article gives you the facts; the question asks what they mean.",
        scoringPoints: [
          {
            heading: "Twenty seconds per question",
            body: "The countdown comes from the server, not from your phone. Closing the app does not pause it, and changing your device clock does nothing."
          },
          {
            heading: "Four answers, four values",
            body: "Every question has four defensible answers, worth 0, 0.3, 0.6 or 1 point. Only one is worth a full point, and the others are wrong in progressively more interesting ways."
          },
          {
            heading: "No speed bonus",
            body: "An answer is worth the same at two seconds as at nineteen. Take the time you have."
          },
          {
            heading: "One attempt",
            body: "Each question is answered once. Reading the same article again in French or in English does not give you another go — it is the same question."
          },
          {
            heading: "Skipping and running out of time",
            body: "Both score zero. Skipping is not penalised beyond that, and the explanation is shown either way."
          },
          {
            heading: "The explanation is not timed",
            body: "Once you have answered, take as long as you like reading why."
          }
        ],
        teamsTitle: "How Teams work",
        teamsIntro:
          "A Team is a private league between friends. There is no public ranking, no discovery and no way to be added by a stranger.",
        teamsPoints: [
          {
            heading: "Create or join",
            body: "Create a Team and share its code, or enter a code somebody sent you. A code is the only way in."
          },
          {
            heading: "One shared set of topics",
            body: "The owner picks the newsletter and mini-case topics, and everybody in the Team plays the same ones. Business Stories and your Path stay personal."
          },
          {
            heading: "Team content comes first",
            body: "In Newsletter and Mini Cases, your Team's content appears above your own. If the same article reaches you both ways, you see it once."
          },
          {
            heading: "One answer, several Teams",
            body: "If two of your Teams were assigned the same question, you answer it once and it counts for both."
          },
          {
            heading: "The edition leaderboard",
            body: "Each edition has its own standing, and it closes when the next edition publishes. You can also look at the week and at all time."
          },
          {
            heading: "Edition streak",
            body: "Your streak counts consecutive editions where you answered every question your Team was given. Editions are Monday, Wednesday, Friday and Sunday — not every day."
          },
          {
            heading: "Joining mid-edition",
            body: "You see the Team and its leaderboard straight away, and you start being scored with the next edition. Nobody joins after seeing the questions."
          },
          {
            heading: "Leaving",
            body: "You stop receiving new editions and keep the points you already earned. Past standings are never rewritten."
          }
        ]
      },
      fr: {
        scoringTitle: "Comment fonctionne le score",
        scoringIntro:
          "Les questions PersoNewsAP testent le jugement, pas la mémoire. L'article donne les faits ; la question demande ce qu'ils signifient.",
        scoringPoints: [
          {
            heading: "Vingt secondes par question",
            body: "Le compte à rebours vient du serveur, pas de votre téléphone. Fermer l'app ne le met pas en pause, et changer l'heure de l'appareil ne change rien."
          },
          {
            heading: "Quatre réponses, quatre valeurs",
            body: "Chaque question a quatre réponses défendables, valant 0, 0,3, 0,6 ou 1 point. Une seule vaut un point entier ; les autres se trompent de façon de plus en plus intéressante."
          },
          {
            heading: "Aucun bonus de vitesse",
            body: "Une réponse vaut autant en deux secondes qu'en dix-neuf. Prenez le temps dont vous disposez."
          },
          {
            heading: "Une seule tentative",
            body: "Chaque question se joue une fois. Relire le même article en français ou en anglais ne donne pas un second essai : c'est la même question."
          },
          {
            heading: "Passer et laisser filer le temps",
            body: "Les deux valent zéro. Passer n'est pas pénalisé au-delà, et l'explication s'affiche dans les deux cas."
          },
          {
            heading: "L'explication n'est pas chronométrée",
            body: "Une fois la réponse donnée, prenez tout le temps de lire pourquoi."
          }
        ],
        teamsTitle: "Comment fonctionnent les Teams",
        teamsIntro:
          "Une Team est une ligue privée entre amis. Aucun classement public, aucune découverte, et personne ne peut vous ajouter sans que vous le vouliez.",
        teamsPoints: [
          {
            heading: "Créer ou rejoindre",
            body: "Créez une Team et partagez son code, ou saisissez celui qu'on vous a envoyé. Le code est le seul moyen d'entrer."
          },
          {
            heading: "Des sujets communs",
            body: "Le propriétaire choisit les sujets newsletter et mini cas, et toute la Team joue les mêmes. Les Business Stories et votre Parcours restent personnels."
          },
          {
            heading: "Le contenu Team passe en premier",
            body: "Dans Newsletter et Mini cas, le contenu de votre Team apparaît au-dessus du vôtre. Si un même article vous arrive des deux côtés, vous le voyez une seule fois."
          },
          {
            heading: "Une réponse, plusieurs Teams",
            body: "Si deux de vos Teams ont reçu la même question, vous y répondez une fois et elle compte pour les deux."
          },
          {
            heading: "Le classement de l'édition",
            body: "Chaque édition a son propre classement, qui se ferme à la publication de la suivante. Vous pouvez aussi voir la semaine et le total."
          },
          {
            heading: "Série d'éditions",
            body: "Votre série compte les éditions consécutives où vous avez répondu à toutes les questions de votre Team. Les éditions sont lundi, mercredi, vendredi et dimanche — pas tous les jours."
          },
          {
            heading: "Rejoindre en cours d'édition",
            body: "Vous voyez la Team et son classement immédiatement, et vous êtes classé à partir de la prochaine édition. Personne ne rejoint après avoir vu les questions."
          },
          {
            heading: "Partir",
            body: "Vous ne recevez plus les nouvelles éditions et conservez les points déjà gagnés. Les classements passés ne sont jamais réécrits."
          }
        ]
      }
    },
    language
  );
}
