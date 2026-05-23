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
        modules: {
          title: "Choose your daily modules",
          description:
            "Pick the formats you want in your five-minute daily drop.",
          selectedFooter: (count: number) =>
            `${count} module${count === 1 ? "" : "s"} selected`,
          emptyFooter: "Choose at least one module to continue."
        },
        topics: {
          title: "Which newsletter topics do you want?",
          description:
            "Choose 1 to 8 topics for your daily newsletter.",
          selectedFooter: (count: number) =>
            `${count} newsletter topic${count === 1 ? "" : "s"} selected`,
          emptyFooter: "Choose at least one newsletter topic to continue."
        },
        miniCaseTopics: {
          title: "Which mini-case topics do you want?",
          description:
            "Choose 1 to 3 topics for your daily mini-case. These are separate from newsletter topics.",
          selectedFooter: (count: number) =>
            `${count} mini-case topic${count === 1 ? "" : "s"} selected`,
          emptyFooter: "Choose at least one mini-case topic to continue.",
          maxFooter: "You can choose up to 3 mini-case topics.",
          save: "Save preferences",
          saving: "Saving..."
        },
        articleCount: {
          title: "Tune the daily dose",
          description: "Choose how many newsletter articles each selected topic gets.",
          selectedFooter: "One to three articles per selected topic. Keep it readable.",
          emptyFooter: "Choose newsletter topics before setting article counts.",
          countLabel: (count: number) => `${count} per drop`,
          emptyTitle: "No topics selected",
          emptyDescription: "Select at least one newsletter topic before setting article counts.",
          emptyAction: "Choose topics",
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
        modules: {
          title: "Choisis tes modules quotidiens",
          description:
            "Sélectionne les formats que tu veux dans ta mise à jour quotidienne de cinq minutes.",
          selectedFooter: (count: number) =>
            `${count} module${count > 1 ? "s" : ""} sélectionné${count > 1 ? "s" : ""}`,
          emptyFooter: "Choisis au moins un module pour continuer."
        },
        topics: {
          title: "Quels sujets veux-tu dans ta newsletter ?",
          description:
            "Choisis 1 à 8 sujets pour ta newsletter quotidienne.",
          selectedFooter: (count: number) =>
            `${count} sujet${count > 1 ? "s" : ""} newsletter sélectionné${count > 1 ? "s" : ""}`,
          emptyFooter: "Choisis au moins un sujet newsletter pour continuer."
        },
        miniCaseTopics: {
          title: "Quels sujets veux-tu pour les mini-cas ?",
          description:
            "Choisis 1 à 3 sujets pour ton mini-cas quotidien. Ces choix sont séparés des sujets newsletter.",
          selectedFooter: (count: number) =>
            `${count} sujet${count > 1 ? "s" : ""} mini-cas sélectionné${count > 1 ? "s" : ""}`,
          emptyFooter: "Choisis au moins un sujet mini-cas pour continuer.",
          maxFooter: "Tu peux choisir jusqu'à 3 sujets mini-cas.",
          save: "Enregistrer les préférences",
          saving: "Enregistrement..."
        },
        articleCount: {
          title: "Dose ton contenu quotidien",
          description: "Choisis combien d'articles newsletter chaque sujet sélectionné reçoit.",
          selectedFooter: "Un à trois articles par sujet sélectionné. Garde un format lisible.",
          emptyFooter: "Choisis des sujets newsletter avant de régler le nombre d'articles.",
          countLabel: (count: number) => `${count} par jour`,
          emptyTitle: "Aucun sujet sélectionné",
          emptyDescription: "Sélectionne au moins un sujet newsletter avant de régler les articles.",
          emptyAction: "Choisir des sujets",
          save: "Enregistrer les préférences",
          saving: "Enregistrement...",
          saveErrorTitle: "Impossible d'enregistrer les préférences"
        }
      }
    },
    language
  );
}
