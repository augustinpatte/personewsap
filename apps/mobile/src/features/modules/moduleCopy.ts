import { localized } from "../../lib/i18n";
import type { Language } from "../../types/domain";

/**
 * All user-visible strings for the four module tabs (Newsletter, Mini cases,
 * Business stories, Learning path) and their shared chrome. FR and EN are
 * maintained together so no screen can ship with a hardcoded language.
 */
export function getModuleCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        common: {
          accountLabel: "Account",
          accountHint: "Opens your account and preferences",
          todayView: "Today",
          archiveView: "Archive",
          editionsView: "Editions",
          historyView: "History",
          currentView: "Current",
          loading: "Loading…",
          retry: "Try again",
          offlineTitle: "Connection issue",
          offlineBody:
            "Your content could not be loaded. Check your connection and try again.",
          openHint: "Opens this reading",
          read: "Read",
          solved: "Solved",
          noResultsTitle: "No match",
          noResultsBody: "Nothing matches that title or date yet.",
          clearSearch: "Clear search",
          searching: "Searching your archive…",
          searchOffline: "Offline — showing the editions already loaded.",
          loadEarlier: "Load earlier editions",
          loadMoreResults: "Load more results",
          searchPageFailed: "Could not load more results. Check your connection.",
          minuteCount: (count: number) => `${count} min`,
          quietDayTitle: "No new edition today",
          quietDayBody:
            "PersoNews publishes four considered editions a week — Monday, Wednesday, Friday and Sunday. Today is a quiet day by design.",
          nextEdition: (weekday: string) => `Next edition: ${weekday}.`,
          onItsWayTitle: "Today's edition is on its way",
          onItsWayBody:
            "This edition is not available yet. Nothing to do — check back in a moment.",
          languageChangeAppliesNext:
            "Your language change will apply to your next edition."
        },
        newsletter: {
          title: "Newsletter",
          tab: "Newsletter",
          lead: "Lead",
          alsoInBrief: "Also in the brief",
          readLead: "Read the lead",
          progress: (read: number, total: number) => `${read}/${total} read`,
          weeklyDigest: "Weekly digest",
          alsoInEdition: "Also in this edition",
          archiveEmptyTitle: "Your editions will settle here",
          archiveEmptyBody:
            "Each edition you receive is kept by date, so you can return to any day's brief.",
          noModuleToday: "Today's edition has no newsletter — see the other tabs."
        },
        stories: {
          title: "Business stories",
          tab: "Stories",
          kicker: "Business story",
          readStory: "Read the story",
          searchPlaceholder: "Search by title or date",
          searchAccessibility: "Search business stories by title or date",
          archiveEmptyTitle: "Your stories will settle here",
          archiveEmptyBody:
            "Each business story you receive is kept here, searchable by title and date.",
          noModuleToday: "Today's edition has no business story — see the other tabs."
        },
        cases: {
          title: "Mini cases",
          tab: "Mini cases",
          kicker: "Mini case",
          decision: "Your call",
          decide: "Make the call",
          score: (score: number, total: number) => `Score ${score}/${total}`,
          searchPlaceholder: "Search by title or date",
          searchAccessibility: "Search mini cases by title or date",
          archiveEmptyTitle: "Your cases will settle here",
          archiveEmptyBody:
            "Each mini case you work through is kept here with its result, searchable by title and date.",
          noModuleToday: "Today's edition has no mini case — see the other tabs."
        },
        path: {
          title: "Learning path",
          tab: "Path",
          // Stable header line: the path is self-paced, so it must not be
          // labelled with an edition date.
          eyebrow: "Personal path",
          sessionsCompleted: "Sessions completed",
          nextSession: "Next session",
          startFirst: "Start your first session",
          continuePath: "Continue your path",
          preparing: "Preparing your session…",
          resume: "Resume your session",
          selfPacedHint: "Go at your own pace — start the next session whenever you want.",
          completedTitle: "Path completed",
          completedBody:
            "You have covered every step up to your target level. Start a new path whenever you like.",
          newPath: "Start a new path",
          advanceFailed: "Your next session could not be prepared. Please try again.",
          historyTitle: "Completed sessions",
          historyEmptyTitle: "No completed session yet",
          historyEmptyBody:
            "Finish your first session and it will be kept here for review.",
          pastPaths: "Past learning paths",
          sessionLabel: (count: number) => `Session ${count}`
        }
      },
      fr: {
        common: {
          accountLabel: "Compte",
          accountHint: "Ouvre votre compte et vos préférences",
          todayView: "Aujourd'hui",
          archiveView: "Archives",
          editionsView: "Éditions",
          historyView: "Historique",
          currentView: "En cours",
          loading: "Chargement…",
          retry: "Réessayer",
          offlineTitle: "Problème de connexion",
          offlineBody:
            "Votre contenu n'a pas pu être chargé. Vérifiez votre connexion puis réessayez.",
          openHint: "Ouvre cette lecture",
          read: "Lu",
          solved: "Résolu",
          noResultsTitle: "Aucun résultat",
          noResultsBody: "Rien ne correspond à ce titre ou cette date pour l'instant.",
          clearSearch: "Effacer la recherche",
          searching: "Recherche dans vos archives…",
          searchOffline: "Hors ligne — seules les éditions déjà chargées sont affichées.",
          loadEarlier: "Afficher les éditions précédentes",
          loadMoreResults: "Afficher plus de résultats",
          searchPageFailed: "Impossible de charger plus de résultats. Vérifiez votre connexion.",
          minuteCount: (count: number) => `${count} min`,
          quietDayTitle: "Aucune nouvelle édition aujourd'hui",
          quietDayBody:
            "PersoNews publie quatre éditions soignées par semaine — lundi, mercredi, vendredi et dimanche. Aujourd'hui est une journée calme, par choix.",
          nextEdition: (weekday: string) => `Prochaine édition : ${weekday}.`,
          onItsWayTitle: "L'édition du jour arrive",
          onItsWayBody:
            "Cette édition n'est pas encore disponible. Rien à faire — revenez dans un instant.",
          languageChangeAppliesNext:
            "Votre changement de langue s'appliquera à votre prochaine édition."
        },
        newsletter: {
          title: "Newsletter",
          tab: "Newsletter",
          lead: "La une",
          alsoInBrief: "Aussi dans le brief",
          readLead: "Lire la une",
          progress: (read: number, total: number) => `${read}/${total} lus`,
          weeklyDigest: "Synthèse hebdo",
          alsoInEdition: "Aussi dans cette édition",
          archiveEmptyTitle: "Vos éditions se rangeront ici",
          archiveEmptyBody:
            "Chaque édition reçue est conservée par date, pour revenir au brief d'un jour précis.",
          noModuleToday:
            "L'édition du jour ne contient pas de newsletter — voyez les autres onglets."
        },
        stories: {
          title: "Business stories",
          tab: "Stories",
          kicker: "Business story",
          readStory: "Lire l'histoire",
          searchPlaceholder: "Rechercher par titre ou date",
          searchAccessibility: "Rechercher une business story par titre ou date",
          archiveEmptyTitle: "Vos histoires se rangeront ici",
          archiveEmptyBody:
            "Chaque business story reçue est conservée ici, retrouvable par titre et par date.",
          noModuleToday:
            "L'édition du jour ne contient pas de business story — voyez les autres onglets."
        },
        cases: {
          title: "Mini cas",
          tab: "Mini cas",
          kicker: "Mini cas",
          decision: "À vous de décider",
          decide: "Décider",
          score: (score: number, total: number) => `Score ${score}/${total}`,
          searchPlaceholder: "Rechercher par titre ou date",
          searchAccessibility: "Rechercher un mini cas par titre ou date",
          archiveEmptyTitle: "Vos cas se rangeront ici",
          archiveEmptyBody:
            "Chaque mini cas travaillé est conservé ici avec son résultat, retrouvable par titre et par date.",
          noModuleToday:
            "L'édition du jour ne contient pas de mini cas — voyez les autres onglets."
        },
        path: {
          title: "Parcours",
          tab: "Parcours",
          eyebrow: "Parcours personnel",
          sessionsCompleted: "Sessions terminées",
          nextSession: "Prochaine session",
          startFirst: "Commencer la première session",
          continuePath: "Continuer le parcours",
          preparing: "Préparation de votre session…",
          resume: "Reprendre votre session",
          selfPacedHint: "Avancez à votre rythme — lancez la session suivante quand vous voulez.",
          completedTitle: "Parcours terminé",
          completedBody:
            "Vous avez couvert toutes les étapes jusqu'à votre niveau cible. Vous pouvez démarrer un nouveau parcours quand vous le souhaitez.",
          newPath: "Démarrer un nouveau parcours",
          advanceFailed: "Votre prochaine session n'a pas pu être préparée. Réessayez.",
          historyTitle: "Sessions terminées",
          historyEmptyTitle: "Aucune session terminée",
          historyEmptyBody:
            "Terminez votre première session : elle restera consultable ici.",
          pastPaths: "Parcours précédents",
          sessionLabel: (count: number) => `Session ${count}`
        }
      }
    },
    language === "fr" ? "fr" : "en"
  );
}

export type ModuleCopy = ReturnType<typeof getModuleCopy>;
