// Computer science concepts.
// Shared base: 9 steps eligible for the three orientations.
// cs_systems: processors, memory, operating systems, networks, protocols, distributed systems.
// cs_programming: logic, variables, functions, algorithms, data structures, complexity, tests.
// cs_software_data: databases, APIs, architecture, Git, cloud, reliability, data.
export const domain = {
  id: "computer_science",
  objectives: ["cs_systems", "cs_programming", "cs_software_data"],
  steps: [
    {
      key: "machine_layers",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Les couches d'un ordinateur, du transistor à l'application",
        summary: "Situer les cinq couches qui séparent un transistor de l'application ouverte à l'écran.",
        goals: [
          "Nommer dans l'ordre transistor, circuit, processeur, système d'exploitation, application.",
          "Dire à quelle couche appartient un problème donné."
        ],
        tutor:
          "Fais nommer les couches de bas en haut, puis demande à quelle couche appartiennent trois problèmes concrets : un écran gelé, un calcul faux, une batterie qui chauffe.",
        contexts: [
          "un téléphone qui ouvre une application de messagerie",
          "une calculatrice à quatre opérations",
          "un serveur qui héberge un site web"
        ]
      },
      en: {
        title: "The layers of a computer, from transistor to application",
        summary: "Place the five layers that separate a transistor from the application on screen.",
        goals: [
          "Name transistor, circuit, processor, operating system and application in order.",
          "Say which layer a given problem belongs to."
        ],
        tutor:
          "Have the student name the layers bottom-up, then ask which layer owns three concrete problems: a frozen screen, a wrong calculation, a hot battery.",
        contexts: [
          "a phone opening a messaging app",
          "a four-function pocket calculator",
          "a server hosting a website"
        ]
      }
    },
    {
      key: "binary_numbers",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Comment les nombres sont écrits en binaire",
        summary: "Convertir un petit nombre décimal en binaire et comprendre pourquoi la machine n'utilise que deux états.",
        goals: [
          "Convertir un nombre inférieur à 32 en binaire et l'inverse.",
          "Expliquer pourquoi deux états suffisent à une machine électronique."
        ],
        tutor:
          "Fais convertir 13 puis 40 en binaire en écrivant les puissances de deux, et demande combien de valeurs tiennent sur 8 bits.",
        contexts: [
          "un compteur de likes qui passe de 255 à 256",
          "une adresse IPv4 écrite en quatre octets",
          "un interrupteur allumé ou éteint"
        ]
      },
      en: {
        title: "How numbers are written in binary",
        summary: "Convert a small decimal number to binary and see why a machine only uses two states.",
        goals: [
          "Convert a number below 32 to binary and back.",
          "Explain why two states are enough for an electronic machine."
        ],
        tutor:
          "Have the student convert 13 then 40 to binary by writing the powers of two, and ask how many values fit in 8 bits.",
        contexts: [
          "a like counter going from 255 to 256",
          "an IPv4 address written as four bytes",
          "a switch that is on or off"
        ]
      }
    },
    {
      key: "text_encoding",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Pourquoi le texte a besoin d'Unicode et d'UTF-8",
        summary: "Comprendre qu'un caractère est un numéro et que l'encodage décide du nombre d'octets utilisés.",
        goals: [
          "Distinguer le caractère, son point de code Unicode et ses octets UTF-8.",
          "Expliquer l'origine des caractères illisibles dans un fichier."
        ],
        tutor:
          "Fais expliquer pourquoi « é » occupe deux octets en UTF-8 alors que « e » en occupe un, puis demande ce qui se passe si un fichier UTF-8 est lu en latin-1.",
        contexts: [
          "un prénom accentué mal affiché dans un export CSV",
          "un emoji qui compte pour plusieurs octets dans un SMS",
          "un nom de fichier japonais copié sur une clé USB"
        ]
      },
      en: {
        title: "Why text needs Unicode and UTF-8",
        summary: "See that a character is a number and that the encoding decides how many bytes it takes.",
        goals: [
          "Tell apart the character, its Unicode code point and its UTF-8 bytes.",
          "Explain where unreadable characters in a file come from."
        ],
        tutor:
          "Have the student explain why “é” takes two bytes in UTF-8 while “e” takes one, then ask what happens when a UTF-8 file is read as latin-1.",
        contexts: [
          "an accented first name broken in a CSV export",
          "an emoji counting as several bytes in a text message",
          "a Japanese file name copied onto a USB stick"
        ]
      }
    },
    {
      key: "what_is_algorithm",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Ce qu'est vraiment un algorithme",
        summary: "Distinguer un algorithme d'un programme : une suite finie d'étapes non ambiguës qui termine.",
        goals: [
          "Citer les trois propriétés d'un algorithme : entrées définies, étapes non ambiguës, terminaison.",
          "Écrire en français les étapes d'une recherche du plus grand élément."
        ],
        tutor:
          "Fais rédiger en français les étapes pour trouver le maximum d'une liste, puis fais tester ces étapes sur une liste vide pour montrer le cas oublié.",
        contexts: [
          "trouver le trajet le plus court dans une application de transport",
          "classer des candidatures par date de dépôt",
          "vérifier qu'un mot est un palindrome"
        ]
      },
      en: {
        title: "What an algorithm really is",
        summary: "Separate an algorithm from a program: a finite sequence of unambiguous steps that terminates.",
        goals: [
          "State the three properties of an algorithm: defined inputs, unambiguous steps, termination.",
          "Write in plain words the steps of a search for the largest element."
        ],
        tutor:
          "Have the student write in plain words the steps to find the maximum of a list, then run those steps on an empty list to expose the forgotten case.",
        contexts: [
          "finding the shortest route in a transit app",
          "sorting applications by submission date",
          "checking whether a word is a palindrome"
        ]
      }
    },
    {
      key: "client_server",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Client et serveur : qui demande, qui répond",
        summary: "Poser le modèle requête-réponse et identifier ce qui tourne sur l'appareil et ce qui tourne à distance.",
        goals: [
          "Décrire le trajet d'une requête et de sa réponse.",
          "Dire quelle partie d'une application donnée est cliente et laquelle est serveur."
        ],
        tutor:
          "Fais tracer la requête et la réponse d'un rafraîchissement de fil d'actualité, puis demande ce qui reste possible hors connexion.",
        contexts: [
          "une application météo qui rafraîchit ses prévisions",
          "un site de réservation qui affiche les places restantes",
          "une boîte mail qui télécharge les nouveaux messages"
        ]
      },
      en: {
        title: "Client and server: who asks, who answers",
        summary: "Set up the request-response model and identify what runs on the device and what runs remotely.",
        goals: [
          "Describe the path of a request and its response.",
          "Say which part of a given application is the client and which is the server."
        ],
        tutor:
          "Have the student trace the request and response of a feed refresh, then ask what still works offline.",
        contexts: [
          "a weather app refreshing its forecast",
          "a booking site showing remaining seats",
          "a mailbox downloading new messages"
        ]
      }
    },
    {
      key: "source_to_execution",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Du code source au programme qui s'exécute",
        summary: "Suivre le passage du texte source aux instructions machine, par compilation ou par interprétation.",
        goals: [
          "Comparer compilation et interprétation sur le moment où l'erreur apparaît.",
          "Nommer ce que produit un compilateur et ce que lit un interpréteur."
        ],
        tutor:
          "Fais comparer une faute de frappe détectée à la compilation en Java et la même faute détectée à l'exécution en Python, puis demande laquelle coûte le plus cher en production.",
        contexts: [
          "une application mobile publiée sur un magasin d'applications",
          "un script Python lancé dans un terminal",
          "une page web dont le JavaScript s'exécute dans le navigateur"
        ]
      },
      en: {
        title: "From source code to a running program",
        summary: "Follow how source text becomes machine instructions, through compilation or interpretation.",
        goals: [
          "Compare compilation and interpretation by when the error shows up.",
          "Name what a compiler produces and what an interpreter reads."
        ],
        tutor:
          "Have the student compare a typo caught at compile time in Java with the same typo caught at run time in Python, then ask which one costs more in production.",
        contexts: [
          "a mobile app shipped to an app store",
          "a Python script launched from a terminal",
          "a web page whose JavaScript runs in the browser"
        ]
      }
    },
    {
      key: "abstraction_layers",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Pourquoi l'informatique empile des couches d'abstraction",
        summary: "Voir qu'une abstraction cache des détails en échange d'un coût et d'une perte de contrôle.",
        goals: [
          "Donner un exemple d'abstraction qui fait gagner du temps et un exemple qui coûte cher.",
          "Expliquer ce qu'une abstraction qui fuit rend visible."
        ],
        tutor:
          "Fais lister ce que cache l'appel « enregistrer un fichier », puis demande ce que l'utilisateur découvre quand le disque est plein.",
        contexts: [
          "un langage qui gère la mémoire à la place du développeur",
          "un service de stockage en ligne présenté comme un dossier",
          "une bibliothèque graphique qui masque le pilote de la carte"
        ]
      },
      en: {
        title: "Why computing stacks layers of abstraction",
        summary: "See that an abstraction hides details in exchange for a cost and a loss of control.",
        goals: [
          "Give one abstraction that saves time and one that costs dearly.",
          "Explain what a leaky abstraction makes visible."
        ],
        tutor:
          "Have the student list what the call “save a file” hides, then ask what the user discovers when the disk is full.",
        contexts: [
          "a language that manages memory for the developer",
          "an online storage service presented as a folder",
          "a graphics library hiding the card driver"
        ]
      }
    },
    {
      key: "files_and_filesystem",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Ce qu'est un fichier pour un système d'exploitation",
        summary: "Comprendre qu'un fichier est un nom, des métadonnées et une suite d'octets répartie sur le disque.",
        goals: [
          "Distinguer le nom, le chemin, les métadonnées et le contenu.",
          "Expliquer pourquoi supprimer un fichier n'efface pas immédiatement ses octets."
        ],
        tutor:
          "Fais décrire ce que contient l'entrée de répertoire d'un fichier photo, puis demande pourquoi un logiciel de récupération peut encore le retrouver après suppression.",
        contexts: [
          "une photo déplacée entre deux dossiers",
          "un document verrouillé parce qu'il est déjà ouvert",
          "une clé USB retirée pendant une copie"
        ]
      },
      en: {
        title: "What a file is for an operating system",
        summary: "Understand that a file is a name, metadata and a byte sequence spread over the disk.",
        goals: [
          "Tell apart the name, the path, the metadata and the content.",
          "Explain why deleting a file does not immediately erase its bytes."
        ],
        tutor:
          "Have the student describe what the directory entry of a photo file holds, then ask why recovery software can still find it after deletion.",
        contexts: [
          "a photo moved between two folders",
          "a document locked because it is already open",
          "a USB stick pulled out during a copy"
        ]
      }
    },
    {
      key: "orders_of_magnitude",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Ordres de grandeur : octet, milliseconde, million d'opérations",
        summary: "Acquérir les repères chiffrés qui permettent de juger si une performance est normale ou absurde.",
        goals: [
          "Citer l'ordre de grandeur d'un accès mémoire, d'un accès disque et d'un aller-retour réseau.",
          "Estimer si une opération annoncée est plausible."
        ],
        tutor:
          "Fais classer un accès RAM, une lecture SSD et un appel réseau transatlantique par durée, puis demande combien d'appels réseau tiennent dans une seconde.",
        contexts: [
          "une page web qui met trois secondes à s'afficher",
          "un export de 50 000 lignes annoncé instantané",
          "une sauvegarde de 2 Go sur une connexion domestique"
        ]
      },
      en: {
        title: "Orders of magnitude: byte, millisecond, million operations",
        summary: "Build the numeric landmarks that tell whether a measured performance is normal or absurd.",
        goals: [
          "State the order of magnitude of a memory access, a disk access and a network round trip.",
          "Estimate whether an announced operation is plausible."
        ],
        tutor:
          "Have the student rank a RAM access, an SSD read and a transatlantic network call by duration, then ask how many network calls fit in one second.",
        contexts: [
          "a web page taking three seconds to appear",
          "a 50,000-row export announced as instant",
          "a 2 GB backup over a home connection"
        ]
      }
    },

    {
      key: "cpu_instruction_cycle",
      objectives: ["cs_systems"],
      stage: 1,
      fr: {
        title: "Comment un processeur exécute une instruction",
        summary: "Dérouler le cycle chercher-décoder-exécuter sur une instruction d'addition.",
        goals: [
          "Nommer les trois phases du cycle et le rôle du compteur ordinal.",
          "Dire où sont lues les données et où est écrit le résultat."
        ],
        tutor:
          "Fais dérouler pas à pas l'addition de deux registres, phase par phase, puis demande ce que devient le compteur ordinal après un saut.",
        contexts: [
          "l'addition de deux nombres dans une boucle de comptage",
          "un branchement conditionnel qui change la suite du programme",
          "une instruction de copie entre deux registres"
        ]
      },
      en: {
        title: "How a processor executes an instruction",
        summary: "Walk the fetch-decode-execute cycle through a single addition instruction.",
        goals: [
          "Name the three phases of the cycle and the role of the program counter.",
          "Say where the data is read and where the result is written."
        ],
        tutor:
          "Have the student walk an addition of two registers phase by phase, then ask what happens to the program counter after a jump.",
        contexts: [
          "adding two numbers inside a counting loop",
          "a conditional branch changing what runs next",
          "a copy instruction between two registers"
        ]
      }
    },
    {
      key: "ram_vs_storage",
      objectives: ["cs_systems"],
      stage: 2,
      fr: {
        title: "Différence entre RAM et stockage",
        summary: "Opposer mémoire vive et stockage persistant sur la volatilité, la vitesse et le prix par gigaoctet.",
        goals: [
          "Expliquer pourquoi un travail non enregistré disparaît à l'extinction.",
          "Comparer les temps d'accès RAM et SSD par ordre de grandeur."
        ],
        tutor:
          "Fais expliquer ce qui est perdu lors d'une coupure de courant, puis demande pourquoi on n'installe pas 2 To de RAM à la place du disque.",
        contexts: [
          "un document en cours d'écriture pendant une coupure de courant",
          "un jeu qui affiche un écran de chargement",
          "un téléphone qui ferme une application restée en arrière-plan"
        ]
      },
      en: {
        title: "The difference between RAM and storage",
        summary: "Contrast volatile memory and persistent storage on volatility, speed and price per gigabyte.",
        goals: [
          "Explain why unsaved work disappears when the machine powers off.",
          "Compare RAM and SSD access times by order of magnitude."
        ],
        tutor:
          "Have the student explain what is lost in a power cut, then ask why we do not install 2 TB of RAM instead of a disk.",
        contexts: [
          "a document being written during a power cut",
          "a game showing a loading screen",
          "a phone closing an app left in the background"
        ]
      }
    },
    {
      key: "os_processes",
      objectives: ["cs_systems"],
      stage: 2,
      fr: {
        title: "Pourquoi les systèmes d'exploitation utilisent des processus",
        summary: "Comprendre le processus comme unité d'isolation : mémoire séparée, droits propres, arrêt indépendant.",
        goals: [
          "Expliquer ce qu'un processus isole d'un autre.",
          "Dire ce qui survit et ce qui disparaît quand un processus est tué."
        ],
        tutor:
          "Fais expliquer pourquoi un onglet de navigateur qui plante ne tue pas les autres, puis demande ce que le système récupère à la fin d'un processus.",
        contexts: [
          "un onglet de navigateur qui plante seul",
          "un antivirus qui tourne sans bloquer le traitement de texte",
          "un serveur qui redémarre un service défaillant"
        ]
      },
      en: {
        title: "Why operating systems use processes",
        summary: "See the process as the unit of isolation: separate memory, own permissions, independent shutdown.",
        goals: [
          "Explain what one process isolates from another.",
          "Say what survives and what disappears when a process is killed."
        ],
        tutor:
          "Have the student explain why a crashing browser tab does not kill the others, then ask what the system reclaims when a process ends.",
        contexts: [
          "a browser tab crashing on its own",
          "an antivirus running without freezing the word processor",
          "a server restarting a failed service"
        ]
      }
    },
    {
      key: "http_request_path",
      objectives: ["cs_systems"],
      stage: 3,
      fr: {
        title: "Comment une requête HTTP atteint un serveur",
        summary: "Suivre une requête depuis la barre d'adresse jusqu'au processus serveur qui la traite.",
        goals: [
          "Ordonner résolution de nom, connexion, requête, réponse.",
          "Lire une ligne de requête et un code de statut."
        ],
        tutor:
          "Fais décrire chaque étape entre la touche Entrée et l'affichage, puis demande ce que signifient un 404 et un 502 pour le trajet décrit.",
        contexts: [
          "l'ouverture d'un article de presse en ligne",
          "un formulaire de connexion envoyé en POST",
          "une image qui reste en chargement sur une page"
        ]
      },
      en: {
        title: "How an HTTP request reaches a server",
        summary: "Follow a request from the address bar to the server process that handles it.",
        goals: [
          "Order name resolution, connection, request and response.",
          "Read a request line and a status code."
        ],
        tutor:
          "Have the student describe each step between pressing Enter and seeing the page, then ask what a 404 and a 502 mean along that path.",
        contexts: [
          "opening an online news article",
          "a login form submitted with POST",
          "an image stuck loading on a page"
        ]
      }
    },
    {
      key: "dns_resolution",
      objectives: ["cs_systems"],
      stage: 3,
      fr: {
        title: "Comment un nom de domaine devient une adresse IP",
        summary: "Décrire la résolution DNS en cascade et le rôle du cache dans la vitesse et dans les pannes.",
        goals: [
          "Nommer les résolveurs successifs interrogés lors d'une résolution.",
          "Expliquer l'effet d'un TTL sur un changement d'adresse."
        ],
        tutor:
          "Fais décrire la cascade de résolveurs pour un nom jamais visité, puis demande pourquoi un changement d'hébergeur met des heures à être visible partout.",
        contexts: [
          "un site déménagé chez un nouvel hébergeur",
          "un réseau d'entreprise qui bloque un domaine",
          "un nom de domaine qui vient d'être acheté"
        ]
      },
      en: {
        title: "How a domain name becomes an IP address",
        summary: "Describe cascading DNS resolution and the role of caching in both speed and outages.",
        goals: [
          "Name the successive resolvers queried during a lookup.",
          "Explain the effect of a TTL when an address changes."
        ],
        tutor:
          "Have the student describe the resolver cascade for a never-visited name, then ask why a hosting move takes hours to be visible everywhere.",
        contexts: [
          "a site moved to a new hosting provider",
          "a corporate network blocking a domain",
          "a domain name bought minutes ago"
        ]
      }
    },
    {
      key: "cpu_cache_locality",
      objectives: ["cs_systems"],
      stage: 3,
      fr: {
        title: "Pourquoi les caches du processeur rendent un code rapide ou lent",
        summary: "Relier la hiérarchie mémoire à la localité des accès et au coût réel d'un défaut de cache.",
        goals: [
          "Expliquer localité temporelle et localité spatiale.",
          "Prévoir quel parcours de tableau à deux dimensions sera le plus rapide."
        ],
        tutor:
          "Fais comparer le parcours d'une matrice ligne par ligne et colonne par colonne, puis demande d'estimer le rapport de durée entre les deux.",
        contexts: [
          "le parcours d'une image pixel par pixel",
          "une somme sur un très grand tableau de mesures",
          "une liste chaînée dispersée en mémoire"
        ]
      },
      en: {
        title: "Why CPU caches make code fast or slow",
        summary: "Connect the memory hierarchy to access locality and to the real cost of a cache miss.",
        goals: [
          "Explain temporal locality and spatial locality.",
          "Predict which traversal of a two-dimensional array will be faster."
        ],
        tutor:
          "Have the student compare row-by-row and column-by-column traversal of a matrix, then ask for an estimate of the ratio between the two.",
        contexts: [
          "walking an image pixel by pixel",
          "summing a very large array of measurements",
          "a linked list scattered across memory"
        ]
      }
    },
    {
      key: "threads_and_context_switch",
      objectives: ["cs_systems"],
      stage: 3,
      fr: {
        title: "Threads et changement de contexte",
        summary: "Comprendre ce que le système sauvegarde pour donner l'illusion que tout tourne en même temps.",
        goals: [
          "Distinguer parallélisme réel et concurrence par alternance.",
          "Citer ce qui est sauvegardé lors d'un changement de contexte."
        ],
        tutor:
          "Fais expliquer comment quatre cœurs font tourner cent tâches, puis demande pourquoi multiplier les threads finit par ralentir la machine.",
        contexts: [
          "un serveur web qui traite mille connexions simultanées",
          "une interface qui reste réactive pendant un téléchargement",
          "un traitement d'images réparti sur plusieurs cœurs"
        ]
      },
      en: {
        title: "Threads and context switching",
        summary: "Understand what the system saves to keep the illusion that everything runs at once.",
        goals: [
          "Tell apart true parallelism and concurrency by interleaving.",
          "List what is saved during a context switch."
        ],
        tutor:
          "Have the student explain how four cores run a hundred tasks, then ask why adding threads eventually slows the machine down.",
        contexts: [
          "a web server handling a thousand simultaneous connections",
          "an interface staying responsive during a download",
          "image processing spread across several cores"
        ]
      }
    },
    {
      key: "virtual_memory",
      objectives: ["cs_systems"],
      stage: 4,
      fr: {
        title: "Mémoire virtuelle et pagination",
        summary: "Comprendre la traduction d'adresses virtuelles en adresses physiques et le coût du recours au disque.",
        goals: [
          "Expliquer pourquoi chaque processus croit disposer de toute la mémoire.",
          "Décrire ce qui se passe lors d'un défaut de page."
        ],
        tutor:
          "Fais expliquer la traduction d'une adresse par la table des pages, puis demande pourquoi une machine qui swappe devient brutalement inutilisable.",
        contexts: [
          "un ordinateur qui rame quand la mémoire est saturée",
          "deux processus qui utilisent la même adresse virtuelle",
          "un très gros fichier ouvert par projection en mémoire"
        ]
      },
      en: {
        title: "Virtual memory and paging",
        summary: "Understand the translation from virtual to physical addresses and the cost of falling back to disk.",
        goals: [
          "Explain why every process believes it owns the whole memory.",
          "Describe what happens on a page fault."
        ],
        tutor:
          "Have the student explain address translation through the page table, then ask why a swapping machine becomes suddenly unusable.",
        contexts: [
          "a computer crawling once memory is saturated",
          "two processes using the same virtual address",
          "a very large file opened through memory mapping"
        ]
      }
    },
    {
      key: "tcp_vs_udp",
      objectives: ["cs_systems"],
      stage: 4,
      fr: {
        title: "TCP ou UDP : fiabilité contre latence",
        summary: "Choisir entre livraison garantie et livraison rapide selon ce que coûte une donnée perdue.",
        goals: [
          "Citer ce que TCP ajoute et ce qu'UDP refuse d'ajouter.",
          "Justifier le choix du protocole pour un usage donné."
        ],
        tutor:
          "Fais justifier le protocole retenu pour un transfert de fichier puis pour un appel vidéo, en demandant à chaque fois le coût d'un paquet perdu.",
        contexts: [
          "un appel vidéo qui pixellise une demi-seconde",
          "le téléchargement d'une mise à jour système",
          "un jeu en ligne où la position du joueur change dix fois par seconde"
        ]
      },
      en: {
        title: "TCP or UDP: reliability against latency",
        summary: "Choose between guaranteed delivery and fast delivery based on what a lost packet costs.",
        goals: [
          "State what TCP adds and what UDP refuses to add.",
          "Justify the protocol choice for a given use."
        ],
        tutor:
          "Have the student justify the protocol for a file transfer then for a video call, each time asking what a lost packet costs.",
        contexts: [
          "a video call pixelating for half a second",
          "downloading a system update",
          "an online game where the player position changes ten times per second"
        ]
      }
    },
    {
      key: "tls_handshake",
      objectives: ["cs_systems"],
      stage: 4,
      fr: {
        title: "Ce que négocie une poignée de main TLS",
        summary: "Comprendre l'enchaînement authentification du serveur, échange de clés, chiffrement symétrique.",
        goals: [
          "Expliquer le rôle du certificat et de l'autorité qui le signe.",
          "Dire pourquoi la suite de la session n'utilise plus l'asymétrique."
        ],
        tutor:
          "Fais décrire les échanges jusqu'à la clé de session, puis demande ce qu'un avertissement de certificat expiré prouve et ne prouve pas.",
        contexts: [
          "un cadenas affiché dans la barre d'adresse",
          "un avertissement de certificat sur un réseau d'hôtel",
          "une application mobile qui refuse un serveur de test"
        ]
      },
      en: {
        title: "What a TLS handshake negotiates",
        summary: "Understand the chain of server authentication, key exchange and symmetric encryption.",
        goals: [
          "Explain the role of the certificate and of the authority signing it.",
          "Say why the rest of the session stops using asymmetric cryptography."
        ],
        tutor:
          "Have the student describe the exchanges up to the session key, then ask what an expired-certificate warning proves and does not prove.",
        contexts: [
          "a padlock shown in the address bar",
          "a certificate warning on a hotel network",
          "a mobile app refusing a test server"
        ]
      }
    },
    {
      key: "race_conditions_locks",
      objectives: ["cs_systems"],
      stage: 4,
      fr: {
        title: "Conditions de course et verrous",
        summary: "Identifier l'entrelacement fautif de deux opérations concurrentes et le coût d'un verrou.",
        goals: [
          "Construire un entrelacement qui produit un solde faux.",
          "Expliquer ce qu'un verrou garantit et ce qu'il coûte."
        ],
        tutor:
          "Fais écrire l'entrelacement de deux retraits simultanés sur le même compte, puis demande où poser le verrou sans bloquer tout le service.",
        contexts: [
          "deux retraits simultanés sur le même compte bancaire",
          "deux acheteurs pour le dernier billet d'un concert",
          "un compteur de vues incrémenté par plusieurs serveurs"
        ]
      },
      en: {
        title: "Race conditions and locks",
        summary: "Spot the faulty interleaving of two concurrent operations and the cost of a lock.",
        goals: [
          "Build an interleaving that produces a wrong balance.",
          "Explain what a lock guarantees and what it costs."
        ],
        tutor:
          "Have the student write the interleaving of two simultaneous withdrawals on one account, then ask where to place the lock without blocking the whole service.",
        contexts: [
          "two simultaneous withdrawals from one bank account",
          "two buyers for the last concert ticket",
          "a view counter incremented by several servers"
        ]
      }
    },
    {
      key: "distributed_replication",
      objectives: ["cs_systems"],
      stage: 5,
      fr: {
        title: "Réplication et cohérence dans un système distribué",
        summary: "Comparer réplication synchrone et asynchrone sur la fraîcheur des lectures et le risque de perte.",
        goals: [
          "Expliquer ce qu'une réplique en retard fait lire à un utilisateur.",
          "Dire ce qui est perdu lors d'une bascule en réplication asynchrone."
        ],
        tutor:
          "Fais raconter ce que voit un utilisateur qui écrit puis relit sur une réplique en retard, et demande quel réglage supprime ce symptôme et à quel prix.",
        contexts: [
          "un commentaire publié qui n'apparaît pas au rafraîchissement",
          "une base répliquée entre l'Europe et l'Amérique",
          "une bascule d'urgence vers un centre de données de secours"
        ]
      },
      en: {
        title: "Replication and consistency in a distributed system",
        summary: "Compare synchronous and asynchronous replication on read freshness and risk of data loss.",
        goals: [
          "Explain what a lagging replica shows to a user.",
          "Say what is lost during a failover under asynchronous replication."
        ],
        tutor:
          "Have the student narrate what a user sees when writing then reading from a lagging replica, and ask which setting removes that symptom and at what price.",
        contexts: [
          "a posted comment missing after a refresh",
          "a database replicated between Europe and America",
          "an emergency failover to a backup data centre"
        ]
      }
    },
    {
      key: "cap_tradeoffs",
      objectives: ["cs_systems"],
      stage: 5,
      fr: {
        title: "Le compromis CAP en pratique",
        summary: "Décider, pendant une partition réseau, entre refuser le service et accepter des données divergentes.",
        goals: [
          "Reformuler CAP comme un choix qui n'existe que pendant une partition.",
          "Choisir cohérence ou disponibilité pour un service donné."
        ],
        tutor:
          "Fais choisir entre refuser une écriture et accepter une divergence pour un panier d'achat puis pour un solde bancaire, en demandant de justifier chaque choix.",
        contexts: [
          "un panier d'achat modifié pendant une coupure réseau",
          "un solde bancaire pendant une partition entre deux régions",
          "un compteur de likes pendant un incident réseau"
        ]
      },
      en: {
        title: "The CAP trade-off in practice",
        summary: "Decide, during a network partition, between refusing service and accepting divergent data.",
        goals: [
          "Restate CAP as a choice that only exists during a partition.",
          "Pick consistency or availability for a given service."
        ],
        tutor:
          "Have the student choose between refusing a write and accepting divergence for a shopping cart then for a bank balance, justifying each choice.",
        contexts: [
          "a shopping cart edited during a network outage",
          "a bank balance during a partition between two regions",
          "a like counter during a network incident"
        ]
      }
    },
    {
      key: "load_balancing",
      objectives: ["cs_systems"],
      stage: 5,
      fr: {
        title: "Comment un répartiteur de charge choisit un serveur",
        summary: "Comparer tourniquet, moindre charge et hachage de session, et gérer les serveurs en mauvaise santé.",
        goals: [
          "Comparer trois stratégies de répartition sur un même trafic.",
          "Expliquer le rôle du contrôle de santé dans le retrait d'un serveur."
        ],
        tutor:
          "Fais comparer tourniquet et moindre charge quand une requête sur dix dure dix fois plus longtemps, puis demande l'effet d'un contrôle de santé trop lent.",
        contexts: [
          "un pic de trafic après une campagne d'emailing",
          "un serveur qui répond mais renvoie des erreurs",
          "une session utilisateur qui doit rester sur la même machine"
        ]
      },
      en: {
        title: "How a load balancer picks a server",
        summary: "Compare round robin, least connections and session hashing, and handle unhealthy servers.",
        goals: [
          "Compare three balancing strategies on the same traffic.",
          "Explain the role of health checks in removing a server."
        ],
        tutor:
          "Have the student compare round robin and least connections when one request in ten takes ten times longer, then ask what a slow health check causes.",
        contexts: [
          "a traffic spike after an email campaign",
          "a server that answers but returns errors",
          "a user session that must stay on the same machine"
        ]
      }
    },
    {
      key: "observability_latency",
      objectives: ["cs_systems"],
      stage: 5,
      fr: {
        title: "Lire une latence p99 pour diagnostiquer un système",
        summary: "Utiliser les percentiles plutôt que la moyenne pour retrouver l'expérience réelle des utilisateurs.",
        goals: [
          "Expliquer pourquoi la moyenne masque les incidents visibles par les clients.",
          "Interpréter un écart important entre p50 et p99."
        ],
        tutor:
          "Fais interpréter un p50 à 80 ms et un p99 à 4 s, puis demande quelles causes techniques produisent cet écart.",
        contexts: [
          "un tableau de bord de supervision après une mise en production",
          "une plainte client sur un service annoncé rapide",
          "un travail de fond qui sature la base une fois par heure"
        ]
      },
      en: {
        title: "Reading p99 latency to diagnose a system",
        summary: "Use percentiles rather than the average to recover what users actually experience.",
        goals: [
          "Explain why the average hides incidents that customers see.",
          "Interpret a wide gap between p50 and p99."
        ],
        tutor:
          "Have the student interpret an 80 ms p50 with a 4 s p99, then ask which technical causes produce that gap.",
        contexts: [
          "a monitoring dashboard after a release",
          "a customer complaint about a service advertised as fast",
          "a background job saturating the database once an hour"
        ]
      }
    },

    {
      key: "variables_and_types",
      objectives: ["cs_programming"],
      stage: 1,
      fr: {
        title: "Variables et types : ce que la machine range vraiment",
        summary: "Séparer le nom, la valeur et le type, et voir ce que le type autorise comme opérations.",
        goals: [
          "Distinguer le nom d'une variable, sa valeur et son type.",
          "Prévoir le résultat d'une addition entre un nombre et une chaîne."
        ],
        tutor:
          "Fais prédire le résultat de \"2\" + 3 dans deux langages différents, puis demande ce que le type change pour la machine.",
        contexts: [
          "un âge saisi dans un formulaire et lu comme du texte",
          "un prix décimal arrondi à l'affichage",
          "un compteur remis à zéro à chaque tour de boucle"
        ]
      },
      en: {
        title: "Variables and types: what the machine actually stores",
        summary: "Separate the name, the value and the type, and see what the type allows as operations.",
        goals: [
          "Tell apart a variable name, its value and its type.",
          "Predict the result of adding a number to a string."
        ],
        tutor:
          "Have the student predict the result of \"2\" + 3 in two different languages, then ask what the type changes for the machine.",
        contexts: [
          "an age typed in a form and read as text",
          "a decimal price rounded for display",
          "a counter reset to zero on each loop turn"
        ]
      }
    },
    {
      key: "conditions_and_loops",
      objectives: ["cs_programming"],
      stage: 2,
      fr: {
        title: "Conditions et boucles : contrôler le flux d'exécution",
        summary: "Écrire une condition sans cas oublié et une boucle dont on sait pourquoi elle s'arrête.",
        goals: [
          "Écrire une condition qui couvre tous les cas d'entrée.",
          "Identifier la variable qui garantit l'arrêt d'une boucle."
        ],
        tutor:
          "Fais écrire les conditions d'un tarif à trois tranches, puis demande quelle entrée n'est traitée par aucune branche.",
        contexts: [
          "un tarif réduit selon l'âge du voyageur",
          "une boucle qui parcourt les lignes d'un fichier",
          "un mot de passe redemandé jusqu'à trois essais"
        ]
      },
      en: {
        title: "Conditions and loops: controlling execution flow",
        summary: "Write a condition with no forgotten case and a loop whose stopping reason is known.",
        goals: [
          "Write a condition that covers every input case.",
          "Identify the variable that guarantees a loop terminates."
        ],
        tutor:
          "Have the student write the conditions of a three-band fare, then ask which input no branch handles.",
        contexts: [
          "a reduced fare based on traveller age",
          "a loop reading the lines of a file",
          "a password prompt allowed up to three attempts"
        ]
      }
    },
    {
      key: "functions_and_scope",
      objectives: ["cs_programming"],
      stage: 2,
      fr: {
        title: "Fonctions, paramètres et portée des variables",
        summary: "Comprendre ce qu'une fonction reçoit, ce qu'elle renvoie et ce qu'elle ne devrait pas connaître.",
        goals: [
          "Distinguer paramètre, argument et valeur de retour.",
          "Expliquer pourquoi une variable locale n'existe plus après l'appel."
        ],
        tutor:
          "Fais transformer un bloc de code répété en fonction avec deux paramètres, puis demande quelles variables globales elle ne doit plus lire.",
        contexts: [
          "un calcul de TVA répété à trois endroits",
          "une fonction de validation d'adresse e-mail",
          "un utilitaire de formatage de date partagé par deux écrans"
        ]
      },
      en: {
        title: "Functions, parameters and variable scope",
        summary: "Understand what a function receives, what it returns and what it should not know about.",
        goals: [
          "Tell apart parameter, argument and return value.",
          "Explain why a local variable no longer exists after the call."
        ],
        tutor:
          "Have the student turn a repeated block into a function with two parameters, then ask which global variables it must stop reading.",
        contexts: [
          "a VAT computation repeated in three places",
          "an email address validation function",
          "a date formatting helper shared by two screens"
        ]
      }
    },
    {
      key: "arrays_vs_linked_lists",
      objectives: ["cs_programming"],
      stage: 3,
      fr: {
        title: "Tableau ou liste chaînée : quel coût pour quelle opération",
        summary: "Comparer accès indexé et insertion au milieu pour choisir la structure adaptée à un usage.",
        goals: [
          "Comparer le coût de l'accès par indice et de l'insertion pour les deux structures.",
          "Choisir la structure adaptée à une liste modifiée en permanence."
        ],
        tutor:
          "Fais comparer l'insertion de mille éléments au milieu d'un tableau et d'une liste chaînée, puis demande laquelle convient à une file d'attente.",
        contexts: [
          "une file d'attente de tickets de support",
          "un historique de navigation parcouru en arrière",
          "un tableau de scores trié affiché à l'écran"
        ]
      },
      en: {
        title: "Array or linked list: which cost for which operation",
        summary: "Compare indexed access and middle insertion to pick the structure that fits a usage.",
        goals: [
          "Compare the cost of index access and insertion for both structures.",
          "Choose the right structure for a constantly modified list."
        ],
        tutor:
          "Have the student compare inserting a thousand elements in the middle of an array and of a linked list, then ask which fits a waiting queue.",
        contexts: [
          "a support ticket waiting queue",
          "a browsing history walked backwards",
          "a sorted scoreboard displayed on screen"
        ]
      }
    },
    {
      key: "hash_maps",
      objectives: ["cs_programming"],
      stage: 3,
      fr: {
        title: "Comment une table de hachage retrouve une clé",
        summary: "Relier la fonction de hachage, le seau d'arrivée et la gestion des collisions au coût moyen constant.",
        goals: [
          "Expliquer le chemin d'une clé jusqu'à sa valeur.",
          "Dire ce qui dégrade une table de hachage en recherche linéaire."
        ],
        tutor:
          "Fais suivre une clé jusqu'à son seau, puis demande ce qui se passe si toutes les clés tombent dans le même seau.",
        contexts: [
          "un annuaire téléphonique interrogé par nom",
          "un cache de sessions utilisateur",
          "un comptage d'occurrences de mots dans un texte"
        ]
      },
      en: {
        title: "How a hash map finds a key",
        summary: "Connect the hash function, the target bucket and collision handling to constant average cost.",
        goals: [
          "Explain the path from a key to its value.",
          "Say what degrades a hash map into a linear search."
        ],
        tutor:
          "Have the student follow a key to its bucket, then ask what happens when every key lands in the same bucket.",
        contexts: [
          "a phone directory queried by name",
          "a cache of user sessions",
          "counting word occurrences in a text"
        ]
      }
    },
    {
      key: "linear_vs_log_complexity",
      objectives: ["cs_programming"],
      stage: 3,
      fr: {
        title: "Complexité linéaire et logarithmique",
        summary: "Comparer le nombre d'opérations d'une recherche séquentielle et d'une recherche dichotomique.",
        goals: [
          "Compter les comparaisons des deux recherches sur un million d'éléments.",
          "Nommer la condition qui rend la dichotomie possible."
        ],
        tutor:
          "Fais compter les comparaisons pour un million d'éléments dans les deux cas, puis demande ce qu'exige la dichotomie sur les données.",
        contexts: [
          "la recherche d'un mot dans un dictionnaire papier",
          "un identifiant cherché dans un journal d'événements",
          "un produit cherché dans un catalogue trié par référence"
        ]
      },
      en: {
        title: "Linear and logarithmic complexity",
        summary: "Compare the operation count of a sequential search and a binary search.",
        goals: [
          "Count the comparisons of both searches over a million elements.",
          "Name the condition that makes binary search possible."
        ],
        tutor:
          "Have the student count comparisons for a million elements in both cases, then ask what binary search requires from the data.",
        contexts: [
          "looking up a word in a paper dictionary",
          "an identifier searched in an event log",
          "a product searched in a catalogue sorted by reference"
        ]
      }
    },
    {
      key: "recursion_base_case",
      objectives: ["cs_programming"],
      stage: 3,
      fr: {
        title: "Récursivité et cas de base",
        summary: "Écrire une fonction récursive dont le cas de base est atteint et suivre l'empilement des appels.",
        goals: [
          "Identifier le cas de base et la réduction du problème.",
          "Expliquer l'origine d'un débordement de pile."
        ],
        tutor:
          "Fais dérouler la pile d'appels d'une factorielle de 4, puis demande ce qui manque dans une version qui ne s'arrête jamais.",
        contexts: [
          "le parcours des dossiers imbriqués d'un disque",
          "le calcul d'une factorielle",
          "l'affichage d'un fil de commentaires imbriqués"
        ]
      },
      en: {
        title: "Recursion and the base case",
        summary: "Write a recursive function whose base case is reached and follow the stack of calls.",
        goals: [
          "Identify the base case and how the problem shrinks.",
          "Explain where a stack overflow comes from."
        ],
        tutor:
          "Have the student unroll the call stack of factorial 4, then ask what is missing in a version that never stops.",
        contexts: [
          "walking the nested folders of a disk",
          "computing a factorial",
          "rendering a thread of nested comments"
        ]
      }
    },
    {
      key: "sorting_algorithms",
      objectives: ["cs_programming"],
      stage: 4,
      fr: {
        title: "Pourquoi le tri fusion bat le tri par insertion",
        summary: "Comparer deux stratégies de tri sur le nombre de comparaisons et sur la mémoire consommée.",
        goals: [
          "Expliquer le découpage récursif du tri fusion.",
          "Dire dans quel cas un tri quadratique reste préférable."
        ],
        tutor:
          "Fais trier six nombres par insertion puis par fusion en comptant les comparaisons, et demande à partir de quelle taille l'écart devient décisif.",
        contexts: [
          "le tri de dix mille commandes par date",
          "le classement d'une main de cartes",
          "un fichier de logs presque déjà trié"
        ]
      },
      en: {
        title: "Why merge sort beats insertion sort",
        summary: "Compare two sorting strategies on comparison count and on memory used.",
        goals: [
          "Explain the recursive splitting of merge sort.",
          "Say when a quadratic sort is still preferable."
        ],
        tutor:
          "Have the student sort six numbers by insertion then by merging while counting comparisons, and ask at which size the gap becomes decisive.",
        contexts: [
          "sorting ten thousand orders by date",
          "arranging a hand of playing cards",
          "a log file that is almost already sorted"
        ]
      }
    },
    {
      key: "trees_and_traversal",
      objectives: ["cs_programming"],
      stage: 4,
      fr: {
        title: "Arbres et parcours",
        summary: "Choisir entre parcours en profondeur et en largeur selon la question posée à la structure.",
        goals: [
          "Distinguer racine, nœud, feuille et hauteur.",
          "Choisir le parcours qui répond à une question donnée."
        ],
        tutor:
          "Fais parcourir un arbre de six nœuds en profondeur puis en largeur, et demande lequel trouve d'abord le nœud le plus proche de la racine.",
        contexts: [
          "l'arborescence des dossiers d'un projet",
          "un organigramme d'entreprise",
          "le rendu d'une page HTML et de ses balises imbriquées"
        ]
      },
      en: {
        title: "Trees and traversals",
        summary: "Choose between depth-first and breadth-first traversal depending on the question asked.",
        goals: [
          "Tell apart root, node, leaf and height.",
          "Choose the traversal that answers a given question."
        ],
        tutor:
          "Have the student traverse a six-node tree depth-first then breadth-first, and ask which one finds the node closest to the root first.",
        contexts: [
          "the folder tree of a project",
          "a company org chart",
          "rendering an HTML page and its nested tags"
        ]
      }
    },
    {
      key: "unit_tests",
      objectives: ["cs_programming"],
      stage: 4,
      fr: {
        title: "Ce qu'un bon test unitaire vérifie",
        summary: "Écrire un test qui échoue pour une seule raison et qui documente le comportement attendu.",
        goals: [
          "Séparer préparation, action et vérification dans un test.",
          "Choisir les cas limites à couvrir en priorité."
        ],
        tutor:
          "Fais écrire trois cas de test pour une fonction de remise commerciale, dont un cas limite, puis demande lequel casserait si la règle changeait.",
        contexts: [
          "une fonction de remise à partir de 100 euros d'achat",
          "un validateur de numéro de téléphone",
          "un calcul de dates de livraison en fin de mois"
        ]
      },
      en: {
        title: "What a good unit test checks",
        summary: "Write a test that fails for exactly one reason and documents the expected behaviour.",
        goals: [
          "Separate arrange, act and assert inside a test.",
          "Choose which edge cases to cover first."
        ],
        tutor:
          "Have the student write three test cases for a discount function, one of them an edge case, then ask which would break if the rule changed.",
        contexts: [
          "a discount function from 100 euros of purchase",
          "a phone number validator",
          "a delivery date computation at the end of a month"
        ]
      }
    },
    {
      key: "immutability_side_effects",
      objectives: ["cs_programming"],
      stage: 4,
      fr: {
        title: "Effets de bord et immutabilité",
        summary: "Repérer une fonction qui modifie son entrée et mesurer ce que cela coûte au débogage.",
        goals: [
          "Distinguer une fonction pure d'une fonction à effet de bord.",
          "Expliquer pourquoi une entrée modifiée rend un bug difficile à reproduire."
        ],
        tutor:
          "Fais repérer la mutation cachée dans une fonction qui trie la liste reçue, puis demande comment la réécrire sans changer l'appelant.",
        contexts: [
          "une fonction de tri qui modifie la liste d'origine",
          "un objet de configuration partagé par deux modules",
          "un panier d'achat mis à jour depuis deux écrans"
        ]
      },
      en: {
        title: "Side effects and immutability",
        summary: "Spot a function that mutates its input and measure what that costs during debugging.",
        goals: [
          "Tell apart a pure function and a function with side effects.",
          "Explain why a mutated input makes a bug hard to reproduce."
        ],
        tutor:
          "Have the student spot the hidden mutation in a function that sorts the list it receives, then ask how to rewrite it without changing callers.",
        contexts: [
          "a sort function that modifies the original list",
          "a configuration object shared by two modules",
          "a shopping cart updated from two screens"
        ]
      }
    },
    {
      key: "dynamic_programming",
      objectives: ["cs_programming"],
      stage: 5,
      fr: {
        title: "Mémoïsation et programmation dynamique",
        summary: "Transformer une récursion exponentielle en calcul linéaire en stockant les sous-résultats.",
        goals: [
          "Repérer les sous-problèmes recalculés dans une récursion.",
          "Comparer le nombre d'appels avant et après mémoïsation."
        ],
        tutor:
          "Fais compter les appels de Fibonacci 10 sans mémoïsation puis avec, et demande quelle propriété du problème rend la technique applicable.",
        contexts: [
          "le calcul du nombre de chemins dans une grille",
          "le rendu de monnaie avec un nombre minimal de pièces",
          "la distance d'édition entre deux mots"
        ]
      },
      en: {
        title: "Memoisation and dynamic programming",
        summary: "Turn an exponential recursion into a linear computation by storing sub-results.",
        goals: [
          "Spot the sub-problems recomputed inside a recursion.",
          "Compare the call count before and after memoisation."
        ],
        tutor:
          "Have the student count the calls of Fibonacci 10 without memoisation then with it, and ask which property of the problem makes the technique valid.",
        contexts: [
          "counting the paths across a grid",
          "making change with the fewest coins",
          "the edit distance between two words"
        ]
      }
    },
    {
      key: "graph_search",
      objectives: ["cs_programming"],
      stage: 5,
      fr: {
        title: "Parcours de graphe : BFS et DFS",
        summary: "Choisir le parcours qui garantit le chemin le plus court dans un graphe non pondéré.",
        goals: [
          "Expliquer pourquoi BFS trouve le chemin minimal en nombre d'arêtes.",
          "Gérer les nœuds déjà visités pour éviter une boucle infinie."
        ],
        tutor:
          "Fais dérouler BFS sur un petit réseau de stations, puis demande ce qui se passe sans marquage des nœuds visités.",
        contexts: [
          "un itinéraire en métro avec correspondances",
          "des amis en commun dans un réseau social",
          "les dépendances entre paquets logiciels"
        ]
      },
      en: {
        title: "Graph traversal: BFS and DFS",
        summary: "Choose the traversal that guarantees the shortest path in an unweighted graph.",
        goals: [
          "Explain why BFS finds the minimal path in number of edges.",
          "Handle already visited nodes to avoid an infinite loop."
        ],
        tutor:
          "Have the student run BFS over a small station network, then ask what happens without marking visited nodes.",
        contexts: [
          "a metro route with interchanges",
          "mutual friends in a social network",
          "dependencies between software packages"
        ]
      }
    },
    {
      key: "big_o_amortized",
      objectives: ["cs_programming"],
      stage: 5,
      fr: {
        title: "Coût amorti : pourquoi un tableau dynamique reste rapide",
        summary: "Expliquer qu'un doublement occasionnel du tableau garde un coût moyen constant par ajout.",
        goals: [
          "Compter les copies effectuées sur une suite d'ajouts.",
          "Distinguer le pire cas ponctuel du coût amorti."
        ],
        tutor:
          "Fais compter les copies après seize ajouts dans un tableau qui double, puis demande pourquoi le pire cas ne décrit pas correctement ce coût.",
        contexts: [
          "un tableau qui grandit à chaque nouvel enregistrement",
          "un tampon de journalisation qui se réalloue",
          "une file de tâches qui absorbe un pic de messages"
        ]
      },
      en: {
        title: "Amortised cost: why a dynamic array stays fast",
        summary: "Explain how occasional doubling keeps the average cost per append constant.",
        goals: [
          "Count the copies performed over a sequence of appends.",
          "Tell apart a one-off worst case and the amortised cost."
        ],
        tutor:
          "Have the student count copies after sixteen appends into a doubling array, then ask why the worst case does not describe that cost properly.",
        contexts: [
          "an array growing with each new record",
          "a logging buffer that reallocates",
          "a task queue absorbing a spike of messages"
        ]
      }
    },
    {
      key: "property_based_testing",
      objectives: ["cs_programming"],
      stage: 5,
      fr: {
        title: "Tests par propriétés",
        summary: "Remplacer une liste d'exemples par une invariante vérifiée sur des entrées générées.",
        goals: [
          "Formuler une propriété toujours vraie pour une fonction donnée.",
          "Expliquer ce qu'un contre-exemple réduit apporte au débogage."
        ],
        tutor:
          "Fais formuler deux propriétés d'une fonction de tri, puis demande quel contre-exemple minimal révélerait un tri instable.",
        contexts: [
          "une fonction de tri testée sur des listes aléatoires",
          "un encodeur et son décodeur appliqués l'un après l'autre",
          "un calcul de prix qui ne doit jamais devenir négatif"
        ]
      },
      en: {
        title: "Property-based testing",
        summary: "Replace a list of examples with an invariant checked over generated inputs.",
        goals: [
          "State a property that always holds for a given function.",
          "Explain what a shrunk counterexample brings to debugging."
        ],
        tutor:
          "Have the student state two properties of a sort function, then ask which minimal counterexample would reveal an unstable sort.",
        contexts: [
          "a sort function tested on random lists",
          "an encoder and its decoder applied one after the other",
          "a price computation that must never go negative"
        ]
      }
    },

    {
      key: "what_is_database",
      objectives: ["cs_software_data"],
      stage: 1,
      fr: {
        title: "Ce qu'une base de données garantit qu'un fichier ne garantit pas",
        summary: "Comparer un fichier partagé et une base sur les écritures simultanées et l'intégrité des données.",
        goals: [
          "Citer trois garanties qu'une base apporte à un fichier partagé.",
          "Décrire ce qui casse quand deux personnes écrivent le même fichier."
        ],
        tutor:
          "Fais raconter ce qui arrive à un tableur partagé modifié par deux personnes hors ligne, puis demande ce qu'une base aurait empêché.",
        contexts: [
          "un tableur de stock partagé par deux magasins",
          "un fichier de contacts recopié sur plusieurs postes",
          "un registre de réservations tenu à la main"
        ]
      },
      en: {
        title: "What a database guarantees that a file does not",
        summary: "Compare a shared file and a database on concurrent writes and data integrity.",
        goals: [
          "State three guarantees a database adds over a shared file.",
          "Describe what breaks when two people write the same file."
        ],
        tutor:
          "Have the student narrate what happens to a shared spreadsheet edited offline by two people, then ask what a database would have prevented.",
        contexts: [
          "a stock spreadsheet shared by two shops",
          "a contact file copied onto several machines",
          "a booking register kept by hand"
        ]
      }
    },
    {
      key: "tables_and_keys",
      objectives: ["cs_software_data"],
      stage: 2,
      fr: {
        title: "Tables, clés primaires et clés étrangères",
        summary: "Modéliser deux entités liées et comprendre ce qu'une clé étrangère interdit.",
        goals: [
          "Choisir une clé primaire stable pour une entité.",
          "Expliquer ce qu'une clé étrangère empêche d'insérer ou de supprimer."
        ],
        tutor:
          "Fais modéliser clients et commandes en deux tables, puis demande ce qui se passe à la suppression d'un client qui a des commandes.",
        contexts: [
          "un client et ses commandes dans une boutique en ligne",
          "un auteur et ses articles dans un blog",
          "un élève et ses inscriptions à des cours"
        ]
      },
      en: {
        title: "Tables, primary keys and foreign keys",
        summary: "Model two related entities and understand what a foreign key forbids.",
        goals: [
          "Choose a stable primary key for an entity.",
          "Explain what a foreign key prevents on insert and on delete."
        ],
        tutor:
          "Have the student model customers and orders as two tables, then ask what happens when deleting a customer who has orders.",
        contexts: [
          "a customer and their orders in an online shop",
          "an author and their posts in a blog",
          "a student and their course enrolments"
        ]
      }
    },
    {
      key: "git_commit_history",
      objectives: ["cs_software_data"],
      stage: 2,
      fr: {
        title: "Ce qu'un commit Git enregistre vraiment",
        summary: "Voir un commit comme un instantané complet relié à son parent, et non comme une différence isolée.",
        goals: [
          "Décrire ce que contient un commit et ce qui le relie au précédent.",
          "Expliquer pourquoi l'historique permet de revenir en arrière."
        ],
        tutor:
          "Fais décrire le contenu d'un commit et son lien au parent, puis demande ce que retrouve exactement un retour à un commit ancien.",
        contexts: [
          "une correction envoyée juste avant une démonstration",
          "un fichier supprimé par erreur la semaine précédente",
          "deux développeurs qui travaillent sur le même dossier"
        ]
      },
      en: {
        title: "What a Git commit actually records",
        summary: "See a commit as a full snapshot linked to its parent, not as an isolated diff.",
        goals: [
          "Describe what a commit contains and what links it to the previous one.",
          "Explain why the history makes it possible to go back."
        ],
        tutor:
          "Have the student describe a commit's content and its parent link, then ask exactly what checking out an old commit restores.",
        contexts: [
          "a fix pushed right before a demo",
          "a file deleted by mistake the week before",
          "two developers working in the same folder"
        ]
      }
    },
    {
      key: "sql_select_join",
      objectives: ["cs_software_data"],
      stage: 3,
      fr: {
        title: "Ce que fait vraiment une jointure SQL",
        summary: "Comprendre l'appariement ligne à ligne d'une jointure et l'effet d'une jointure externe.",
        goals: [
          "Prévoir le nombre de lignes produites par une jointure.",
          "Distinguer jointure interne et jointure externe sur un exemple."
        ],
        tutor:
          "Fais prévoir le nombre de lignes d'une jointure entre trois clients et cinq commandes, puis demande ce que change une jointure externe à gauche.",
        contexts: [
          "un rapport des commandes par client",
          "une liste d'élèves sans note enregistrée",
          "un export comptable qui duplique des lignes"
        ]
      },
      en: {
        title: "What a SQL join actually does",
        summary: "Understand the row-by-row matching of a join and the effect of an outer join.",
        goals: [
          "Predict the number of rows a join produces.",
          "Tell apart inner and outer join on a concrete example."
        ],
        tutor:
          "Have the student predict the row count of a join between three customers and five orders, then ask what a left outer join changes.",
        contexts: [
          "a report of orders per customer",
          "a list of students with no recorded grade",
          "an accounting export that duplicates rows"
        ]
      }
    },
    {
      key: "rest_api_contract",
      objectives: ["cs_software_data"],
      stage: 3,
      fr: {
        title: "Le contrat d'une API REST",
        summary: "Lire une API comme un contrat : ressources, verbes, codes de statut et forme des erreurs.",
        goals: [
          "Associer chaque verbe HTTP à l'effet attendu sur une ressource.",
          "Choisir le code de statut adapté à trois situations d'erreur."
        ],
        tutor:
          "Fais choisir le verbe et le code de statut pour créer, modifier et supprimer une réservation, puis demande ce que doit contenir le corps d'une erreur.",
        contexts: [
          "une API de réservation de salles",
          "une intégration de paiement appelée par une application mobile",
          "un client qui envoie un champ obligatoire vide"
        ]
      },
      en: {
        title: "The contract of a REST API",
        summary: "Read an API as a contract: resources, verbs, status codes and error shape.",
        goals: [
          "Map each HTTP verb to its expected effect on a resource.",
          "Pick the right status code for three error situations."
        ],
        tutor:
          "Have the student pick verb and status code to create, update and delete a booking, then ask what an error body must contain.",
        contexts: [
          "a room booking API",
          "a payment integration called by a mobile app",
          "a client sending a required field empty"
        ]
      }
    },
    {
      key: "database_indexes",
      objectives: ["cs_software_data"],
      stage: 3,
      fr: {
        title: "Pourquoi une base de données utilise des index",
        summary: "Comprendre l'index comme structure triée qui accélère la lecture et ralentit l'écriture.",
        goals: [
          "Expliquer ce qu'un index évite de parcourir.",
          "Citer deux coûts d'un index inutile."
        ],
        tutor:
          "Fais comparer une recherche par e-mail sur un million de lignes avec et sans index, puis demande ce que coûte cet index à chaque insertion.",
        contexts: [
          "une connexion utilisateur recherchée par adresse e-mail",
          "un rapport mensuel filtré par date de commande",
          "une table d'historique alimentée en continu"
        ]
      },
      en: {
        title: "Why a database uses indexes",
        summary: "See an index as a sorted structure that speeds reads up and slows writes down.",
        goals: [
          "Explain what an index avoids scanning.",
          "State two costs of a useless index."
        ],
        tutor:
          "Have the student compare an email lookup over a million rows with and without an index, then ask what that index costs on every insert.",
        contexts: [
          "a user login looked up by email address",
          "a monthly report filtered by order date",
          "a history table written to continuously"
        ]
      }
    },
    {
      key: "git_branch_merge",
      objectives: ["cs_software_data"],
      stage: 3,
      fr: {
        title: "Branches et fusions",
        summary: "Comprendre l'origine d'un conflit de fusion et ce que Git demande de trancher.",
        goals: [
          "Expliquer ce qu'une branche isole du tronc commun.",
          "Décrire la situation exacte qui produit un conflit."
        ],
        tutor:
          "Fais décrire deux branches qui modifient la même ligne, puis demande ce que Git ne peut pas décider seul et pourquoi.",
        contexts: [
          "une correction urgente pendant qu'une refonte est en cours",
          "deux équipes qui modifient le même fichier de configuration",
          "une branche restée ouverte pendant trois semaines"
        ]
      },
      en: {
        title: "Branches and merges",
        summary: "Understand where a merge conflict comes from and what Git asks you to decide.",
        goals: [
          "Explain what a branch isolates from the main line.",
          "Describe the exact situation that produces a conflict."
        ],
        tutor:
          "Have the student describe two branches editing the same line, then ask what Git cannot decide alone and why.",
        contexts: [
          "an urgent fix while a rewrite is in progress",
          "two teams editing the same configuration file",
          "a branch left open for three weeks"
        ]
      }
    },
    {
      key: "transactions_acid",
      objectives: ["cs_software_data"],
      stage: 4,
      fr: {
        title: "Transactions et propriétés ACID",
        summary: "Utiliser une transaction pour qu'une suite d'écritures réussisse entièrement ou pas du tout.",
        goals: [
          "Expliquer atomicité et isolation sur un transfert entre deux comptes.",
          "Dire ce que voit une autre session pendant la transaction."
        ],
        tutor:
          "Fais dérouler un virement interrompu au milieu, puis demande ce qu'une autre session lit avant la validation.",
        contexts: [
          "un virement entre deux comptes",
          "une commande qui décrémente un stock",
          "une inscription qui crée un compte et un profil"
        ]
      },
      en: {
        title: "Transactions and ACID properties",
        summary: "Use a transaction so that a sequence of writes fully succeeds or does not happen at all.",
        goals: [
          "Explain atomicity and isolation on a transfer between two accounts.",
          "Say what another session sees while the transaction runs."
        ],
        tutor:
          "Have the student walk through a transfer interrupted midway, then ask what another session reads before the commit.",
        contexts: [
          "a transfer between two accounts",
          "an order decrementing stock",
          "a signup creating an account and a profile"
        ]
      }
    },
    {
      key: "n_plus_one_queries",
      objectives: ["cs_software_data"],
      stage: 4,
      fr: {
        title: "Le problème des requêtes N+1",
        summary: "Repérer une boucle qui interroge la base à chaque itération et la remplacer par une requête groupée.",
        goals: [
          "Compter les requêtes générées par une boucle d'affichage.",
          "Proposer une requête unique qui remplace la boucle."
        ],
        tutor:
          "Fais compter les requêtes d'une page qui affiche cent commandes avec leur client, puis demande la requête unique équivalente.",
        contexts: [
          "une page listant cent commandes avec le nom du client",
          "un export qui charge les auteurs article par article",
          "une API mobile lente uniquement sur la liste principale"
        ]
      },
      en: {
        title: "The N+1 query problem",
        summary: "Spot a loop that queries the database on each iteration and replace it with one batched query.",
        goals: [
          "Count the queries generated by a rendering loop.",
          "Propose a single query that replaces the loop."
        ],
        tutor:
          "Have the student count the queries of a page showing a hundred orders with their customer, then ask for the equivalent single query.",
        contexts: [
          "a page listing a hundred orders with the customer name",
          "an export loading authors article by article",
          "a mobile API slow only on the main list"
        ]
      }
    },
    {
      key: "cache_invalidation",
      objectives: ["cs_software_data"],
      stage: 4,
      fr: {
        title: "Mettre en cache sans servir des données périmées",
        summary: "Choisir une stratégie d'invalidation adaptée à la tolérance métier à la donnée obsolète.",
        goals: [
          "Comparer expiration par durée et invalidation à l'écriture.",
          "Fixer une durée de cache justifiée pour une donnée donnée."
        ],
        tutor:
          "Fais fixer une durée de cache pour un prix puis pour un article de blog, en demandant à chaque fois le coût d'une valeur périmée.",
        contexts: [
          "un prix modifié pendant une promotion",
          "une page d'accueil éditoriale mise à jour deux fois par jour",
          "un solde de points de fidélité affiché après un achat"
        ]
      },
      en: {
        title: "Caching without serving stale data",
        summary: "Pick an invalidation strategy matching how much staleness the business tolerates.",
        goals: [
          "Compare time-based expiry and write-through invalidation.",
          "Set a justified cache duration for a given piece of data."
        ],
        tutor:
          "Have the student set a cache duration for a price then for a blog post, each time asking what a stale value costs.",
        contexts: [
          "a price changed during a promotion",
          "an editorial homepage refreshed twice a day",
          "a loyalty point balance shown right after a purchase"
        ]
      }
    },
    {
      key: "api_versioning",
      objectives: ["cs_software_data"],
      stage: 4,
      fr: {
        title: "Faire évoluer une API sans casser ses clients",
        summary: "Distinguer changement compatible et rupture, et organiser une migration de clients existants.",
        goals: [
          "Classer trois modifications en compatibles ou en ruptures.",
          "Décrire une transition qui laisse les anciens clients fonctionner."
        ],
        tutor:
          "Fais classer l'ajout d'un champ, le renommage d'un champ et le durcissement d'une validation, puis demande le plan de migration correspondant.",
        contexts: [
          "une application mobile installée que l'on ne peut pas forcer à se mettre à jour",
          "un partenaire qui intègre l'API depuis deux ans",
          "un champ obligatoire ajouté à un formulaire d'inscription"
        ]
      },
      en: {
        title: "Evolving an API without breaking its clients",
        summary: "Tell apart compatible changes and breaking changes, and plan a migration for existing clients.",
        goals: [
          "Classify three modifications as compatible or breaking.",
          "Describe a transition that keeps old clients working."
        ],
        tutor:
          "Have the student classify adding a field, renaming a field and tightening a validation, then ask for the matching migration plan.",
        contexts: [
          "an installed mobile app that cannot be forced to update",
          "a partner integrating the API for two years",
          "a required field added to a signup form"
        ]
      }
    },
    {
      key: "normalization_denormalization",
      objectives: ["cs_software_data"],
      stage: 5,
      fr: {
        title: "Normaliser ou dénormaliser un schéma",
        summary: "Arbitrer entre absence de duplication et rapidité de lecture selon les requêtes réellement servies.",
        goals: [
          "Citer le risque principal de la duplication de données.",
          "Justifier une dénormalisation par une requête précise."
        ],
        tutor:
          "Fais justifier la duplication du nom du client dans la table des commandes, puis demande ce qui doit être mis à jour quand ce nom change.",
        contexts: [
          "un tableau de bord de ventes recalculé à chaque ouverture",
          "une adresse de livraison figée au moment de la commande",
          "un catalogue lu mille fois plus souvent qu'il n'est modifié"
        ]
      },
      en: {
        title: "Normalising or denormalising a schema",
        summary: "Arbitrate between no duplication and fast reads based on the queries actually served.",
        goals: [
          "State the main risk of duplicating data.",
          "Justify a denormalisation with a precise query."
        ],
        tutor:
          "Have the student justify duplicating the customer name into the orders table, then ask what must be updated when that name changes.",
        contexts: [
          "a sales dashboard recomputed on every open",
          "a delivery address frozen at order time",
          "a catalogue read a thousand times more often than written"
        ]
      }
    },
    {
      key: "idempotency_retries",
      objectives: ["cs_software_data"],
      stage: 5,
      fr: {
        title: "Idempotence et reprise sur erreur",
        summary: "Concevoir une opération que l'on peut rejouer sans créer de doublon ni double paiement.",
        goals: [
          "Expliquer ce qu'une clé d'idempotence garantit lors d'un réessai.",
          "Repérer une opération dangereuse à rejouer."
        ],
        tutor:
          "Fais analyser un paiement dont la réponse s'est perdue, puis demande quelle clé permet de rejouer l'appel sans débiter deux fois.",
        contexts: [
          "un paiement dont la réponse réseau s'est perdue",
          "un webhook renvoyé trois fois par un partenaire",
          "un travail de fond relancé après un redémarrage"
        ]
      },
      en: {
        title: "Idempotency and retries",
        summary: "Design an operation that can be replayed without creating a duplicate or a double charge.",
        goals: [
          "Explain what an idempotency key guarantees during a retry.",
          "Spot an operation that is dangerous to replay."
        ],
        tutor:
          "Have the student analyse a payment whose response was lost, then ask which key allows replaying the call without charging twice.",
        contexts: [
          "a payment whose network response was lost",
          "a webhook re-sent three times by a partner",
          "a background job restarted after a reboot"
        ]
      }
    },
    {
      key: "cloud_scaling",
      objectives: ["cs_software_data"],
      stage: 5,
      fr: {
        title: "Mise à l'échelle horizontale et état partagé",
        summary: "Identifier l'état local qui empêche d'ajouter des serveurs et le déplacer vers un service partagé.",
        goals: [
          "Repérer un état conservé en mémoire d'une seule instance.",
          "Proposer où déplacer cet état pour permettre l'ajout de serveurs."
        ],
        tutor:
          "Fais expliquer pourquoi des sessions en mémoire déconnectent les utilisateurs après un ajout de serveur, puis demande où déplacer ces sessions.",
        contexts: [
          "des utilisateurs déconnectés après l'ajout d'un serveur",
          "des fichiers téléversés stockés sur le disque d'une machine",
          "un travail planifié qui s'exécute en double sur deux instances"
        ]
      },
      en: {
        title: "Horizontal scaling and shared state",
        summary: "Identify the local state that blocks adding servers and move it to a shared service.",
        goals: [
          "Spot state kept in the memory of a single instance.",
          "Propose where to move that state to allow adding servers."
        ],
        tutor:
          "Have the student explain why in-memory sessions log users out after a server is added, then ask where those sessions should move.",
        contexts: [
          "users logged out after a server was added",
          "uploaded files stored on one machine's disk",
          "a scheduled job running twice on two instances"
        ]
      }
    },
    {
      key: "slo_error_budget",
      objectives: ["cs_software_data"],
      stage: 5,
      fr: {
        title: "SLO et budget d'erreur",
        summary: "Traduire un objectif de fiabilité en minutes d'indisponibilité tolérées et en décision de mise en production.",
        goals: [
          "Convertir un objectif de 99,9 % en durée d'indisponibilité mensuelle.",
          "Décider d'une mise en production selon le budget consommé."
        ],
        tutor:
          "Fais convertir 99,9 % en minutes par mois, puis demande quelle décision prendre si le budget est déjà consommé au dix du mois.",
        contexts: [
          "un service dont le budget d'erreur est épuisé en début de mois",
          "une mise en production prévue un vendredi soir",
          "un incident de quarante minutes sur un service critique"
        ]
      },
      en: {
        title: "SLOs and error budgets",
        summary: "Translate a reliability target into tolerated downtime minutes and into a release decision.",
        goals: [
          "Convert a 99.9% target into monthly downtime.",
          "Decide on a release based on the consumed budget."
        ],
        tutor:
          "Have the student convert 99.9% into minutes per month, then ask which decision to take if the budget is already spent by the tenth.",
        contexts: [
          "a service whose error budget is exhausted early in the month",
          "a release planned for a Friday evening",
          "a forty-minute incident on a critical service"
        ]
      }
    }
  ]
};
