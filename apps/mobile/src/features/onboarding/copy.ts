import type { Language } from "../../types/domain";
import { localized } from "../../lib/i18n";

export function getOnboardingCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        step: (step: number, total: number) => `Step ${step} of ${total}`,
        common: {
          back: "Back",
          continue: "Continue",
          selected: "Selected",
          notSelected: "Not selected"
        },
        language: {
          title: "Pick your briefing language",
          description:
            "Choose the language for your daily drop. FR and EN are written as native editorial versions.",
          selectedFooter: "You can change language later from Account.",
          emptyFooter: "Choose one language to continue.",
          backToLogin: "Back to login"
        },
        topics: {
          title: "Pick newsletter topics",
          description:
            "Choose one or more categories for your daily newsletter. They also shape mini-cases.",
          selectedFooter: (count: number) =>
            `${count} newsletter categor${count === 1 ? "y" : "ies"} selected`,
          emptyFooter: "Choose at least one newsletter category to continue."
        },
        miniCaseTopic: {
          title: "Pick your mini-case topic",
          description:
            "Your daily mini-case uses one topic from your newsletter choices. Pick the one you want to practice.",
          singleDescription:
            "You selected one newsletter category, so your mini-case will use it too.",
          selectedFooter: "This topic will drive the daily mini-case.",
          emptyFooter: "Choose one mini-case topic to continue."
        },
        articleCount: {
          title: "Tune the daily dose",
          description: "Choose how many newsletter articles each selected category gets.",
          selectedFooter: "One to three articles per selected category. Keep it readable.",
          emptyFooter: "Choose categories before setting article counts.",
          countLabel: (count: number) => `${count} per drop`,
          emptyTitle: "No categories selected",
          emptyDescription: "Select at least one category before setting article counts.",
          emptyAction: "Choose categories",
          save: "Save preferences",
          saving: "Saving...",
          saveErrorTitle: "Could not save preferences"
        }
      },
      fr: {
        step: (step: number, total: number) => `Étape ${step} sur ${total}`,
        common: {
          back: "Retour",
          continue: "Continuer",
          selected: "Sélectionné",
          notSelected: "Non sélectionné"
        },
        language: {
          title: "Choisis la langue de ton briefing",
          description:
            "Choisis la langue de ta mise à jour quotidienne. FR et EN sont écrits comme deux versions éditoriales natives.",
          selectedFooter: "Tu pourras changer la langue plus tard dans Compte.",
          emptyFooter: "Choisis une langue pour continuer.",
          backToLogin: "Retour à la connexion"
        },
        topics: {
          title: "Choisis tes sujets newsletter",
          description:
            "Choisis une ou plusieurs catégories pour ta newsletter quotidienne. Elles guident aussi les mini-cas.",
          selectedFooter: (count: number) =>
            `${count} catégorie${count > 1 ? "s" : ""} newsletter sélectionnée${count > 1 ? "s" : ""}`,
          emptyFooter: "Choisis au moins une catégorie newsletter pour continuer."
        },
        miniCaseTopic: {
          title: "Choisis ton sujet de mini-cas",
          description:
            "Ton mini-cas quotidien utilise un sujet parmi tes choix newsletter. Choisis celui que tu veux travailler.",
          singleDescription:
            "Tu as sélectionné une seule catégorie newsletter, donc ton mini-cas l'utilisera aussi.",
          selectedFooter: "Ce sujet guidera le mini-cas quotidien.",
          emptyFooter: "Choisis un sujet de mini-cas pour continuer."
        },
        articleCount: {
          title: "Dose ton contenu quotidien",
          description: "Choisis combien d'articles newsletter chaque catégorie sélectionnée reçoit.",
          selectedFooter: "Un à trois articles par catégorie sélectionnée. Garde un format lisible.",
          emptyFooter: "Choisis des catégories avant de régler le nombre d'articles.",
          countLabel: (count: number) => `${count} par jour`,
          emptyTitle: "Aucune catégorie sélectionnée",
          emptyDescription: "Sélectionne au moins une catégorie avant de régler les articles.",
          emptyAction: "Choisir des catégories",
          save: "Enregistrer les préférences",
          saving: "Enregistrement...",
          saveErrorTitle: "Impossible d'enregistrer les préférences"
        }
      }
    },
    language
  );
}
