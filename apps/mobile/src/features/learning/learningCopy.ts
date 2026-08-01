import { localized } from "../../lib/i18n";
import type { Language } from "../../types/domain";

export function getLearningCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        account: {
          title: "Learning path",
          description: "Your active five-minute learning path.",
          completedDescription: "Your last path is complete. Its history stays available.",
          disabledTitle: "Personal learning path off",
          disabledBody: "Activate a progressive five-minute path, four times per week.",
          enable: "Activate path",
          emptyTitle: "Create your learning path",
          emptyBody: "Choose one bilingual path. It will become the fourth module in Today.",
          change: "Change path",
          newPath: "Start a new path",
          overview: "View path",
          disable: "Disable path",
          disableTitle: "Disable learning path?",
          disableBody:
            "Your current path will be archived. Its history stays available, and no future learning sessions will be generated.",
          disableConfirm: "Disable",
          replaceTitle: "Change learning path?",
          replaceBody:
            "Your current path will be archived. Its history stays available, and the new path becomes the only active one.",
          cancel: "Cancel",
          confirm: "Continue",
          sessionsCompleted: (value: number) =>
            value === 1 ? "1 session completed" : `${value} sessions completed`,
          sessionsStarted: (value: number) =>
            value === 1 ? "1 session started" : `${value} sessions started`,
          feedbackSent: (value: number) =>
            value === 1 ? "1 feedback sent" : `${value} feedback sent`
        },
        card: {
          kicker: "Learning path",
          createTitle: "Create your learning path",
          createBody:
            "Choose one domain, one direction and a level. Your next edition will include a five-minute session.",
          createButton: "Create path",
          readyTitle: "Your path is ready.",
          readyBody: "The first session will arrive with the next edition.",
          sessionLabel: (value: number) => `Session ${value}`,
          duration: "5 min",
          available: "Available",
          completed: "Session complete",
          start: "Start",
          continue: "Continue",
          view: "View path"
        },
        setup: {
          eyebrow: "Learning path",
          title: "Create your learning path",
          replacingTitle: "Choose your new path",
          subtitle:
            "One bilingual path, four sessions per week, five minutes maximum per session.",
          stepLabel: (current: number, total: number) => `Step ${current}/${total}`,
          domainTitle: "Choose a domain",
          currentLevelTitle: "Your current level",
          targetLevelTitle: "Your target level",
          objectiveTitle: "Choose an orientation",
          objectiveEmpty: "Choose a domain first to see its orientations.",
          confirmationTitle: "Confirm your path",
          domain: "Domain",
          orientation: "Orientation",
          currentLevel: "Current level",
          targetLevel: "Target level",
          frequency: "Frequency",
          frequencyValue: "Four sessions per week",
          duration: "Duration",
          durationValue: "Five minutes maximum",
          providers: "Works with ChatGPT, Claude or Gemini.",
          back: "Back",
          next: "Next",
          notNow: "Not now",
          create: "Create my learning path",
          creating: "Creating",
          missingSelection: "Complete this step to continue.",
          error:
            "The learning path could not be created right now. Your choices are still here.",
          loadErrorTitle: "Learning paths are unavailable",
          loadErrorBody:
            "The list of domains could not be loaded. Your choices are saved and will come back.",
          retry: "Try again",
          retrying: "Loading",
          replaceNotice:
            "Creating this path will archive the current one. Its history will stay available."
        },
        session: {
          eyebrow: "Learning path",
          duration: "Five minutes maximum",
          objectives: "Session goals",
          openWith: "Open with",
          copyPrompt: "Copy prompt",
          promptCopied: "Prompt copied. Paste it into a new conversation.",
          syncPending:
            "Prompt copied. Your progress will sync when the connection is back.",
          openFailed:
            "The provider could not be opened. The prompt is copied; paste it into a new conversation.",
          complete: "I've finished",
          completeLocked: "Copy or open the prompt first.",
          viewPrompt: "View prompt",
          hidePrompt: "Hide prompt",
          loading: "Loading the session",
          sessionLabel: (value: number) => `Session ${value}`,
          unavailableTitle: "Session unavailable",
          unavailableBody: "This session is no longer available. Return to Today to refresh your path.",
          backToday: "Back to Today"
        },
        feedback: {
          eyebrow: "Learning path",
          title: "Session feedback",
          subtitle: "Four quick ratings.",
          comprehension: "Comprehension",
          comprehensionQuestion: "How well did you understand the topic?",
          explainability: "Ability to explain",
          explainabilityQuestion: "Could you explain it to someone else?",
          interest: "Interest",
          interestQuestion: "How interesting was this session?",
          difficulty: "Difficulty",
          difficultyQuestion: "How did the difficulty feel?",
          difficultyLabels: [
            "Much too easy",
            "Slightly too easy",
            "About right",
            "Slightly too difficult",
            "Much too difficult"
          ],
          submit: "Submit feedback",
          submitting: "Submitting",
          required: "Answer the four ratings to finish the session.",
          error: "Feedback could not be saved. Your ratings are still selected."
        },
        overview: {
          eyebrow: "Learning path",
          title: "Your path",
          domain: "Domain",
          orientation: "Orientation",
          currentLevel: "Current level",
          targetLevel: "Target level",
          status: "Status",
          sessionLabel: (value: number) => `Session ${value}`,
          remainingSessions: (value: number) =>
            value === 1 ? "1 upcoming session" : `${value} upcoming sessions`,
          sessionsCompleted: "Sessions completed",
          conceptsStudied: "Concepts studied",
          pathInProgress: "Path in progress",
          pathCompleted: "Path completed",
          history: "Session history",
          noHistory: "No completed session yet.",
          nextEdition: "Next edition",
          nextUnknown: "With the next edition",
          replace: "Change path",
          loading: "Loading your path",
          emptyTitle: "No active path yet",
          emptyBody: "Create a path to receive a five-minute session in Today."
        }
      },
      fr: {
        account: {
          title: "Parcours",
          description: "Votre parcours d'apprentissage actif en cinq minutes.",
          completedDescription: "Votre dernier parcours est terminé. Son historique reste disponible.",
          disabledTitle: "Parcours personnalisé désactivé",
          disabledBody:
            "Activez un parcours progressif de cinq minutes, quatre fois par semaine.",
          enable: "Activer le parcours",
          emptyTitle: "Créer votre parcours",
          emptyBody:
            "Choisissez un seul parcours bilingue. Il deviendra le quatrième module dans Aujourd'hui.",
          change: "Changer de parcours",
          newPath: "Commencer un nouveau parcours",
          overview: "Voir le parcours",
          disable: "Désactiver le parcours",
          disableTitle: "Désactiver le parcours ?",
          disableBody:
            "Votre parcours actuel sera archivé. Son historique reste disponible, et aucune future session ne sera générée.",
          disableConfirm: "Désactiver",
          replaceTitle: "Changer de parcours ?",
          replaceBody:
            "Votre parcours actuel sera archivé. Son historique reste disponible, et le nouveau parcours devient le seul actif.",
          cancel: "Annuler",
          confirm: "Continuer",
          sessionsCompleted: (value: number) =>
            value === 1 ? "1 session terminée" : `${value} sessions terminées`,
          sessionsStarted: (value: number) =>
            value === 1 ? "1 session commencée" : `${value} sessions commencées`,
          feedbackSent: (value: number) =>
            value === 1 ? "1 retour envoyé" : `${value} retours envoyés`
        },
        card: {
          kicker: "Parcours",
          createTitle: "Créer votre parcours",
          createBody:
            "Choisissez un domaine, une orientation et un niveau. Votre prochaine édition inclura une session de cinq minutes.",
          createButton: "Créer le parcours",
          readyTitle: "Votre parcours est prêt.",
          readyBody: "La première session arrivera avec la prochaine édition.",
          sessionLabel: (value: number) => `Session ${value}`,
          duration: "5 min",
          available: "Disponible",
          completed: "Session terminée",
          start: "Commencer",
          continue: "Continuer",
          view: "Voir le parcours"
        },
        setup: {
          eyebrow: "Parcours",
          title: "Créer votre parcours",
          replacingTitle: "Choisir votre nouveau parcours",
          subtitle:
            "Un seul parcours bilingue, quatre sessions par semaine, cinq minutes maximum par session.",
          stepLabel: (current: number, total: number) => `Étape ${current}/${total}`,
          domainTitle: "Choisir un domaine",
          currentLevelTitle: "Votre niveau actuel",
          targetLevelTitle: "Votre niveau cible",
          objectiveTitle: "Choisir une orientation",
          objectiveEmpty: "Choisissez d'abord un domaine pour voir ses orientations.",
          confirmationTitle: "Confirmer votre parcours",
          domain: "Domaine",
          orientation: "Orientation",
          currentLevel: "Niveau actuel",
          targetLevel: "Niveau cible",
          frequency: "Fréquence",
          frequencyValue: "Quatre sessions par semaine",
          duration: "Durée",
          durationValue: "Cinq minutes maximum",
          providers: "Utilisable avec ChatGPT, Claude ou Gemini.",
          back: "Retour",
          next: "Suivant",
          notNow: "Pas maintenant",
          create: "Créer mon parcours",
          creating: "Création",
          missingSelection: "Complétez cette étape pour continuer.",
          error:
            "Le parcours n'a pas pu être créé pour le moment. Vos choix sont conservés.",
          loadErrorTitle: "Les parcours sont indisponibles",
          loadErrorBody:
            "La liste des domaines n'a pas pu être chargée. Vos choix sont enregistrés et seront restaurés.",
          retry: "Réessayer",
          retrying: "Chargement",
          replaceNotice:
            "Créer ce parcours archivera le parcours actuel. Son historique restera disponible."
        },
        session: {
          eyebrow: "Parcours",
          duration: "Cinq minutes maximum",
          objectives: "Objectifs de la session",
          openWith: "Ouvrir avec",
          copyPrompt: "Copier le prompt",
          promptCopied: "Prompt copié. Collez-le dans une nouvelle conversation.",
          syncPending:
            "Prompt copié. Votre progression sera synchronisée au retour de la connexion.",
          openFailed:
            "Le fournisseur n'a pas pu être ouvert. Le prompt est copié; collez-le dans une nouvelle conversation.",
          complete: "J'ai terminé",
          completeLocked: "Copiez ou ouvrez le prompt d'abord.",
          viewPrompt: "Voir le prompt",
          hidePrompt: "Masquer le prompt",
          loading: "Chargement de la session",
          sessionLabel: (value: number) => `Session ${value}`,
          unavailableTitle: "Session indisponible",
          unavailableBody:
            "Cette session n'est plus disponible. Revenez à Aujourd'hui pour actualiser votre parcours.",
          backToday: "Retour à Aujourd'hui"
        },
        feedback: {
          eyebrow: "Parcours",
          title: "Retour de session",
          subtitle: "Quatre notes rapides.",
          comprehension: "Compréhension",
          comprehensionQuestion: "À quel point avez-vous compris le sujet ?",
          explainability: "Capacité à expliquer",
          explainabilityQuestion: "Pourriez-vous l'expliquer à quelqu'un ?",
          interest: "Intérêt",
          interestQuestion: "À quel point cette session vous a-t-elle intéressé ?",
          difficulty: "Difficulté",
          difficultyQuestion: "Comment avez-vous trouvé la difficulté ?",
          difficultyLabels: [
            "Beaucoup trop facile",
            "Un peu trop facile",
            "Adaptée",
            "Un peu trop difficile",
            "Beaucoup trop difficile"
          ],
          submit: "Valider",
          submitting: "Validation",
          required: "Répondez aux quatre notes pour terminer la session.",
          error:
            "Le retour n'a pas pu être enregistré. Vos notes restent sélectionnées."
        },
        overview: {
          eyebrow: "Parcours",
          title: "Votre parcours",
          domain: "Domaine",
          orientation: "Orientation",
          currentLevel: "Niveau actuel",
          targetLevel: "Niveau cible",
          status: "État",
          sessionLabel: (value: number) => `Session ${value}`,
          remainingSessions: (value: number) =>
            value === 1 ? "1 session à venir" : `${value} sessions à venir`,
          sessionsCompleted: "Sessions terminées",
          conceptsStudied: "Concepts étudiés",
          pathInProgress: "Parcours en cours",
          pathCompleted: "Parcours terminé",
          history: "Historique des sessions",
          noHistory: "Aucune session terminée pour le moment.",
          nextEdition: "Prochaine édition",
          nextUnknown: "Avec la prochaine édition",
          replace: "Changer de parcours",
          loading: "Chargement du parcours",
          emptyTitle: "Aucun parcours actif",
          emptyBody:
            "Créez un parcours pour recevoir une session de cinq minutes dans Aujourd'hui."
        }
      }
    },
    language
  );
}
