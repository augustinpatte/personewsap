import type { Language } from "../../types/domain";
import { localized } from "../../lib/i18n";

export function getOnboardingCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        step: (step: number, total: number) => `Step ${step} of ${total}`,
        common: {
          back: "Back",
          continue: "Continue"
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
          title: "Pick practical-case interests",
          description:
            "Choose the categories you want for practical mini-cases. They also shape newsletter depth.",
          selectedFooter: (count: number) =>
            `${count} categor${count === 1 ? "y" : "ies"} selected for articles and cases`,
          emptyFooter: "Choose at least one practical-case category to continue."
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
          continue: "Continuer"
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
          title: "Choisis tes intérêts mini-cas",
          description:
            "Choisis les catégories que tu veux pour les mini-cas pratiques. Elles règlent aussi la profondeur newsletter.",
          selectedFooter: (count: number) =>
            `${count} catégorie${count > 1 ? "s" : ""} sélectionnée${count > 1 ? "s" : ""} pour articles et mini-cas`,
          emptyFooter: "Choisis au moins une catégorie mini-cas pour continuer."
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
