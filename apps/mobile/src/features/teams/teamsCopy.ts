import { localized } from "../../lib/i18n";
import type { ContentLanguage } from "../today/contentTypes";
import type { EditionStatus, LeaderboardRange } from "./leaderboard";

/**
 * Everything Teams says.
 *
 * Register note, because it is easy to lose: this is a private league between
 * friends, not a game. No exclamation marks, no "Great job", no streak
 * fireworks. The scoreboard is factual and the copy stays out of its way — the
 * same editorial voice the rest of the app uses, applied to a leaderboard.
 */
export function getTeamsCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        tabTitle: "Teams",
        eyebrow: "Teams",

        // Landing
        yourTeams: "Your Teams",
        join: "Join a Team",
        create: "Create a Team",
        emptyTitle: "No Teams yet",
        emptyBody:
          "A Team is a private league between friends. Join one with a code, or create your own.",
        members: (count: number) => (count === 1 ? "1 member" : `${count} members`),
        rank: (value: number) => `#${value}`,
        noRankYet: "Not ranked yet",
        editionProgress: (done: number, total: number) => `${done}/${total} finished`,

        // Profile gate
        profileTitle: "Choose your player name",
        profileBody:
          "Team-mates see this on the leaderboard. Nothing else in PersoNewsAP changes.",
        usernameLabel: "Username",
        usernamePlaceholder: "augustin",
        countryLabel: "Country",
        countryPlaceholder: "Search a country",
        avatarLabel: "Photo",
        avatarOptional: "Optional",
        avatarChoose: "Choose a photo",
        avatarRemove: "Remove",
        avatarTooLarge: "That photo is too large even after compression. Try another one.",
        avatarPermissionTitle: "Photo access is off",
        avatarPermissionBody:
          "PersoNewsAP needs access to your photo library to set an avatar. You can turn it on in Settings, or skip this step.",
        saveProfile: "Continue",
        savingProfile: "Saving",
        usernameTaken: "That name is taken. Try another one.",
        usernameTooShort: "At least 3 characters.",
        usernameTooLong: "At most 20 characters.",
        usernameInvalid: "Letters, digits, dot and underscore only.",
        usernameReserved: "That name is reserved.",
        usernameNotAllowed: "Choose another name.",
        countryRequired: "Choose a country.",

        // Create
        createTitle: "Create a Team",
        nameLabel: "Team name",
        namePlaceholder: "Loyola Finance",
        newsletterTopics: "Newsletter topics",
        miniCaseTopics: "Mini case topics",
        configNote: "Everyone in the Team plays the same topics.",
        contentEstimate: (articles: number, cases: number, questions: number) =>
          `${articles} articles, ${cases} mini cases — ${questions} questions per edition`,
        reviewTitle: "Review",
        createConfirm: "Create the Team",
        nameTooShort: "At least 2 characters.",
        nameTooLong: "At most 40 characters.",
        nameNotAllowed: "Choose another name.",

        // Invite
        inviteTitle: "Invite",
        inviteBody: "Share this code, or the link.",
        inviteCode: "Invite code",
        shareInvite: "Share",
        regenerate: "New code",
        regenerateHint: "The old code stops working",
        joinTitle: "Join a Team",
        joinBody: "Enter the code a friend sent you.",
        joinPlaceholder: "ABCD2345",
        joinConfirm: "Join",
        joinNotFound: "That code does not match a Team.",
        joinArchived: "That Team is no longer active.",
        joinAlreadyMember: "You are already in this Team.",
        joinFailed: "Could not join right now. Check your connection and try again.",

        // Eligibility
        startsNextEdition: "You join the leaderboard with the next edition.",
        startsNextEditionShort: "Starts next edition",

        // Detail
        currentEdition: "Current edition",
        myRank: "Your rank",
        myPoints: "Your points",
        myStreak: "Your streak",
        streakValue: (value: number) => (value === 1 ? "1 edition" : `${value} editions`),
        completion: "Completion",
        leaderboard: "Leaderboard",
        rangeEdition: "Current edition",
        rangeWeek: "This week",
        rangeAllTime: "All time",
        statusNotStarted: "Not started",
        statusInProgress: "In progress",
        statusCompleted: "Completed",
        you: "You",
        blockedMember: "Blocked",
        hiddenMember: "Player",

        // Owner
        manage: "Manage",
        editConfig: "Change topics",
        configTakesEffect: "Changes apply from the next edition.",
        removeMember: "Remove from Team",
        transferOwnership: "Make owner",
        archiveTeam: "Archive the Team",
        archiveConfirm:
          "The Team stops receiving editions. Past results stay available to everyone in it.",
        leaveTeam: "Leave the Team",
        leaveConfirm: "You keep the points you already earned. You stop receiving new editions.",
        ownerMustTransfer: "Make somebody else owner before leaving.",
        cancel: "Cancel",

        // Moderation
        report: "Report",
        reportProfile: "Report this profile",
        reportTeamName: "Report the Team name",
        block: "Block",
        unblock: "Unblock",
        blockExplains: "You stop seeing their name and photo. Their score is unchanged.",
        reportSent: "Thanks. We will look at it.",
        reportReasonUsername: "Inappropriate name",
        reportReasonAvatar: "Inappropriate photo",
        reportReasonTeamName: "Inappropriate Team name",
        reportReasonHarassment: "Harassment",
        reportReasonOther: "Something else",

        retry: "Try again",
        loadFailed: "Teams could not be loaded."
      },
      fr: {
        tabTitle: "Teams",
        eyebrow: "Teams",

        yourTeams: "Vos Teams",
        join: "Rejoindre une Team",
        create: "Créer une Team",
        emptyTitle: "Aucune Team",
        emptyBody:
          "Une Team est une ligue privée entre amis. Rejoignez-en une avec un code, ou créez la vôtre.",
        members: (count: number) => (count === 1 ? "1 membre" : `${count} membres`),
        rank: (value: number) => `n°${value}`,
        noRankYet: "Pas encore classé",
        editionProgress: (done: number, total: number) => `${done}/${total} terminé`,

        profileTitle: "Choisissez votre nom de joueur",
        profileBody:
          "Vos coéquipiers le verront dans le classement. Rien d'autre ne change dans PersoNewsAP.",
        usernameLabel: "Nom d'utilisateur",
        usernamePlaceholder: "augustin",
        countryLabel: "Pays",
        countryPlaceholder: "Rechercher un pays",
        avatarLabel: "Photo",
        avatarOptional: "Facultatif",
        avatarChoose: "Choisir une photo",
        avatarRemove: "Retirer",
        avatarTooLarge: "Cette photo reste trop lourde après compression. Essayez-en une autre.",
        avatarPermissionTitle: "Accès aux photos désactivé",
        avatarPermissionBody:
          "PersoNewsAP a besoin d'accéder à votre photothèque pour définir un avatar. Vous pouvez l'activer dans Réglages, ou passer cette étape.",
        saveProfile: "Continuer",
        savingProfile: "Enregistrement",
        usernameTaken: "Ce nom est déjà pris. Essayez-en un autre.",
        usernameTooShort: "3 caractères minimum.",
        usernameTooLong: "20 caractères maximum.",
        usernameInvalid: "Lettres, chiffres, point et tiret bas uniquement.",
        usernameReserved: "Ce nom est réservé.",
        usernameNotAllowed: "Choisissez un autre nom.",
        countryRequired: "Choisissez un pays.",

        createTitle: "Créer une Team",
        nameLabel: "Nom de la Team",
        namePlaceholder: "Loyola Finance",
        newsletterTopics: "Sujets newsletter",
        miniCaseTopics: "Sujets mini cas",
        configNote: "Tout le monde dans la Team joue les mêmes sujets.",
        contentEstimate: (articles: number, cases: number, questions: number) =>
          `${articles} articles, ${cases} mini cas — ${questions} questions par édition`,
        reviewTitle: "Récapitulatif",
        createConfirm: "Créer la Team",
        nameTooShort: "2 caractères minimum.",
        nameTooLong: "40 caractères maximum.",
        nameNotAllowed: "Choisissez un autre nom.",

        inviteTitle: "Inviter",
        inviteBody: "Partagez ce code, ou le lien.",
        inviteCode: "Code d'invitation",
        shareInvite: "Partager",
        regenerate: "Nouveau code",
        regenerateHint: "L'ancien code cesse de fonctionner",
        joinTitle: "Rejoindre une Team",
        joinBody: "Saisissez le code qu'un ami vous a envoyé.",
        joinPlaceholder: "ABCD2345",
        joinConfirm: "Rejoindre",
        joinNotFound: "Ce code ne correspond à aucune Team.",
        joinArchived: "Cette Team n'est plus active.",
        joinAlreadyMember: "Vous êtes déjà dans cette Team.",
        joinFailed: "Impossible de rejoindre pour le moment. Vérifiez votre connexion.",

        startsNextEdition: "Vous entrez au classement à la prochaine édition.",
        startsNextEditionShort: "Démarre à la prochaine édition",

        currentEdition: "Édition en cours",
        myRank: "Votre rang",
        myPoints: "Vos points",
        myStreak: "Votre série",
        streakValue: (value: number) => (value === 1 ? "1 édition" : `${value} éditions`),
        completion: "Progression",
        leaderboard: "Classement",
        rangeEdition: "Édition en cours",
        rangeWeek: "Cette semaine",
        rangeAllTime: "Depuis le début",
        statusNotStarted: "Pas commencé",
        statusInProgress: "En cours",
        statusCompleted: "Terminé",
        you: "Vous",
        blockedMember: "Bloqué",
        hiddenMember: "Joueur",

        manage: "Gérer",
        editConfig: "Changer les sujets",
        configTakesEffect: "Les changements s'appliquent à partir de la prochaine édition.",
        removeMember: "Retirer de la Team",
        transferOwnership: "Nommer propriétaire",
        archiveTeam: "Archiver la Team",
        archiveConfirm:
          "La Team ne reçoit plus d'éditions. Les résultats passés restent visibles par ses membres.",
        leaveTeam: "Quitter la Team",
        leaveConfirm:
          "Vous conservez les points déjà gagnés. Vous ne recevez plus les nouvelles éditions.",
        ownerMustTransfer: "Nommez quelqu'un d'autre propriétaire avant de partir.",
        cancel: "Annuler",

        report: "Signaler",
        reportProfile: "Signaler ce profil",
        reportTeamName: "Signaler le nom de la Team",
        block: "Bloquer",
        unblock: "Débloquer",
        blockExplains: "Vous ne voyez plus son nom ni sa photo. Son score est inchangé.",
        reportSent: "Merci. Nous allons regarder.",
        reportReasonUsername: "Nom inapproprié",
        reportReasonAvatar: "Photo inappropriée",
        reportReasonTeamName: "Nom de Team inapproprié",
        reportReasonHarassment: "Harcèlement",
        reportReasonOther: "Autre chose",

        retry: "Réessayer",
        loadFailed: "Impossible de charger les Teams."
      }
    },
    language
  );
}

export function statusLabel(
  status: EditionStatus,
  copy: ReturnType<typeof getTeamsCopy>
): string {
  if (status === "completed") {
    return copy.statusCompleted;
  }

  return status === "in_progress" ? copy.statusInProgress : copy.statusNotStarted;
}

export function rangeLabel(
  range: LeaderboardRange,
  copy: ReturnType<typeof getTeamsCopy>
): string {
  if (range === "week") {
    return copy.rangeWeek;
  }

  return range === "all_time" ? copy.rangeAllTime : copy.rangeEdition;
}
