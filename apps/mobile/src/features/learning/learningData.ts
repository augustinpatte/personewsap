import type {
  LearningDomain,
  LearningObjective,
  LearningPath,
  LearningSession
} from "./learningTypes";

export const learningDomainOrder = [
  "computer_science",
  "artificial_intelligence",
  "blockchain",
  "quantum_physics",
  "mathematics",
  "cybersecurity",
  "human_biology_medicine"
] as const;

export const mockLearningDomains: LearningDomain[] = [
  {
    id: "domain-computer-science",
    slug: "computer_science",
    label_fr: "Informatique",
    label_en: "Computer Science",
    description_fr: "Comprendre les systèmes, les réseaux, les algorithmes et la logique du code.",
    description_en: "Understand systems, networks, algorithms and the logic behind code.",
    position: 1
  },
  {
    id: "domain-artificial-intelligence",
    slug: "artificial_intelligence",
    label_fr: "Intelligence artificielle",
    label_en: "Artificial Intelligence",
    description_fr: "Apprendre comment les modèles apprennent, raisonnent et arrivent dans les produits.",
    description_en: "Learn how models learn, reason and reach real products.",
    position: 2
  },
  {
    id: "domain-blockchain",
    slug: "blockchain",
    label_fr: "Blockchain",
    label_en: "Blockchain",
    description_fr: "Lire les réseaux décentralisés avec une logique technique, économique et juridique.",
    description_en: "Read decentralised networks through technical, economic and legal logic.",
    position: 3
  },
  {
    id: "domain-quantum-physics",
    slug: "quantum_physics",
    label_fr: "Physique quantique",
    label_en: "Quantum Physics",
    description_fr: "Construire les bases pour comprendre états, mesures, qubits et applications.",
    description_en: "Build the foundations for states, measurement, qubits and applications.",
    position: 4
  },
  {
    id: "domain-mathematics",
    slug: "mathematics",
    label_fr: "Mathématiques",
    label_en: "Mathematics",
    description_fr: "Renforcer les outils de raisonnement qui soutiennent la science et la finance.",
    description_en: "Strengthen the reasoning tools behind science, software and finance.",
    position: 5
  },
  {
    id: "domain-cybersecurity",
    slug: "cybersecurity",
    label_fr: "Cybersécurité",
    label_en: "Cybersecurity",
    description_fr: "Comprendre les attaques, les défenses et les décisions de sécurité.",
    description_en: "Understand attacks, defences and security decisions.",
    position: 6
  },
  {
    id: "domain-human-biology-medicine",
    slug: "human_biology_medicine",
    label_fr: "Biologie humaine et médecine",
    label_en: "Human Biology and Medicine",
    description_fr: "Relier biologie, diagnostic, essais cliniques et décisions médicales.",
    description_en: "Connect biology, diagnosis, clinical trials and medical decisions.",
    position: 7
  }
];

export const mockLearningObjectives: LearningObjective[] = mockLearningDomains.flatMap(
  (domain, index) => {
    const shared = {
      domain_id: domain.id,
      position: 1
    };

    const objectiveSets: Record<string, Array<Omit<LearningObjective, "domain_id">>> = {
      computer_science: [
        {
          id: "objective-cs-systems",
          slug: "systems",
          label_fr: "Comprendre les systèmes",
          label_en: "Understand systems",
          description_fr:
            "Découvrir ce qui se passe sous le code : processeurs, mémoire, systèmes d'exploitation, Internet et réseaux.",
          description_en:
            "Discover what happens below the code: processors, memory, operating systems, the Internet and networks.",
          position: 1
        },
        {
          id: "objective-cs-algorithms",
          slug: "algorithms",
          label_fr: "Raisonner avec les algorithmes",
          label_en: "Reason with algorithms",
          description_fr:
            "Apprendre à choisir une structure de données, comparer des coûts et expliquer pourquoi une solution tient.",
          description_en:
            "Learn to choose a data structure, compare costs and explain why a solution holds up.",
          position: 2
        },
        {
          id: "objective-cs-product",
          slug: "product_engineering",
          label_fr: "Construire des produits fiables",
          label_en: "Build reliable products",
          description_fr:
            "Relier architecture, tests, performance et décisions produit dans des situations concrètes.",
          description_en:
            "Connect architecture, tests, performance and product decisions in practical situations.",
          position: 3
        }
      ],
      artificial_intelligence: [
        {
          id: "objective-ai-models",
          slug: "models",
          label_fr: "Comprendre les modèles",
          label_en: "Understand models",
          description_fr:
            "Comprendre données, entraînement, évaluation, limites et risques de hallucination.",
          description_en:
            "Understand data, training, evaluation, limits and hallucination risks.",
          position: 1
        },
        {
          id: "objective-ai-products",
          slug: "ai_products",
          label_fr: "Créer des produits IA",
          label_en: "Create AI products",
          description_fr:
            "Apprendre à cadrer un cas d'usage, choisir une approche et vérifier la qualité réelle.",
          description_en:
            "Learn to frame a use case, choose an approach and verify real quality.",
          position: 2
        },
        {
          id: "objective-ai-governance",
          slug: "governance",
          label_fr: "Piloter les risques IA",
          label_en: "Manage AI risks",
          description_fr:
            "Relier conformité, biais, sécurité, transparence et adoption responsable.",
          description_en:
            "Connect compliance, bias, safety, transparency and responsible adoption.",
          position: 3
        }
      ],
      blockchain: [
        {
          id: "objective-blockchain-basics",
          slug: "protocols",
          label_fr: "Comprendre les protocoles",
          label_en: "Understand protocols",
          description_fr:
            "Comprendre blocs, consensus, wallets, frais et sécurité des transactions.",
          description_en:
            "Understand blocks, consensus, wallets, fees and transaction security.",
          position: 1
        },
        {
          id: "objective-blockchain-defi",
          slug: "defi",
          label_fr: "Lire la DeFi",
          label_en: "Read DeFi",
          description_fr:
            "Analyser prêts, liquidité, rendement, smart contracts et risques économiques.",
          description_en:
            "Analyse lending, liquidity, yield, smart contracts and economic risk.",
          position: 2
        },
        {
          id: "objective-blockchain-regulation",
          slug: "regulation",
          label_fr: "Comprendre la régulation",
          label_en: "Understand regulation",
          description_fr:
            "Relier usages crypto, conformité, protection des investisseurs et modèles d'affaires.",
          description_en:
            "Connect crypto uses, compliance, investor protection and business models.",
          position: 3
        }
      ],
      quantum_physics: [
        {
          id: "objective-quantum-foundations",
          slug: "foundations",
          label_fr: "Poser les bases",
          label_en: "Build foundations",
          description_fr:
            "Comprendre états, superposition, mesure et le vocabulaire essentiel.",
          description_en:
            "Understand states, superposition, measurement and the essential vocabulary.",
          position: 1
        },
        {
          id: "objective-quantum-computing",
          slug: "computing",
          label_fr: "Comprendre le calcul quantique",
          label_en: "Understand quantum computing",
          description_fr:
            "Découvrir qubits, portes, erreurs et pourquoi certains calculs changent d'échelle.",
          description_en:
            "Discover qubits, gates, errors and why some calculations scale differently.",
          position: 2
        },
        {
          id: "objective-quantum-applications",
          slug: "applications",
          label_fr: "Explorer les applications",
          label_en: "Explore applications",
          description_fr:
            "Relier capteurs, cryptographie, matériaux et promesses réalistes du secteur.",
          description_en:
            "Connect sensors, cryptography, materials and realistic industry promises.",
          position: 3
        }
      ],
      mathematics: [
        {
          id: "objective-maths-proof",
          slug: "proof",
          label_fr: "Raisonner proprement",
          label_en: "Reason cleanly",
          description_fr:
            "Travailler logique, preuves, contre-exemples et méthodes de résolution.",
          description_en:
            "Work on logic, proofs, counterexamples and problem-solving methods.",
          position: 1
        },
        {
          id: "objective-maths-data",
          slug: "data",
          label_fr: "Maîtriser les données",
          label_en: "Master data",
          description_fr:
            "Comprendre probabilités, statistiques, corrélation, incertitude et modèles.",
          description_en:
            "Understand probability, statistics, correlation, uncertainty and models.",
          position: 2
        },
        {
          id: "objective-maths-finance",
          slug: "finance",
          label_fr: "Appliquer aux marchés",
          label_en: "Apply to markets",
          description_fr:
            "Relier taux, risque, optimisation et lecture quantitative des décisions.",
          description_en:
            "Connect rates, risk, optimisation and quantitative decision reading.",
          position: 3
        }
      ],
      cybersecurity: [
        {
          id: "objective-cyber-threats",
          slug: "threats",
          label_fr: "Comprendre les attaques",
          label_en: "Understand attacks",
          description_fr:
            "Lire phishing, vulnérabilités, malware, exploitation et chaînes d'attaque.",
          description_en:
            "Read phishing, vulnerabilities, malware, exploitation and attack chains.",
          position: 1
        },
        {
          id: "objective-cyber-defense",
          slug: "defense",
          label_fr: "Construire une défense",
          label_en: "Build a defence",
          description_fr:
            "Comprendre authentification, chiffrement, surveillance et réponse à incident.",
          description_en:
            "Understand authentication, encryption, monitoring and incident response.",
          position: 2
        },
        {
          id: "objective-cyber-risk",
          slug: "risk",
          label_fr: "Piloter le risque",
          label_en: "Manage risk",
          description_fr:
            "Relier sécurité, coûts, conformité, priorisation et décisions de direction.",
          description_en:
            "Connect security, cost, compliance, prioritisation and leadership decisions.",
          position: 3
        }
      ],
      human_biology_medicine: [
        {
          id: "objective-biology-body",
          slug: "body_systems",
          label_fr: "Comprendre le corps",
          label_en: "Understand the body",
          description_fr:
            "Relier cellules, organes, immunité, hormones et grandes fonctions vitales.",
          description_en:
            "Connect cells, organs, immunity, hormones and major vital functions.",
          position: 1
        },
        {
          id: "objective-medicine-diagnosis",
          slug: "diagnosis",
          label_fr: "Lire un raisonnement médical",
          label_en: "Read medical reasoning",
          description_fr:
            "Comprendre symptômes, hypothèses, examens, probabilités et décisions cliniques.",
          description_en:
            "Understand symptoms, hypotheses, tests, probabilities and clinical decisions.",
          position: 2
        },
        {
          id: "objective-medicine-research",
          slug: "research",
          label_fr: "Analyser la recherche médicale",
          label_en: "Analyse medical research",
          description_fr:
            "Lire essais cliniques, niveaux de preuve, biais et sécurité des traitements.",
          description_en:
            "Read clinical trials, evidence levels, bias and treatment safety.",
          position: 3
        }
      ]
    };

    return (objectiveSets[domain.slug] ?? []).map((objective) => ({
      ...shared,
      ...objective,
      position: objective.position + index * 3
    }));
  }
);

export const mockLearningPath: LearningPath = {
  id: "mock-learning-path-active",
  user_id: null,
  domain_id: "domain-computer-science",
  objective_id: "objective-cs-systems",
  current_level: 2,
  target_level: 4,
  status: "active",
  created_at: "2026-04-26T07:00:00Z",
  updated_at: "2026-04-26T07:00:00Z",
  archived_at: null
};

export const mockLearningSessions: LearningSession[] = [
  {
    id: "mock-learning-session-1",
    path_id: mockLearningPath.id,
    session_number: 1,
    title_fr: "Ce que fait vraiment un système d'exploitation",
    title_en: "What an operating system really does",
    summary_fr:
      "Une carte simple des responsabilités entre matériel, système, applications et réseau.",
    summary_en:
      "A simple map of responsibilities between hardware, system, applications and network.",
    objectives_fr: [
      "Distinguer matériel, noyau et application.",
      "Comprendre pourquoi la mémoire doit être gérée.",
      "Relier fichiers, processus et réseau."
    ],
    objectives_en: [
      "Separate hardware, kernel and application.",
      "Understand why memory needs management.",
      "Connect files, processes and network."
    ],
    prompt_text:
      "You are my five-minute tutor for PersoNewsAP. Teach me what an operating system really does. My current level is beginner and my target is to become independent. Keep it concrete, use one analogy, ask no written homework, and finish with four quick recall questions I can answer mentally.",
    status: "available",
    available_on: "2026-04-26",
    completed_at: null,
    created_at: "2026-04-26T07:00:00Z"
  }
];
