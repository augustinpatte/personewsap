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
          "A name and a country. Team-mates see them on the leaderboard, and nothing else in PersoNewsAP changes. A photo is optional, and you can add or remove it whenever you like.",
        usernameLabel: "Username",
        usernamePlaceholder: "augustin",
        countryLabel: "Country",
        countryPlaceholder: "Search a country",
        avatarLabel: "Photo",
        avatarChoose: "Choose a photo",
        avatarRemove: "Remove",
        avatarTooLarge: "That photo is too large even after compression. Try another one.",
        avatarPermissionTitle: "Photo access is off",
        avatarPermissionBody:
          "PersoNewsAP needs your photo library to set a player photo. Turn it on in Settings to continue.",
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
        //
        // Names the member an action would act on, for VoiceOver only: the
        // visible button stays one short verb, because four of them under every
        // card is what keeps the roster readable.
        actionFor: (action: string, member: string) => `${action}: ${member}`,
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


        // Profile, continued
        avatarOptional: "Optional",
        avatarChange: "Change photo",
        avatarHelp: "A square photo, resized on your phone before it is sent.",
        avatarPreparing: "Preparing the photo",
        avatarUploading: "Sending the photo",
        avatarFailed: "That photo could not be prepared. Try another one.",
        avatarPermissionOpenSettings: "Open Settings",
        avatarPermissionRetry: "Try again",
        countryChange: "Change",
        countryNoResults: "No country matches that.",
        countryMoreResults: (count: number) =>
          count === 1 ? "1 more — keep typing" : `${count} more — keep typing`,
        countrySelected: "Selected country",
        profileNeeds: "Teams needs a name and a country.",
        avatarRemoved: "Photo removed.",
        teamPhotoLabel: "Team photo",
        teamPhotoHelp: "Optional. Only members of this Team can see it.",
        teamPhotoChoose: "Add a Team photo",
        teamPhotoChange: "Change the Team photo",
        teamPhotoRemove: "Remove the Team photo",
        teamPhotoSaved: "Team photo updated.",

        // Create, continued
        createIntro: "You choose the topics. Everybody in the Team plays the same ones.",
        newsletterTopicsHelp: "Pick topics, then how many articles each one contributes.",
        miniCaseTopicsHelp: "Mini cases everybody in the Team plays.",
        articlesCount: (count: number) => (count === 1 ? "1 article" : "2 articles"),
        articlesTotal: (count: number) => (count === 1 ? "1 article" : `${count} articles`),
        gamesRequired: "Choose at least one newsletter topic or one mini case topic.",
        topicsChosen: (count: number) => (count === 1 ? "1 topic" : `${count} topics`),
        noTopicsChosen: "None yet",
        nameNotSet: "Not set yet",
        selected: "Selected",
        createdTitle: "Team created",
        startsNextEditionCreated: "Your Team starts scoring with the next edition.",
        effectiveFrom: (date: string) => `From the edition of ${date}`,

        // Create, guided setup
        setupStep: (current: number, total: number) => `Step ${current} of ${total}`,
        setupBack: "Back",
        setupContinue: "Continue",
        setupTemplateTitle: "What does your Team want to follow?",
        setupTemplateBody: "Pick a starting point. You can change everything afterward.",
        setupScratchTitle: "Build from scratch",
        setupScratchBody: "Choose every topic yourself.",
        setupIntensityTitle: "How much do you want to play?",
        setupIntensityBody: "You can change this later too.",
        setupRecommended: "Recommended",
        setupRecommendedForYou: "Recommended for you",
        setupSeparateFromPersonal: "Team topics are separate from your personal interests.",
        setupPreviewTitle: "You're ready",
        setupPreviewBody: "This is what your Team will play. You can change these choices later.",
        setupTopicsLabel: "Topics",
        setupMiniCasesLabel: "Mini cases",
        setupPerEdition: "Per edition",
        setupEditionShape: (articles: number, miniCases: number) =>
          [
            articles > 0 ? (articles === 1 ? "1 article" : `${articles} articles`) : null,
            miniCases > 0 ? (miniCases === 1 ? "1 mini case" : `${miniCases} mini cases`) : null
          ]
            .filter(Boolean)
            .join(" · "),
        setupCustomize: "Customize",
        setupCustomizeTitle: "Customize your Team",
        setupCustomizeIntro: "Start from the recommendation and change anything you like.",
        setupBackToRecommendation: "Back to the recommendation",
        setupSelectedPreset: (preset: string, intensity: string) => `${preset} · ${intensity}`,
        intensities: {
          chill: { name: "Chill", body: "A small, easy routine." },
          regular: { name: "Regular", body: "Balanced for most Teams." },
          intensive: { name: "Intensive", body: "More coverage and more questions." }
        },
        presets: {
          finance: { name: "Finance", body: "Markets, companies and the forces moving money." },
          business: { name: "Business", body: "Companies, markets and the decisions behind them." },
          tech_ai: { name: "Tech & AI", body: "AI, software and emerging technology." },
          law: { name: "Law", body: "Rules, institutions and the decisions that shape markets." },
          medicine: { name: "Medicine", body: "Health, pharma and medical innovation." },
          engineering: { name: "Engineering", body: "Industry, energy and how things get built." },
          sport_business: {
            name: "Sports Business",
            body: "The business behind clubs, leagues and athletes."
          },
          culture_media: {
            name: "Culture & Media",
            body: "Entertainment, platforms, creators and media economics."
          },
          balanced: { name: "Balanced", body: "A mix of the major PersoNewsAP topics." }
        },

        // Manage, start from a preset
        presetStart: "Start from a preset",
        presetManageBody:
          "Pick a starting point. It replaces the topics below. Nothing is saved until you tap Save.",
        presetReplace: "Replace the topics below",
        presetCancel: "Cancel",
        presetReplaceConfirmTitle: "Replace the topics?",
        presetReplaceConfirmBody:
          "The topics below will be replaced by this preset. Nothing is saved until you tap Save, and saved changes apply from the next edition.",
        presetReplaceConfirm: "Replace",
        presetApplied: "Preset applied below. Tap Save the topics to keep it.",

        // Invite, continued
        inviteCopy: "Copy the code",
        inviteCopied: "Copied",
        inviteShareMessage: (name: string, code: string) =>
          `Join my PersoNewsAP Team "${name}". Invite code: ${code}`,
        inviteDisable: "Turn the code off",
        inviteEnable: "Turn the code on",
        inviteDisabledState: "The code is off. Nobody can join with it.",
        inviteOpenState: "Anybody with the code can join.",
        inviteRotated: "New code created. The old one stopped working.",
        openTeam: "Open the Team",

        // Join, continued
        joinCodeLabel: "Invite code",
        joinHint: "Eight characters. Upper or lower case, it does not matter.",
        joinTooShort: "A code is eight characters.",
        joinedTitle: "You are in",

        // Detail, continued
        statusStartsNextEdition: "Starts next edition",
        membersTitle: "Members",
        viewMembers: "Members",
        teamArchived: "This Team is archived.",
        teamArchivedBody: "It receives no new editions. Past results stay available.",

        // Manage, continued
        manageTitle: "Manage the Team",
        manageOwnerOnly: "Only the owner can manage this Team.",
        renameSave: "Save the name",
        renameSaved: "Name updated.",
        saveConfig: "Save the topics",
        configSaved: "Topics updated. They apply from the next edition.",
        roleOwner: "Owner",
        roleMember: "Member",
        removeMemberConfirm: (name: string) =>
          `Remove ${name} from the Team? The points they already earned stay in the past standings.`,
        transferConfirmBody: (name: string) =>
          `Make ${name} the owner? You become an ordinary member, and only they can hand it back.`,
        transferDone: "Ownership transferred.",
        archiveTitle: "Archive the Team",
        leaveTitle: "Leave the Team",
        leaveAsOwnerAlone: "You are alone in this Team, so leaving archives it.",
        confirm: "Confirm",
        memberSince: (date: string) => `Member since ${date}`,

        // Account
        editProfile: "Edit player profile",
        editProfileTitle: "Player profile",
        editProfileBody: "Your photo, name and country, as team-mates see them.",
        profileSaved: "Profile updated.",
        save: "Save",

        notOwner: "Only the owner can do that.",
        actionFailed: "That did not work. Check your connection and try again.",

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
          "Un nom et un pays. Vos coéquipiers les voient dans le classement, et rien d'autre ne change dans PersoNewsAP. La photo est facultative, et vous pouvez l'ajouter ou la retirer quand vous voulez.",
        usernameLabel: "Nom d'utilisateur",
        usernamePlaceholder: "augustin",
        countryLabel: "Pays",
        countryPlaceholder: "Rechercher un pays",
        avatarLabel: "Photo",
        avatarChoose: "Choisir une photo",
        avatarRemove: "Retirer",
        avatarTooLarge: "Cette photo reste trop lourde après compression. Essayez-en une autre.",
        avatarPermissionTitle: "Accès aux photos désactivé",
        avatarPermissionBody:
          "PersoNewsAP a besoin de votre photothèque pour définir une photo de joueur. Activez l'accès dans Réglages pour continuer.",
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

        actionFor: (action: string, member: string) => `${action} : ${member}`,
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


        avatarOptional: "Facultatif",
        avatarChange: "Changer la photo",
        avatarHelp: "Une photo carrée, redimensionnée sur votre téléphone avant l'envoi.",
        avatarPreparing: "Préparation de la photo",
        avatarUploading: "Envoi de la photo",
        avatarFailed: "Cette photo n'a pas pu être préparée. Essayez-en une autre.",
        avatarPermissionOpenSettings: "Ouvrir les Réglages",
        avatarPermissionRetry: "Réessayer",
        countryChange: "Changer",
        countryNoResults: "Aucun pays ne correspond.",
        countryMoreResults: (count: number) =>
          count === 1 ? "1 autre — continuez à taper" : `${count} autres — continuez à taper`,
        countrySelected: "Pays sélectionné",
        profileNeeds: "Teams demande un nom et un pays.",
        avatarRemoved: "Photo retirée.",
        teamPhotoLabel: "Photo de la Team",
        teamPhotoHelp: "Facultative. Seuls les membres de cette Team la voient.",
        teamPhotoChoose: "Ajouter une photo de Team",
        teamPhotoChange: "Changer la photo de Team",
        teamPhotoRemove: "Retirer la photo de Team",
        teamPhotoSaved: "Photo de la Team mise à jour.",

        createIntro: "Vous choisissez les sujets. Toute la Team joue les mêmes.",
        newsletterTopicsHelp: "Choisissez les sujets, puis le nombre d'articles de chacun.",
        miniCaseTopicsHelp: "Les mini cas que toute la Team joue.",
        articlesCount: (count: number) => (count === 1 ? "1 article" : "2 articles"),
        articlesTotal: (count: number) => (count === 1 ? "1 article" : `${count} articles`),
        gamesRequired: "Choisissez au moins un sujet newsletter ou un sujet mini cas.",
        topicsChosen: (count: number) => (count === 1 ? "1 sujet" : `${count} sujets`),
        noTopicsChosen: "Aucun pour l'instant",
        nameNotSet: "Pas encore choisi",
        selected: "Sélectionné",
        createdTitle: "Team créée",
        startsNextEditionCreated: "Les scores commenceront à la prochaine édition.",
        effectiveFrom: (date: string) => `À partir de l'édition du ${date}`,

        // Création, parcours guidé
        setupStep: (current: number, total: number) => `Étape ${current} sur ${total}`,
        setupBack: "Retour",
        setupContinue: "Continuer",
        setupTemplateTitle: "Que veut suivre votre Team ?",
        setupTemplateBody: "Choisissez un point de départ. Vous pourrez tout modifier ensuite.",
        setupScratchTitle: "Partir de zéro",
        setupScratchBody: "Choisissez chaque sujet vous-même.",
        setupIntensityTitle: "À quel rythme voulez-vous jouer ?",
        setupIntensityBody: "Vous pourrez aussi le changer plus tard.",
        setupRecommended: "Recommandé",
        setupRecommendedForYou: "Recommandé pour vous",
        setupSeparateFromPersonal: "Les sujets de votre Team n'affectent pas vos préférences personnelles.",
        setupPreviewTitle: "C'est prêt",
        setupPreviewBody:
          "Voici ce que votre Team va jouer. Vous pourrez modifier ces choix plus tard.",
        setupTopicsLabel: "Sujets",
        setupMiniCasesLabel: "Mini cas",
        setupPerEdition: "Par édition",
        setupEditionShape: (articles: number, miniCases: number) =>
          [
            articles > 0 ? (articles === 1 ? "1 article" : `${articles} articles`) : null,
            miniCases > 0 ? `${miniCases} mini cas` : null
          ]
            .filter(Boolean)
            .join(" · "),
        setupCustomize: "Personnaliser",
        setupCustomizeTitle: "Personnaliser votre Team",
        setupCustomizeIntro: "Partez de la recommandation et changez ce que vous voulez.",
        setupBackToRecommendation: "Revenir à la recommandation",
        setupSelectedPreset: (preset: string, intensity: string) => `${preset} · ${intensity}`,
        intensities: {
          chill: { name: "Tranquille", body: "Une petite routine, facile à tenir." },
          regular: { name: "Régulier", body: "Le bon équilibre pour la plupart des Teams." },
          intensive: { name: "Intensif", body: "Plus de sujets et plus de questions." }
        },
        presets: {
          finance: { name: "Finance", body: "Les marchés, les entreprises et les capitaux qui les font bouger." },
          business: { name: "Business", body: "Les entreprises, les marchés et leurs décisions." },
          tech_ai: { name: "Tech & IA", body: "IA, logiciels et technologies émergentes." },
          law: { name: "Droit", body: "Règles, institutions et décisions qui pèsent sur les marchés." },
          medicine: { name: "Médecine", body: "Santé, pharma et innovation médicale." },
          engineering: { name: "Ingénierie", body: "Industrie, énergie et la façon dont on construit." },
          sport_business: {
            name: "Business du sport",
            body: "L'économie des clubs, des ligues et des athlètes."
          },
          culture_media: {
            name: "Culture & médias",
            body: "Divertissement, plateformes, créateurs et économie des médias."
          },
          balanced: { name: "Équilibré", body: "Un peu de chaque grand sujet de PersoNewsAP." }
        },

        // Gérer, partir d'un modèle
        presetStart: "Partir d'un modèle",
        presetManageBody:
          "Choisissez un point de départ. Il remplace les sujets ci-dessous. Rien n'est enregistré tant que vous n'avez pas appuyé sur Enregistrer.",
        presetReplace: "Remplacer les sujets ci-dessous",
        presetCancel: "Annuler",
        presetReplaceConfirmTitle: "Remplacer les sujets ?",
        presetReplaceConfirmBody:
          "Les sujets ci-dessous seront remplacés par ce modèle. Rien n'est enregistré tant que vous n'avez pas appuyé sur Enregistrer, et les changements enregistrés s'appliquent à partir de la prochaine édition.",
        presetReplaceConfirm: "Remplacer",
        presetApplied: "Modèle appliqué ci-dessous. Appuyez sur Enregistrer les sujets pour le garder.",

        inviteCopy: "Copier le code",
        inviteCopied: "Copié",
        inviteShareMessage: (name: string, code: string) =>
          `Rejoins ma Team PersoNewsAP « ${name} ». Code d'invitation : ${code}`,
        inviteDisable: "Désactiver le code",
        inviteEnable: "Réactiver le code",
        inviteDisabledState: "Le code est désactivé. Personne ne peut rejoindre avec.",
        inviteOpenState: "Toute personne avec le code peut rejoindre.",
        inviteRotated: "Nouveau code créé. L'ancien ne fonctionne plus.",
        openTeam: "Ouvrir la Team",

        joinCodeLabel: "Code d'invitation",
        joinHint: "Huit caractères. Majuscules ou minuscules, cela n'a pas d'importance.",
        joinTooShort: "Un code fait huit caractères.",
        joinedTitle: "Vous êtes dans la Team",

        statusStartsNextEdition: "Démarre à la prochaine édition",
        membersTitle: "Membres",
        viewMembers: "Membres",
        teamArchived: "Cette Team est archivée.",
        teamArchivedBody: "Elle ne reçoit plus d'éditions. Les résultats passés restent visibles.",

        manageTitle: "Gérer la Team",
        manageOwnerOnly: "Seul le propriétaire peut gérer cette Team.",
        renameSave: "Enregistrer le nom",
        renameSaved: "Nom mis à jour.",
        saveConfig: "Enregistrer les sujets",
        configSaved: "Sujets mis à jour. Ils s'appliquent à partir de la prochaine édition.",
        roleOwner: "Propriétaire",
        roleMember: "Membre",
        removeMemberConfirm: (name: string) =>
          `Retirer ${name} de la Team ? Les points déjà gagnés restent dans les classements passés.`,
        transferConfirmBody: (name: string) =>
          `Nommer ${name} propriétaire ? Vous devenez membre ordinaire, et seul ce membre pourra vous rendre le rôle.`,
        transferDone: "Propriété transférée.",
        archiveTitle: "Archiver la Team",
        leaveTitle: "Quitter la Team",
        leaveAsOwnerAlone: "Vous êtes seul dans cette Team : la quitter l'archive.",
        confirm: "Confirmer",
        memberSince: (date: string) => `Membre depuis le ${date}`,

        editProfile: "Modifier le profil joueur",
        editProfileTitle: "Profil joueur",
        editProfileBody: "Votre photo, votre nom et votre pays, tels que vos coéquipiers les voient.",
        profileSaved: "Profil mis à jour.",
        save: "Enregistrer",

        notOwner: "Seul le propriétaire peut faire cela.",
        actionFailed: "Cela n'a pas fonctionné. Vérifiez votre connexion et réessayez.",

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
  // "Starts next edition" is not a degree of progress and must never collapse
  // into "Not started": a reader who joined mid-edition was never given a
  // question, and accusing them of not having answered one is a lie the row
  // tells about a rule the product chose.
  if (status === "starts_next_edition") {
    return copy.statusStartsNextEdition;
  }

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
