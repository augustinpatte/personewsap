// Human biology and medicine concepts. Every step stays general and educational:
// no personal diagnosis, no individual treatment advice.
// Shared base: 9 steps eligible for the three orientations.
// medicine_body: anatomy, physiology, coordination of the major systems.
// medicine_disease: how diseases appear, progress and are studied.
// medicine_evidence: pharmacology, clinical trials, risk, evidence quality.
export const domain = {
  id: "human_biology_medicine",
  objectives: ["medicine_body", "medicine_disease", "medicine_evidence"],
  steps: [
    {
      key: "cell_basics",
      objectives: "*",
      stage: 1,
      fr: {
        title: "La cellule, unité de base du vivant",
        summary: "Situer les principaux compartiments d'une cellule et le rôle de chacun.",
        goals: [
          "Nommer trois compartiments cellulaires et leur fonction.",
          "Expliquer le rôle de la membrane comme frontière sélective."
        ],
        tutor:
          "Fais nommer trois compartiments d'une cellule et leur rôle, puis demande ce qui se passe si la membrane laisse tout passer.",
        contexts: [
          "une cellule musculaire riche en mitochondries",
          "un globule rouge dépourvu de noyau",
          "une cellule de la peau qui se renouvelle"
        ]
      },
      en: {
        title: "The cell, basic unit of life",
        summary: "Locate the main compartments of a cell and the role of each one.",
        goals: [
          "Name three cell compartments and their function.",
          "Explain the membrane's role as a selective boundary."
        ],
        tutor:
          "Have the student name three cell compartments and their role, then ask what happens if the membrane lets everything through.",
        contexts: [
          "a muscle cell rich in mitochondria",
          "a red blood cell without a nucleus",
          "a skin cell being renewed"
        ]
      }
    },
    {
      key: "body_systems_map",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Les grands systèmes du corps et leur coordination",
        summary: "Relier les systèmes entre eux plutôt que de les mémoriser séparément.",
        goals: [
          "Associer chaque grand système à sa fonction principale.",
          "Décrire une coordination entre deux systèmes lors d'un effort."
        ],
        tutor:
          "Fais décrire ce qui se coordonne entre trois systèmes quand on monte un escalier rapidement.",
        contexts: [
          "une montée d'escalier rapide",
          "un repas copieux suivi d'une somnolence",
          "une déshydratation par forte chaleur"
        ]
      },
      en: {
        title: "The major body systems and their coordination",
        summary: "Connect the systems to each other rather than memorising them separately.",
        goals: [
          "Match each major system to its main function.",
          "Describe a coordination between two systems during exercise."
        ],
        tutor:
          "Have the student describe what three systems coordinate when climbing stairs quickly.",
        contexts: [
          "a quick climb up a staircase",
          "a heavy meal followed by drowsiness",
          "dehydration during a heatwave"
        ]
      }
    },
    {
      key: "homeostasis",
      objectives: "*",
      stage: 1,
      fr: {
        title: "L'homéostasie : maintenir un équilibre",
        summary: "Comprendre la régulation par rétroaction négative sur des exemples de température et de glycémie.",
        goals: [
          "Décrire une boucle de rétroaction négative complète.",
          "Identifier capteur, centre de contrôle et effecteur."
        ],
        tutor:
          "Fais décrire la boucle qui ramène la température corporelle après un effort, en nommant capteur, centre et effecteur.",
        contexts: [
          "une transpiration déclenchée par la chaleur",
          "un frisson par temps froid",
          "une glycémie qui remonte après un repas"
        ]
      },
      en: {
        title: "Homeostasis: keeping a balance",
        summary: "Understand negative feedback regulation through temperature and blood sugar examples.",
        goals: [
          "Describe a full negative feedback loop.",
          "Identify sensor, control centre and effector."
        ],
        tutor:
          "Have the student describe the loop returning body temperature to normal after exercise, naming sensor, centre and effector.",
        contexts: [
          "sweating triggered by heat",
          "shivering in cold weather",
          "blood sugar rising after a meal"
        ]
      }
    },
    {
      key: "dna_to_protein",
      objectives: "*",
      stage: 1,
      fr: {
        title: "De l'ADN à la protéine",
        summary: "Suivre le passage d'une séquence d'ADN à une protéine fonctionnelle en deux étapes.",
        goals: [
          "Ordonner transcription et traduction.",
          "Expliquer pourquoi toutes les cellules n'expriment pas les mêmes gènes."
        ],
        tutor:
          "Fais ordonner les deux étapes du gène à la protéine, puis demande pourquoi deux cellules du même corps sont différentes.",
        contexts: [
          "l'insuline produite par le pancréas",
          "une cellule de peau et un neurone au même génome",
          "une enzyme digestive fabriquée après un repas"
        ]
      },
      en: {
        title: "From DNA to protein",
        summary: "Follow the path from a DNA sequence to a functional protein in two steps.",
        goals: [
          "Order transcription and translation.",
          "Explain why not all cells express the same genes."
        ],
        tutor:
          "Have the student order the two steps from gene to protein, then ask why two cells of the same body differ.",
        contexts: [
          "insulin produced by the pancreas",
          "a skin cell and a neuron sharing one genome",
          "a digestive enzyme made after a meal"
        ]
      }
    },
    {
      key: "medical_vocabulary",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Lire un terme médical",
        summary: "Décomposer un mot médical en préfixe, racine et suffixe pour en deviner le sens.",
        goals: [
          "Décomposer trois termes médicaux courants.",
          "Deviner le sens d'un terme inconnu à partir de ses éléments."
        ],
        tutor:
          "Fais décomposer trois termes médicaux, puis demande de deviner le sens d'un quatrième jamais rencontré.",
        contexts: [
          "un compte rendu d'examen rempli d'abréviations",
          "un terme finissant par -ite dans une notice",
          "un mot composé désignant une opération"
        ]
      },
      en: {
        title: "Reading a medical term",
        summary: "Break a medical word into prefix, root and suffix to infer its meaning.",
        goals: [
          "Break down three common medical terms.",
          "Infer the meaning of an unknown term from its parts."
        ],
        tutor:
          "Have the student break down three medical terms, then infer the meaning of a fourth they have never seen.",
        contexts: [
          "a test report full of abbreviations",
          "a term ending in -itis in a leaflet",
          "a compound word naming a surgical procedure"
        ]
      }
    },
    {
      key: "anatomical_orientation",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Se repérer dans le corps : plans et positions",
        summary: "Utiliser le vocabulaire de position pour décrire une localisation sans ambiguïté.",
        goals: [
          "Utiliser correctement quatre termes de position.",
          "Décrire une localisation sans ambiguïté."
        ],
        tutor:
          "Fais décrire la position d'un organe par rapport à deux autres avec le vocabulaire adapté, puis corrige les ambiguïtés.",
        contexts: [
          "la description d'une douleur lors d'une consultation",
          "une coupe d'imagerie médicale",
          "un schéma d'anatomie vu de face et de profil"
        ]
      },
      en: {
        title: "Orienting yourself in the body: planes and positions",
        summary: "Use positional vocabulary to describe a location without ambiguity.",
        goals: [
          "Correctly use four positional terms.",
          "Describe a location without ambiguity."
        ],
        tutor:
          "Have the student describe an organ's position relative to two others using the right vocabulary, then fix the ambiguities.",
        contexts: [
          "describing a pain during a consultation",
          "a medical imaging slice",
          "an anatomy diagram seen from front and side"
        ]
      }
    },
    {
      key: "immune_defense_lines",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Les deux lignes de défense de l'immunité",
        summary: "Distinguer la réponse immédiate non spécifique de la réponse ciblée et mémorisée.",
        goals: [
          "Comparer immunité innée et immunité adaptative sur trois critères.",
          "Expliquer ce que la mémoire immunitaire change lors d'un second contact."
        ],
        tutor:
          "Fais comparer les deux réponses lors d'une coupure infectée, puis demande ce qui change lors d'un second contact avec le même agent.",
        contexts: [
          "une coupure qui rougit et gonfle",
          "une seconde exposition au même virus",
          "une fièvre déclenchée par une infection"
        ]
      },
      en: {
        title: "The two lines of immune defence",
        summary: "Tell apart the immediate non-specific response and the targeted, remembered one.",
        goals: [
          "Compare innate and adaptive immunity on three criteria.",
          "Explain what immune memory changes on a second contact."
        ],
        tutor:
          "Have the student compare both responses on an infected cut, then ask what changes on a second contact with the same agent.",
        contexts: [
          "a cut turning red and swollen",
          "a second exposure to the same virus",
          "a fever triggered by an infection"
        ]
      }
    },
    {
      key: "metabolism_energy",
      objectives: "*",
      stage: 2,
      fr: {
        title: "D'où vient l'énergie des cellules",
        summary: "Relier les nutriments consommés à la production d'énergie utilisable par les cellules.",
        goals: [
          "Décrire le chemin d'un nutriment jusqu'à l'énergie cellulaire.",
          "Comparer une dépense au repos et à l'effort."
        ],
        tutor:
          "Fais suivre le trajet d'un sucre depuis l'assiette jusqu'à la contraction d'un muscle, en nommant chaque étape.",
        contexts: [
          "un sprint de trente secondes",
          "un jeûne d'une nuit",
          "une marche longue à allure régulière"
        ]
      },
      en: {
        title: "Where cells get their energy",
        summary: "Connect consumed nutrients to the production of energy cells can use.",
        goals: [
          "Describe the path from a nutrient to cellular energy.",
          "Compare energy expenditure at rest and during exercise."
        ],
        tutor:
          "Have the student follow a sugar from the plate to a muscle contraction, naming every step.",
        contexts: [
          "a thirty-second sprint",
          "an overnight fast",
          "a long walk at steady pace"
        ]
      }
    },
    {
      key: "medical_uncertainty",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Pourquoi la médecine raisonne en probabilités",
        summary: "Comprendre qu'un raisonnement médical pondère des hypothèses au lieu de certitudes.",
        goals: [
          "Expliquer pourquoi un même symptôme admet plusieurs causes.",
          "Dire ce qu'un examen complémentaire modifie dans le raisonnement."
        ],
        tutor:
          "Fais lister plusieurs causes possibles d'un symptôme courant, puis demande ce qu'un examen change dans la hiérarchie des hypothèses. Reste général et n'évoque aucun cas personnel.",
        contexts: [
          "une fatigue persistante aux causes multiples",
          "un examen qui écarte une hypothèse",
          "deux patients aux mêmes symptômes et aux causes différentes"
        ]
      },
      en: {
        title: "Why medicine reasons in probabilities",
        summary: "Understand that medical reasoning weighs hypotheses rather than certainties.",
        goals: [
          "Explain why one symptom admits several causes.",
          "Say what an additional test changes in the reasoning."
        ],
        tutor:
          "Have the student list several possible causes of a common symptom, then ask what a test changes in the ranking. Stay general and avoid any personal case.",
        contexts: [
          "persistent tiredness with multiple causes",
          "a test ruling out one hypothesis",
          "two patients with the same symptoms and different causes"
        ]
      }
    },

    {
      key: "skeleton_and_muscles",
      objectives: ["medicine_body"],
      stage: 1,
      fr: {
        title: "Os, articulations et muscles",
        summary: "Comprendre le levier formé par un os, une articulation et un muscle qui se contracte.",
        goals: [
          "Décrire le mouvement produit par une paire de muscles antagonistes.",
          "Nommer les trois éléments d'un levier articulaire."
        ],
        tutor:
          "Fais décrire les muscles qui plient puis tendent le coude, et demande pourquoi un muscle ne peut que tirer.",
        contexts: [
          "la flexion du coude en portant un sac",
          "une articulation du genou en descente",
          "une posture assise maintenue longtemps"
        ]
      },
      en: {
        title: "Bones, joints and muscles",
        summary: "Understand the lever formed by a bone, a joint and a contracting muscle.",
        goals: [
          "Describe the movement produced by a pair of antagonist muscles.",
          "Name the three parts of a joint lever."
        ],
        tutor:
          "Have the student describe the muscles bending then extending the elbow, and ask why a muscle can only pull.",
        contexts: [
          "bending the elbow while carrying a bag",
          "a knee joint going downhill",
          "a seated posture held for a long time"
        ]
      }
    },
    {
      key: "heart_circulation",
      objectives: ["medicine_body"],
      stage: 2,
      fr: {
        title: "Le trajet du sang dans le cœur",
        summary: "Suivre les deux circulations et comprendre le rôle des valves dans le sens du flux.",
        goals: [
          "Ordonner les cavités traversées par le sang.",
          "Expliquer le rôle des valves cardiaques."
        ],
        tutor:
          "Fais suivre une goutte de sang depuis une jambe jusqu'au retour dans cette même jambe, cavité par cavité.",
        contexts: [
          "une goutte de sang partie d'une jambe",
          "un souffle entendu à l'auscultation",
          "un rythme cardiaque accéléré par l'effort"
        ]
      },
      en: {
        title: "The path of blood through the heart",
        summary: "Follow both circulations and understand the role of valves in flow direction.",
        goals: [
          "Order the chambers the blood passes through.",
          "Explain the role of the heart valves."
        ],
        tutor:
          "Have the student follow a drop of blood from a leg back to that same leg, chamber by chamber.",
        contexts: [
          "a drop of blood leaving a leg",
          "a murmur heard on auscultation",
          "a heart rate raised by exercise"
        ]
      }
    },
    {
      key: "respiration_gas_exchange",
      objectives: ["medicine_body"],
      stage: 2,
      fr: {
        title: "Les échanges gazeux dans les poumons",
        summary: "Relier la surface alvéolaire, la diffusion des gaz et le transport par le sang.",
        goals: [
          "Expliquer la diffusion de l'oxygène au niveau alvéolaire.",
          "Dire ce qui déclenche l'augmentation du rythme respiratoire."
        ],
        tutor:
          "Fais expliquer ce qui traverse la paroi alvéolaire dans chaque sens, puis demande quel gaz déclenche l'envie de respirer.",
        contexts: [
          "un effort qui accélère la respiration",
          "une altitude élevée en montagne",
          "une apnée volontaire de trente secondes"
        ]
      },
      en: {
        title: "Gas exchange in the lungs",
        summary: "Connect alveolar surface, gas diffusion and transport by the blood.",
        goals: [
          "Explain oxygen diffusion at the alveolar level.",
          "Say what triggers an increase in breathing rate."
        ],
        tutor:
          "Have the student explain what crosses the alveolar wall in each direction, then ask which gas drives the urge to breathe.",
        contexts: [
          "exercise speeding up breathing",
          "high altitude in the mountains",
          "a thirty-second voluntary breath hold"
        ]
      }
    },
    {
      key: "neuron_signal",
      objectives: ["medicine_body"],
      stage: 3,
      fr: {
        title: "Comment un neurone transmet un signal",
        summary: "Distinguer la propagation électrique le long de l'axone de la transmission chimique à la synapse.",
        goals: [
          "Décrire les deux modes de transmission successifs.",
          "Expliquer ce qui limite la vitesse d'un influx."
        ],
        tutor:
          "Fais suivre un signal depuis un récepteur cutané jusqu'au cerveau, en distinguant les deux modes de transmission.",
        contexts: [
          "un réflexe de retrait au contact d'une surface brûlante",
          "une main endormie après une compression",
          "un message de douleur remontant depuis un pied"
        ]
      },
      en: {
        title: "How a neuron transmits a signal",
        summary: "Tell apart electrical propagation along the axon and chemical transmission at the synapse.",
        goals: [
          "Describe the two successive transmission modes.",
          "Explain what limits the speed of an impulse."
        ],
        tutor:
          "Have the student follow a signal from a skin receptor to the brain, distinguishing the two transmission modes.",
        contexts: [
          "a withdrawal reflex on touching a hot surface",
          "a hand gone numb after compression",
          "a pain message travelling up from a foot"
        ]
      }
    },
    {
      key: "digestion_absorption",
      objectives: ["medicine_body"],
      stage: 3,
      fr: {
        title: "La digestion et l'absorption",
        summary: "Suivre la transformation mécanique et chimique des aliments jusqu'au passage dans le sang.",
        goals: [
          "Associer chaque organe digestif à sa transformation principale.",
          "Dire où et comment les nutriments passent dans le sang."
        ],
        tutor:
          "Fais suivre un morceau de pain de la bouche jusqu'au sang, en nommant les transformations à chaque étape.",
        contexts: [
          "un morceau de pain mâché puis avalé",
          "un repas gras qui ralentit la vidange de l'estomac",
          "une prise de médicament pendant le repas"
        ]
      },
      en: {
        title: "Digestion and absorption",
        summary: "Follow the mechanical and chemical transformation of food until it enters the blood.",
        goals: [
          "Match each digestive organ to its main transformation.",
          "Say where and how nutrients pass into the blood."
        ],
        tutor:
          "Have the student follow a piece of bread from mouth to blood, naming the transformation at each step.",
        contexts: [
          "a piece of bread chewed then swallowed",
          "a fatty meal slowing stomach emptying",
          "a medicine taken during a meal"
        ]
      }
    },
    {
      key: "kidney_filtration",
      objectives: ["medicine_body"],
      stage: 3,
      fr: {
        title: "La filtration rénale",
        summary: "Comprendre l'enchaînement filtration, réabsorption et sécrétion qui produit l'urine.",
        goals: [
          "Ordonner les trois étapes de formation de l'urine.",
          "Expliquer pourquoi le volume filtré dépasse largement le volume émis."
        ],
        tutor:
          "Fais comparer le volume filtré chaque jour et le volume d'urine émis, puis demande ce qui explique l'écart.",
        contexts: [
          "une journée sans boire suffisamment",
          "une urine plus foncée le matin",
          "une consommation importante d'eau en une heure"
        ]
      },
      en: {
        title: "Kidney filtration",
        summary: "Understand the chain of filtration, reabsorption and secretion that produces urine.",
        goals: [
          "Order the three steps of urine formation.",
          "Explain why the filtered volume far exceeds the emitted volume."
        ],
        tutor:
          "Have the student compare the daily filtered volume and the emitted urine volume, then explain the gap.",
        contexts: [
          "a day without drinking enough",
          "darker urine in the morning",
          "a large water intake within an hour"
        ]
      }
    },
    {
      key: "hormonal_regulation",
      objectives: ["medicine_body"],
      stage: 3,
      fr: {
        title: "Les hormones et la régulation à distance",
        summary: "Comprendre une communication lente et diffuse fondée sur des récepteurs spécifiques.",
        goals: [
          "Comparer signal nerveux et signal hormonal sur trois critères.",
          "Expliquer pourquoi seules certaines cellules répondent à une hormone."
        ],
        tutor:
          "Fais comparer la réponse nerveuse et la réponse hormonale à un même stress, puis demande pourquoi toutes les cellules ne réagissent pas.",
        contexts: [
          "une montée d'adrénaline lors d'une frayeur",
          "une régulation de la glycémie après un repas",
          "une croissance étalée sur plusieurs années"
        ]
      },
      en: {
        title: "Hormones and regulation at a distance",
        summary: "Understand a slow, diffuse communication based on specific receptors.",
        goals: [
          "Compare nerve and hormone signals on three criteria.",
          "Explain why only some cells respond to a hormone."
        ],
        tutor:
          "Have the student compare the nervous and hormonal response to the same stress, then ask why not all cells react.",
        contexts: [
          "an adrenaline surge during a fright",
          "blood sugar regulation after a meal",
          "growth spread over several years"
        ]
      }
    },
    {
      key: "brain_regions",
      objectives: ["medicine_body"],
      stage: 4,
      fr: {
        title: "Les grandes régions du cerveau",
        summary: "Associer des fonctions à des régions tout en évitant la caricature des zones isolées.",
        goals: [
          "Associer trois régions à leurs fonctions dominantes.",
          "Expliquer pourquoi une fonction mobilise plusieurs régions."
        ],
        tutor:
          "Fais associer trois régions à leurs fonctions, puis demande pourquoi parler d'une zone unique du langage est réducteur.",
        contexts: [
          "la production et la compréhension du langage",
          "la coordination d'un geste précis",
          "la mémorisation d'un itinéraire"
        ]
      },
      en: {
        title: "The major brain regions",
        summary: "Match functions to regions while avoiding the caricature of isolated areas.",
        goals: [
          "Match three regions to their dominant functions.",
          "Explain why one function recruits several regions."
        ],
        tutor:
          "Have the student match three regions to their functions, then ask why speaking of a single language area is reductive.",
        contexts: [
          "producing and understanding language",
          "coordinating a precise gesture",
          "memorising a route"
        ]
      }
    },
    {
      key: "liver_functions",
      objectives: ["medicine_body"],
      stage: 4,
      fr: {
        title: "Les fonctions du foie",
        summary: "Comprendre pourquoi un même organe assure stockage, synthèse et transformation des substances.",
        goals: [
          "Citer trois fonctions distinctes du foie.",
          "Expliquer le rôle du foie dans le devenir d'un médicament."
        ],
        tutor:
          "Fais citer trois fonctions du foie, puis demande pourquoi un médicament avalé n'a pas le même effet qu'un médicament injecté.",
        contexts: [
          "un médicament avalé qui passe d'abord par le foie",
          "une réserve de sucre mobilisée pendant la nuit",
          "des protéines du sang fabriquées en continu"
        ]
      },
      en: {
        title: "The functions of the liver",
        summary: "Understand why one organ handles storage, synthesis and transformation of substances.",
        goals: [
          "Name three distinct liver functions.",
          "Explain the liver's role in the fate of a medicine."
        ],
        tutor:
          "Have the student name three liver functions, then ask why a swallowed medicine does not act like an injected one.",
        contexts: [
          "a swallowed medicine passing through the liver first",
          "a sugar reserve mobilised overnight",
          "blood proteins produced continuously"
        ]
      }
    },
    {
      key: "blood_composition",
      objectives: ["medicine_body"],
      stage: 4,
      fr: {
        title: "La composition du sang",
        summary: "Relier chaque composant du sang à sa fonction et lire un bilan sanguin de façon générale.",
        goals: [
          "Associer trois composants sanguins à leur fonction.",
          "Expliquer ce qu'un taux anormal signale en général."
        ],
        tutor:
          "Fais associer trois composants du sang à leur fonction, puis demande ce qu'un taux abaissé pourrait signaler de façon générale, sans interpréter de cas personnel.",
        contexts: [
          "un don du sang et ses composants séparés",
          "une plaie qui cesse de saigner",
          "un transport d'oxygène vers les muscles"
        ]
      },
      en: {
        title: "The composition of blood",
        summary: "Connect each blood component to its function and read a blood panel in general terms.",
        goals: [
          "Match three blood components to their function.",
          "Explain what an abnormal level signals in general."
        ],
        tutor:
          "Have the student match three blood components to their function, then ask what a low level could signal in general, without interpreting a personal case.",
        contexts: [
          "a blood donation separated into components",
          "a wound that stops bleeding",
          "oxygen transported to the muscles"
        ]
      }
    },
    {
      key: "sleep_and_circadian",
      objectives: ["medicine_body"],
      stage: 4,
      fr: {
        title: "Le sommeil et l'horloge biologique",
        summary: "Comprendre l'alternance des cycles de sommeil et le rôle de la lumière comme synchroniseur.",
        goals: [
          "Décrire la succession des stades au cours d'un cycle.",
          "Expliquer le rôle de la lumière dans le réglage de l'horloge."
        ],
        tutor:
          "Fais décrire l'enchaînement des stades d'un cycle, puis demande pourquoi la lumière du matin avance l'horloge interne.",
        contexts: [
          "un décalage horaire après un vol long",
          "un travail de nuit répété plusieurs semaines",
          "un réveil difficile en plein cycle profond"
        ]
      },
      en: {
        title: "Sleep and the biological clock",
        summary: "Understand the alternation of sleep cycles and the role of light as a synchroniser.",
        goals: [
          "Describe the succession of stages within a cycle.",
          "Explain the role of light in setting the clock."
        ],
        tutor:
          "Have the student describe the succession of stages in one cycle, then ask why morning light advances the internal clock.",
        contexts: [
          "jet lag after a long flight",
          "night work repeated over several weeks",
          "a hard awakening in the middle of deep sleep"
        ]
      }
    },
    {
      key: "reproduction_development",
      objectives: ["medicine_body"],
      stage: 5,
      fr: {
        title: "Reproduction et développement embryonnaire",
        summary: "Suivre les grandes étapes qui mènent d'une cellule unique à un organisme différencié.",
        goals: [
          "Ordonner les grandes étapes du développement précoce.",
          "Expliquer ce que signifie la différenciation cellulaire."
        ],
        tutor:
          "Fais ordonner les grandes étapes du développement précoce, puis demande comment des cellules identiques deviennent différentes.",
        contexts: [
          "une cellule unique devenue un organisme complet",
          "des cellules identiques qui se spécialisent",
          "un suivi de grossesse par imagerie"
        ]
      },
      en: {
        title: "Reproduction and embryonic development",
        summary: "Follow the major steps from a single cell to a differentiated organism.",
        goals: [
          "Order the major steps of early development.",
          "Explain what cell differentiation means."
        ],
        tutor:
          "Have the student order the major steps of early development, then ask how identical cells become different.",
        contexts: [
          "a single cell becoming a full organism",
          "identical cells that specialise",
          "a pregnancy followed through imaging"
        ]
      }
    },
    {
      key: "skin_barrier",
      objectives: ["medicine_body"],
      stage: 5,
      fr: {
        title: "La peau comme organe",
        summary: "Comprendre les fonctions de barrière, de régulation thermique et de perception de la peau.",
        goals: [
          "Citer trois fonctions de la peau au-delà de la protection.",
          "Décrire les étapes de la cicatrisation d'une plaie."
        ],
        tutor:
          "Fais citer trois fonctions de la peau, puis demande de décrire les étapes de la cicatrisation d'une coupure superficielle.",
        contexts: [
          "une coupure superficielle qui cicatrise",
          "une transpiration abondante par forte chaleur",
          "une exposition solaire prolongée"
        ]
      },
      en: {
        title: "The skin as an organ",
        summary: "Understand the barrier, thermal regulation and sensing functions of the skin.",
        goals: [
          "Name three skin functions beyond protection.",
          "Describe the steps of wound healing."
        ],
        tutor:
          "Have the student name three skin functions, then describe the healing steps of a superficial cut.",
        contexts: [
          "a superficial cut healing over",
          "heavy sweating in hot weather",
          "prolonged sun exposure"
        ]
      }
    },
    {
      key: "aging_physiology",
      objectives: ["medicine_body"],
      stage: 5,
      fr: {
        title: "Ce que le vieillissement change dans l'organisme",
        summary: "Distinguer les modifications physiologiques attendues des processus pathologiques.",
        goals: [
          "Citer trois changements physiologiques liés à l'âge.",
          "Distinguer un changement attendu d'un signe pathologique."
        ],
        tutor:
          "Fais distinguer trois changements attendus avec l'âge et un processus pathologique, en restant général et sans évoquer de cas personnel.",
        contexts: [
          "une masse musculaire qui diminue avec les décennies",
          "une récupération plus lente après un effort",
          "une audition moins fine dans les aigus"
        ]
      },
      en: {
        title: "What ageing changes in the body",
        summary: "Tell expected physiological changes apart from pathological processes.",
        goals: [
          "Name three physiological changes linked to age.",
          "Tell an expected change apart from a pathological sign."
        ],
        tutor:
          "Have the student separate three expected age-related changes from a pathological process, staying general and avoiding personal cases.",
        contexts: [
          "muscle mass decreasing over decades",
          "slower recovery after exercise",
          "reduced hearing in high frequencies"
        ]
      }
    },
    {
      key: "exercise_adaptation",
      objectives: ["medicine_body"],
      stage: 5,
      fr: {
        title: "Comment le corps s'adapte à l'effort répété",
        summary: "Comprendre l'adaptation progressive du cœur, des muscles et du métabolisme à l'entraînement.",
        goals: [
          "Décrire deux adaptations physiologiques à l'entraînement.",
          "Expliquer le rôle de la récupération dans l'adaptation."
        ],
        tutor:
          "Fais décrire deux adaptations obtenues après plusieurs semaines d'entraînement, puis demande pourquoi la récupération en fait partie.",
        contexts: [
          "un rythme cardiaque de repos qui baisse",
          "une même distance parcourue plus facilement",
          "une reprise après plusieurs mois d'arrêt"
        ]
      },
      en: {
        title: "How the body adapts to repeated exercise",
        summary: "Understand the gradual adaptation of heart, muscles and metabolism to training.",
        goals: [
          "Describe two physiological adaptations to training.",
          "Explain the role of recovery in adaptation."
        ],
        tutor:
          "Have the student describe two adaptations obtained after several weeks of training, then ask why recovery is part of it.",
        contexts: [
          "a resting heart rate going down",
          "the same distance covered more easily",
          "resuming after several months off"
        ]
      }
    },

    {
      key: "pathogen_types",
      objectives: ["medicine_disease"],
      stage: 1,
      fr: {
        title: "Bactéries, virus, champignons et parasites",
        summary: "Distinguer les grandes familles d'agents infectieux et ce que cela implique pour les traitements.",
        goals: [
          "Comparer bactérie et virus sur la structure et la reproduction.",
          "Expliquer pourquoi un antibiotique n'agit pas sur un virus."
        ],
        tutor:
          "Fais comparer une bactérie et un virus, puis demande pourquoi un antibiotique est inutile contre une infection virale.",
        contexts: [
          "une angine d'origine virale ou bactérienne",
          "une infection cutanée due à un champignon",
          "une contamination alimentaire par une bactérie"
        ]
      },
      en: {
        title: "Bacteria, viruses, fungi and parasites",
        summary: "Tell apart the major families of infectious agents and what that implies for treatment.",
        goals: [
          "Compare bacteria and viruses on structure and reproduction.",
          "Explain why an antibiotic does not act on a virus."
        ],
        tutor:
          "Have the student compare a bacterium and a virus, then ask why an antibiotic is useless against a viral infection.",
        contexts: [
          "a sore throat of viral or bacterial origin",
          "a skin infection caused by a fungus",
          "food contamination by a bacterium"
        ]
      }
    },
    {
      key: "infection_transmission",
      objectives: ["medicine_disease"],
      stage: 2,
      fr: {
        title: "Comment une infection se transmet",
        summary: "Relier le mode de transmission aux mesures de prévention réellement efficaces.",
        goals: [
          "Associer trois modes de transmission à leur prévention adaptée.",
          "Expliquer pourquoi une mesure efficace ici est inutile ailleurs."
        ],
        tutor:
          "Fais associer trois modes de transmission aux mesures adaptées, puis demande pourquoi la même mesure ne convient pas partout.",
        contexts: [
          "une transmission par gouttelettes dans une salle fermée",
          "une contamination par les mains et les surfaces",
          "une infection transmise par un insecte piqueur"
        ]
      },
      en: {
        title: "How an infection spreads",
        summary: "Connect the transmission route to the prevention measures that actually work.",
        goals: [
          "Match three transmission routes to their fitting prevention.",
          "Explain why a measure effective here is useless elsewhere."
        ],
        tutor:
          "Have the student match three transmission routes to fitting measures, then ask why the same measure does not suit all of them.",
        contexts: [
          "droplet transmission in a closed room",
          "contamination through hands and surfaces",
          "an infection carried by a biting insect"
        ]
      }
    },
    {
      key: "inflammation",
      objectives: ["medicine_disease"],
      stage: 2,
      fr: {
        title: "L'inflammation : utile et dangereuse",
        summary: "Comprendre pourquoi une réaction protectrice devient nuisible lorsqu'elle se prolonge.",
        goals: [
          "Citer les signes classiques d'une inflammation aiguë.",
          "Opposer inflammation aiguë et inflammation chronique."
        ],
        tutor:
          "Fais citer les signes d'une inflammation aiguë, puis demande ce qui change quand elle persiste pendant des mois.",
        contexts: [
          "une entorse gonflée et douloureuse",
          "une inflammation persistante d'une articulation",
          "une rougeur autour d'une plaie infectée"
        ]
      },
      en: {
        title: "Inflammation: useful and dangerous",
        summary: "Understand why a protective reaction becomes harmful when it persists.",
        goals: [
          "Name the classic signs of acute inflammation.",
          "Contrast acute and chronic inflammation."
        ],
        tutor:
          "Have the student name the signs of acute inflammation, then ask what changes when it persists for months.",
        contexts: [
          "a swollen and painful sprain",
          "persistent inflammation of a joint",
          "redness around an infected wound"
        ]
      }
    },
    {
      key: "antibiotic_resistance",
      objectives: ["medicine_disease"],
      stage: 3,
      fr: {
        title: "La résistance aux antibiotiques",
        summary: "Comprendre la sélection de bactéries résistantes et ses conséquences collectives.",
        goals: [
          "Expliquer le mécanisme de sélection des bactéries résistantes.",
          "Dire pourquoi la résistance est un problème collectif."
        ],
        tutor:
          "Fais expliquer ce qui arrive aux bactéries survivantes après un traitement incomplet, puis demande l'effet à l'échelle d'une population.",
        contexts: [
          "un traitement interrompu dès la disparition des symptômes",
          "un usage massif d'antibiotiques en élevage",
          "une infection hospitalière difficile à traiter"
        ]
      },
      en: {
        title: "Antibiotic resistance",
        summary: "Understand the selection of resistant bacteria and its collective consequences.",
        goals: [
          "Explain the selection mechanism of resistant bacteria.",
          "Say why resistance is a collective problem."
        ],
        tutor:
          "Have the student explain what happens to surviving bacteria after an incomplete course, then ask the effect at population scale.",
        contexts: [
          "a course stopped as soon as symptoms disappear",
          "heavy antibiotic use in livestock farming",
          "a hospital infection that is hard to treat"
        ]
      }
    },
    {
      key: "cancer_mechanisms",
      objectives: ["medicine_disease"],
      stage: 3,
      fr: {
        title: "Comment naît un cancer",
        summary: "Comprendre l'accumulation d'altérations qui libère une cellule des contrôles de division.",
        goals: [
          "Expliquer pourquoi une seule mutation ne suffit généralement pas.",
          "Distinguer une tumeur locale d'une dissémination."
        ],
        tutor:
          "Fais expliquer pourquoi plusieurs altérations sont nécessaires, puis demande ce que change une dissémination à distance. Reste général et n'évoque aucun cas personnel.",
        contexts: [
          "une exposition prolongée à un agent cancérigène",
          "des mécanismes de réparation de l'ADN défaillants",
          "une tumeur détectée à un stade précoce"
        ]
      },
      en: {
        title: "How a cancer arises",
        summary: "Understand the accumulation of alterations that frees a cell from division controls.",
        goals: [
          "Explain why a single mutation is usually not enough.",
          "Tell a local tumour apart from a dissemination."
        ],
        tutor:
          "Have the student explain why several alterations are needed, then ask what distant spread changes. Stay general and avoid any personal case.",
        contexts: [
          "prolonged exposure to a carcinogenic agent",
          "failing DNA repair mechanisms",
          "a tumour detected at an early stage"
        ]
      }
    },
    {
      key: "autoimmune_disease",
      objectives: ["medicine_disease"],
      stage: 3,
      fr: {
        title: "Les maladies auto-immunes",
        summary: "Comprendre une réponse immunitaire dirigée contre les propres tissus de l'organisme.",
        goals: [
          "Expliquer ce qu'est une perte de tolérance immunitaire.",
          "Dire pourquoi ces maladies évoluent souvent par poussées."
        ],
        tutor:
          "Fais expliquer ce que signifie une perte de tolérance, puis demande pourquoi l'évolution se fait souvent par poussées. Reste général.",
        contexts: [
          "une atteinte articulaire évoluant par poussées",
          "une destruction progressive de cellules productrices d'hormone",
          "un traitement qui module la réponse immunitaire"
        ]
      },
      en: {
        title: "Autoimmune diseases",
        summary: "Understand an immune response directed against the body's own tissues.",
        goals: [
          "Explain what a loss of immune tolerance is.",
          "Say why these diseases often progress in flares."
        ],
        tutor:
          "Have the student explain what loss of tolerance means, then ask why progression often happens in flares. Stay general.",
        contexts: [
          "joint involvement progressing in flares",
          "progressive destruction of hormone-producing cells",
          "a treatment that modulates the immune response"
        ]
      }
    },
    {
      key: "genetic_disease",
      objectives: ["medicine_disease"],
      stage: 3,
      fr: {
        title: "Les maladies génétiques",
        summary: "Distinguer une maladie liée à un seul gène d'une prédisposition multifactorielle.",
        goals: [
          "Comparer maladie monogénique et prédisposition multifactorielle.",
          "Expliquer ce qu'un facteur de risque génétique ne détermine pas."
        ],
        tutor:
          "Fais comparer une maladie monogénique et une prédisposition, puis demande ce qu'un résultat génétique ne permet pas de conclure. Reste général.",
        contexts: [
          "une maladie transmise selon un schéma familial clair",
          "une prédisposition combinée à un mode de vie",
          "un test génétique proposé au grand public"
        ]
      },
      en: {
        title: "Genetic diseases",
        summary: "Tell apart a single-gene disease and a multifactorial predisposition.",
        goals: [
          "Compare a monogenic disease and a multifactorial predisposition.",
          "Explain what a genetic risk factor does not determine."
        ],
        tutor:
          "Have the student compare a monogenic disease and a predisposition, then ask what a genetic result cannot conclude. Stay general.",
        contexts: [
          "a disease transmitted along a clear family pattern",
          "a predisposition combined with lifestyle",
          "a genetic test marketed to the general public"
        ]
      }
    },
    {
      key: "cardiovascular_risk",
      objectives: ["medicine_disease"],
      stage: 4,
      fr: {
        title: "Comment se construit un risque cardiovasculaire",
        summary: "Comprendre l'accumulation lente de facteurs qui aboutit à un événement brutal.",
        goals: [
          "Distinguer un facteur de risque modifiable d'un facteur non modifiable.",
          "Expliquer pourquoi le risque se calcule globalement et non facteur par facteur."
        ],
        tutor:
          "Fais distinguer facteurs modifiables et non modifiables, puis demande pourquoi un score global vaut mieux qu'un seul chiffre. Reste général.",
        contexts: [
          "un dépôt qui se constitue sur des décennies",
          "un score de risque calculé en population",
          "un événement aigu survenant sans signe préalable"
        ]
      },
      en: {
        title: "How cardiovascular risk builds up",
        summary: "Understand the slow accumulation of factors leading to a sudden event.",
        goals: [
          "Tell a modifiable risk factor apart from a non-modifiable one.",
          "Explain why risk is computed globally rather than factor by factor."
        ],
        tutor:
          "Have the student separate modifiable and non-modifiable factors, then ask why a global score beats a single figure. Stay general.",
        contexts: [
          "a deposit building over decades",
          "a risk score computed at population level",
          "an acute event occurring with no prior sign"
        ]
      }
    },
    {
      key: "diabetes_mechanism",
      objectives: ["medicine_disease"],
      stage: 4,
      fr: {
        title: "Le mécanisme du diabète",
        summary: "Distinguer un défaut de production d'insuline d'une résistance des tissus à son action.",
        goals: [
          "Comparer les deux principaux mécanismes.",
          "Expliquer pourquoi une glycémie élevée abîme les vaisseaux à long terme."
        ],
        tutor:
          "Fais comparer les deux mécanismes principaux, puis demande pourquoi les complications touchent surtout les petits vaisseaux. Reste général.",
        contexts: [
          "une insuline absente faute de cellules productrices",
          "des tissus qui répondent mal à l'insuline présente",
          "un suivi de glycémie sur plusieurs mois"
        ]
      },
      en: {
        title: "The mechanism of diabetes",
        summary: "Tell apart a defect in insulin production and a tissue resistance to its action.",
        goals: [
          "Compare the two main mechanisms.",
          "Explain why high blood sugar damages vessels over time."
        ],
        tutor:
          "Have the student compare the two main mechanisms, then ask why complications mostly affect small vessels. Stay general.",
        contexts: [
          "insulin absent for lack of producing cells",
          "tissues responding poorly to available insulin",
          "blood sugar monitored over several months"
        ]
      }
    },
    {
      key: "neurodegenerative_disease",
      objectives: ["medicine_disease"],
      stage: 4,
      fr: {
        title: "Les maladies neurodégénératives",
        summary: "Comprendre une perte progressive de neurones et le décalage entre lésions et symptômes.",
        goals: [
          "Expliquer pourquoi les symptômes apparaissent tardivement.",
          "Distinguer un déclin cognitif attendu d'un processus pathologique."
        ],
        tutor:
          "Fais expliquer pourquoi les symptômes apparaissent longtemps après les premières lésions. Reste général et n'évoque aucun cas personnel.",
        contexts: [
          "des lésions présentes des années avant les symptômes",
          "une compensation par d'autres circuits neuronaux",
          "un suivi de recherche sur plusieurs années"
        ]
      },
      en: {
        title: "Neurodegenerative diseases",
        summary: "Understand a progressive loss of neurons and the lag between lesions and symptoms.",
        goals: [
          "Explain why symptoms appear late.",
          "Tell an expected cognitive decline apart from a pathological process."
        ],
        tutor:
          "Have the student explain why symptoms appear long after the first lesions. Stay general and avoid any personal case.",
        contexts: [
          "lesions present years before symptoms",
          "compensation by other neural circuits",
          "a research follow-up over several years"
        ]
      }
    },
    {
      key: "mental_health_biology",
      objectives: ["medicine_disease"],
      stage: 4,
      fr: {
        title: "Ce que la biologie explique des troubles psychiques",
        summary: "Situer la part biologique parmi les facteurs psychologiques et sociaux, sans réduction abusive.",
        goals: [
          "Citer trois familles de facteurs impliqués dans un trouble.",
          "Expliquer pourquoi une explication uniquement chimique est réductrice."
        ],
        tutor:
          "Fais citer trois familles de facteurs, puis demande pourquoi une explication uniquement chimique est insuffisante. Reste général.",
        contexts: [
          "une vulnérabilité familiale associée à un événement de vie",
          "une explication publique réduite à un déséquilibre chimique",
          "un accompagnement combinant plusieurs approches"
        ]
      },
      en: {
        title: "What biology explains about mental health conditions",
        summary: "Place the biological share among psychological and social factors, without undue reduction.",
        goals: [
          "Name three families of factors involved in a condition.",
          "Explain why a purely chemical account is reductive."
        ],
        tutor:
          "Have the student name three families of factors, then ask why a purely chemical account is insufficient. Stay general.",
        contexts: [
          "a family vulnerability combined with a life event",
          "a public account reduced to a chemical imbalance",
          "care combining several approaches"
        ]
      }
    },
    {
      key: "epidemic_dynamics",
      objectives: ["medicine_disease"],
      stage: 5,
      fr: {
        title: "La dynamique d'une épidémie",
        summary: "Relier le nombre de reproduction, le délai entre contaminations et l'effet des mesures.",
        goals: [
          "Interpréter un nombre de reproduction supérieur ou inférieur à un.",
          "Expliquer le décalage entre une mesure et son effet visible."
        ],
        tutor:
          "Fais interpréter un nombre de reproduction de 1,3, puis demande pourquoi l'effet d'une mesure met deux semaines à se voir.",
        contexts: [
          "un nombre de reproduction estimé à 1,3",
          "une courbe de cas qui continue de monter après une mesure",
          "une couverture vaccinale partielle dans une population"
        ]
      },
      en: {
        title: "The dynamics of an epidemic",
        summary: "Connect the reproduction number, the delay between infections and the effect of measures.",
        goals: [
          "Interpret a reproduction number above or below one.",
          "Explain the lag between a measure and its visible effect."
        ],
        tutor:
          "Have the student interpret a reproduction number of 1.3, then ask why a measure takes two weeks to show its effect.",
        contexts: [
          "a reproduction number estimated at 1.3",
          "a case curve still rising after a measure",
          "partial vaccine coverage in a population"
        ]
      }
    },
    {
      key: "chronic_disease_progression",
      objectives: ["medicine_disease"],
      stage: 5,
      fr: {
        title: "L'évolution d'une maladie chronique",
        summary: "Comprendre une trajectoire longue faite de stabilité, de poussées et d'adaptations du suivi.",
        goals: [
          "Décrire les phases typiques d'une trajectoire chronique.",
          "Expliquer le rôle du suivi régulier dans cette trajectoire."
        ],
        tutor:
          "Fais décrire les phases d'une trajectoire chronique, puis demande à quoi sert un suivi régulier en période stable. Reste général.",
        contexts: [
          "une période stable de plusieurs années",
          "une poussée déclenchée par une infection",
          "un ajustement de suivi après un changement d'état"
        ]
      },
      en: {
        title: "The course of a chronic disease",
        summary: "Understand a long trajectory of stability, flares and adjustments to follow-up.",
        goals: [
          "Describe the typical phases of a chronic trajectory.",
          "Explain the role of regular follow-up along that trajectory."
        ],
        tutor:
          "Have the student describe the phases of a chronic trajectory, then ask what regular follow-up achieves in a stable period. Stay general.",
        contexts: [
          "a stable period lasting several years",
          "a flare triggered by an infection",
          "a follow-up adjusted after a change in condition"
        ]
      }
    },
    {
      key: "comorbidity",
      objectives: ["medicine_disease"],
      stage: 5,
      fr: {
        title: "Les comorbidités",
        summary: "Comprendre pourquoi plusieurs maladies simultanées compliquent le raisonnement médical.",
        goals: [
          "Expliquer comment deux maladies peuvent aggraver leurs effets mutuels.",
          "Dire pourquoi les recommandations isolées se contredisent parfois."
        ],
        tutor:
          "Fais expliquer pourquoi deux recommandations distinctes peuvent devenir contradictoires chez une même personne. Reste général.",
        contexts: [
          "deux recommandations qui s'opposent pour un même patient",
          "des essais cliniques excluant les patients complexes",
          "un suivi coordonné entre plusieurs spécialités"
        ]
      },
      en: {
        title: "Comorbidities",
        summary: "Understand why several simultaneous diseases complicate medical reasoning.",
        goals: [
          "Explain how two diseases can worsen each other's effects.",
          "Say why isolated guidelines sometimes contradict each other."
        ],
        tutor:
          "Have the student explain why two separate guidelines can become contradictory for one person. Stay general.",
        contexts: [
          "two guidelines conflicting for one patient",
          "clinical trials excluding complex patients",
          "care coordinated across several specialties"
        ]
      }
    },
    {
      key: "rare_disease_diagnosis",
      objectives: ["medicine_disease"],
      stage: 5,
      fr: {
        title: "Le parcours diagnostique d'une maladie rare",
        summary: "Comprendre pourquoi une maladie rare met souvent des années à être identifiée.",
        goals: [
          "Expliquer pourquoi les hypothèses fréquentes sont explorées en premier.",
          "Dire ce qu'un registre de maladies rares apporte."
        ],
        tutor:
          "Fais expliquer pourquoi les hypothèses les plus fréquentes sont explorées d'abord, puis demande ce qu'un registre change. Reste général.",
        contexts: [
          "un symptôme compatible avec vingt maladies courantes",
          "un délai de plusieurs années avant identification",
          "un registre national regroupant des cas dispersés"
        ]
      },
      en: {
        title: "The diagnostic journey of a rare disease",
        summary: "Understand why a rare disease often takes years to be identified.",
        goals: [
          "Explain why frequent hypotheses are explored first.",
          "Say what a rare disease registry brings."
        ],
        tutor:
          "Have the student explain why the most frequent hypotheses are explored first, then ask what a registry changes. Stay general.",
        contexts: [
          "a symptom compatible with twenty common diseases",
          "a delay of several years before identification",
          "a national registry gathering scattered cases"
        ]
      }
    },

    {
      key: "what_is_a_drug",
      objectives: ["medicine_evidence"],
      stage: 1,
      fr: {
        title: "Ce qu'est un médicament",
        summary: "Distinguer principe actif, excipients et forme galénique, et comprendre ce que chacun apporte.",
        goals: [
          "Distinguer principe actif et excipients sur une notice.",
          "Expliquer ce que la forme du médicament change à son action."
        ],
        tutor:
          "Fais lire la composition d'une notice et distinguer principe actif et excipients, puis demande ce que change une forme à libération prolongée.",
        contexts: [
          "une notice listant plusieurs composants",
          "un comprimé à libération prolongée",
          "un générique comparé à un médicament d'origine"
        ]
      },
      en: {
        title: "What a medicine is",
        summary: "Tell apart active ingredient, excipients and dosage form, and what each contributes.",
        goals: [
          "Tell active ingredient from excipients on a leaflet.",
          "Explain what the dosage form changes about the action."
        ],
        tutor:
          "Have the student read a leaflet's composition and separate active ingredient from excipients, then ask what an extended-release form changes.",
        contexts: [
          "a leaflet listing several components",
          "an extended-release tablet",
          "a generic compared with an originator medicine"
        ]
      }
    },
    {
      key: "dose_response",
      objectives: ["medicine_evidence"],
      stage: 2,
      fr: {
        title: "La relation dose-effet",
        summary: "Comprendre la courbe qui relie une dose à un effet et la marge entre efficacité et toxicité.",
        goals: [
          "Décrire l'allure d'une courbe dose-effet.",
          "Expliquer ce qu'est une marge thérapeutique étroite."
        ],
        tutor:
          "Fais décrire l'allure d'une courbe dose-effet, puis demande ce qu'implique une marge thérapeutique étroite pour la surveillance.",
        contexts: [
          "un effet qui n'augmente plus au-delà d'une dose",
          "une substance efficace à faible dose et toxique au-delà",
          "un ajustement de dose selon le poids"
        ]
      },
      en: {
        title: "The dose-response relationship",
        summary: "Understand the curve linking dose to effect and the margin between efficacy and toxicity.",
        goals: [
          "Describe the shape of a dose-response curve.",
          "Explain what a narrow therapeutic margin is."
        ],
        tutor:
          "Have the student describe the shape of a dose-response curve, then ask what a narrow margin implies for monitoring.",
        contexts: [
          "an effect that stops rising beyond a dose",
          "a substance effective at low dose and toxic above",
          "a dose adjusted to body weight"
        ]
      }
    },
    {
      key: "drug_journey",
      objectives: ["medicine_evidence"],
      stage: 2,
      fr: {
        title: "Le trajet d'un médicament dans le corps",
        summary: "Suivre absorption, distribution, métabolisme et élimination pour comprendre la durée d'action.",
        goals: [
          "Ordonner les quatre étapes du devenir d'un médicament.",
          "Expliquer ce que la demi-vie détermine dans un schéma de prise."
        ],
        tutor:
          "Fais ordonner les quatre étapes, puis demande pourquoi certains médicaments se prennent une fois par jour et d'autres trois fois.",
        contexts: [
          "un médicament pris trois fois par jour",
          "une prise à jeun ou pendant le repas",
          "une élimination ralentie chez une personne âgée"
        ]
      },
      en: {
        title: "The journey of a medicine through the body",
        summary: "Follow absorption, distribution, metabolism and elimination to understand duration of action.",
        goals: [
          "Order the four steps of a medicine's fate.",
          "Explain what half-life determines in a dosing schedule."
        ],
        tutor:
          "Have the student order the four steps, then ask why some medicines are taken once a day and others three times.",
        contexts: [
          "a medicine taken three times a day",
          "a dose taken fasting or with a meal",
          "slowed elimination in an older person"
        ]
      }
    },
    {
      key: "clinical_trial_phases",
      objectives: ["medicine_evidence"],
      stage: 3,
      fr: {
        title: "Les phases d'un essai clinique",
        summary: "Associer chaque phase à la question qu'elle cherche à trancher et à sa population.",
        goals: [
          "Associer chaque phase à sa question principale.",
          "Expliquer pourquoi un effet rare n'apparaît qu'après commercialisation."
        ],
        tutor:
          "Fais associer chaque phase à sa question, puis demande pourquoi un effet indésirable rare échappe souvent aux essais.",
        contexts: [
          "un essai de tolérance sur quelques dizaines de volontaires",
          "une comparaison à un traitement existant sur des milliers de patients",
          "un effet indésirable détecté après plusieurs années d'usage"
        ]
      },
      en: {
        title: "The phases of a clinical trial",
        summary: "Match each phase to the question it aims to settle and to its population.",
        goals: [
          "Match each phase to its main question.",
          "Explain why a rare effect only appears after marketing."
        ],
        tutor:
          "Have the student match each phase to its question, then ask why a rare adverse effect often escapes trials.",
        contexts: [
          "a tolerance trial on a few dozen volunteers",
          "a comparison to an existing treatment on thousands of patients",
          "an adverse effect detected after years of use"
        ]
      }
    },
    {
      key: "placebo_control",
      objectives: ["medicine_evidence"],
      stage: 3,
      fr: {
        title: "Le placebo et le groupe témoin",
        summary: "Comprendre pourquoi un groupe de comparaison est nécessaire pour attribuer un effet au traitement.",
        goals: [
          "Expliquer ce qu'un groupe témoin permet d'isoler.",
          "Citer deux phénomènes confondus avec un effet du traitement."
        ],
        tutor:
          "Fais expliquer pourquoi une amélioration observée sans groupe témoin ne prouve rien, puis demande deux explications alternatives.",
        contexts: [
          "une amélioration observée sans comparaison",
          "une maladie qui guérit spontanément en une semaine",
          "un essai où les deux groupes s'améliorent"
        ]
      },
      en: {
        title: "Placebo and the control group",
        summary: "Understand why a comparison group is needed to attribute an effect to the treatment.",
        goals: [
          "Explain what a control group isolates.",
          "Name two phenomena confused with a treatment effect."
        ],
        tutor:
          "Have the student explain why an improvement without a control group proves nothing, then give two alternative explanations.",
        contexts: [
          "an improvement observed with no comparison",
          "a condition that resolves on its own within a week",
          "a trial where both groups improve"
        ]
      }
    },
    {
      key: "randomization_blinding",
      objectives: ["medicine_evidence"],
      stage: 3,
      fr: {
        title: "Randomisation et insu",
        summary: "Comprendre ce que le tirage au sort et l'aveugle éliminent comme biais.",
        goals: [
          "Expliquer ce que la randomisation équilibre entre les groupes.",
          "Dire ce que l'insu protège chez le patient et chez l'évaluateur."
        ],
        tutor:
          "Fais expliquer ce que la randomisation équilibre, puis demande ce qui se passe si l'évaluateur connaît le groupe de chaque patient.",
        contexts: [
          "deux groupes constitués par tirage au sort",
          "un évaluateur qui connaît le traitement reçu",
          "un essai où les patients devinent leur groupe"
        ]
      },
      en: {
        title: "Randomisation and blinding",
        summary: "Understand which biases random allocation and blinding eliminate.",
        goals: [
          "Explain what randomisation balances between groups.",
          "Say what blinding protects in the patient and in the assessor."
        ],
        tutor:
          "Have the student explain what randomisation balances, then ask what happens if the assessor knows each patient's group.",
        contexts: [
          "two groups formed by random allocation",
          "an assessor who knows the treatment received",
          "a trial where patients guess their group"
        ]
      }
    },
    {
      key: "pharmacovigilance",
      objectives: ["medicine_evidence"],
      stage: 3,
      fr: {
        title: "La pharmacovigilance",
        summary: "Comprendre la surveillance après commercialisation et ce qu'un signalement isolé prouve.",
        goals: [
          "Expliquer pourquoi la surveillance continue après l'autorisation.",
          "Dire ce qu'un signalement isolé permet et ne permet pas de conclure."
        ],
        tutor:
          "Fais expliquer ce qu'un signalement isolé permet de conclure, puis demande ce qu'il faut pour établir un lien de causalité.",
        contexts: [
          "un signalement isolé après une vaccination",
          "un effet rare détecté sur un million de doses",
          "un retrait de médicament décidé après plusieurs années"
        ]
      },
      en: {
        title: "Pharmacovigilance",
        summary: "Understand post-marketing surveillance and what an isolated report proves.",
        goals: [
          "Explain why surveillance continues after authorisation.",
          "Say what an isolated report can and cannot establish."
        ],
        tutor:
          "Have the student explain what an isolated report establishes, then ask what is needed to show causality.",
        contexts: [
          "an isolated report after a vaccination",
          "a rare effect detected across a million doses",
          "a medicine withdrawn after several years"
        ]
      }
    },
    {
      key: "relative_absolute_risk",
      objectives: ["medicine_evidence"],
      stage: 4,
      fr: {
        title: "Risque relatif et risque absolu",
        summary: "Traduire une réduction annoncée en pourcentage en effet réellement attendu dans une population.",
        goals: [
          "Convertir une réduction relative en réduction absolue.",
          "Expliquer pourquoi la présentation relative impressionne davantage."
        ],
        tutor:
          "Fais convertir une réduction de 50 % appliquée à un risque de 2 pour 1000, puis demande laquelle des deux formulations informe le mieux.",
        contexts: [
          "un titre annonçant un risque divisé par deux",
          "un risque initial de deux cas pour mille",
          "une communication publique sur un traitement préventif"
        ]
      },
      en: {
        title: "Relative and absolute risk",
        summary: "Translate an announced percentage reduction into the effect actually expected in a population.",
        goals: [
          "Convert a relative reduction into an absolute one.",
          "Explain why the relative presentation impresses more."
        ],
        tutor:
          "Have the student convert a 50% reduction applied to a risk of 2 per 1000, then ask which framing informs better.",
        contexts: [
          "a headline announcing a risk halved",
          "a baseline risk of two cases per thousand",
          "public communication about a preventive treatment"
        ]
      }
    },
    {
      key: "number_needed_to_treat",
      objectives: ["medicine_evidence"],
      stage: 4,
      fr: {
        title: "Le nombre de sujets à traiter",
        summary: "Traduire un bénéfice statistique en nombre de personnes à traiter pour éviter un événement.",
        goals: [
          "Calculer un nombre de sujets à traiter à partir d'une réduction absolue.",
          "Comparer bénéfice attendu et effets indésirables attendus."
        ],
        tutor:
          "Fais calculer un nombre de sujets à traiter à partir d'une réduction absolue, puis demande comment le comparer aux effets indésirables.",
        contexts: [
          "un traitement préventif à large échelle",
          "un bénéfice obtenu chez une personne sur cent traitées",
          "un effet indésirable survenant chez une personne sur cinquante"
        ]
      },
      en: {
        title: "The number needed to treat",
        summary: "Translate a statistical benefit into how many people must be treated to avoid one event.",
        goals: [
          "Compute a number needed to treat from an absolute reduction.",
          "Compare expected benefit with expected adverse effects."
        ],
        tutor:
          "Have the student compute a number needed to treat from an absolute reduction, then compare it with adverse effects.",
        contexts: [
          "a large-scale preventive treatment",
          "a benefit obtained in one person out of a hundred treated",
          "an adverse effect occurring in one person out of fifty"
        ]
      }
    },
    {
      key: "screening_tradeoffs",
      objectives: ["medicine_evidence"],
      stage: 4,
      fr: {
        title: "Les compromis d'un dépistage",
        summary: "Peser bénéfice attendu, faux positifs et surdiagnostic avant d'élargir un dépistage.",
        goals: [
          "Expliquer ce qu'est un surdiagnostic.",
          "Dire pourquoi dépister plus largement n'est pas toujours bénéfique."
        ],
        tutor:
          "Fais estimer le nombre de faux positifs d'un dépistage en population, puis demande ce que le surdiagnostic ajoute comme coût.",
        contexts: [
          "un dépistage proposé à toute une classe d'âge",
          "des examens complémentaires déclenchés par un faux positif",
          "une anomalie détectée qui n'aurait jamais causé de symptôme"
        ]
      },
      en: {
        title: "The trade-offs of screening",
        summary: "Weigh expected benefit, false positives and overdiagnosis before broadening a screening programme.",
        goals: [
          "Explain what overdiagnosis is.",
          "Say why screening more widely is not always beneficial."
        ],
        tutor:
          "Have the student estimate the false positives of a population screening, then ask what overdiagnosis adds as a cost.",
        contexts: [
          "a screening offered to a whole age group",
          "follow-up tests triggered by a false positive",
          "a detected anomaly that would never have caused symptoms"
        ]
      }
    },
    {
      key: "vaccine_mechanism",
      objectives: ["medicine_evidence"],
      stage: 4,
      fr: {
        title: "Comment fonctionne un vaccin",
        summary: "Relier la présentation d'un antigène à la mémoire immunitaire et à la protection collective.",
        goals: [
          "Décrire le mécanisme de la mémoire immunitaire induite.",
          "Expliquer ce que la couverture vaccinale change pour une population."
        ],
        tutor:
          "Fais décrire ce qui se passe lors de la première puis de la seconde rencontre avec l'agent, puis demande l'effet d'une couverture élevée.",
        contexts: [
          "une première exposition sous forme vaccinale",
          "une couverture élevée protégeant des personnes non vaccinées",
          "un rappel administré à distance de la première dose"
        ]
      },
      en: {
        title: "How a vaccine works",
        summary: "Connect antigen presentation to immune memory and to population-level protection.",
        goals: [
          "Describe the mechanism of induced immune memory.",
          "Explain what vaccine coverage changes for a population."
        ],
        tutor:
          "Have the student describe the first then the second encounter with the agent, then ask the effect of high coverage.",
        contexts: [
          "a first exposure in vaccine form",
          "high coverage protecting unvaccinated people",
          "a booster given long after the first dose"
        ]
      }
    },
    {
      key: "evidence_hierarchy",
      objectives: ["medicine_evidence"],
      stage: 5,
      fr: {
        title: "La hiérarchie des preuves",
        summary: "Classer les sources selon leur capacité à établir un lien de cause à effet.",
        goals: [
          "Classer quatre types d'études par niveau de preuve.",
          "Dire pourquoi une étude observationnelle ne conclut pas à la causalité."
        ],
        tutor:
          "Fais classer quatre sources par niveau de preuve, puis demande pourquoi un témoignage individuel se situe en bas du classement.",
        contexts: [
          "un témoignage individuel relayé en ligne",
          "une étude observationnelle sur dix mille personnes",
          "un essai randomisé contre placebo"
        ]
      },
      en: {
        title: "The hierarchy of evidence",
        summary: "Rank sources by their ability to establish a cause-and-effect link.",
        goals: [
          "Rank four study types by evidence level.",
          "Say why an observational study does not conclude causality."
        ],
        tutor:
          "Have the student rank four sources by evidence level, then ask why an individual testimony sits at the bottom.",
        contexts: [
          "an individual testimony shared online",
          "an observational study on ten thousand people",
          "a randomised placebo-controlled trial"
        ]
      }
    },
    {
      key: "meta_analysis",
      objectives: ["medicine_evidence"],
      stage: 5,
      fr: {
        title: "La méta-analyse",
        summary: "Comprendre l'agrégation de plusieurs études et ce que l'hétérogénéité entre elles signale.",
        goals: [
          "Expliquer ce qu'une méta-analyse gagne par rapport à une étude isolée.",
          "Dire ce qu'une forte hétérogénéité doit faire suspecter."
        ],
        tutor:
          "Fais expliquer ce qu'une méta-analyse apporte, puis demande ce qu'il faut conclure quand les études incluses se contredisent.",
        contexts: [
          "douze études de tailles très différentes",
          "des résultats contradictoires entre deux pays",
          "une conclusion reposant surtout sur une seule grande étude"
        ]
      },
      en: {
        title: "Meta-analysis",
        summary: "Understand the aggregation of several studies and what heterogeneity between them signals.",
        goals: [
          "Explain what a meta-analysis gains over a single study.",
          "Say what strong heterogeneity should raise as a suspicion."
        ],
        tutor:
          "Have the student explain what a meta-analysis adds, then ask what to conclude when included studies contradict each other.",
        contexts: [
          "twelve studies of very different sizes",
          "contradictory results between two countries",
          "a conclusion resting mostly on one large study"
        ]
      }
    },
    {
      key: "publication_bias",
      objectives: ["medicine_evidence"],
      stage: 5,
      fr: {
        title: "Le biais de publication",
        summary: "Comprendre comment la non-publication des résultats négatifs déforme l'état des connaissances.",
        goals: [
          "Expliquer l'effet de la non-publication des essais négatifs.",
          "Citer un dispositif qui limite ce biais."
        ],
        tutor:
          "Fais expliquer ce que change la non-publication de dix essais négatifs sur douze, puis demande quel dispositif corrige ce problème.",
        contexts: [
          "dix essais négatifs jamais publiés",
          "un registre d'essais déclarés avant leur démarrage",
          "une littérature qui semble unanimement favorable"
        ]
      },
      en: {
        title: "Publication bias",
        summary: "Understand how not publishing negative results distorts the state of knowledge.",
        goals: [
          "Explain the effect of unpublished negative trials.",
          "Name a mechanism that limits this bias."
        ],
        tutor:
          "Have the student explain what ten unpublished negative trials out of twelve change, then ask which mechanism fixes it.",
        contexts: [
          "ten negative trials never published",
          "a trial registry filled in before the study starts",
          "a literature that looks unanimously favourable"
        ]
      }
    },
    {
      key: "reading_guidelines",
      objectives: ["medicine_evidence"],
      stage: 5,
      fr: {
        title: "Lire une recommandation médicale",
        summary: "Comprendre le niveau de preuve, la force d'une recommandation et les conflits d'intérêts déclarés.",
        goals: [
          "Distinguer force de recommandation et niveau de preuve.",
          "Repérer les éléments de transparence attendus dans un document."
        ],
        tutor:
          "Fais distinguer force de recommandation et niveau de preuve dans un extrait, puis demande quels éléments de transparence vérifier.",
        contexts: [
          "une recommandation forte fondée sur un niveau de preuve faible",
          "une mise à jour publiée cinq ans après la précédente",
          "une déclaration de liens d'intérêts en fin de document"
        ]
      },
      en: {
        title: "Reading a clinical guideline",
        summary: "Understand evidence level, strength of recommendation and declared conflicts of interest.",
        goals: [
          "Tell strength of recommendation apart from evidence level.",
          "Spot the transparency elements expected in a document."
        ],
        tutor:
          "Have the student separate strength of recommendation from evidence level in an extract, then ask which transparency elements to check.",
        contexts: [
          "a strong recommendation based on weak evidence",
          "an update published five years after the previous one",
          "a conflict-of-interest statement at the end of the document"
        ]
      }
    }
  ]
};
