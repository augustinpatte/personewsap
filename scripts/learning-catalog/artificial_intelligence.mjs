// Artificial intelligence concepts.
// Shared base: 9 steps eligible for the three orientations.
// ai_foundations: how models learn, produce outputs, fail and are evaluated.
// ai_machine_learning: data, statistics, training, metrics, main algorithms.
// ai_building: models in products, APIs, RAG, agents, architecture.
export const domain = {
  id: "artificial_intelligence",
  objectives: ["ai_foundations", "ai_machine_learning", "ai_building"],
  steps: [
    {
      key: "what_is_a_model",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Ce qu'est un modèle : une fonction apprise sur des exemples",
        summary: "Comprendre qu'un modèle n'est pas une règle écrite à la main mais des paramètres ajustés sur des données.",
        goals: [
          "Distinguer un programme écrit par une personne d'un modèle appris.",
          "Dire ce que contient un modèle une fois entraîné."
        ],
        tutor:
          "Fais comparer un filtre anti-spam écrit à la main et un filtre appris, puis demande ce que contient exactement le fichier du modèle.",
        contexts: [
          "un filtre anti-spam qui apprend sur des messages signalés",
          "une estimation de prix immobilier à partir de ventes passées",
          "une reconnaissance de chiffres écrits à la main"
        ]
      },
      en: {
        title: "What a model is: a function learned from examples",
        summary: "Understand that a model is not a hand-written rule but parameters fitted on data.",
        goals: [
          "Tell apart a program written by a person and a learned model.",
          "Say what a trained model actually contains."
        ],
        tutor:
          "Have the student compare a hand-written spam filter with a learned one, then ask what the model file actually contains.",
        contexts: [
          "a spam filter learning from reported messages",
          "a house price estimate from past sales",
          "recognition of handwritten digits"
        ]
      }
    },
    {
      key: "data_features_labels",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Données, caractéristiques et étiquettes",
        summary: "Structurer un jeu de données en lignes, colonnes explicatives et colonne à prédire.",
        goals: [
          "Séparer les caractéristiques de la cible dans un tableau donné.",
          "Repérer une colonne qui contient déjà la réponse."
        ],
        tutor:
          "Fais désigner les caractéristiques et la cible dans un tableau de prêts bancaires, puis demande quelle colonne rendrait la prédiction triviale.",
        contexts: [
          "un tableau de demandes de prêt avec leur issue",
          "des mesures météo et la pluie du lendemain",
          "des trajets de livraison et leur durée réelle"
        ]
      },
      en: {
        title: "Data, features and labels",
        summary: "Structure a dataset into rows, explanatory columns and the column to predict.",
        goals: [
          "Separate features from the target in a given table.",
          "Spot a column that already contains the answer."
        ],
        tutor:
          "Have the student point out features and target in a table of bank loans, then ask which column would make the prediction trivial.",
        contexts: [
          "a table of loan applications with their outcome",
          "weather measurements and next-day rain",
          "delivery trips and their actual duration"
        ]
      }
    },
    {
      key: "training_vs_inference",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Entraînement et inférence : deux moments distincts",
        summary: "Séparer la phase où le modèle ajuste ses paramètres de la phase où il répond à une demande.",
        goals: [
          "Dire à quel moment le modèle apprend et à quel moment il ne change plus.",
          "Comparer le coût des deux phases."
        ],
        tutor:
          "Fais expliquer si un modèle apprend de la question que l'utilisateur vient de poser, puis demande ce qu'il faudrait pour qu'il l'apprenne vraiment.",
        contexts: [
          "un assistant qui répond à une question posée aujourd'hui",
          "une recommandation musicale recalculée chaque nuit",
          "un modèle de traduction embarqué sur un téléphone"
        ]
      },
      en: {
        title: "Training and inference: two distinct moments",
        summary: "Separate the phase where the model fits its parameters from the phase where it answers.",
        goals: [
          "Say when the model learns and when it no longer changes.",
          "Compare the cost of the two phases."
        ],
        tutor:
          "Have the student explain whether a model learns from the question just asked, then ask what it would take for it to really learn it.",
        contexts: [
          "an assistant answering a question asked today",
          "a music recommendation recomputed every night",
          "a translation model embedded in a phone"
        ]
      }
    },
    {
      key: "ai_ml_dl_scope",
      objectives: "*",
      stage: 1,
      fr: {
        title: "IA, apprentissage automatique, apprentissage profond : trois cercles emboîtés",
        summary: "Situer les trois termes les uns par rapport aux autres et rattacher un système donné au bon cercle.",
        goals: [
          "Ordonner les trois notions du plus large au plus étroit.",
          "Classer trois systèmes réels dans le bon cercle."
        ],
        tutor:
          "Fais classer un moteur de règles fiscales, un détecteur de fraude statistique et un modèle de langue, puis demande le critère utilisé pour trancher.",
        contexts: [
          "un moteur de règles pour le calcul d'impôts",
          "un détecteur de fraude entraîné sur des transactions",
          "un assistant conversationnel généraliste"
        ]
      },
      en: {
        title: "AI, machine learning, deep learning: three nested circles",
        summary: "Place the three terms relative to each other and assign a given system to the right circle.",
        goals: [
          "Order the three notions from broadest to narrowest.",
          "Classify three real systems into the right circle."
        ],
        tutor:
          "Have the student classify a tax rule engine, a statistical fraud detector and a language model, then ask which criterion they used.",
        contexts: [
          "a rule engine computing taxes",
          "a fraud detector trained on transactions",
          "a general-purpose conversational assistant"
        ]
      }
    },
    {
      key: "probabilistic_answers",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Pourquoi un modèle donne une réponse probable et non certaine",
        summary: "Comprendre qu'une sortie de modèle est un pari statistique assorti d'un degré de confiance.",
        goals: [
          "Interpréter un score de confiance de 0,7 sur une classification.",
          "Dire pourquoi une réponse fausse peut être donnée avec assurance."
        ],
        tutor:
          "Fais interpréter une prédiction à 70 % de confiance, puis demande combien d'erreurs sont attendues sur cent cas de ce type.",
        contexts: [
          "un diagnostic automatique de panne annoncé à 70 %",
          "une détection de fraude sur un paiement inhabituel",
          "une suggestion de réponse dans une messagerie"
        ]
      },
      en: {
        title: "Why a model gives a probable answer, not a certain one",
        summary: "Understand that a model output is a statistical bet carrying a confidence level.",
        goals: [
          "Interpret a 0.7 confidence score on a classification.",
          "Say why a wrong answer can be delivered confidently."
        ],
        tutor:
          "Have the student interpret a prediction at 70% confidence, then ask how many errors to expect over a hundred such cases.",
        contexts: [
          "an automatic fault diagnosis announced at 70%",
          "fraud detection on an unusual payment",
          "a suggested reply in a messaging app"
        ]
      }
    },
    {
      key: "train_test_split",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Pourquoi on garde des données jamais vues",
        summary: "Séparer entraînement, validation et test pour mesurer autre chose que de la mémorisation.",
        goals: [
          "Expliquer le rôle de chacun des trois jeux de données.",
          "Repérer une fuite de données entre entraînement et test."
        ],
        tutor:
          "Fais expliquer pourquoi un score de 100 % sur les données d'entraînement n'apprend rien, puis demande comment une fuite peut se glisser dans un découpage temporel.",
        contexts: [
          "un modèle de prévision de ventes évalué sur l'année écoulée",
          "des photos du même patient présentes dans les deux jeux",
          "un concours de science des données avec un jeu caché"
        ]
      },
      en: {
        title: "Why we keep data the model has never seen",
        summary: "Split training, validation and test data to measure something other than memorisation.",
        goals: [
          "Explain the role of each of the three datasets.",
          "Spot a data leak between training and test."
        ],
        tutor:
          "Have the student explain why 100% on training data teaches nothing, then ask how a leak can slip into a time-based split.",
        contexts: [
          "a sales forecast model evaluated on the past year",
          "photos of the same patient present in both sets",
          "a data science contest with a hidden test set"
        ]
      }
    },
    {
      key: "overfitting_intuition",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Sur-apprentissage : mémoriser au lieu de généraliser",
        summary: "Reconnaître l'écart entre performance d'entraînement et performance réelle comme signal de sur-apprentissage.",
        goals: [
          "Lire un écart entre score d'entraînement et score de test.",
          "Citer deux causes fréquentes de sur-apprentissage."
        ],
        tutor:
          "Fais diagnostiquer un modèle à 99 % en entraînement et 62 % en test, puis demande deux corrections possibles et leur effet attendu.",
        contexts: [
          "un modèle de scoring entraîné sur trois cents dossiers",
          "un détecteur d'objets qui ne reconnaît que les photos du studio",
          "une prévision qui fonctionnait avant un changement de tarif"
        ]
      },
      en: {
        title: "Overfitting: memorising instead of generalising",
        summary: "Read the gap between training performance and real performance as an overfitting signal.",
        goals: [
          "Read a gap between training score and test score.",
          "Name two frequent causes of overfitting."
        ],
        tutor:
          "Have the student diagnose a model at 99% training and 62% test, then ask for two fixes and their expected effect.",
        contexts: [
          "a scoring model trained on three hundred files",
          "an object detector that only recognises studio photos",
          "a forecast that worked before a pricing change"
        ]
      }
    },
    {
      key: "bias_in_data",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Comment un biais des données devient un biais du modèle",
        summary: "Suivre le chemin d'une sous-représentation dans les données jusqu'à une décision systématiquement défavorable.",
        goals: [
          "Identifier une population sous-représentée dans un jeu de données.",
          "Expliquer pourquoi la précision globale peut masquer ce biais."
        ],
        tutor:
          "Fais analyser un modèle de recrutement entraîné sur dix ans d'embauches passées, puis demande quelle mesure par sous-groupe révélerait le problème.",
        contexts: [
          "un tri de candidatures appris sur les embauches passées",
          "une reconnaissance vocale entraînée sur peu d'accents",
          "un score de risque calibré sur une seule région"
        ]
      },
      en: {
        title: "How a bias in the data becomes a bias in the model",
        summary: "Follow the path from under-representation in data to a systematically unfavourable decision.",
        goals: [
          "Identify an under-represented population in a dataset.",
          "Explain why overall accuracy can hide that bias."
        ],
        tutor:
          "Have the student analyse a hiring model trained on ten years of past hires, then ask which per-subgroup measurement would expose the problem.",
        contexts: [
          "application screening learned from past hires",
          "speech recognition trained on few accents",
          "a risk score calibrated on a single region"
        ]
      }
    },
    {
      key: "compute_and_data_cost",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Ce que coûte un entraînement : données, calcul, énergie",
        summary: "Relier taille du modèle, volume de données et facture de calcul pour juger un projet réaliste.",
        goals: [
          "Comparer l'ordre de grandeur d'un entraînement complet et d'un ajustement fin.",
          "Dire ce qui rend une inférence coûteuse à grande échelle."
        ],
        tutor:
          "Fais comparer le coût d'un entraînement complet et celui d'un ajustement fin, puis demande ce qui domine la facture d'un service à un million de requêtes par jour.",
        contexts: [
          "une équipe qui veut entraîner son propre modèle de langue",
          "un ajustement fin sur deux mille exemples internes",
          "un service qui traite un million de requêtes par jour"
        ]
      },
      en: {
        title: "What training costs: data, compute, energy",
        summary: "Connect model size, data volume and compute bill to judge whether a project is realistic.",
        goals: [
          "Compare the order of magnitude of full training and of fine-tuning.",
          "Say what makes inference expensive at scale."
        ],
        tutor:
          "Have the student compare the cost of full training and of fine-tuning, then ask what dominates the bill of a service at a million requests per day.",
        contexts: [
          "a team wanting to train its own language model",
          "a fine-tune on two thousand internal examples",
          "a service handling a million requests per day"
        ]
      }
    },

    {
      key: "tokens_and_text",
      objectives: ["ai_foundations"],
      stage: 1,
      fr: {
        title: "Comment un modèle de langue découpe le texte en tokens",
        summary: "Voir qu'un modèle lit des morceaux de mots et non des lettres ni des mots entiers.",
        goals: [
          "Découper une phrase courte en tokens plausibles.",
          "Expliquer pourquoi compter les caractères d'un mot est difficile pour un modèle."
        ],
        tutor:
          "Fais découper une phrase en tokens plausibles, puis demande pourquoi le modèle se trompe en comptant les lettres d'un mot rare.",
        contexts: [
          "un mot rare découpé en plusieurs morceaux",
          "une facture de service au million de tokens",
          "un texte en français plus coûteux qu'en anglais à longueur égale"
        ]
      },
      en: {
        title: "How a language model splits text into tokens",
        summary: "See that a model reads word pieces rather than letters or whole words.",
        goals: [
          "Split a short sentence into plausible tokens.",
          "Explain why counting the letters of a word is hard for a model."
        ],
        tutor:
          "Have the student split a sentence into plausible tokens, then ask why the model miscounts the letters of a rare word.",
        contexts: [
          "a rare word split into several pieces",
          "a service bill priced per million tokens",
          "a French text costing more than English at equal length"
        ]
      }
    },
    {
      key: "next_token_prediction",
      objectives: ["ai_foundations"],
      stage: 2,
      fr: {
        title: "Prédire le token suivant : le mécanisme de base d'un modèle de langue",
        summary: "Comprendre qu'un texte long est produit un token à la fois, chacun conditionné par les précédents.",
        goals: [
          "Décrire la boucle de génération token par token.",
          "Expliquer pourquoi une erreur au début oriente toute la suite."
        ],
        tutor:
          "Fais dérouler la génération des cinq premiers tokens d'une phrase, puis demande l'effet d'un premier token mal choisi.",
        contexts: [
          "une réponse d'assistant qui part dans une mauvaise direction",
          "une complétion de code proposée dans un éditeur",
          "un résumé qui reprend le ton du début du texte"
        ]
      },
      en: {
        title: "Next-token prediction: the base mechanism of a language model",
        summary: "Understand that long text is produced one token at a time, each conditioned on the previous ones.",
        goals: [
          "Describe the token-by-token generation loop.",
          "Explain why an early mistake steers the whole continuation."
        ],
        tutor:
          "Have the student unroll the generation of the first five tokens of a sentence, then ask the effect of a badly chosen first token.",
        contexts: [
          "an assistant answer drifting in the wrong direction",
          "a code completion suggested in an editor",
          "a summary echoing the tone of the opening"
        ]
      }
    },
    {
      key: "temperature_sampling",
      objectives: ["ai_foundations"],
      stage: 2,
      fr: {
        title: "Température et échantillonnage : pourquoi deux réponses diffèrent",
        summary: "Relier le réglage de température à la variabilité des sorties et au risque d'invention.",
        goals: [
          "Prévoir l'effet d'une température basse et d'une température haute.",
          "Choisir un réglage adapté à une tâche factuelle."
        ],
        tutor:
          "Fais choisir une température pour une extraction de données puis pour une génération d'idées, en demandant de justifier chaque choix.",
        contexts: [
          "une extraction de champs depuis une facture",
          "une génération de titres publicitaires",
          "deux exécutions du même prompt qui donnent des réponses différentes"
        ]
      },
      en: {
        title: "Temperature and sampling: why two answers differ",
        summary: "Connect the temperature setting to output variability and to the risk of invention.",
        goals: [
          "Predict the effect of a low and of a high temperature.",
          "Choose a setting suited to a factual task."
        ],
        tutor:
          "Have the student choose a temperature for data extraction then for idea generation, justifying each choice.",
        contexts: [
          "extracting fields from an invoice",
          "generating advertising headlines",
          "two runs of the same prompt returning different answers"
        ]
      }
    },
    {
      key: "embeddings_meaning",
      objectives: ["ai_foundations"],
      stage: 3,
      fr: {
        title: "Les plongements vectoriels : représenter le sens par des nombres",
        summary: "Comprendre qu'un texte devient un vecteur dont la proximité approche la proximité de sens.",
        goals: [
          "Expliquer ce que mesure la similarité entre deux vecteurs.",
          "Citer un cas où deux textes proches en vecteur ont un sens opposé."
        ],
        tutor:
          "Fais classer trois phrases par proximité de sens, puis demande pourquoi une négation peut rester très proche de la phrase affirmative.",
        contexts: [
          "une recherche interne qui trouve des documents sans le mot exact",
          "des articles regroupés par thème automatiquement",
          "une phrase et sa négation jugées très proches"
        ]
      },
      en: {
        title: "Embeddings: representing meaning with numbers",
        summary: "Understand that a text becomes a vector whose closeness approximates closeness in meaning.",
        goals: [
          "Explain what similarity between two vectors measures.",
          "Give a case where two close vectors carry opposite meaning."
        ],
        tutor:
          "Have the student rank three sentences by closeness of meaning, then ask why a negation can stay very close to the affirmative sentence.",
        contexts: [
          "an internal search finding documents without the exact word",
          "articles automatically grouped by theme",
          "a sentence and its negation judged very close"
        ]
      }
    },
    {
      key: "attention_mechanism",
      objectives: ["ai_foundations"],
      stage: 3,
      fr: {
        title: "Ce que fait le mécanisme d'attention",
        summary: "Comprendre comment un modèle pondère les mots du contexte pour interpréter le mot courant.",
        goals: [
          "Expliquer la pondération des mots du contexte sur un exemple d'ambiguïté.",
          "Dire pourquoi l'attention coûte cher quand le texte s'allonge."
        ],
        tutor:
          "Fais désigner les mots qui lèvent l'ambiguïté de « il » dans une phrase, puis demande comment ce coût évolue avec la longueur du texte.",
        contexts: [
          "un pronom qui renvoie à l'un de deux personnages",
          "un long contrat où une clause dépend d'une définition initiale",
          "une traduction où le genre du mot dépend du contexte"
        ]
      },
      en: {
        title: "What the attention mechanism does",
        summary: "Understand how a model weighs context words to interpret the current word.",
        goals: [
          "Explain context weighting on an ambiguity example.",
          "Say why attention gets expensive as text grows longer."
        ],
        tutor:
          "Have the student point out the words resolving “it” in a sentence, then ask how that cost grows with text length.",
        contexts: [
          "a pronoun referring to one of two characters",
          "a long contract where a clause depends on an early definition",
          "a translation where word gender depends on context"
        ]
      }
    },
    {
      key: "hallucination_causes",
      objectives: ["ai_foundations"],
      stage: 3,
      fr: {
        title: "Pourquoi un modèle invente une référence",
        summary: "Relier l'invention à l'objectif de plausibilité plutôt qu'à une base de faits consultée.",
        goals: [
          "Expliquer pourquoi une citation inventée paraît crédible.",
          "Citer deux dispositifs qui réduisent le risque d'invention."
        ],
        tutor:
          "Fais analyser une réponse contenant une référence inexistante, puis demande quel dispositif aurait empêché de la publier.",
        contexts: [
          "une note juridique citant un article de loi inexistant",
          "une bibliographie générée pour un mémoire",
          "un numéro de version de bibliothèque inventé"
        ]
      },
      en: {
        title: "Why a model invents a reference",
        summary: "Connect invention to an objective of plausibility rather than a consulted fact base.",
        goals: [
          "Explain why a fabricated citation looks credible.",
          "Name two mechanisms that reduce the risk of invention."
        ],
        tutor:
          "Have the student analyse an answer containing a non-existent reference, then ask which mechanism would have blocked publication.",
        contexts: [
          "a legal note citing a non-existent statute",
          "a bibliography generated for a dissertation",
          "an invented library version number"
        ]
      }
    },
    {
      key: "context_window",
      objectives: ["ai_foundations"],
      stage: 3,
      fr: {
        title: "La fenêtre de contexte et ce qui en sort",
        summary: "Comprendre la limite de contexte et l'effet de la troncature sur une conversation longue.",
        goals: [
          "Calculer si un document tient dans une fenêtre donnée.",
          "Expliquer ce que le modèle oublie lorsque la fenêtre est dépassée."
        ],
        tutor:
          "Fais estimer si un rapport de cinquante pages tient dans une fenêtre donnée, puis demande quelles informations disparaissent en premier.",
        contexts: [
          "une conversation longue qui oublie la consigne initiale",
          "un rapport de cinquante pages soumis en une fois",
          "un historique de support client accumulé sur six mois"
        ]
      },
      en: {
        title: "The context window and what falls out of it",
        summary: "Understand the context limit and the effect of truncation on a long conversation.",
        goals: [
          "Compute whether a document fits in a given window.",
          "Explain what the model forgets once the window overflows."
        ],
        tutor:
          "Have the student estimate whether a fifty-page report fits a given window, then ask which information disappears first.",
        contexts: [
          "a long conversation forgetting the initial instruction",
          "a fifty-page report submitted at once",
          "six months of accumulated support history"
        ]
      }
    },
    {
      key: "pretraining_finetuning",
      objectives: ["ai_foundations"],
      stage: 4,
      fr: {
        title: "Pré-entraînement, ajustement fin et alignement",
        summary: "Distinguer les trois étapes qui transforment un modèle brut en assistant utilisable.",
        goals: [
          "Associer chaque étape au type de données qu'elle consomme.",
          "Dire quelle étape corrige un ton inadapté."
        ],
        tutor:
          "Fais associer chaque étape aux données qu'elle utilise, puis demande laquelle corrigerait un modèle au style trop familier.",
        contexts: [
          "un modèle brut qui complète du texte sans répondre aux questions",
          "un assistant spécialisé sur le vocabulaire d'une entreprise",
          "un modèle qui refuse une demande dangereuse"
        ]
      },
      en: {
        title: "Pre-training, fine-tuning and alignment",
        summary: "Tell apart the three stages that turn a raw model into a usable assistant.",
        goals: [
          "Match each stage to the kind of data it consumes.",
          "Say which stage fixes an inappropriate tone."
        ],
        tutor:
          "Have the student match each stage to its data, then ask which one would fix a model whose style is too casual.",
        contexts: [
          "a raw model completing text instead of answering",
          "an assistant specialised in a company's vocabulary",
          "a model refusing a dangerous request"
        ]
      }
    },
    {
      key: "learning_from_preferences",
      objectives: ["ai_foundations"],
      stage: 4,
      fr: {
        title: "Apprendre à partir de préférences humaines",
        summary: "Comprendre comment des comparaisons entre deux réponses orientent le comportement d'un modèle.",
        goals: [
          "Décrire la boucle comparaison, modèle de récompense, ajustement.",
          "Citer un effet indésirable d'une récompense mal définie."
        ],
        tutor:
          "Fais décrire la boucle d'apprentissage par préférences, puis demande ce qui arrive si les évaluateurs préfèrent systématiquement les réponses longues.",
        contexts: [
          "deux réponses proposées à des évaluateurs humains",
          "un assistant devenu exagérément complaisant",
          "des réponses de plus en plus longues sans gain d'information"
        ]
      },
      en: {
        title: "Learning from human preferences",
        summary: "Understand how comparisons between two answers steer a model's behaviour.",
        goals: [
          "Describe the loop of comparison, reward model and tuning.",
          "Name an unwanted effect of a badly defined reward."
        ],
        tutor:
          "Have the student describe the preference learning loop, then ask what happens if raters systematically prefer long answers.",
        contexts: [
          "two answers shown to human raters",
          "an assistant that became excessively agreeable",
          "answers growing longer with no added information"
        ]
      }
    },
    {
      key: "eval_benchmarks",
      objectives: ["ai_foundations"],
      stage: 4,
      fr: {
        title: "Ce que mesure vraiment un score de benchmark",
        summary: "Lire un classement de modèles en tenant compte de la contamination et de l'écart avec l'usage réel.",
        goals: [
          "Expliquer ce qu'une contamination du jeu de test invalide.",
          "Dire pourquoi un score élevé ne garantit pas un bon usage métier."
        ],
        tutor:
          "Fais critiquer une annonce de score record, puis demande quelle évaluation serait pertinente pour un cas d'usage précis.",
        contexts: [
          "un classement public de modèles de langue",
          "un jeu de test publié depuis trois ans sur Internet",
          "un modèle excellent en examen mais faible sur des e-mails clients"
        ]
      },
      en: {
        title: "What a benchmark score really measures",
        summary: "Read a model leaderboard accounting for contamination and the gap with real usage.",
        goals: [
          "Explain what test-set contamination invalidates.",
          "Say why a high score does not guarantee good business use."
        ],
        tutor:
          "Have the student critique a record-score announcement, then ask which evaluation would be relevant for one precise use case.",
        contexts: [
          "a public leaderboard of language models",
          "a test set published on the internet three years ago",
          "a model excellent at exams but weak on customer emails"
        ]
      }
    },
    {
      key: "prompt_sensitivity",
      objectives: ["ai_foundations"],
      stage: 4,
      fr: {
        title: "Pourquoi une reformulation change la réponse",
        summary: "Mesurer la sensibilité d'un modèle à la formulation et en tirer une méthode de test.",
        goals: [
          "Construire deux formulations équivalentes d'une même demande.",
          "Décider quand une variation de réponse est acceptable."
        ],
        tutor:
          "Fais écrire deux formulations équivalentes d'une même consigne, puis demande comment vérifier que le modèle répond pareil sur cinquante cas.",
        contexts: [
          "une même question posée poliment puis sèchement",
          "une consigne traduite du français vers l'anglais",
          "un ordre de champs modifié dans une demande d'extraction"
        ]
      },
      en: {
        title: "Why rewording changes the answer",
        summary: "Measure a model's sensitivity to phrasing and turn it into a testing method.",
        goals: [
          "Build two equivalent phrasings of one request.",
          "Decide when a variation in the answer is acceptable."
        ],
        tutor:
          "Have the student write two equivalent phrasings of one instruction, then ask how to check the model answers the same over fifty cases.",
        contexts: [
          "the same question asked politely then bluntly",
          "an instruction translated from French to English",
          "a reordered field list in an extraction request"
        ]
      }
    },
    {
      key: "reasoning_steps",
      objectives: ["ai_foundations"],
      stage: 5,
      fr: {
        title: "Raisonnement pas à pas et ses limites",
        summary: "Comprendre ce que le raisonnement explicite améliore et pourquoi il ne garantit pas la justesse.",
        goals: [
          "Citer un type de tâche où le raisonnement explicite aide nettement.",
          "Expliquer pourquoi une justification cohérente peut accompagner un résultat faux."
        ],
        tutor:
          "Fais analyser une résolution détaillée qui aboutit à un résultat faux, puis demande à quelle étape la vérification aurait dû intervenir.",
        contexts: [
          "un problème arithmétique à plusieurs étapes",
          "une justification élégante mais fausse",
          "un calcul de dates avec années bissextiles"
        ]
      },
      en: {
        title: "Step-by-step reasoning and its limits",
        summary: "Understand what explicit reasoning improves and why it does not guarantee correctness.",
        goals: [
          "Name a task type where explicit reasoning clearly helps.",
          "Explain why a coherent justification can accompany a wrong result."
        ],
        tutor:
          "Have the student analyse a detailed solution reaching a wrong result, then ask at which step verification should have happened.",
        contexts: [
          "a multi-step arithmetic problem",
          "an elegant but wrong justification",
          "a date computation involving leap years"
        ]
      }
    },
    {
      key: "model_distillation",
      objectives: ["ai_foundations"],
      stage: 5,
      fr: {
        title: "Distiller un grand modèle en petit modèle",
        summary: "Comprendre le transfert de comportement d'un grand modèle vers un modèle plus petit et moins cher.",
        goals: [
          "Décrire ce que le petit modèle apprend du grand.",
          "Dire ce qui se dégrade en premier après distillation."
        ],
        tutor:
          "Fais décrire ce que le petit modèle apprend exactement, puis demande sur quel type de tâche l'écart réapparaît en premier.",
        contexts: [
          "un modèle embarqué sur un téléphone sans réseau",
          "un service de classification à très fort volume",
          "un assistant spécialisé sur un seul domaine métier"
        ]
      },
      en: {
        title: "Distilling a large model into a small one",
        summary: "Understand the transfer of behaviour from a large model to a smaller, cheaper one.",
        goals: [
          "Describe what the small model learns from the large one.",
          "Say what degrades first after distillation."
        ],
        tutor:
          "Have the student describe exactly what the small model learns, then ask on which task type the gap reappears first.",
        contexts: [
          "a model embedded on a phone with no network",
          "a very high volume classification service",
          "an assistant specialised in a single business domain"
        ]
      }
    },
    {
      key: "multimodal_models",
      objectives: ["ai_foundations"],
      stage: 5,
      fr: {
        title: "Ce qu'un modèle multimodal aligne réellement",
        summary: "Comprendre la mise en correspondance d'images et de textes dans un même espace de représentation.",
        goals: [
          "Expliquer ce que signifie aligner une image et une légende.",
          "Citer une erreur typique de lecture d'image."
        ],
        tutor:
          "Fais expliquer comment une image et sa légende deviennent comparables, puis demande pourquoi un tableau chiffré photographié reste difficile à lire.",
        contexts: [
          "une photo de facture dont on extrait le montant",
          "une recherche d'images par description textuelle",
          "un graphique photographié dont on demande la tendance"
        ]
      },
      en: {
        title: "What a multimodal model actually aligns",
        summary: "Understand how images and texts are mapped into a shared representation space.",
        goals: [
          "Explain what aligning an image and a caption means.",
          "Name a typical image-reading error."
        ],
        tutor:
          "Have the student explain how an image and its caption become comparable, then ask why a photographed numeric table stays hard to read.",
        contexts: [
          "a photographed invoice whose amount is extracted",
          "an image search from a text description",
          "a photographed chart whose trend is requested"
        ]
      }
    },
    {
      key: "interpretability_probes",
      objectives: ["ai_foundations"],
      stage: 5,
      fr: {
        title: "Ouvrir la boîte : sondes et interprétabilité",
        summary: "Découvrir les méthodes qui relient une décision du modèle à des éléments internes ou à des entrées.",
        goals: [
          "Distinguer une explication locale d'une explication globale.",
          "Dire ce qu'une carte d'importance ne prouve pas."
        ],
        tutor:
          "Fais interpréter une carte d'importance sur un refus de crédit, puis demande ce que cette carte ne permet pas de conclure.",
        contexts: [
          "un refus de crédit à justifier auprès d'un client",
          "une image dont on colore les zones décisives",
          "un audit réglementaire d'un modèle de scoring"
        ]
      },
      en: {
        title: "Opening the box: probes and interpretability",
        summary: "Discover the methods linking a model decision to internal elements or to inputs.",
        goals: [
          "Tell apart a local explanation and a global explanation.",
          "Say what an importance map does not prove."
        ],
        tutor:
          "Have the student interpret an importance map on a credit refusal, then ask what that map cannot establish.",
        contexts: [
          "a credit refusal to justify to a customer",
          "an image with decisive regions highlighted",
          "a regulatory audit of a scoring model"
        ]
      }
    },

    {
      key: "supervised_vs_unsupervised",
      objectives: ["ai_machine_learning"],
      stage: 1,
      fr: {
        title: "Apprentissage supervisé et non supervisé",
        summary: "Choisir la famille d'algorithmes selon que les exemples portent ou non une réponse connue.",
        goals: [
          "Classer trois problèmes en supervisé ou non supervisé.",
          "Dire ce que coûte l'étiquetage des données."
        ],
        tutor:
          "Fais classer une prévision de churn, une segmentation de clients et une détection d'anomalies, puis demande ce qui manque pour rendre le deuxième supervisé.",
        contexts: [
          "une prévision de départ de clients à partir d'historiques",
          "une segmentation de clientèle sans catégories prédéfinies",
          "une détection d'anomalies sur des capteurs industriels"
        ]
      },
      en: {
        title: "Supervised and unsupervised learning",
        summary: "Pick the algorithm family depending on whether the examples carry a known answer.",
        goals: [
          "Classify three problems as supervised or unsupervised.",
          "Say what labelling data costs."
        ],
        tutor:
          "Have the student classify churn prediction, customer segmentation and anomaly detection, then ask what is missing to make the second supervised.",
        contexts: [
          "predicting customer churn from history",
          "segmenting customers with no predefined categories",
          "detecting anomalies on industrial sensors"
        ]
      }
    },
    {
      key: "linear_regression",
      objectives: ["ai_machine_learning"],
      stage: 2,
      fr: {
        title: "La régression linéaire : ajuster une droite et lire ses coefficients",
        summary: "Interpréter la pente et l'ordonnée à l'origine comme une relation quantifiée entre deux variables.",
        goals: [
          "Interpréter un coefficient en unités métier.",
          "Repérer une relation manifestement non linéaire."
        ],
        tutor:
          "Fais interpréter un coefficient de surface sur un prix immobilier, puis demande ce qui invalide la droite quand la relation se courbe.",
        contexts: [
          "un prix au mètre carré estimé sur des ventes récentes",
          "une consommation électrique en fonction de la température",
          "un chiffre d'affaires en fonction du budget publicitaire"
        ]
      },
      en: {
        title: "Linear regression: fitting a line and reading its coefficients",
        summary: "Interpret slope and intercept as a quantified relation between two variables.",
        goals: [
          "Interpret a coefficient in business units.",
          "Spot a clearly non-linear relation."
        ],
        tutor:
          "Have the student interpret a floor-area coefficient on a property price, then ask what invalidates the line when the relation curves.",
        contexts: [
          "a price per square metre estimated from recent sales",
          "electricity consumption against temperature",
          "revenue against advertising budget"
        ]
      }
    },
    {
      key: "loss_function",
      objectives: ["ai_machine_learning"],
      stage: 2,
      fr: {
        title: "Ce que mesure une fonction de perte",
        summary: "Comprendre que le choix de la perte définit quelle erreur le modèle acceptera de commettre.",
        goals: [
          "Comparer erreur absolue et erreur quadratique sur une valeur aberrante.",
          "Choisir une perte cohérente avec un enjeu métier."
        ],
        tutor:
          "Fais comparer l'effet d'une valeur aberrante sur deux pertes, puis demande laquelle choisir quand les grosses erreurs coûtent très cher.",
        contexts: [
          "une prévision de stock où la rupture coûte plus que le surstock",
          "un jeu de mesures contenant une valeur aberrante",
          "une estimation de délai de livraison"
        ]
      },
      en: {
        title: "What a loss function measures",
        summary: "Understand that choosing the loss defines which error the model agrees to make.",
        goals: [
          "Compare absolute and squared error on an outlier.",
          "Choose a loss consistent with a business stake."
        ],
        tutor:
          "Have the student compare the effect of an outlier on two losses, then ask which to choose when big errors are very costly.",
        contexts: [
          "a stock forecast where a shortage costs more than surplus",
          "a measurement set containing an outlier",
          "a delivery time estimate"
        ]
      }
    },
    {
      key: "gradient_descent",
      objectives: ["ai_machine_learning"],
      stage: 3,
      fr: {
        title: "La descente de gradient pas à pas",
        summary: "Suivre l'ajustement itératif des paramètres et l'effet du pas d'apprentissage sur la convergence.",
        goals: [
          "Décrire une itération complète de mise à jour des paramètres.",
          "Prévoir le comportement avec un pas trop grand ou trop petit."
        ],
        tutor:
          "Fais dérouler trois itérations sur une fonction à une variable, puis demande ce qui se passe si le pas double à chaque fois.",
        contexts: [
          "une courbe d'erreur qui descend puis stagne",
          "un entraînement qui diverge dès les premières étapes",
          "un modèle qui n'améliore plus rien après mille itérations"
        ]
      },
      en: {
        title: "Gradient descent step by step",
        summary: "Follow the iterative adjustment of parameters and the effect of the learning rate on convergence.",
        goals: [
          "Describe one full parameter update iteration.",
          "Predict the behaviour with a too large or too small step."
        ],
        tutor:
          "Have the student run three iterations on a one-variable function, then ask what happens if the step doubles each time.",
        contexts: [
          "an error curve dropping then flattening",
          "a training run diverging from the first steps",
          "a model improving nothing after a thousand iterations"
        ]
      }
    },
    {
      key: "classification_threshold",
      objectives: ["ai_machine_learning"],
      stage: 3,
      fr: {
        title: "Le seuil de décision d'un classifieur",
        summary: "Transformer une probabilité en décision et mesurer l'effet du seuil sur les deux types d'erreurs.",
        goals: [
          "Expliquer l'effet d'un seuil abaissé sur les faux positifs.",
          "Fixer un seuil à partir d'un coût métier."
        ],
        tutor:
          "Fais fixer un seuil pour une détection de fraude, puis demande combien de clients honnêtes seront bloqués à ce seuil.",
        contexts: [
          "une détection de fraude bancaire",
          "un filtre de modération de commentaires",
          "un test de dépistage à visée éducative"
        ]
      },
      en: {
        title: "The decision threshold of a classifier",
        summary: "Turn a probability into a decision and measure the threshold's effect on both error types.",
        goals: [
          "Explain the effect of lowering the threshold on false positives.",
          "Set a threshold from a business cost."
        ],
        tutor:
          "Have the student set a threshold for fraud detection, then ask how many honest customers get blocked at that threshold.",
        contexts: [
          "bank fraud detection",
          "a comment moderation filter",
          "a screening test used as a teaching example"
        ]
      }
    },
    {
      key: "precision_recall",
      objectives: ["ai_machine_learning"],
      stage: 3,
      fr: {
        title: "Précision et rappel : choisir son erreur",
        summary: "Calculer précision et rappel sur une matrice de confusion et arbitrer selon l'usage.",
        goals: [
          "Calculer précision et rappel à partir d'une matrice de confusion.",
          "Dire laquelle privilégier pour un usage donné."
        ],
        tutor:
          "Fais calculer précision et rappel sur une matrice de confusion donnée, puis demande laquelle privilégier pour un filtre anti-spam.",
        contexts: [
          "un filtre anti-spam qui bloque un message important",
          "une recherche documentaire dans un fonds juridique",
          "une alerte de maintenance préventive"
        ]
      },
      en: {
        title: "Precision and recall: choosing your error",
        summary: "Compute precision and recall from a confusion matrix and arbitrate by use case.",
        goals: [
          "Compute precision and recall from a confusion matrix.",
          "Say which to favour for a given use."
        ],
        tutor:
          "Have the student compute precision and recall on a given confusion matrix, then ask which to favour for a spam filter.",
        contexts: [
          "a spam filter blocking an important message",
          "document search in a legal archive",
          "a preventive maintenance alert"
        ]
      }
    },
    {
      key: "cross_validation",
      objectives: ["ai_machine_learning"],
      stage: 3,
      fr: {
        title: "La validation croisée",
        summary: "Estimer la performance d'un modèle sur peu de données sans dépendre d'un découpage chanceux.",
        goals: [
          "Décrire une validation croisée en cinq blocs.",
          "Dire pourquoi elle est nécessaire quand les données sont rares."
        ],
        tutor:
          "Fais décrire une validation croisée en cinq blocs, puis demande ce qu'elle change pour un jeu de deux cents exemples.",
        contexts: [
          "un jeu de deux cents dossiers médicaux anonymisés",
          "deux découpages qui donnent des scores très différents",
          "une comparaison entre trois modèles candidats"
        ]
      },
      en: {
        title: "Cross-validation",
        summary: "Estimate model performance on little data without depending on a lucky split.",
        goals: [
          "Describe a five-fold cross-validation.",
          "Say why it is needed when data is scarce."
        ],
        tutor:
          "Have the student describe a five-fold cross-validation, then ask what it changes for a set of two hundred examples.",
        contexts: [
          "a set of two hundred anonymised medical files",
          "two splits giving very different scores",
          "a comparison between three candidate models"
        ]
      }
    },
    {
      key: "decision_trees_forests",
      objectives: ["ai_machine_learning"],
      stage: 4,
      fr: {
        title: "Arbres de décision et forêts aléatoires",
        summary: "Comprendre la construction d'un arbre par découpes successives et l'apport du vote d'un ensemble.",
        goals: [
          "Lire un arbre de décision et suivre le chemin d'un exemple.",
          "Expliquer ce qu'apporte le vote de plusieurs arbres."
        ],
        tutor:
          "Fais suivre un dossier dans un petit arbre de décision, puis demande pourquoi cent arbres différents se trompent moins souvent qu'un seul.",
        contexts: [
          "un dossier de prêt suivi de nœud en nœud",
          "un arbre profond qui colle exactement aux données d'entraînement",
          "un score de risque qui doit rester explicable"
        ]
      },
      en: {
        title: "Decision trees and random forests",
        summary: "Understand tree construction by successive splits and what an ensemble vote adds.",
        goals: [
          "Read a decision tree and follow one example's path.",
          "Explain what the vote of several trees brings."
        ],
        tutor:
          "Have the student follow a file through a small decision tree, then ask why a hundred different trees are wrong less often than one.",
        contexts: [
          "a loan file followed node by node",
          "a deep tree matching the training data exactly",
          "a risk score that must stay explainable"
        ]
      }
    },
    {
      key: "feature_engineering",
      objectives: ["ai_machine_learning"],
      stage: 4,
      fr: {
        title: "Construire une caractéristique utile",
        summary: "Transformer une donnée brute en variable porteuse d'information pour le modèle.",
        goals: [
          "Dériver deux caractéristiques utiles à partir d'une date brute.",
          "Repérer une caractéristique qui ne sera pas disponible au moment de la prédiction."
        ],
        tutor:
          "Fais dériver trois variables à partir d'une date de commande, puis demande laquelle ne serait pas connue au moment de prédire.",
        contexts: [
          "une date de commande transformée en jour de semaine",
          "une adresse convertie en distance au dépôt",
          "un texte libre résumé en longueur et en présence de mots-clés"
        ]
      },
      en: {
        title: "Building a useful feature",
        summary: "Turn raw data into a variable that carries information for the model.",
        goals: [
          "Derive two useful features from a raw date.",
          "Spot a feature that will not be available at prediction time."
        ],
        tutor:
          "Have the student derive three variables from an order date, then ask which one would not be known at prediction time.",
        contexts: [
          "an order date turned into a weekday",
          "an address converted into distance to the depot",
          "free text reduced to length and keyword presence"
        ]
      }
    },
    {
      key: "regularization",
      objectives: ["ai_machine_learning"],
      stage: 4,
      fr: {
        title: "Régularisation : pénaliser la complexité",
        summary: "Ajouter une pénalité sur les coefficients pour préférer un modèle plus simple et plus stable.",
        goals: [
          "Expliquer ce qu'une pénalité impose aux coefficients.",
          "Prévoir l'effet d'une pénalité trop forte."
        ],
        tutor:
          "Fais comparer les coefficients avec et sans pénalité, puis demande ce qui se passe quand la pénalité devient très grande.",
        contexts: [
          "un modèle à trois cents variables et cinq cents exemples",
          "des coefficients qui changent complètement d'un mois à l'autre",
          "une sélection automatique des variables utiles"
        ]
      },
      en: {
        title: "Regularisation: penalising complexity",
        summary: "Add a penalty on coefficients to prefer a simpler and more stable model.",
        goals: [
          "Explain what a penalty imposes on coefficients.",
          "Predict the effect of a too strong penalty."
        ],
        tutor:
          "Have the student compare coefficients with and without penalty, then ask what happens when the penalty becomes very large.",
        contexts: [
          "a model with three hundred variables and five hundred examples",
          "coefficients changing completely from month to month",
          "an automatic selection of useful variables"
        ]
      }
    },
    {
      key: "imbalanced_data",
      objectives: ["ai_machine_learning"],
      stage: 4,
      fr: {
        title: "Données déséquilibrées et métriques trompeuses",
        summary: "Reconnaître qu'une exactitude élevée peut décrire un modèle qui ne détecte jamais la classe rare.",
        goals: [
          "Calculer l'exactitude d'un modèle qui prédit toujours la classe majoritaire.",
          "Choisir une métrique adaptée à une classe rare."
        ],
        tutor:
          "Fais calculer l'exactitude d'un modèle qui répond toujours « non » sur un problème à 1 % de positifs, puis demande quelle métrique utiliser.",
        contexts: [
          "une fraude présente dans un paiement sur mille",
          "une panne rare sur une flotte de machines",
          "un modèle à 99 % d'exactitude qui ne détecte rien"
        ]
      },
      en: {
        title: "Imbalanced data and misleading metrics",
        summary: "Recognise that high accuracy can describe a model that never detects the rare class.",
        goals: [
          "Compute the accuracy of a model always predicting the majority class.",
          "Choose a metric suited to a rare class."
        ],
        tutor:
          "Have the student compute the accuracy of a model always answering “no” on a 1% positive problem, then ask which metric to use.",
        contexts: [
          "fraud present in one payment out of a thousand",
          "a rare failure across a fleet of machines",
          "a 99% accurate model detecting nothing"
        ]
      }
    },
    {
      key: "neural_network_layers",
      objectives: ["ai_machine_learning"],
      stage: 5,
      fr: {
        title: "Ce qu'ajoute une couche cachée",
        summary: "Comprendre pourquoi une non-linéarité permet d'apprendre des frontières qu'une droite ne peut pas tracer.",
        goals: [
          "Expliquer le rôle de la fonction d'activation.",
          "Donner un problème qu'un modèle linéaire ne peut pas résoudre."
        ],
        tutor:
          "Fais expliquer pourquoi empiler des couches sans activation revient à une seule couche, puis demande un problème que cela rendrait insoluble.",
        contexts: [
          "une séparation de deux nuages de points imbriqués",
          "une reconnaissance de chiffres manuscrits",
          "un réseau à dix couches sans fonction d'activation"
        ]
      },
      en: {
        title: "What a hidden layer adds",
        summary: "Understand why a non-linearity allows learning boundaries a straight line cannot draw.",
        goals: [
          "Explain the role of the activation function.",
          "Give a problem a linear model cannot solve."
        ],
        tutor:
          "Have the student explain why stacking layers without activation collapses to one layer, then ask which problem that makes unsolvable.",
        contexts: [
          "separating two interlocked point clouds",
          "recognising handwritten digits",
          "a ten-layer network with no activation function"
        ]
      }
    },
    {
      key: "backpropagation",
      objectives: ["ai_machine_learning"],
      stage: 5,
      fr: {
        title: "La rétropropagation",
        summary: "Comprendre comment l'erreur finale est répartie sur chaque paramètre pour le corriger.",
        goals: [
          "Décrire le sens de circulation de l'erreur dans le réseau.",
          "Expliquer ce qu'est un gradient qui s'évanouit."
        ],
        tutor:
          "Fais décrire le trajet de l'erreur de la sortie vers les premières couches, puis demande pourquoi les premières couches apprennent parfois très lentement.",
        contexts: [
          "un réseau profond dont les premières couches n'évoluent plus",
          "une erreur de sortie répartie sur des milliers de poids",
          "un entraînement suivi couche par couche"
        ]
      },
      en: {
        title: "Backpropagation",
        summary: "Understand how the final error is distributed onto each parameter to correct it.",
        goals: [
          "Describe the direction the error travels through the network.",
          "Explain what a vanishing gradient is."
        ],
        tutor:
          "Have the student describe the error's path from output to first layers, then ask why early layers sometimes learn very slowly.",
        contexts: [
          "a deep network whose first layers stop changing",
          "an output error spread over thousands of weights",
          "a training run monitored layer by layer"
        ]
      }
    },
    {
      key: "clustering_kmeans",
      objectives: ["ai_machine_learning"],
      stage: 5,
      fr: {
        title: "Le regroupement par k-moyennes",
        summary: "Former des groupes sans étiquettes et mesurer ce que le choix du nombre de groupes impose.",
        goals: [
          "Décrire l'alternance affectation et recalcul des centres.",
          "Expliquer pourquoi deux exécutions peuvent donner des groupes différents."
        ],
        tutor:
          "Fais dérouler deux itérations de k-moyennes sur six points, puis demande comment choisir le nombre de groupes sans étiquettes.",
        contexts: [
          "une segmentation de clients par montant et fréquence d'achat",
          "des capteurs regroupés par profil de mesure",
          "deux exécutions qui produisent des groupes différents"
        ]
      },
      en: {
        title: "K-means clustering",
        summary: "Form groups without labels and see what choosing the number of groups imposes.",
        goals: [
          "Describe the alternation of assignment and centre recomputation.",
          "Explain why two runs can produce different groups."
        ],
        tutor:
          "Have the student run two k-means iterations over six points, then ask how to choose the number of groups without labels.",
        contexts: [
          "customer segmentation by purchase amount and frequency",
          "sensors grouped by measurement profile",
          "two runs producing different groups"
        ]
      }
    },
    {
      key: "dimensionality_reduction",
      objectives: ["ai_machine_learning"],
      stage: 5,
      fr: {
        title: "Réduction de dimension et analyse en composantes principales",
        summary: "Projeter des données à nombreuses variables en gardant l'essentiel de leur variance.",
        goals: [
          "Expliquer ce que conserve une projection en deux dimensions.",
          "Dire ce qui est perdu et pourquoi c'est parfois acceptable."
        ],
        tutor:
          "Fais interpréter une projection expliquant 80 % de la variance, puis demande ce que représentent les 20 % restants.",
        contexts: [
          "cinquante mesures de capteurs projetées sur un plan",
          "une visualisation de clients en deux dimensions",
          "un modèle accéléré en réduisant les variables d'entrée"
        ]
      },
      en: {
        title: "Dimensionality reduction and principal component analysis",
        summary: "Project data with many variables while keeping most of its variance.",
        goals: [
          "Explain what a two-dimensional projection preserves.",
          "Say what is lost and why that is sometimes acceptable."
        ],
        tutor:
          "Have the student interpret a projection explaining 80% of variance, then ask what the remaining 20% represents.",
        contexts: [
          "fifty sensor measurements projected onto a plane",
          "a two-dimensional visualisation of customers",
          "a model sped up by reducing input variables"
        ]
      }
    },

    {
      key: "calling_model_api",
      objectives: ["ai_building"],
      stage: 1,
      fr: {
        title: "Ce qui se passe quand une application appelle un modèle",
        summary: "Suivre le trajet d'un appel d'API de modèle : requête, jetons consommés, réponse, coût.",
        goals: [
          "Décrire le contenu d'une requête envoyée à un modèle.",
          "Dire d'où vient la facturation d'un appel."
        ],
        tutor:
          "Fais décrire le contenu exact d'une requête à un modèle, puis demande ce qui augmente la facture pour un même service.",
        contexts: [
          "un chatbot de support intégré à un site",
          "une génération de description produit dans un back-office",
          "une facture mensuelle qui triple sans hausse d'utilisateurs"
        ]
      },
      en: {
        title: "What happens when an application calls a model",
        summary: "Follow a model API call: request, tokens consumed, response, cost.",
        goals: [
          "Describe the content of a request sent to a model.",
          "Say where the billing of a call comes from."
        ],
        tutor:
          "Have the student describe the exact content of a request to a model, then ask what inflates the bill for the same service.",
        contexts: [
          "a support chatbot embedded in a website",
          "product description generation in a back office",
          "a monthly bill tripling with no more users"
        ]
      }
    },
    {
      key: "prompt_structure",
      objectives: ["ai_building"],
      stage: 2,
      fr: {
        title: "Structurer un prompt : rôle, consigne, format attendu",
        summary: "Écrire une instruction dont la sortie est prévisible parce que le format est imposé.",
        goals: [
          "Séparer contexte, tâche et format attendu dans une instruction.",
          "Réécrire une consigne vague en consigne vérifiable."
        ],
        tutor:
          "Fais réécrire une consigne vague en trois blocs séparés, puis demande comment vérifier automatiquement que la sortie respecte le format.",
        contexts: [
          "un résumé d'e-mail client en trois puces",
          "une classification de tickets en quatre catégories fixes",
          "une consigne qui produit un texte différent à chaque exécution"
        ]
      },
      en: {
        title: "Structuring a prompt: role, instruction, expected format",
        summary: "Write an instruction whose output is predictable because the format is imposed.",
        goals: [
          "Separate context, task and expected format in an instruction.",
          "Rewrite a vague instruction into a verifiable one."
        ],
        tutor:
          "Have the student rewrite a vague instruction into three separate blocks, then ask how to check the output format automatically.",
        contexts: [
          "a customer email summarised into three bullets",
          "ticket classification into four fixed categories",
          "an instruction producing different text on each run"
        ]
      }
    },
    {
      key: "structured_output",
      objectives: ["ai_building"],
      stage: 2,
      fr: {
        title: "Obtenir une sortie JSON exploitable",
        summary: "Imposer un schéma de sortie et prévoir ce qui se passe quand le modèle s'en écarte.",
        goals: [
          "Décrire un schéma minimal pour une extraction de données.",
          "Choisir le comportement de l'application face à une sortie invalide."
        ],
        tutor:
          "Fais décrire un schéma pour extraire trois champs d'une facture, puis demande ce que doit faire l'application si un champ manque.",
        contexts: [
          "l'extraction du montant et de la date d'une facture",
          "une réponse tronquée au milieu d'un objet JSON",
          "une intégration qui refuse un champ inconnu"
        ]
      },
      en: {
        title: "Getting usable JSON output",
        summary: "Impose an output schema and plan for what happens when the model departs from it.",
        goals: [
          "Describe a minimal schema for a data extraction.",
          "Choose how the application behaves on invalid output."
        ],
        tutor:
          "Have the student describe a schema extracting three invoice fields, then ask what the application must do if a field is missing.",
        contexts: [
          "extracting the amount and date of an invoice",
          "a response truncated in the middle of a JSON object",
          "an integration rejecting an unknown field"
        ]
      }
    },
    {
      key: "rag_pipeline",
      objectives: ["ai_building"],
      stage: 3,
      fr: {
        title: "Comment fonctionne une architecture RAG",
        summary: "Enchaîner recherche de passages pertinents et génération pour répondre à partir de documents propres.",
        goals: [
          "Ordonner les étapes indexation, recherche, assemblage, génération.",
          "Dire quelle étape est en cause quand la réponse cite un mauvais document."
        ],
        tutor:
          "Fais ordonner les étapes d'une chaîne RAG, puis demande quelle étape corriger quand la réponse s'appuie sur le mauvais document.",
        contexts: [
          "un assistant qui répond à partir du manuel interne",
          "une réponse correcte mais fondée sur une version périmée du document",
          "une base documentaire de dix mille pages"
        ]
      },
      en: {
        title: "How a RAG architecture works",
        summary: "Chain retrieval of relevant passages and generation to answer from your own documents.",
        goals: [
          "Order the indexing, retrieval, assembly and generation stages.",
          "Say which stage is at fault when the answer cites the wrong document."
        ],
        tutor:
          "Have the student order the stages of a RAG chain, then ask which stage to fix when the answer relies on the wrong document.",
        contexts: [
          "an assistant answering from the internal handbook",
          "a correct answer based on an outdated document version",
          "a documentation base of ten thousand pages"
        ]
      }
    },
    {
      key: "chunking_strategy",
      objectives: ["ai_building"],
      stage: 3,
      fr: {
        title: "Découper des documents pour la recherche",
        summary: "Choisir une taille de fragment qui garde le sens complet sans noyer la recherche.",
        goals: [
          "Expliquer l'effet d'un fragment trop court et d'un fragment trop long.",
          "Proposer un découpage adapté à un document structuré."
        ],
        tutor:
          "Fais découper un contrat en fragments, puis demande ce qui se perd si une clause est coupée en deux.",
        contexts: [
          "un contrat dont une clause est coupée en deux fragments",
          "un manuel technique organisé en sections numérotées",
          "une transcription de réunion sans titres"
        ]
      },
      en: {
        title: "Chunking documents for retrieval",
        summary: "Choose a chunk size that keeps meaning complete without drowning the search.",
        goals: [
          "Explain the effect of a too short and a too long chunk.",
          "Propose a chunking suited to a structured document."
        ],
        tutor:
          "Have the student chunk a contract, then ask what is lost when a clause is split in two.",
        contexts: [
          "a contract whose clause is split across two chunks",
          "a technical manual organised in numbered sections",
          "a meeting transcript with no headings"
        ]
      }
    },
    {
      key: "vector_search",
      objectives: ["ai_building"],
      stage: 3,
      fr: {
        title: "La recherche par similarité vectorielle",
        summary: "Comparer recherche par mots-clés et recherche vectorielle, et combiner les deux quand c'est utile.",
        goals: [
          "Citer un cas où la recherche par mots-clés bat la recherche vectorielle.",
          "Expliquer ce qu'apporte une recherche hybride."
        ],
        tutor:
          "Fais comparer les résultats des deux recherches sur une référence produit exacte, puis demande comment les combiner.",
        contexts: [
          "une référence produit exacte cherchée par un client",
          "une question posée avec d'autres mots que le document",
          "un corpus contenant beaucoup d'acronymes internes"
        ]
      },
      en: {
        title: "Vector similarity search",
        summary: "Compare keyword search and vector search, and combine both when useful.",
        goals: [
          "Give a case where keyword search beats vector search.",
          "Explain what hybrid search brings."
        ],
        tutor:
          "Have the student compare both searches on an exact product reference, then ask how to combine them.",
        contexts: [
          "an exact product reference searched by a customer",
          "a question asked with different words than the document",
          "a corpus full of internal acronyms"
        ]
      }
    },
    {
      key: "latency_cost_budget",
      objectives: ["ai_building"],
      stage: 3,
      fr: {
        title: "Budget de latence et de coût par requête",
        summary: "Répartir un budget de temps et d'argent entre les étapes d'une chaîne de génération.",
        goals: [
          "Décomposer la latence d'une réponse en étapes mesurables.",
          "Identifier l'étape à optimiser en premier."
        ],
        tutor:
          "Fais décomposer une réponse de quatre secondes en étapes chiffrées, puis demande laquelle optimiser en premier et pourquoi.",
        contexts: [
          "un assistant qui répond en quatre secondes",
          "une chaîne qui appelle deux modèles successifs",
          "un budget mensuel dépassé en trois semaines"
        ]
      },
      en: {
        title: "Latency and cost budget per request",
        summary: "Split a time and money budget across the stages of a generation chain.",
        goals: [
          "Break down response latency into measurable stages.",
          "Identify the stage to optimise first."
        ],
        tutor:
          "Have the student break a four-second response into timed stages, then ask which to optimise first and why.",
        contexts: [
          "an assistant answering in four seconds",
          "a chain calling two models in sequence",
          "a monthly budget exhausted in three weeks"
        ]
      }
    },
    {
      key: "tool_calling",
      objectives: ["ai_building"],
      stage: 4,
      fr: {
        title: "Donner des outils à un modèle",
        summary: "Décrire des fonctions appelables et contrôler ce que le modèle a le droit de déclencher.",
        goals: [
          "Décrire un outil par son nom, ses paramètres et son effet.",
          "Dire quels outils ne doivent jamais être exposés sans confirmation."
        ],
        tutor:
          "Fais décrire deux outils avec leurs paramètres, puis demande lequel exige une confirmation humaine avant exécution.",
        contexts: [
          "une consultation de stock en lecture seule",
          "un remboursement client déclenché automatiquement",
          "un envoi d'e-mail au nom de l'entreprise"
        ]
      },
      en: {
        title: "Giving tools to a model",
        summary: "Describe callable functions and control what the model is allowed to trigger.",
        goals: [
          "Describe a tool by its name, parameters and effect.",
          "Say which tools must never be exposed without confirmation."
        ],
        tutor:
          "Have the student describe two tools with their parameters, then ask which one requires human confirmation before running.",
        contexts: [
          "a read-only stock lookup",
          "a customer refund triggered automatically",
          "an email sent on behalf of the company"
        ]
      }
    },
    {
      key: "agent_loop",
      objectives: ["ai_building"],
      stage: 4,
      fr: {
        title: "La boucle d'un agent et sa condition d'arrêt",
        summary: "Encadrer une boucle observer-décider-agir par un budget d'étapes et un critère de succès.",
        goals: [
          "Décrire une itération complète de la boucle d'un agent.",
          "Définir une condition d'arrêt vérifiable."
        ],
        tutor:
          "Fais définir la condition d'arrêt d'un agent de recherche documentaire, puis demande ce qui se passe sans limite d'étapes.",
        contexts: [
          "un agent qui relance indéfiniment le même appel",
          "une tâche de recherche en plusieurs étapes",
          "un budget de dix appels d'outils par demande"
        ]
      },
      en: {
        title: "An agent loop and its stopping condition",
        summary: "Bound an observe-decide-act loop with a step budget and a success criterion.",
        goals: [
          "Describe one full iteration of an agent loop.",
          "Define a verifiable stopping condition."
        ],
        tutor:
          "Have the student define the stopping condition of a document research agent, then ask what happens with no step limit.",
        contexts: [
          "an agent retrying the same call forever",
          "a multi-step research task",
          "a budget of ten tool calls per request"
        ]
      }
    },
    {
      key: "guardrails_validation",
      objectives: ["ai_building"],
      stage: 4,
      fr: {
        title: "Valider une sortie de modèle avant de l'utiliser",
        summary: "Placer des vérifications déterministes entre la génération et l'action effectuée par le produit.",
        goals: [
          "Lister les contrôles à appliquer avant d'enregistrer une sortie.",
          "Choisir le comportement en cas d'échec de validation."
        ],
        tutor:
          "Fais lister les contrôles avant d'enregistrer un montant extrait automatiquement, puis demande quoi faire quand un contrôle échoue.",
        contexts: [
          "un montant extrait puis enregistré en comptabilité",
          "un texte publié directement sur un site public",
          "une réponse contenant une donnée personnelle"
        ]
      },
      en: {
        title: "Validating a model output before using it",
        summary: "Place deterministic checks between generation and the action the product performs.",
        goals: [
          "List the checks to apply before persisting an output.",
          "Choose the behaviour when validation fails."
        ],
        tutor:
          "Have the student list the checks before saving an automatically extracted amount, then ask what to do when a check fails.",
        contexts: [
          "an amount extracted then written into accounting",
          "text published directly on a public site",
          "an answer containing personal data"
        ]
      }
    },
    {
      key: "caching_llm_calls",
      objectives: ["ai_building"],
      stage: 4,
      fr: {
        title: "Mettre en cache des réponses de modèle",
        summary: "Identifier les appels réellement répétés et construire une clé de cache qui ne mélange pas deux demandes.",
        goals: [
          "Construire une clé de cache à partir des éléments qui changent la réponse.",
          "Citer un cas où le cache produirait une réponse fausse."
        ],
        tutor:
          "Fais construire la clé de cache d'une génération de description produit, puis demande ce qui arriverait si la langue n'entrait pas dans la clé.",
        contexts: [
          "la même question posée par cent utilisateurs",
          "une génération identique dans deux langues différentes",
          "un prompt modifié sans changement de clé"
        ]
      },
      en: {
        title: "Caching model responses",
        summary: "Identify genuinely repeated calls and build a cache key that never merges two requests.",
        goals: [
          "Build a cache key from the elements that change the answer.",
          "Give a case where the cache would return a wrong answer."
        ],
        tutor:
          "Have the student build the cache key of a product description generation, then ask what happens if language is not part of the key.",
        contexts: [
          "the same question asked by a hundred users",
          "an identical generation in two different languages",
          "a prompt changed without changing the key"
        ]
      }
    },
    {
      key: "product_eval_set",
      objectives: ["ai_building"],
      stage: 5,
      fr: {
        title: "Construire un jeu d'évaluation pour son produit",
        summary: "Constituer des cas représentatifs et une règle de notation stable pour comparer deux versions.",
        goals: [
          "Choisir des cas qui couvrent les usages réels et les cas difficiles.",
          "Définir une notation reproductible par deux personnes différentes."
        ],
        tutor:
          "Fais constituer dix cas d'évaluation pour un assistant de support, puis demande comment noter sans dépendre de l'humeur de l'évaluateur.",
        contexts: [
          "une comparaison entre deux versions d'un prompt",
          "un changement de modèle fournisseur",
          "des cas rares signalés par le service client"
        ]
      },
      en: {
        title: "Building an evaluation set for your product",
        summary: "Assemble representative cases and a stable scoring rule to compare two versions.",
        goals: [
          "Choose cases covering real usage and hard cases.",
          "Define a scoring reproducible by two different people."
        ],
        tutor:
          "Have the student assemble ten evaluation cases for a support assistant, then ask how to score without depending on the rater's mood.",
        contexts: [
          "a comparison between two prompt versions",
          "a change of model provider",
          "rare cases reported by customer service"
        ]
      }
    },
    {
      key: "fallback_and_degradation",
      objectives: ["ai_building"],
      stage: 5,
      fr: {
        title: "Que faire quand le modèle échoue",
        summary: "Concevoir une dégradation lisible plutôt qu'une erreur brute quand la génération est impossible.",
        goals: [
          "Distinguer réessai, repli et échec assumé.",
          "Choisir la réponse produit quand aucune génération n'aboutit."
        ],
        tutor:
          "Fais choisir le comportement produit quand le modèle est indisponible dix minutes, puis demande ce que l'utilisateur doit voir exactement.",
        contexts: [
          "une panne du fournisseur pendant dix minutes",
          "une sortie invalide malgré deux tentatives",
          "un dépassement de quota en pleine journée"
        ]
      },
      en: {
        title: "What to do when the model fails",
        summary: "Design a readable degradation rather than a raw error when generation is impossible.",
        goals: [
          "Tell apart retry, fallback and accepted failure.",
          "Choose the product answer when no generation succeeds."
        ],
        tutor:
          "Have the student choose the product behaviour when the model is down for ten minutes, then ask what the user must see exactly.",
        contexts: [
          "a provider outage lasting ten minutes",
          "an invalid output despite two attempts",
          "a quota exceeded in the middle of the day"
        ]
      }
    },
    {
      key: "finetuning_vs_prompting",
      objectives: ["ai_building"],
      stage: 5,
      fr: {
        title: "Ajuster un modèle ou améliorer le prompt",
        summary: "Arbitrer entre ajustement fin, exemples dans le prompt et recherche documentaire selon le problème observé.",
        goals: [
          "Associer un symptôme observé au bon levier de correction.",
          "Citer ce que l'ajustement fin ne corrige pas."
        ],
        tutor:
          "Fais choisir le levier adapté à trois symptômes : mauvais format, faits manquants, ton inadapté, en demandant de justifier.",
        contexts: [
          "un format de sortie régulièrement incorrect",
          "des faits internes absents des réponses",
          "un ton inadapté à la marque"
        ]
      },
      en: {
        title: "Fine-tuning a model or improving the prompt",
        summary: "Arbitrate between fine-tuning, in-prompt examples and retrieval based on the observed problem.",
        goals: [
          "Match an observed symptom to the right corrective lever.",
          "State what fine-tuning does not fix."
        ],
        tutor:
          "Have the student pick the right lever for three symptoms: wrong format, missing facts, wrong tone, justifying each.",
        contexts: [
          "an output format regularly incorrect",
          "internal facts missing from answers",
          "a tone that does not match the brand"
        ]
      }
    },
    {
      key: "prompt_injection_defense",
      objectives: ["ai_building"],
      stage: 5,
      fr: {
        title: "Se protéger de l'injection de prompt",
        summary: "Traiter tout contenu externe comme non fiable et séparer les instructions des données lues.",
        goals: [
          "Expliquer pourquoi un document lu peut contenir une instruction hostile.",
          "Citer deux protections qui limitent l'impact d'une injection."
        ],
        tutor:
          "Fais analyser une page web contenant une instruction cachée destinée à l'assistant, puis demande quelles limites d'outils réduisent le risque.",
        contexts: [
          "une page web lue par un assistant de navigation",
          "un e-mail entrant contenant une consigne cachée",
          "un document partagé par un tiers externe"
        ]
      },
      en: {
        title: "Defending against prompt injection",
        summary: "Treat all external content as untrusted and keep instructions separate from read data.",
        goals: [
          "Explain why a read document can contain a hostile instruction.",
          "Name two protections limiting the impact of an injection."
        ],
        tutor:
          "Have the student analyse a web page containing a hidden instruction aimed at the assistant, then ask which tool limits reduce the risk.",
        contexts: [
          "a web page read by a browsing assistant",
          "an incoming email carrying a hidden instruction",
          "a document shared by an external third party"
        ]
      }
    }
  ]
};
