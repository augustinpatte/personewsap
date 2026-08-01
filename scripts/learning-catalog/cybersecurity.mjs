// Cybersecurity concepts. Every step stays strictly defensive and educational.
// Shared base: 9 steps eligible for the three orientations.
// cyber_foundations: threats, identity, cryptography, essential security rules.
// cyber_network_defense: networks, monitoring, vulnerabilities, incidents.
// cyber_app_cloud: web and API security, permissions, cloud, secure design.
export const domain = {
  id: "cybersecurity",
  objectives: ["cyber_foundations", "cyber_network_defense", "cyber_app_cloud"],
  steps: [
    {
      key: "cia_triad",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Confidentialité, intégrité, disponibilité",
        summary: "Classer un incident selon la propriété de sécurité qu'il met en défaut.",
        goals: [
          "Définir les trois propriétés avec un exemple chacune.",
          "Classer trois incidents réels dans la bonne catégorie."
        ],
        tutor:
          "Fais classer trois incidents dans les trois propriétés, puis demande lequel serait le plus grave pour un hôpital et pourquoi.",
        contexts: [
          "un fichier client copié par un tiers",
          "un montant de facture modifié dans une base",
          "un site inaccessible pendant une journée"
        ]
      },
      en: {
        title: "Confidentiality, integrity, availability",
        summary: "Classify an incident by the security property it breaks.",
        goals: [
          "Define the three properties with one example each.",
          "Classify three real incidents into the right category."
        ],
        tutor:
          "Have the student classify three incidents across the three properties, then ask which would hurt a hospital most and why.",
        contexts: [
          "a customer file copied by a third party",
          "an invoice amount altered in a database",
          "a site unreachable for a day"
        ]
      }
    },
    {
      key: "threat_model",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Ce qu'est un modèle de menace",
        summary: "Nommer ce que l'on protège, contre qui et jusqu'où avant de choisir des protections.",
        goals: [
          "Formuler un modèle de menace en trois questions.",
          "Expliquer pourquoi une protection sans menace identifiée est inutile."
        ],
        tutor:
          "Fais formuler le modèle de menace d'un journaliste puis celui d'une boutique en ligne, et demande ce qui change entre les deux.",
        contexts: [
          "un journaliste protégeant ses sources",
          "une boutique en ligne et ses données de paiement",
          "un particulier qui craint surtout le vol de son téléphone"
        ]
      },
      en: {
        title: "What a threat model is",
        summary: "Name what you protect, against whom and how far, before choosing protections.",
        goals: [
          "Frame a threat model in three questions.",
          "Explain why a protection without an identified threat is useless."
        ],
        tutor:
          "Have the student frame the threat model of a journalist then of an online shop, and ask what changes between them.",
        contexts: [
          "a journalist protecting sources",
          "an online shop and its payment data",
          "an individual mainly worried about phone theft"
        ]
      }
    },
    {
      key: "authentication_authorization",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Authentification et autorisation",
        summary: "Séparer la preuve d'identité de la décision d'accorder un accès.",
        goals: [
          "Distinguer les deux notions sur un cas concret.",
          "Repérer un système qui authentifie sans autoriser correctement."
        ],
        tutor:
          "Fais analyser un cas où un utilisateur authentifié accède à des données qui ne le concernent pas, puis demande quelle étape a échoué.",
        contexts: [
          "un badge d'immeuble qui ouvre tous les étages",
          "un employé connecté qui voit les dossiers d'un collègue",
          "un compte administrateur utilisé pour un usage courant"
        ]
      },
      en: {
        title: "Authentication and authorisation",
        summary: "Separate proving identity from deciding to grant access.",
        goals: [
          "Tell the two notions apart on a concrete case.",
          "Spot a system that authenticates but authorises badly."
        ],
        tutor:
          "Have the student analyse a case where a logged-in user reaches data that is not theirs, then ask which step failed.",
        contexts: [
          "a building badge that opens every floor",
          "a signed-in employee seeing a colleague's files",
          "an administrator account used for daily work"
        ]
      }
    },
    {
      key: "password_reuse_risk",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Pourquoi un mot de passe unique par service",
        summary: "Comprendre comment une fuite sur un site compromet tous les comptes partageant le même mot de passe.",
        goals: [
          "Décrire l'enchaînement d'une fuite vers d'autres comptes.",
          "Expliquer ce qu'un gestionnaire de mots de passe résout."
        ],
        tutor:
          "Fais décrire ce qu'un attaquant fait d'une liste de couples adresse et mot de passe issue d'une fuite ancienne.",
        contexts: [
          "une fuite d'un forum abandonné depuis cinq ans",
          "une même adresse e-mail utilisée partout",
          "un gestionnaire de mots de passe installé sur deux appareils"
        ]
      },
      en: {
        title: "Why every service needs its own password",
        summary: "Understand how one site's breach compromises every account sharing that password.",
        goals: [
          "Describe the chain from a breach to other accounts.",
          "Explain what a password manager solves."
        ],
        tutor:
          "Have the student describe what an attacker does with a list of address and password pairs from an old breach.",
        contexts: [
          "a breach of a forum abandoned five years ago",
          "the same email address used everywhere",
          "a password manager installed on two devices"
        ]
      }
    },
    {
      key: "phishing_recognition",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Reconnaître une tentative d'hameçonnage",
        summary: "Repérer les signaux d'un message frauduleux et adopter un réflexe de vérification hors canal.",
        goals: [
          "Citer quatre signaux d'alerte dans un message.",
          "Décrire la vérification à effectuer avant toute action."
        ],
        tutor:
          "Fais analyser un message urgent demandant une action immédiate, puis demande quelle vérification indépendante effectuer.",
        contexts: [
          "un message annonçant la suspension d'un compte",
          "une demande de virement urgente attribuée à un dirigeant",
          "un lien affichant un nom de domaine presque correct"
        ]
      },
      en: {
        title: "Recognising a phishing attempt",
        summary: "Spot the signals of a fraudulent message and build an out-of-band verification reflex.",
        goals: [
          "Name four warning signals in a message.",
          "Describe the verification to run before acting."
        ],
        tutor:
          "Have the student analyse an urgent message demanding immediate action, then ask which independent check to run.",
        contexts: [
          "a message announcing an account suspension",
          "an urgent transfer request attributed to an executive",
          "a link showing an almost-correct domain name"
        ]
      }
    },
    {
      key: "attack_surface",
      objectives: "*",
      stage: 2,
      fr: {
        title: "La surface d'attaque",
        summary: "Inventorier les points d'entrée exposés et réduire ceux qui ne servent à personne.",
        goals: [
          "Lister les points d'entrée d'un système donné.",
          "Identifier un service exposé sans usage réel."
        ],
        tutor:
          "Fais lister les points d'entrée d'une petite entreprise, puis demande lequel peut être fermé sans gêner personne.",
        contexts: [
          "une imprimante accessible depuis Internet",
          "un ancien site de campagne resté en ligne",
          "un accès distant ouvert pour un prestataire parti"
        ]
      },
      en: {
        title: "The attack surface",
        summary: "Inventory the exposed entry points and remove the ones nobody uses.",
        goals: [
          "List the entry points of a given system.",
          "Identify an exposed service with no real use."
        ],
        tutor:
          "Have the student list the entry points of a small company, then ask which can be closed without inconveniencing anyone.",
        contexts: [
          "a printer reachable from the internet",
          "an old campaign website still online",
          "a remote access left open for a departed contractor"
        ]
      }
    },
    {
      key: "defense_in_depth",
      objectives: "*",
      stage: 2,
      fr: {
        title: "La défense en profondeur",
        summary: "Empiler des protections indépendantes pour qu'une seule faille ne suffise pas.",
        goals: [
          "Décrire trois couches de protection indépendantes.",
          "Expliquer pourquoi une seule barrière est insuffisante."
        ],
        tutor:
          "Fais décrire les couches qui séparent un attaquant d'une base de données, puis demande laquelle manque le plus souvent.",
        contexts: [
          "un attaquant qui a déjà obtenu un mot de passe valide",
          "un poste de travail infecté dans un réseau interne",
          "une sauvegarde stockée hors du réseau principal"
        ]
      },
      en: {
        title: "Defence in depth",
        summary: "Stack independent protections so that one failure is never enough.",
        goals: [
          "Describe three independent protection layers.",
          "Explain why a single barrier is insufficient."
        ],
        tutor:
          "Have the student describe the layers separating an attacker from a database, then ask which one is most often missing.",
        contexts: [
          "an attacker who already holds a valid password",
          "an infected workstation inside an internal network",
          "a backup stored outside the main network"
        ]
      }
    },
    {
      key: "patch_management",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Pourquoi les mises à jour comptent",
        summary: "Comprendre la course entre la publication d'un correctif et son exploitation par des attaquants.",
        goals: [
          "Expliquer ce que la publication d'un correctif révèle.",
          "Proposer un délai de correction selon la criticité."
        ],
        tutor:
          "Fais expliquer pourquoi une faille devient plus dangereuse après publication du correctif, puis demande un délai raisonnable d'application.",
        contexts: [
          "un correctif publié pour un serveur exposé",
          "un logiciel maintenu mais jamais redémarré",
          "un équipement dont le fabricant a cessé le support"
        ]
      },
      en: {
        title: "Why updates matter",
        summary: "Understand the race between a patch being published and attackers exploiting it.",
        goals: [
          "Explain what publishing a patch reveals.",
          "Propose a remediation delay based on criticality."
        ],
        tutor:
          "Have the student explain why a flaw gets more dangerous after its patch is published, then propose a reasonable rollout delay.",
        contexts: [
          "a patch published for an exposed server",
          "software that is maintained but never restarted",
          "a device whose vendor ended support"
        ]
      }
    },
    {
      key: "risk_prioritization",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Prioriser un risque : probabilité et impact",
        summary: "Classer des risques par produit probabilité-impact plutôt que par crainte subjective.",
        goals: [
          "Positionner trois risques sur une matrice probabilité-impact.",
          "Justifier de ne pas traiter un risque immédiatement."
        ],
        tutor:
          "Fais positionner trois risques sur une matrice, puis demande lequel traiter en premier avec un budget limité.",
        contexts: [
          "un risque rare mais catastrophique",
          "un incident fréquent au coût faible",
          "un budget de sécurité limité à un seul chantier"
        ]
      },
      en: {
        title: "Prioritising a risk: likelihood and impact",
        summary: "Rank risks by likelihood times impact rather than by subjective fear.",
        goals: [
          "Place three risks on a likelihood-impact matrix.",
          "Justify not addressing a risk immediately."
        ],
        tutor:
          "Have the student place three risks on a matrix, then ask which to treat first with a limited budget.",
        contexts: [
          "a rare but catastrophic risk",
          "a frequent incident with low cost",
          "a security budget limited to one project"
        ]
      }
    },

    {
      key: "authentication_factors",
      objectives: ["cyber_foundations"],
      stage: 1,
      fr: {
        title: "Les facteurs d'authentification",
        summary: "Distinguer ce que l'on sait, ce que l'on possède et ce que l'on est, et combiner deux catégories.",
        goals: [
          "Classer trois moyens d'authentification par catégorie.",
          "Expliquer pourquoi deux facteurs de la même catégorie n'ajoutent rien."
        ],
        tutor:
          "Fais classer trois moyens d'authentification, puis demande pourquoi deux mots de passe ne valent pas une double authentification.",
        contexts: [
          "un code reçu sur une application dédiée",
          "une empreinte digitale sur un téléphone",
          "une question secrète dont la réponse est publique"
        ]
      },
      en: {
        title: "Authentication factors",
        summary: "Tell apart something you know, own and are, and combine two different categories.",
        goals: [
          "Sort three authentication means by category.",
          "Explain why two factors of the same category add nothing."
        ],
        tutor:
          "Have the student sort three authentication means, then ask why two passwords do not amount to two-factor authentication.",
        contexts: [
          "a code received in a dedicated app",
          "a fingerprint on a phone",
          "a secret question whose answer is public"
        ]
      }
    },
    {
      key: "symmetric_asymmetric",
      objectives: ["cyber_foundations"],
      stage: 2,
      fr: {
        title: "Chiffrement symétrique et asymétrique",
        summary: "Comparer les deux familles sur la distribution des clés et sur la vitesse.",
        goals: [
          "Dire quel problème l'asymétrique résout que le symétrique ne résout pas.",
          "Expliquer pourquoi les deux sont utilisés ensemble."
        ],
        tutor:
          "Fais expliquer comment deux inconnus établissent un secret commun, puis demande pourquoi la suite des échanges revient au symétrique.",
        contexts: [
          "deux personnes qui ne se sont jamais rencontrées",
          "un fichier chiffré sur un disque dur personnel",
          "un échange de clés au début d'une connexion sécurisée"
        ]
      },
      en: {
        title: "Symmetric and asymmetric encryption",
        summary: "Compare both families on key distribution and on speed.",
        goals: [
          "Say which problem asymmetric solves that symmetric does not.",
          "Explain why both are used together."
        ],
        tutor:
          "Have the student explain how two strangers establish a shared secret, then ask why the rest of the exchange returns to symmetric.",
        contexts: [
          "two people who have never met",
          "a file encrypted on a personal hard drive",
          "a key exchange at the start of a secure connection"
        ]
      }
    },
    {
      key: "password_hashing",
      objectives: ["cyber_foundations"],
      stage: 2,
      fr: {
        title: "Pourquoi les mots de passe sont hachés et salés",
        summary: "Comprendre le stockage d'une empreinte lente et salée plutôt que du mot de passe lui-même.",
        goals: [
          "Expliquer le rôle du sel contre les tables précalculées.",
          "Dire pourquoi une fonction lente est préférable ici."
        ],
        tutor:
          "Fais expliquer ce qu'un attaquant obtient en volant une table de mots de passe correctement hachés et salés.",
        contexts: [
          "une base de comptes utilisateurs exfiltrée",
          "deux utilisateurs ayant choisi le même mot de passe",
          "un service qui envoie le mot de passe en clair par e-mail"
        ]
      },
      en: {
        title: "Why passwords are hashed and salted",
        summary: "Understand storing a slow, salted fingerprint rather than the password itself.",
        goals: [
          "Explain the role of the salt against precomputed tables.",
          "Say why a slow function is preferable here."
        ],
        tutor:
          "Have the student explain what an attacker gets from stealing a correctly hashed and salted password table.",
        contexts: [
          "an exfiltrated user account database",
          "two users who picked the same password",
          "a service emailing the password in clear text"
        ]
      }
    },
    {
      key: "certificates_and_trust",
      objectives: ["cyber_foundations"],
      stage: 3,
      fr: {
        title: "Certificats et autorités de certification",
        summary: "Comprendre la chaîne de confiance qui relie un certificat de site à une racine installée.",
        goals: [
          "Décrire la chaîne de confiance d'un certificat de site.",
          "Dire ce qu'un certificat prouve et ce qu'il ne prouve pas."
        ],
        tutor:
          "Fais dérouler la chaîne de confiance d'un certificat, puis demande ce qu'un certificat valide ne garantit pas sur le site visité.",
        contexts: [
          "un site de phishing muni d'un certificat valide",
          "une autorité racine installée par défaut dans un navigateur",
          "un certificat expiré depuis deux jours"
        ]
      },
      en: {
        title: "Certificates and certificate authorities",
        summary: "Understand the trust chain linking a site certificate to an installed root.",
        goals: [
          "Describe the trust chain of a site certificate.",
          "Say what a certificate proves and what it does not."
        ],
        tutor:
          "Have the student walk a certificate's trust chain, then ask what a valid certificate does not guarantee about the site.",
        contexts: [
          "a phishing site holding a valid certificate",
          "a root authority preinstalled in a browser",
          "a certificate expired two days ago"
        ]
      }
    },
    {
      key: "social_engineering",
      objectives: ["cyber_foundations"],
      stage: 3,
      fr: {
        title: "L'ingénierie sociale",
        summary: "Comprendre les leviers psychologiques exploités et les procédures qui y résistent.",
        goals: [
          "Nommer trois leviers psychologiques utilisés contre un employé.",
          "Concevoir une procédure qui résiste à la pression."
        ],
        tutor:
          "Fais concevoir une procédure de validation des virements qui résiste à un appel urgent d'un supposé dirigeant.",
        contexts: [
          "un appel urgent attribué à la direction",
          "un prestataire inconnu qui réclame un accès immédiat",
          "une demande formulée juste avant un week-end"
        ]
      },
      en: {
        title: "Social engineering",
        summary: "Understand the psychological levers exploited and the procedures that resist them.",
        goals: [
          "Name three psychological levers used against an employee.",
          "Design a procedure that resists pressure."
        ],
        tutor:
          "Have the student design a payment validation procedure that resists an urgent call from a supposed executive.",
        contexts: [
          "an urgent call attributed to management",
          "an unknown contractor demanding immediate access",
          "a request made right before a weekend"
        ]
      }
    },
    {
      key: "malware_families",
      objectives: ["cyber_foundations"],
      stage: 3,
      fr: {
        title: "Les familles de logiciels malveillants",
        summary: "Classer les menaces par objectif afin de choisir la protection et la réaction adaptées.",
        goals: [
          "Associer trois familles à leur objectif principal.",
          "Choisir la protection prioritaire selon la famille."
        ],
        tutor:
          "Fais associer trois familles à leur objectif, puis demande quelle protection prioritaire découle de chacune.",
        contexts: [
          "des fichiers d'entreprise soudain illisibles",
          "un poste qui envoie des données vers l'extérieur la nuit",
          "un ordinateur exceptionnellement lent depuis une semaine"
        ]
      },
      en: {
        title: "Malware families",
        summary: "Classify threats by objective in order to pick the right protection and reaction.",
        goals: [
          "Match three families to their main objective.",
          "Choose the priority protection for each family."
        ],
        tutor:
          "Have the student match three families to their objective, then ask which priority protection follows from each.",
        contexts: [
          "company files suddenly unreadable",
          "a machine sending data outward at night",
          "a computer unusually slow for a week"
        ]
      }
    },
    {
      key: "backup_strategy",
      objectives: ["cyber_foundations"],
      stage: 3,
      fr: {
        title: "La règle de sauvegarde 3-2-1",
        summary: "Concevoir des sauvegardes qui survivent à un incident touchant tout le réseau.",
        goals: [
          "Énoncer la règle et l'appliquer à un cas concret.",
          "Expliquer pourquoi une sauvegarde doit être testée et isolée."
        ],
        tutor:
          "Fais concevoir un plan de sauvegarde pour une PME, puis demande ce qui se passe si les sauvegardes sont accessibles depuis le réseau.",
        contexts: [
          "une PME dont les serveurs sont chiffrés par une attaque",
          "une sauvegarde jamais restaurée depuis deux ans",
          "un disque de sauvegarde branché en permanence"
        ]
      },
      en: {
        title: "The 3-2-1 backup rule",
        summary: "Design backups that survive an incident affecting the whole network.",
        goals: [
          "State the rule and apply it to a concrete case.",
          "Explain why a backup must be tested and isolated."
        ],
        tutor:
          "Have the student design a backup plan for a small company, then ask what happens if backups are reachable from the network.",
        contexts: [
          "a company whose servers are encrypted by an attack",
          "a backup never restored in two years",
          "a backup drive permanently plugged in"
        ]
      }
    },
    {
      key: "key_management",
      objectives: ["cyber_foundations"],
      stage: 4,
      fr: {
        title: "La gestion des clés",
        summary: "Organiser génération, stockage, rotation et révocation des clés sur toute leur durée de vie.",
        goals: [
          "Décrire le cycle de vie complet d'une clé.",
          "Expliquer ce qu'une rotation limite comme dégât."
        ],
        tutor:
          "Fais décrire le cycle de vie d'une clé, puis demande ce qu'il faut faire immédiatement quand une clé est suspectée compromise.",
        contexts: [
          "une clé de chiffrement en service depuis six ans",
          "un développeur qui quitte l'entreprise",
          "une clé retrouvée dans un dépôt de code public"
        ]
      },
      en: {
        title: "Key management",
        summary: "Organise generation, storage, rotation and revocation of keys across their lifetime.",
        goals: [
          "Describe the full life cycle of a key.",
          "Explain what damage rotation limits."
        ],
        tutor:
          "Have the student describe a key's life cycle, then ask what to do immediately when a key is suspected compromised.",
        contexts: [
          "an encryption key in service for six years",
          "a developer leaving the company",
          "a key found in a public code repository"
        ]
      }
    },
    {
      key: "digital_signatures",
      objectives: ["cyber_foundations"],
      stage: 4,
      fr: {
        title: "Signature numérique et non-répudiation",
        summary: "Distinguer ce qu'une signature garantit sur l'origine et sur l'intégrité d'un document.",
        goals: [
          "Dire ce qu'une signature valide établit exactement.",
          "Expliquer ce qu'une clé volée retire à cette garantie."
        ],
        tutor:
          "Fais expliquer ce qu'une signature valide prouve, puis demande ce qui change si la clé privée a été copiée trois mois plus tôt.",
        contexts: [
          "un contrat signé électroniquement",
          "une mise à jour logicielle signée par son éditeur",
          "une clé privée copiée à l'insu de son détenteur"
        ]
      },
      en: {
        title: "Digital signatures and non-repudiation",
        summary: "Separate what a signature guarantees about origin and about document integrity.",
        goals: [
          "Say what a valid signature exactly establishes.",
          "Explain what a stolen key removes from that guarantee."
        ],
        tutor:
          "Have the student explain what a valid signature proves, then ask what changes if the private key was copied three months earlier.",
        contexts: [
          "a contract signed electronically",
          "a software update signed by its publisher",
          "a private key copied without its owner knowing"
        ]
      }
    },
    {
      key: "data_minimization",
      objectives: ["cyber_foundations"],
      stage: 4,
      fr: {
        title: "Minimisation des données",
        summary: "Réduire l'impact d'une fuite en ne collectant et ne conservant que le nécessaire.",
        goals: [
          "Identifier les données collectées sans usage réel.",
          "Fixer une durée de conservation justifiée."
        ],
        tutor:
          "Fais examiner un formulaire d'inscription et supprimer les champs inutiles, puis demande une durée de conservation justifiée.",
        contexts: [
          "un formulaire demandant la date de naissance sans raison",
          "des journaux conservés depuis cinq ans",
          "une copie de pièce d'identité gardée après vérification"
        ]
      },
      en: {
        title: "Data minimisation",
        summary: "Reduce the impact of a breach by collecting and keeping only what is needed.",
        goals: [
          "Identify data collected with no real use.",
          "Set a justified retention period."
        ],
        tutor:
          "Have the student review a signup form and drop useless fields, then set a justified retention period.",
        contexts: [
          "a form asking for a birth date with no reason",
          "logs kept for five years",
          "an identity document copy kept after verification"
        ]
      }
    },
    {
      key: "security_awareness",
      objectives: ["cyber_foundations"],
      stage: 4,
      fr: {
        title: "Construire une sensibilisation efficace",
        summary: "Concevoir une sensibilisation mesurable qui change les comportements plutôt que la culpabilité.",
        goals: [
          "Définir un indicateur de progrès mesurable.",
          "Expliquer pourquoi punir le signalement dégrade la sécurité."
        ],
        tutor:
          "Fais définir deux indicateurs de sensibilisation, puis demande ce qui arrive si les employés craignent de signaler une erreur.",
        contexts: [
          "un employé qui n'ose pas signaler un clic malheureux",
          "une campagne de test d'hameçonnage interne",
          "une formation annuelle suivie sans effet mesurable"
        ]
      },
      en: {
        title: "Building effective security awareness",
        summary: "Design measurable awareness that changes behaviour rather than assigning blame.",
        goals: [
          "Define a measurable progress indicator.",
          "Explain why punishing reports degrades security."
        ],
        tutor:
          "Have the student define two awareness indicators, then ask what happens when employees fear reporting a mistake.",
        contexts: [
          "an employee afraid to report an unlucky click",
          "an internal phishing simulation campaign",
          "an annual training with no measurable effect"
        ]
      }
    },
    {
      key: "zero_trust",
      objectives: ["cyber_foundations"],
      stage: 5,
      fr: {
        title: "Le modèle zero trust",
        summary: "Remplacer la confiance accordée au réseau interne par une vérification à chaque accès.",
        goals: [
          "Expliquer ce que le modèle abandonne comme hypothèse.",
          "Décrire ce qui est vérifié à chaque requête."
        ],
        tutor:
          "Fais expliquer pourquoi la position réseau ne suffit plus à accorder un accès, puis demande ce qu'il faut vérifier à la place.",
        contexts: [
          "un poste connecté au réseau interne mais compromis",
          "un salarié en télétravail depuis un lieu public",
          "un prestataire disposant d'un accès temporaire"
        ]
      },
      en: {
        title: "The zero trust model",
        summary: "Replace trust granted to the internal network with verification at every access.",
        goals: [
          "Explain which assumption the model abandons.",
          "Describe what is verified on each request."
        ],
        tutor:
          "Have the student explain why network position no longer justifies access, then ask what must be verified instead.",
        contexts: [
          "a machine on the internal network but compromised",
          "an employee working remotely from a public place",
          "a contractor holding temporary access"
        ]
      }
    },
    {
      key: "threat_intelligence",
      objectives: ["cyber_foundations"],
      stage: 5,
      fr: {
        title: "Le renseignement sur les menaces",
        summary: "Transformer une information sur des attaquants en décision de défense concrète.",
        goals: [
          "Distinguer une information exploitable d'un simple indicateur.",
          "Traduire un rapport de menace en action de défense."
        ],
        tutor:
          "Fais traduire un rapport décrivant une campagne d'attaque en trois actions défensives concrètes et priorisées.",
        contexts: [
          "un rapport public décrivant une campagne visant un secteur",
          "une liste d'indicateurs techniques déjà obsolètes",
          "un signalement partagé entre entreprises d'un même secteur"
        ]
      },
      en: {
        title: "Threat intelligence",
        summary: "Turn information about attackers into a concrete defensive decision.",
        goals: [
          "Tell actionable intelligence apart from a bare indicator.",
          "Translate a threat report into a defensive action."
        ],
        tutor:
          "Have the student turn a report describing an attack campaign into three concrete, prioritised defensive actions.",
        contexts: [
          "a public report describing a campaign against one sector",
          "a list of technical indicators already outdated",
          "a warning shared between companies of one industry"
        ]
      }
    },
    {
      key: "supply_chain_risk",
      objectives: ["cyber_foundations"],
      stage: 5,
      fr: {
        title: "Le risque fournisseur",
        summary: "Évaluer ce qu'un prestataire compromis permettrait d'atteindre dans le système d'information.",
        goals: [
          "Cartographier les accès accordés à des tiers.",
          "Définir une exigence de sécurité contractuelle utile."
        ],
        tutor:
          "Fais cartographier les accès d'un prestataire de maintenance, puis demande ce qu'un attaquant obtiendrait en le compromettant.",
        contexts: [
          "un prestataire de maintenance disposant d'un accès permanent",
          "un outil externe intégré dans toutes les pages du site",
          "une bibliothèque logicielle maintenue par une seule personne"
        ]
      },
      en: {
        title: "Supplier risk",
        summary: "Assess what a compromised supplier would let an attacker reach in your systems.",
        goals: [
          "Map the accesses granted to third parties.",
          "Define a useful contractual security requirement."
        ],
        tutor:
          "Have the student map a maintenance supplier's access, then ask what an attacker would obtain by compromising it.",
        contexts: [
          "a maintenance supplier holding permanent access",
          "an external tool embedded in every page of the site",
          "a software library maintained by a single person"
        ]
      }
    },
    {
      key: "security_governance",
      objectives: ["cyber_foundations"],
      stage: 5,
      fr: {
        title: "Politique de sécurité et responsabilité",
        summary: "Écrire des règles applicables et désigner qui décide et qui assume un risque accepté.",
        goals: [
          "Distinguer une règle applicable d'une intention vague.",
          "Identifier qui doit formellement accepter un risque résiduel."
        ],
        tutor:
          "Fais réécrire une règle vague en règle vérifiable, puis demande qui doit signer l'acceptation d'un risque résiduel.",
        contexts: [
          "une politique qui interdit tout sans exception praticable",
          "un risque accepté sans trace écrite",
          "une exception accordée oralement à une équipe"
        ]
      },
      en: {
        title: "Security policy and accountability",
        summary: "Write applicable rules and name who decides and who owns an accepted risk.",
        goals: [
          "Tell an applicable rule apart from a vague intention.",
          "Identify who must formally accept a residual risk."
        ],
        tutor:
          "Have the student rewrite a vague rule into a checkable one, then ask who must sign off a residual risk.",
        contexts: [
          "a policy forbidding everything with no workable exception",
          "an accepted risk with no written trace",
          "an exception granted verbally to one team"
        ]
      }
    },

    {
      key: "ports_and_services",
      objectives: ["cyber_network_defense"],
      stage: 1,
      fr: {
        title: "Ports et services exposés",
        summary: "Comprendre qu'un service à l'écoute sur un port est une porte visible depuis le réseau.",
        goals: [
          "Expliquer ce qu'un port ouvert signifie concrètement.",
          "Identifier un service qui ne devrait pas être exposé."
        ],
        tutor:
          "Fais lister les services qu'un serveur web doit exposer, puis demande lesquels doivent rester accessibles uniquement en interne.",
        contexts: [
          "un serveur web exposant aussi sa base de données",
          "un service d'administration accessible depuis Internet",
          "un port ouvert par une application installée par défaut"
        ]
      },
      en: {
        title: "Ports and exposed services",
        summary: "Understand that a service listening on a port is a door visible from the network.",
        goals: [
          "Explain what an open port concretely means.",
          "Identify a service that should not be exposed."
        ],
        tutor:
          "Have the student list the services a web server must expose, then ask which should stay internal only.",
        contexts: [
          "a web server also exposing its database",
          "an administration service reachable from the internet",
          "a port opened by a default-installed application"
        ]
      }
    },
    {
      key: "firewall_rules",
      objectives: ["cyber_network_defense"],
      stage: 2,
      fr: {
        title: "Ce que fait un pare-feu",
        summary: "Écrire des règles de filtrage qui refusent par défaut et n'autorisent que le nécessaire.",
        goals: [
          "Rédiger un jeu de règles à refus par défaut.",
          "Expliquer pourquoi l'ordre des règles compte."
        ],
        tutor:
          "Fais rédiger trois règles pour un serveur web, puis demande ce qu'une règle d'autorisation large placée en premier annule.",
        contexts: [
          "un serveur web accessible uniquement en HTTPS",
          "une règle temporaire jamais retirée",
          "un accès d'administration limité à quelques adresses"
        ]
      },
      en: {
        title: "What a firewall does",
        summary: "Write filtering rules that deny by default and allow only what is needed.",
        goals: [
          "Write a deny-by-default rule set.",
          "Explain why rule order matters."
        ],
        tutor:
          "Have the student write three rules for a web server, then ask what a broad allow rule placed first cancels.",
        contexts: [
          "a web server reachable over HTTPS only",
          "a temporary rule never removed",
          "administration access limited to a few addresses"
        ]
      }
    },
    {
      key: "vpn_scope",
      objectives: ["cyber_network_defense"],
      stage: 2,
      fr: {
        title: "Ce qu'un VPN protège et ne protège pas",
        summary: "Délimiter la protection d'un tunnel chiffré et ce qui reste exposé au-delà.",
        goals: [
          "Dire ce qu'un VPN cache et à qui.",
          "Citer une menace qu'un VPN ne réduit pas."
        ],
        tutor:
          "Fais lister ce qu'un VPN protège sur un réseau public, puis demande ce qu'il ne change absolument pas.",
        contexts: [
          "une connexion depuis le réseau Wi-Fi d'un aéroport",
          "un site consulté qui suit l'utilisateur avec un compte",
          "un poste déjà infecté qui se connecte au VPN"
        ]
      },
      en: {
        title: "What a VPN protects and does not protect",
        summary: "Delimit what an encrypted tunnel protects and what stays exposed beyond it.",
        goals: [
          "Say what a VPN hides and from whom.",
          "Name a threat a VPN does not reduce."
        ],
        tutor:
          "Have the student list what a VPN protects on a public network, then ask what it changes nothing about.",
        contexts: [
          "a connection from an airport Wi-Fi network",
          "a visited site tracking the user through an account",
          "an already infected machine connecting to the VPN"
        ]
      }
    },
    {
      key: "network_segmentation",
      objectives: ["cyber_network_defense"],
      stage: 3,
      fr: {
        title: "La segmentation réseau",
        summary: "Découper un réseau pour qu'un poste compromis n'atteigne pas les systèmes critiques.",
        goals: [
          "Proposer un découpage en trois zones justifiées.",
          "Expliquer ce que la segmentation ralentit chez un attaquant."
        ],
        tutor:
          "Fais découper le réseau d'une PME en trois zones, puis demande ce qu'un poste compromis peut encore atteindre.",
        contexts: [
          "un poste d'accueil sur le même réseau que la comptabilité",
          "des caméras connectées au réseau bureautique",
          "un environnement de test relié à la production"
        ]
      },
      en: {
        title: "Network segmentation",
        summary: "Split a network so a compromised machine cannot reach critical systems.",
        goals: [
          "Propose a justified split into three zones.",
          "Explain what segmentation slows down for an attacker."
        ],
        tutor:
          "Have the student split a small company network into three zones, then ask what a compromised machine can still reach.",
        contexts: [
          "a reception desk machine on the accounting network",
          "connected cameras on the office network",
          "a test environment linked to production"
        ]
      }
    },
    {
      key: "detection_vs_prevention",
      objectives: ["cyber_network_defense"],
      stage: 3,
      fr: {
        title: "Détection et prévention d'intrusion",
        summary: "Arbitrer entre alerter et bloquer selon le coût d'un blocage injustifié.",
        goals: [
          "Comparer détection et blocage sur le risque de faux positif.",
          "Choisir le mode adapté à un service donné."
        ],
        tutor:
          "Fais choisir entre alerter et bloquer pour un service de paiement, puis demande le coût d'un blocage injustifié.",
        contexts: [
          "un service de paiement bloqué à tort en pleine journée",
          "un trafic inhabituel détecté la nuit",
          "une signature d'attaque déclenchée par un usage légitime"
        ]
      },
      en: {
        title: "Intrusion detection and prevention",
        summary: "Arbitrate between alerting and blocking based on the cost of a wrong block.",
        goals: [
          "Compare detection and blocking on false positive risk.",
          "Choose the right mode for a given service."
        ],
        tutor:
          "Have the student choose between alerting and blocking for a payment service, then ask the cost of a wrong block.",
        contexts: [
          "a payment service wrongly blocked mid-day",
          "unusual traffic detected at night",
          "an attack signature triggered by legitimate usage"
        ]
      }
    },
    {
      key: "log_collection",
      objectives: ["cyber_network_defense"],
      stage: 3,
      fr: {
        title: "Collecte et centralisation des journaux",
        summary: "Choisir quoi journaliser, où le conserver et comment garder les traces exploitables.",
        goals: [
          "Lister les journaux indispensables à une enquête.",
          "Expliquer pourquoi les journaux doivent quitter la machine."
        ],
        tutor:
          "Fais lister les journaux nécessaires pour reconstituer une intrusion, puis demande ce qu'un attaquant efface en premier.",
        contexts: [
          "une machine dont les journaux ont été effacés",
          "des horloges désynchronisées entre deux serveurs",
          "une rétention de journaux limitée à sept jours"
        ]
      },
      en: {
        title: "Log collection and centralisation",
        summary: "Choose what to log, where to keep it and how to keep the traces usable.",
        goals: [
          "List the logs essential to an investigation.",
          "Explain why logs must leave the machine."
        ],
        tutor:
          "Have the student list the logs needed to reconstruct an intrusion, then ask what an attacker erases first.",
        contexts: [
          "a machine whose logs were wiped",
          "clocks out of sync between two servers",
          "a log retention limited to seven days"
        ]
      }
    },
    {
      key: "vulnerability_scanning",
      objectives: ["cyber_network_defense"],
      stage: 3,
      fr: {
        title: "Le scan de vulnérabilités",
        summary: "Interpréter un rapport de scan et prioriser sans se noyer dans les scores bruts.",
        goals: [
          "Interpréter un score de gravité en tenant compte de l'exposition.",
          "Justifier de traiter une faille moyenne avant une faille critique."
        ],
        tutor:
          "Fais prioriser trois vulnérabilités dont la plus grave concerne un serveur interne isolé, et demande de justifier l'ordre.",
        contexts: [
          "une faille critique sur une machine sans accès réseau",
          "une faille moyenne sur le serveur public principal",
          "un rapport contenant huit cents lignes"
        ]
      },
      en: {
        title: "Vulnerability scanning",
        summary: "Interpret a scan report and prioritise without drowning in raw scores.",
        goals: [
          "Interpret a severity score accounting for exposure.",
          "Justify fixing a medium flaw before a critical one."
        ],
        tutor:
          "Have the student prioritise three vulnerabilities where the worst affects an isolated internal server, and justify the order.",
        contexts: [
          "a critical flaw on a machine with no network access",
          "a medium flaw on the main public server",
          "a report containing eight hundred lines"
        ]
      }
    },
    {
      key: "alert_correlation",
      objectives: ["cyber_network_defense"],
      stage: 4,
      fr: {
        title: "La corrélation d'alertes",
        summary: "Relier des événements isolés pour distinguer un incident réel d'un bruit permanent.",
        goals: [
          "Construire une règle de corrélation à partir de deux événements.",
          "Expliquer le coût opérationnel d'un excès d'alertes."
        ],
        tutor:
          "Fais construire une règle reliant un échec de connexion répété à une connexion réussie inhabituelle, et demande son taux de faux positifs attendu.",
        contexts: [
          "cent échecs de connexion suivis d'une réussite",
          "une équipe qui reçoit trois mille alertes par jour",
          "une connexion réussie depuis deux pays en dix minutes"
        ]
      },
      en: {
        title: "Alert correlation",
        summary: "Link isolated events to tell a real incident apart from permanent noise.",
        goals: [
          "Build a correlation rule from two events.",
          "Explain the operational cost of alert overload."
        ],
        tutor:
          "Have the student build a rule linking repeated login failures to an unusual success, and ask its expected false positive rate.",
        contexts: [
          "a hundred login failures followed by a success",
          "a team receiving three thousand alerts a day",
          "a successful login from two countries in ten minutes"
        ]
      }
    },
    {
      key: "incident_response_phases",
      objectives: ["cyber_network_defense"],
      stage: 4,
      fr: {
        title: "Les phases d'une réponse à incident",
        summary: "Ordonner détection, confinement, éradication, rétablissement et retour d'expérience.",
        goals: [
          "Ordonner les phases et dire ce que chacune vise.",
          "Expliquer pourquoi éteindre un serveur trop vite peut nuire."
        ],
        tutor:
          "Fais ordonner les phases sur un cas concret, puis demande pourquoi le confinement précède l'éradication.",
        contexts: [
          "un serveur compromis découvert un vendredi soir",
          "une décision d'isoler une machine sans l'éteindre",
          "un retour d'expérience rédigé deux semaines après"
        ]
      },
      en: {
        title: "The phases of incident response",
        summary: "Order detection, containment, eradication, recovery and lessons learned.",
        goals: [
          "Order the phases and state what each aims at.",
          "Explain why powering a server off too early can hurt."
        ],
        tutor:
          "Have the student order the phases on a concrete case, then ask why containment comes before eradication.",
        contexts: [
          "a compromised server discovered on a Friday evening",
          "a decision to isolate a machine without powering it off",
          "a lessons-learned report written two weeks later"
        ]
      }
    },
    {
      key: "availability_attacks",
      objectives: ["cyber_network_defense"],
      stage: 4,
      fr: {
        title: "Absorber une saturation de service",
        summary: "Préparer les protections qui maintiennent un service disponible pendant une saturation.",
        goals: [
          "Citer trois protections qui absorbent une charge anormale.",
          "Expliquer pourquoi la préparation compte plus que la réaction."
        ],
        tutor:
          "Fais lister les protections à mettre en place avant un pic anormal, puis demande lesquelles ne peuvent plus être activées en urgence.",
        contexts: [
          "un site public saturé pendant une opération commerciale",
          "un service dépendant d'un seul fournisseur d'accès",
          "un contrat de mitigation signé après l'incident"
        ]
      },
      en: {
        title: "Absorbing a service saturation",
        summary: "Prepare the protections that keep a service available during a saturation event.",
        goals: [
          "Name three protections that absorb abnormal load.",
          "Explain why preparation matters more than reaction."
        ],
        tutor:
          "Have the student list the protections to set up before an abnormal spike, then ask which cannot be enabled in a hurry.",
        contexts: [
          "a public site saturated during a sales event",
          "a service depending on a single access provider",
          "a mitigation contract signed after the incident"
        ]
      }
    },
    {
      key: "endpoint_detection",
      objectives: ["cyber_network_defense"],
      stage: 4,
      fr: {
        title: "La détection sur les postes",
        summary: "Comprendre ce qu'un agent observe sur un poste et ce qu'il ne peut pas voir.",
        goals: [
          "Citer trois comportements suspects observables sur un poste.",
          "Expliquer les limites d'une détection par signature."
        ],
        tutor:
          "Fais citer trois comportements suspects sur un poste, puis demande pourquoi la détection par signature seule ne suffit plus.",
        contexts: [
          "un outil d'administration légitime utilisé anormalement",
          "un document bureautique qui lance un script",
          "un logiciel jamais vu ailleurs dans le parc"
        ]
      },
      en: {
        title: "Endpoint detection",
        summary: "Understand what an agent observes on a machine and what it cannot see.",
        goals: [
          "Name three suspicious behaviours observable on a machine.",
          "Explain the limits of signature-based detection."
        ],
        tutor:
          "Have the student name three suspicious behaviours on a machine, then ask why signature detection alone no longer suffices.",
        contexts: [
          "a legitimate admin tool used abnormally",
          "an office document launching a script",
          "software never seen elsewhere in the fleet"
        ]
      }
    },
    {
      key: "threat_hunting",
      objectives: ["cyber_network_defense"],
      stage: 5,
      fr: {
        title: "La chasse aux menaces",
        summary: "Partir d'une hypothèse plutôt que d'une alerte pour chercher une compromission silencieuse.",
        goals: [
          "Formuler une hypothèse de chasse vérifiable dans les journaux.",
          "Dire ce qu'une chasse infructueuse apporte quand même."
        ],
        tutor:
          "Fais formuler une hypothèse de chasse vérifiable dans les journaux existants, puis demande ce que prouve un résultat négatif.",
        contexts: [
          "une compromission présente depuis six mois sans alerte",
          "une hypothèse fondée sur une technique d'attaque connue",
          "une recherche qui ne trouve finalement rien"
        ]
      },
      en: {
        title: "Threat hunting",
        summary: "Start from a hypothesis rather than an alert to look for a silent compromise.",
        goals: [
          "Frame a hunting hypothesis verifiable in the logs.",
          "Say what an unsuccessful hunt still brings."
        ],
        tutor:
          "Have the student frame a hunting hypothesis checkable in existing logs, then ask what a negative result proves.",
        contexts: [
          "a compromise present for six months with no alert",
          "a hypothesis based on a known attack technique",
          "a search that finds nothing in the end"
        ]
      }
    },
    {
      key: "forensic_timeline",
      objectives: ["cyber_network_defense"],
      stage: 5,
      fr: {
        title: "Reconstituer une chronologie d'incident",
        summary: "Assembler des traces de sources différentes en une chronologie fiable et datée.",
        goals: [
          "Ordonner des traces provenant de trois sources distinctes.",
          "Expliquer l'importance d'une référence de temps commune."
        ],
        tutor:
          "Fais reconstituer une chronologie à partir de trois sources aux horloges décalées, puis demande comment lever l'ambiguïté.",
        contexts: [
          "un pare-feu, un serveur et un poste aux horloges différentes",
          "une trace effacée sur une seule des trois sources",
          "un incident dont l'origine remonte à plusieurs semaines"
        ]
      },
      en: {
        title: "Reconstructing an incident timeline",
        summary: "Assemble traces from different sources into one reliable, timestamped timeline.",
        goals: [
          "Order traces coming from three distinct sources.",
          "Explain the importance of a shared time reference."
        ],
        tutor:
          "Have the student rebuild a timeline from three sources with skewed clocks, then ask how to resolve the ambiguity.",
        contexts: [
          "a firewall, a server and a workstation with different clocks",
          "a trace erased on only one of the three sources",
          "an incident whose origin goes back several weeks"
        ]
      }
    },
    {
      key: "joint_exercises",
      objectives: ["cyber_network_defense"],
      stage: 5,
      fr: {
        title: "L'exercice conjoint attaque-défense",
        summary: "Organiser un exercice autorisé où les défenseurs mesurent leur détection en temps réel.",
        goals: [
          "Définir le périmètre et les règles d'un exercice autorisé.",
          "Choisir les indicateurs de détection à mesurer."
        ],
        tutor:
          "Fais définir le périmètre, l'autorisation écrite et deux indicateurs de détection pour un exercice interne.",
        contexts: [
          "un exercice planifié avec autorisation écrite de la direction",
          "un délai moyen de détection mesuré pendant l'exercice",
          "une action d'exercice confondue avec une vraie attaque"
        ]
      },
      en: {
        title: "Joint attack-defence exercises",
        summary: "Organise an authorised exercise where defenders measure their detection in real time.",
        goals: [
          "Define the scope and rules of an authorised exercise.",
          "Choose the detection indicators to measure."
        ],
        tutor:
          "Have the student define the scope, the written authorisation and two detection indicators for an internal exercise.",
        contexts: [
          "an exercise planned with written management approval",
          "a mean detection time measured during the exercise",
          "an exercise action mistaken for a real attack"
        ]
      }
    },
    {
      key: "business_continuity",
      objectives: ["cyber_network_defense"],
      stage: 5,
      fr: {
        title: "Plan de continuité et reprise",
        summary: "Fixer une durée d'interruption et une perte de données acceptables, puis dimensionner en conséquence.",
        goals: [
          "Définir une durée d'interruption et une perte de données acceptables.",
          "Vérifier qu'un plan a été réellement testé."
        ],
        tutor:
          "Fais fixer une durée d'interruption acceptable pour un service critique, puis demande ce que cela impose aux sauvegardes.",
        contexts: [
          "un service de facturation arrêté quatre heures",
          "une reprise testée uniquement sur le papier",
          "des données perdues depuis la dernière sauvegarde nocturne"
        ]
      },
      en: {
        title: "Continuity and recovery planning",
        summary: "Set an acceptable outage duration and data loss, then size the plan accordingly.",
        goals: [
          "Define an acceptable outage duration and data loss.",
          "Check that a plan has actually been tested."
        ],
        tutor:
          "Have the student set an acceptable outage duration for a critical service, then ask what that imposes on backups.",
        contexts: [
          "a billing service down for four hours",
          "a recovery tested only on paper",
          "data lost since the last nightly backup"
        ]
      }
    },

    {
      key: "https_protection",
      objectives: ["cyber_app_cloud"],
      stage: 1,
      fr: {
        title: "Ce que HTTPS protège",
        summary: "Délimiter la protection du transport et ce qui reste visible ou vulnérable ailleurs.",
        goals: [
          "Dire ce qu'un tiers sur le réseau peut encore observer.",
          "Expliquer pourquoi HTTPS ne rend pas un site fiable."
        ],
        tutor:
          "Fais lister ce qu'un observateur du réseau voit encore malgré HTTPS, puis demande ce que le cadenas ne garantit pas.",
        contexts: [
          "une connexion à un site depuis un café",
          "un site frauduleux affichant un cadenas",
          "des données stockées en clair sur le serveur"
        ]
      },
      en: {
        title: "What HTTPS protects",
        summary: "Delimit transport protection and what stays visible or vulnerable elsewhere.",
        goals: [
          "Say what a third party on the network can still observe.",
          "Explain why HTTPS does not make a site trustworthy."
        ],
        tutor:
          "Have the student list what a network observer still sees despite HTTPS, then ask what the padlock does not guarantee.",
        contexts: [
          "a connection to a site from a café",
          "a fraudulent site displaying a padlock",
          "data stored in clear text on the server"
        ]
      }
    },
    {
      key: "input_validation",
      objectives: ["cyber_app_cloud"],
      stage: 2,
      fr: {
        title: "Valider les entrées côté serveur",
        summary: "Comprendre pourquoi toute validation faite dans le navigateur peut être contournée.",
        goals: [
          "Expliquer pourquoi une validation côté client ne protège pas.",
          "Définir une validation stricte pour un champ donné."
        ],
        tutor:
          "Fais expliquer comment une contrainte de formulaire peut être contournée, puis demande la validation serveur correspondante.",
        contexts: [
          "un champ de quantité limité à cent dans le formulaire",
          "un prix envoyé par le navigateur lors d'un achat",
          "un identifiant de commande modifié dans l'URL"
        ]
      },
      en: {
        title: "Validating input on the server",
        summary: "Understand why any validation done in the browser can be bypassed.",
        goals: [
          "Explain why client-side validation does not protect.",
          "Define a strict validation for a given field."
        ],
        tutor:
          "Have the student explain how a form constraint can be bypassed, then ask for the matching server-side validation.",
        contexts: [
          "a quantity field capped at a hundred in the form",
          "a price sent by the browser during a purchase",
          "an order identifier edited in the URL"
        ]
      }
    },
    {
      key: "secrets_management",
      objectives: ["cyber_app_cloud"],
      stage: 2,
      fr: {
        title: "Ne pas mettre de secret dans le code",
        summary: "Sortir les secrets du dépôt et prévoir leur rotation après une exposition.",
        goals: [
          "Citer trois endroits où un secret ne doit jamais figurer.",
          "Décrire la réaction à une clé publiée par erreur."
        ],
        tutor:
          "Fais décrire les actions à mener quand une clé d'API a été publiée dans un dépôt public il y a un mois.",
        contexts: [
          "une clé d'API laissée dans un fichier de configuration",
          "un mot de passe visible dans l'historique du dépôt",
          "un secret affiché dans les journaux d'une application"
        ]
      },
      en: {
        title: "Keeping secrets out of the code",
        summary: "Move secrets out of the repository and plan their rotation after exposure.",
        goals: [
          "Name three places a secret must never appear.",
          "Describe the reaction to a key published by mistake."
        ],
        tutor:
          "Have the student describe the actions to take when an API key was published in a public repository a month ago.",
        contexts: [
          "an API key left in a configuration file",
          "a password visible in the repository history",
          "a secret printed in an application's logs"
        ]
      }
    },
    {
      key: "sql_injection_defense",
      objectives: ["cyber_app_cloud"],
      stage: 3,
      fr: {
        title: "Se protéger de l'injection SQL",
        summary: "Séparer le code de la donnée grâce aux requêtes paramétrées plutôt qu'au filtrage de caractères.",
        goals: [
          "Expliquer pourquoi la concaténation de chaînes est dangereuse.",
          "Réécrire une requête vulnérable en requête paramétrée."
        ],
        tutor:
          "Fais réécrire une requête construite par concaténation en requête paramétrée, puis demande pourquoi filtrer les apostrophes ne suffit pas.",
        contexts: [
          "un formulaire de recherche interrogeant une base",
          "une page de connexion construisant sa requête à la main",
          "un filtre de caractères contourné par un encodage"
        ]
      },
      en: {
        title: "Defending against SQL injection",
        summary: "Separate code from data using parameterised queries rather than character filtering.",
        goals: [
          "Explain why string concatenation is dangerous.",
          "Rewrite a vulnerable query as a parameterised one."
        ],
        tutor:
          "Have the student rewrite a concatenated query as a parameterised one, then ask why filtering quotes is not enough.",
        contexts: [
          "a search form querying a database",
          "a login page building its query by hand",
          "a character filter bypassed through encoding"
        ]
      }
    },
    {
      key: "xss_defense",
      objectives: ["cyber_app_cloud"],
      stage: 3,
      fr: {
        title: "Se protéger du script intersite",
        summary: "Échapper les contenus fournis par les utilisateurs au moment de l'affichage.",
        goals: [
          "Expliquer ce qu'un contenu non échappé permet dans un navigateur.",
          "Choisir l'échappement adapté au contexte d'affichage."
        ],
        tutor:
          "Fais expliquer ce qui se passe quand un commentaire contenant du code est affiché tel quel, puis demande où appliquer l'échappement.",
        contexts: [
          "un commentaire affiché sur une page publique",
          "un nom d'utilisateur repris dans une page de profil",
          "un paramètre d'URL réaffiché dans un message d'erreur"
        ]
      },
      en: {
        title: "Defending against cross-site scripting",
        summary: "Escape user-supplied content at the moment it is rendered.",
        goals: [
          "Explain what unescaped content enables in a browser.",
          "Choose the escaping suited to the rendering context."
        ],
        tutor:
          "Have the student explain what happens when a comment containing code is displayed as-is, then ask where to apply escaping.",
        contexts: [
          "a comment displayed on a public page",
          "a username echoed on a profile page",
          "a URL parameter echoed in an error message"
        ]
      }
    },
    {
      key: "session_management",
      objectives: ["cyber_app_cloud"],
      stage: 3,
      fr: {
        title: "Gérer les sessions et les cookies",
        summary: "Protéger un jeton de session par ses attributs, sa durée et son renouvellement.",
        goals: [
          "Citer les attributs qui protègent un cookie de session.",
          "Expliquer pourquoi renouveler l'identifiant après connexion."
        ],
        tutor:
          "Fais lister les attributs d'un cookie de session sûr, puis demande ce qu'un vol de jeton permet malgré un bon mot de passe.",
        contexts: [
          "un jeton de session volé sur un poste partagé",
          "une session qui ne expire jamais",
          "un identifiant de session inchangé après connexion"
        ]
      },
      en: {
        title: "Managing sessions and cookies",
        summary: "Protect a session token through its attributes, its lifetime and its renewal.",
        goals: [
          "Name the attributes that protect a session cookie.",
          "Explain why the identifier is renewed after login."
        ],
        tutor:
          "Have the student list the attributes of a safe session cookie, then ask what a stolen token allows despite a strong password.",
        contexts: [
          "a session token stolen on a shared machine",
          "a session that never expires",
          "a session identifier unchanged after login"
        ]
      }
    },
    {
      key: "broken_access_control",
      objectives: ["cyber_app_cloud"],
      stage: 3,
      fr: {
        title: "Les défauts de contrôle d'accès",
        summary: "Vérifier les droits côté serveur pour chaque objet demandé, pas seulement à l'affichage.",
        goals: [
          "Repérer un accès direct à un objet non contrôlé.",
          "Décrire le contrôle à effectuer à chaque requête."
        ],
        tutor:
          "Fais analyser une URL où changer un identifiant affiche la facture d'un autre client, puis demande le contrôle manquant.",
        contexts: [
          "un identifiant de facture incrémenté dans l'URL",
          "un bouton masqué mais dont l'appel reste possible",
          "un rôle vérifié uniquement à l'affichage du menu"
        ]
      },
      en: {
        title: "Broken access control",
        summary: "Check permissions on the server for every requested object, not only at display time.",
        goals: [
          "Spot a direct object access with no check.",
          "Describe the check to run on every request."
        ],
        tutor:
          "Have the student analyse a URL where changing an identifier shows another customer's invoice, then ask for the missing check.",
        contexts: [
          "an invoice identifier incremented in the URL",
          "a hidden button whose call still works",
          "a role checked only when rendering the menu"
        ]
      }
    },
    {
      key: "delegated_access",
      objectives: ["cyber_app_cloud"],
      stage: 4,
      fr: {
        title: "Déléguer un accès sans partager son mot de passe",
        summary: "Comprendre l'échange de jetons à portée limitée et révocable entre trois parties.",
        goals: [
          "Décrire les trois rôles impliqués dans une délégation d'accès.",
          "Expliquer ce qu'une portée limitée empêche."
        ],
        tutor:
          "Fais décrire les trois rôles d'une délégation d'accès, puis demande ce qu'une portée trop large permettrait à l'application tierce.",
        contexts: [
          "une application tierce qui lit un agenda",
          "un accès révoqué depuis les paramètres du compte",
          "une portée demandant plus de droits que nécessaire"
        ]
      },
      en: {
        title: "Delegating access without sharing a password",
        summary: "Understand the exchange of limited-scope, revocable tokens between three parties.",
        goals: [
          "Describe the three roles involved in access delegation.",
          "Explain what a limited scope prevents."
        ],
        tutor:
          "Have the student describe the three roles of access delegation, then ask what an overly broad scope would let the third-party app do.",
        contexts: [
          "a third-party app reading a calendar",
          "an access revoked from the account settings",
          "a scope requesting more rights than needed"
        ]
      }
    },
    {
      key: "least_privilege_cloud",
      objectives: ["cyber_app_cloud"],
      stage: 4,
      fr: {
        title: "Le moindre privilège dans le cloud",
        summary: "Attribuer à chaque composant les seules permissions dont il a besoin pour fonctionner.",
        goals: [
          "Réduire une permission trop large à un besoin réel.",
          "Expliquer ce qu'un rôle trop permissif aggrave lors d'un incident."
        ],
        tutor:
          "Fais réduire une permission d'écriture globale au strict nécessaire, puis demande ce que cela change en cas de compromission.",
        contexts: [
          "un service disposant d'un accès complet au stockage",
          "un rôle d'administration attribué par facilité",
          "une clé de service partagée entre trois applications"
        ]
      },
      en: {
        title: "Least privilege in the cloud",
        summary: "Grant each component only the permissions it needs to work.",
        goals: [
          "Narrow an overly broad permission to a real need.",
          "Explain what an over-permissive role worsens during an incident."
        ],
        tutor:
          "Have the student narrow a global write permission to the strict minimum, then ask what it changes if compromised.",
        contexts: [
          "a service holding full access to storage",
          "an admin role granted for convenience",
          "a service key shared across three applications"
        ]
      }
    },
    {
      key: "container_isolation",
      objectives: ["cyber_app_cloud"],
      stage: 4,
      fr: {
        title: "L'isolation des conteneurs",
        summary: "Comprendre ce qu'un conteneur isole réellement et ce qu'il partage avec l'hôte.",
        goals: [
          "Dire ce qu'un conteneur partage avec le système hôte.",
          "Citer deux réglages qui renforcent son isolation."
        ],
        tutor:
          "Fais comparer l'isolation d'un conteneur et celle d'une machine virtuelle, puis demande deux réglages qui réduisent le risque.",
        contexts: [
          "un conteneur exécuté avec les droits administrateur",
          "un dossier de l'hôte monté dans un conteneur",
          "une image construite à partir d'une base non maintenue"
        ]
      },
      en: {
        title: "Container isolation",
        summary: "Understand what a container actually isolates and what it shares with the host.",
        goals: [
          "Say what a container shares with the host system.",
          "Name two settings that strengthen its isolation."
        ],
        tutor:
          "Have the student compare container and virtual machine isolation, then ask for two settings that reduce risk.",
        contexts: [
          "a container running with administrator rights",
          "a host folder mounted inside a container",
          "an image built from an unmaintained base"
        ]
      }
    },
    {
      key: "dependency_vulnerabilities",
      objectives: ["cyber_app_cloud"],
      stage: 4,
      fr: {
        title: "Les vulnérabilités des dépendances",
        summary: "Suivre les bibliothèques tierces et décider quand une alerte concerne réellement l'application.",
        goals: [
          "Vérifier si une faille annoncée est réellement atteignable.",
          "Choisir entre mise à jour immédiate et contournement."
        ],
        tutor:
          "Fais vérifier si une faille signalée dans une dépendance est atteignable dans l'application, puis demande la décision à prendre.",
        contexts: [
          "une alerte sur une bibliothèque utilisée pour une seule fonction",
          "une dépendance indirecte présente huit niveaux plus bas",
          "une mise à jour majeure qui casse l'application"
        ]
      },
      en: {
        title: "Dependency vulnerabilities",
        summary: "Track third-party libraries and decide when an alert really concerns the application.",
        goals: [
          "Check whether an announced flaw is actually reachable.",
          "Choose between immediate update and a workaround."
        ],
        tutor:
          "Have the student check whether a reported dependency flaw is reachable in the application, then ask for the decision.",
        contexts: [
          "an alert on a library used for a single function",
          "an indirect dependency eight levels down",
          "a major update that breaks the application"
        ]
      }
    },
    {
      key: "secure_development_lifecycle",
      objectives: ["cyber_app_cloud"],
      stage: 5,
      fr: {
        title: "Intégrer la sécurité au cycle de développement",
        summary: "Placer les contrôles de sécurité au moment où une correction coûte le moins cher.",
        goals: [
          "Associer trois contrôles aux étapes du cycle.",
          "Expliquer pourquoi un audit final seul coûte plus cher."
        ],
        tutor:
          "Fais placer trois contrôles de sécurité aux bonnes étapes du cycle, puis demande le coût d'une correction découverte en production.",
        contexts: [
          "une faille de conception découverte la veille du lancement",
          "un contrôle automatique exécuté à chaque proposition de code",
          "un audit annuel réalisé après la mise en production"
        ]
      },
      en: {
        title: "Building security into the development cycle",
        summary: "Place security checks where a fix costs the least.",
        goals: [
          "Match three checks to the stages of the cycle.",
          "Explain why a final audit alone costs more."
        ],
        tutor:
          "Have the student place three security checks at the right stages, then ask the cost of a fix found in production.",
        contexts: [
          "a design flaw found the day before launch",
          "an automated check run on every code proposal",
          "an annual audit performed after release"
        ]
      }
    },
    {
      key: "architecture_threat_modeling",
      objectives: ["cyber_app_cloud"],
      stage: 5,
      fr: {
        title: "Modéliser les menaces d'une architecture",
        summary: "Analyser un schéma d'architecture pour repérer les frontières de confiance et leurs risques.",
        goals: [
          "Tracer les frontières de confiance sur un schéma.",
          "Associer une contre-mesure à chaque frontière franchie."
        ],
        tutor:
          "Fais tracer les frontières de confiance d'une architecture à trois composants, puis demande une contre-mesure par frontière.",
        contexts: [
          "une application mobile appelant une API publique",
          "un service interne qui fait confiance à son appelant",
          "un flux de données traversant un partenaire externe"
        ]
      },
      en: {
        title: "Threat modelling an architecture",
        summary: "Analyse an architecture diagram to find trust boundaries and their risks.",
        goals: [
          "Draw the trust boundaries on a diagram.",
          "Attach a countermeasure to each boundary crossed."
        ],
        tutor:
          "Have the student draw the trust boundaries of a three-component architecture, then give one countermeasure per boundary.",
        contexts: [
          "a mobile app calling a public API",
          "an internal service trusting its caller",
          "a data flow crossing an external partner"
        ]
      }
    },
    {
      key: "cloud_misconfiguration",
      objectives: ["cyber_app_cloud"],
      stage: 5,
      fr: {
        title: "Les erreurs de configuration cloud",
        summary: "Repérer les réglages par défaut qui exposent des données sans qu'aucune faille soit exploitée.",
        goals: [
          "Citer trois configurations fréquemment exposées.",
          "Décrire un contrôle automatique qui les détecte."
        ],
        tutor:
          "Fais citer trois configurations exposant des données sans faille logicielle, puis demande comment les détecter automatiquement.",
        contexts: [
          "un espace de stockage accessible publiquement",
          "une base de données ouverte sans mot de passe",
          "un journal de débogage exposé sur Internet"
        ]
      },
      en: {
        title: "Cloud misconfiguration",
        summary: "Spot the default settings that expose data without any flaw being exploited.",
        goals: [
          "Name three frequently exposed configurations.",
          "Describe an automated check that detects them."
        ],
        tutor:
          "Have the student name three configurations exposing data with no software flaw, then ask how to detect them automatically.",
        contexts: [
          "a storage bucket left publicly readable",
          "a database open with no password",
          "a debug log exposed on the internet"
        ]
      }
    },
    {
      key: "api_abuse_protection",
      objectives: ["cyber_app_cloud"],
      stage: 5,
      fr: {
        title: "Protéger une API des abus",
        summary: "Limiter le débit, détecter l'énumération et protéger les points d'entrée coûteux.",
        goals: [
          "Choisir une limite de débit adaptée à un point d'entrée.",
          "Repérer un usage automatisé dans des journaux d'API."
        ],
        tutor:
          "Fais fixer une limite de débit pour un point d'entrée de connexion, puis demande comment repérer une énumération de comptes.",
        contexts: [
          "un point d'entrée de connexion appelé mille fois par minute",
          "une recherche coûteuse appelée en boucle",
          "des identifiants testés séquentiellement"
        ]
      },
      en: {
        title: "Protecting an API from abuse",
        summary: "Limit rate, detect enumeration and protect expensive endpoints.",
        goals: [
          "Choose a rate limit suited to an endpoint.",
          "Spot automated usage in API logs."
        ],
        tutor:
          "Have the student set a rate limit for a login endpoint, then ask how to spot account enumeration.",
        contexts: [
          "a login endpoint called a thousand times per minute",
          "an expensive search called in a loop",
          "identifiers tested sequentially"
        ]
      }
    }
  ]
};
