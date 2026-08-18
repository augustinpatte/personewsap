/**
 * Copy for the three public pages the stores require: privacy, support and
 * account deletion.
 *
 * Kept out of LanguageContext's key/value dictionary on purpose — that one is
 * for short interface strings, and this is prose that has to stay accurate.
 * Holding both languages side by side in one structure is also what makes FR/EN
 * parity checkable in a test rather than by eye.
 *
 * Nothing here may describe behaviour the product does not have. Everything
 * below matches what is actually implemented: four editions a week, a
 * self-paced learning path, one notification per published edition, analytics
 * only when an endpoint is configured, no advertising, no data sale.
 */

export const LEGAL_LAST_UPDATED = "2026-08-18";

/** Set at build time before store submission; see /support. */
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL?.trim() ?? "";

export const ACCOUNT_DELETION_ENDPOINT =
  import.meta.env.VITE_ACCOUNT_DELETION_ENDPOINT?.trim() ?? "";

export type LegalLanguage = "fr" | "en";

type Section = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

type PrivacyCopy = {
  eyebrow: string;
  title: string;
  updated: (date: string) => string;
  intro: string[];
  sections: Section[];
};

type SupportCopy = {
  eyebrow: string;
  title: string;
  intro: string[];
  sections: Section[];
  contactHeading: string;
  contactConfigured: (email: string) => string;
  contactMissing: string;
};

type DeleteCopy = {
  eyebrow: string;
  title: string;
  intro: string[];
  whatIsDeletedHeading: string;
  whatIsDeleted: string[];
  whatIsKeptHeading: string;
  whatIsKept: string[];
  signedOutHeading: string;
  signedOutBody: string;
  signInCta: string;
  signedInAs: (email: string) => string;
  confirmHeading: string;
  confirmBody: string;
  confirmCheckbox: string;
  deleteCta: string;
  deleting: string;
  successHeading: string;
  successBody: string;
  errorHeading: string;
  errorBody: string;
  unauthorized: string;
  notConfigured: string;
  cancel: string;
};

export const legalCopy: Record<
  LegalLanguage,
  { privacy: PrivacyCopy; support: SupportCopy; deleteAccount: DeleteCopy }
> = {
  en: {
    privacy: {
      eyebrow: "PersoNewsAP",
      title: "Privacy policy",
      updated: (date) => `Last updated ${date}`,
      intro: [
        "PersoNewsAP is a personalised editorial product. It publishes four editions a week — Monday, Wednesday, Friday and Sunday — each with a newsletter brief, a business story and a mini case, plus an optional self-paced learning path.",
        "This policy describes exactly what we store, why, and how to get it back or remove it. It describes the product as it is built today; nothing here is aspirational."
      ],
      sections: [
        {
          heading: "Account and sign-in",
          paragraphs: [
            "We store your email address and an authentication record so you can sign in and so your content follows you across devices. Passwords are handled by our authentication provider and are never visible to us.",
            "We also store the reading language you choose and the timezone your device reports at sign-up."
          ]
        },
        {
          heading: "Your preferences",
          paragraphs: [
            "The topics you select for the newsletter and for mini cases, how many articles you want per edition, and whether the learning path and notifications are on. These decide what each edition contains."
          ]
        },
        {
          heading: "What you do with the content",
          bullets: [
            "Which items you have opened or completed, so an edition can show your progress and the archive can mark what you have read.",
            "Your mini-case answers and score, so a completed case can be reviewed later and so your result follows you to another device.",
            "Your learning path: the objective and level you chose, the sessions prepared for you, and the ratings you give a session so the next one can adapt.",
            "Optional feedback you send about an item."
          ]
        },
        {
          heading: "Notifications",
          paragraphs: [
            "If — and only if — you turn notifications on, we store a push token for each device so we can send one notification per published edition: four a week, never on a quiet day. We keep a record of which device was notified for which edition, so you are never notified twice for the same one.",
            "Turning notifications off disables the stored token. Uninstalling the app also retires it the next time we try to reach it."
          ]
        },
        {
          heading: "Analytics",
          paragraphs: [
            "The app sends product analytics only if an analytics endpoint has been configured for the build. When it is not configured, no analytics events leave your device. Analytics events never contain the content you read or your mini-case answers."
          ]
        },
        {
          heading: "What we do not do",
          bullets: [
            "No advertising, and no advertising identifiers.",
            "No selling or renting of personal data.",
            "No tracking across other apps or websites.",
            "No profiling beyond the preferences you set yourself."
          ]
        },
        {
          heading: "Who else processes your data",
          bullets: [
            "Supabase — database, authentication and storage of everything described above.",
            "Expo push notification service — delivery of the edition notification, if you enabled it.",
            "Our content pipeline calls language-model providers to write editions. It sends article material and editorial instructions; it never sends your account, your preferences or your answers."
          ]
        },
        {
          heading: "How long we keep it",
          paragraphs: [
            "Account data, preferences, reading history, mini-case results and learning progress are kept while your account exists. Delivery records for notifications are kept as long as the device token exists.",
            "Deleting your account removes all of it immediately, as described below."
          ]
        },
        {
          heading: "Getting your data, and deleting it",
          paragraphs: [
            "In the app, open Account to export a copy of your data or to delete your account. Deletion is immediate and permanent: your profile, preferences, reading history, mini-case results, learning path and notification settings are removed, and you are signed out.",
            "You can also delete your account from this website at /delete-account without installing the app.",
            "Editorial content itself — articles, stories, cases — belongs to the product and is not deleted; it simply stops being linked to you."
          ]
        },
        {
          heading: "Contacting us",
          paragraphs: [
            "For any privacy question, use the contact route listed on the support page."
          ]
        }
      ]
    },
    support: {
      eyebrow: "PersoNewsAP",
      title: "Support",
      intro: [
        "PersoNewsAP publishes four editions a week: Monday, Wednesday, Friday and Sunday. Each one holds a newsletter brief, a business story and a mini case. The learning path runs at your own pace, independently of the edition calendar."
      ],
      sections: [
        {
          heading: "Signing in",
          bullets: [
            "Sign in with the email address you used to create your account.",
            "Forgot your password? Use “Forgot password” on the sign-in screen; a reset link is sent to your email.",
            "If the link does not arrive, check your spam folder before requesting another."
          ]
        },
        {
          heading: "Notifications",
          bullets: [
            "One notification per published edition — four a week, nothing on a quiet day.",
            "Turn them on or off at any time in Account.",
            "Nothing arrives on Tuesday, Thursday or Saturday: those are quiet days by design, not a fault."
          ]
        },
        {
          heading: "Content and feedback",
          bullets: [
            "No edition on a given day? Tuesday, Thursday and Saturday have none by design.",
            "An edition that has not arrived yet appears as “on its way”; pull to refresh.",
            "Every past edition stays in the archive, searchable by title and date.",
            "You can rate any item; the rating shapes what you are sent next."
          ]
        },
        {
          heading: "Your data",
          bullets: [
            "Export a copy of your data from Account.",
            "Delete your account from Account, or from this website at /delete-account.",
            "Deletion is immediate and cannot be undone."
          ]
        }
      ],
      contactHeading: "Contact",
      contactConfigured: (email) => `Write to ${email}. We answer within a few working days.`,
      contactMissing:
        "A support address has not been configured for this deployment yet. Set VITE_SUPPORT_EMAIL before store submission."
    },
    deleteAccount: {
      eyebrow: "PersoNewsAP",
      title: "Delete your account",
      intro: [
        "This deletes your PersoNewsAP account and everything stored with it. It is immediate and cannot be undone.",
        "You can only delete the account you are signed in with."
      ],
      whatIsDeletedHeading: "What is deleted",
      whatIsDeleted: [
        "Your profile and sign-in",
        "Your topic and edition preferences",
        "Your reading history and completed items",
        "Your mini-case answers and scores",
        "Your learning path, its sessions and your ratings",
        "Your notification settings and push tokens",
        "The link between your account and every edition you received"
      ],
      whatIsKeptHeading: "What is not deleted",
      whatIsKept: [
        "The editorial content itself — articles, business stories and mini cases. It belongs to the product and is shared by all readers; it simply stops being linked to you."
      ],
      signedOutHeading: "Sign in first",
      signedOutBody:
        "For your safety, an account can only be deleted by its owner. Sign in, then come back to this page.",
      signInCta: "Sign in",
      signedInAs: (email) => `Signed in as ${email}`,
      confirmHeading: "Confirm",
      confirmBody:
        "Once you confirm, your account and its data are removed straight away and you are signed out.",
      confirmCheckbox: "I understand this cannot be undone.",
      deleteCta: "Delete my account",
      deleting: "Deleting…",
      successHeading: "Your account has been deleted",
      successBody:
        "Everything stored with your account has been removed. You can create a new account at any time.",
      errorHeading: "Your account was not deleted",
      errorBody: "Something went wrong. Your account is untouched — please try again.",
      unauthorized: "Your session has expired. Sign in again, then retry.",
      notConfigured:
        "Account deletion is not configured for this deployment yet. Use the Account screen in the app, or contact support.",
      cancel: "Cancel"
    }
  },
  fr: {
    privacy: {
      eyebrow: "PersoNewsAP",
      title: "Politique de confidentialité",
      updated: (date) => `Dernière mise à jour le ${date}`,
      intro: [
        "PersoNewsAP est un produit éditorial personnalisé. Il publie quatre éditions par semaine — lundi, mercredi, vendredi et dimanche — composées d'un brief newsletter, d'une business story et d'un mini cas, auxquels s'ajoute un parcours d'apprentissage optionnel, à votre rythme.",
        "Cette politique décrit précisément ce que nous conservons, pourquoi, et comment le récupérer ou le supprimer. Elle décrit le produit tel qu'il est réellement construit aujourd'hui."
      ],
      sections: [
        {
          heading: "Compte et connexion",
          paragraphs: [
            "Nous conservons votre adresse e-mail et un enregistrement d'authentification afin que vous puissiez vous connecter et retrouver vos contenus sur vos différents appareils. Les mots de passe sont gérés par notre fournisseur d'authentification et ne nous sont jamais visibles.",
            "Nous conservons également la langue de lecture que vous choisissez et le fuseau horaire indiqué par votre appareil à l'inscription."
          ]
        },
        {
          heading: "Vos préférences",
          paragraphs: [
            "Les thèmes que vous sélectionnez pour la newsletter et pour les mini cas, le nombre d'articles souhaité par édition, et l'activation du parcours et des notifications. Ce sont eux qui déterminent le contenu de chaque édition."
          ]
        },
        {
          heading: "Ce que vous faites du contenu",
          bullets: [
            "Les contenus que vous avez ouverts ou terminés, pour afficher votre progression dans l'édition et signaler dans l'archive ce que vous avez lu.",
            "Vos réponses et votre score aux mini cas, pour pouvoir revoir un cas terminé et retrouver votre résultat sur un autre appareil.",
            "Votre parcours : l'objectif et le niveau choisis, les sessions préparées pour vous, et les évaluations que vous donnez à une session pour adapter la suivante.",
            "Les retours facultatifs que vous envoyez sur un contenu."
          ]
        },
        {
          heading: "Notifications",
          paragraphs: [
            "Si — et seulement si — vous activez les notifications, nous conservons un jeton push par appareil afin d'envoyer une notification par édition publiée : quatre par semaine, jamais un jour sans édition. Nous gardons la trace de l'appareil notifié pour chaque édition, afin que vous ne soyez jamais notifié deux fois pour la même.",
            "Désactiver les notifications désactive le jeton conservé. Désinstaller l'application le retire également dès la tentative d'envoi suivante."
          ]
        },
        {
          heading: "Analytique",
          paragraphs: [
            "L'application n'envoie de données d'usage que si un point de collecte a été configuré pour la version installée. Sans configuration, aucun événement ne quitte votre appareil. Ces événements ne contiennent jamais le contenu que vous lisez ni vos réponses aux mini cas."
          ]
        },
        {
          heading: "Ce que nous ne faisons pas",
          bullets: [
            "Aucune publicité, aucun identifiant publicitaire.",
            "Aucune vente ni location de données personnelles.",
            "Aucun suivi sur d'autres applications ou sites.",
            "Aucun profilage au-delà des préférences que vous définissez vous-même."
          ]
        },
        {
          heading: "Qui traite vos données",
          bullets: [
            "Supabase — base de données, authentification et stockage de tout ce qui est décrit ci-dessus.",
            "Service de notifications push Expo — remise de la notification d'édition, si vous l'avez activée.",
            "Notre chaîne éditoriale appelle des fournisseurs de modèles de langage pour rédiger les éditions. Elle leur transmet de la matière journalistique et des consignes éditoriales ; jamais votre compte, vos préférences ni vos réponses."
          ]
        },
        {
          heading: "Durée de conservation",
          paragraphs: [
            "Les données de compte, préférences, historique de lecture, résultats de mini cas et progression du parcours sont conservés tant que votre compte existe. Les enregistrements de remise des notifications sont conservés tant que le jeton de l'appareil existe.",
            "La suppression de votre compte efface l'ensemble immédiatement, comme décrit ci-dessous."
          ]
        },
        {
          heading: "Récupérer vos données, et les supprimer",
          paragraphs: [
            "Dans l'application, ouvrez Compte pour exporter une copie de vos données ou supprimer votre compte. La suppression est immédiate et définitive : profil, préférences, historique de lecture, résultats de mini cas, parcours et réglages de notification sont effacés, et vous êtes déconnecté.",
            "Vous pouvez également supprimer votre compte depuis ce site, sur /delete-account, sans installer l'application.",
            "Le contenu éditorial lui-même — articles, stories, cas — appartient au produit et n'est pas supprimé ; il cesse simplement d'être associé à vous."
          ]
        },
        {
          heading: "Nous contacter",
          paragraphs: [
            "Pour toute question relative à la confidentialité, utilisez le contact indiqué sur la page d'assistance."
          ]
        }
      ]
    },
    support: {
      eyebrow: "PersoNewsAP",
      title: "Assistance",
      intro: [
        "PersoNewsAP publie quatre éditions par semaine : lundi, mercredi, vendredi et dimanche. Chacune contient un brief newsletter, une business story et un mini cas. Le parcours avance à votre rythme, indépendamment du calendrier éditorial."
      ],
      sections: [
        {
          heading: "Connexion",
          bullets: [
            "Connectez-vous avec l'adresse e-mail utilisée à la création du compte.",
            "Mot de passe oublié ? Utilisez « Mot de passe oublié » sur l'écran de connexion ; un lien de réinitialisation vous est envoyé.",
            "Si le lien n'arrive pas, vérifiez vos indésirables avant d'en redemander un."
          ]
        },
        {
          heading: "Notifications",
          bullets: [
            "Une notification par édition publiée — quatre par semaine, rien un jour sans édition.",
            "Activez-les ou désactivez-les à tout moment dans Compte.",
            "Rien n'arrive le mardi, le jeudi ni le samedi : ce sont des jours sans édition par choix, pas un dysfonctionnement."
          ]
        },
        {
          heading: "Contenu et retours",
          bullets: [
            "Pas d'édition un jour donné ? Mardi, jeudi et samedi n'en comportent pas, par choix.",
            "Une édition pas encore arrivée s'affiche comme « en chemin » ; tirez pour actualiser.",
            "Chaque édition passée reste dans l'archive, consultable par titre et par date.",
            "Vous pouvez évaluer chaque contenu ; l'évaluation oriente ce qui vous sera proposé ensuite."
          ]
        },
        {
          heading: "Vos données",
          bullets: [
            "Exportez une copie de vos données depuis Compte.",
            "Supprimez votre compte depuis Compte, ou depuis ce site sur /delete-account.",
            "La suppression est immédiate et irréversible."
          ]
        }
      ],
      contactHeading: "Contact",
      contactConfigured: (email) =>
        `Écrivez à ${email}. Nous répondons sous quelques jours ouvrés.`,
      contactMissing:
        "Aucune adresse d'assistance n'est encore configurée pour ce déploiement. Définissez VITE_SUPPORT_EMAIL avant la soumission aux stores."
    },
    deleteAccount: {
      eyebrow: "PersoNewsAP",
      title: "Supprimer votre compte",
      intro: [
        "Cette action supprime votre compte PersoNewsAP et tout ce qui y est associé. Elle est immédiate et irréversible.",
        "Vous ne pouvez supprimer que le compte avec lequel vous êtes connecté."
      ],
      whatIsDeletedHeading: "Ce qui est supprimé",
      whatIsDeleted: [
        "Votre profil et votre connexion",
        "Vos préférences de thèmes et d'édition",
        "Votre historique de lecture et vos contenus terminés",
        "Vos réponses et scores aux mini cas",
        "Votre parcours, ses sessions et vos évaluations",
        "Vos réglages de notification et vos jetons push",
        "Le lien entre votre compte et chaque édition reçue"
      ],
      whatIsKeptHeading: "Ce qui n'est pas supprimé",
      whatIsKept: [
        "Le contenu éditorial lui-même — articles, business stories et mini cas. Il appartient au produit et est partagé par tous les lecteurs ; il cesse simplement d'être associé à vous."
      ],
      signedOutHeading: "Connectez-vous d'abord",
      signedOutBody:
        "Par sécurité, un compte ne peut être supprimé que par son titulaire. Connectez-vous, puis revenez sur cette page.",
      signInCta: "Se connecter",
      signedInAs: (email) => `Connecté en tant que ${email}`,
      confirmHeading: "Confirmation",
      confirmBody:
        "Après confirmation, votre compte et vos données sont effacés immédiatement et vous êtes déconnecté.",
      confirmCheckbox: "Je comprends que cette action est irréversible.",
      deleteCta: "Supprimer mon compte",
      deleting: "Suppression…",
      successHeading: "Votre compte a été supprimé",
      successBody:
        "Tout ce qui était associé à votre compte a été effacé. Vous pouvez créer un nouveau compte à tout moment.",
      errorHeading: "Votre compte n'a pas été supprimé",
      errorBody:
        "Une erreur est survenue. Votre compte est intact — veuillez réessayer.",
      unauthorized: "Votre session a expiré. Reconnectez-vous, puis réessayez.",
      notConfigured:
        "La suppression de compte n'est pas encore configurée pour ce déploiement. Utilisez l'écran Compte dans l'application, ou contactez l'assistance.",
      cancel: "Annuler"
    }
  }
};
