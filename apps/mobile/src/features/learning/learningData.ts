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
  domain("computer_science", 1, "Informatique", "Computer Science", "Comprendre les systèmes, les réseaux, les algorithmes et la logique du code.", "Understand systems, networks, algorithms and the logic behind code."),
  domain("artificial_intelligence", 2, "Intelligence artificielle", "Artificial Intelligence", "Apprendre comment les modèles apprennent, raisonnent et arrivent dans les produits.", "Learn how models learn, reason and reach real products."),
  domain("blockchain", 3, "Blockchain", "Blockchain", "Lire les réseaux décentralisés avec une logique technique, économique et juridique.", "Read decentralized networks through technical, economic and legal logic."),
  domain("quantum_physics", 4, "Physique quantique", "Quantum Physics", "Construire les bases pour comprendre états, mesures, qubits et applications.", "Build the foundations for states, measurement, qubits and applications."),
  domain("mathematics", 5, "Mathématiques", "Mathematics", "Renforcer les outils de raisonnement qui soutiennent la science, le logiciel et la finance.", "Strengthen the reasoning tools behind science, software and finance."),
  domain("cybersecurity", 6, "Cybersécurité", "Cybersecurity", "Comprendre les attaques, les défenses et les décisions de sécurité.", "Understand attacks, defenses and security decisions."),
  domain("human_biology_medicine", 7, "Biologie humaine et médecine", "Human Biology and Medicine", "Relier biologie, essais cliniques, preuves et décisions médicales générales.", "Connect biology, clinical trials, evidence and general medical decisions.")
];

export const mockLearningObjectives: LearningObjective[] = [
  objective("cs_systems", "computer_science", "systems", 1, "Comprendre les systèmes", "Understand computer systems", "Découvrir ce qui se passe sous le code : processeurs, mémoire, systèmes d’exploitation, Internet et réseaux.", "Learn what happens beneath the code: processors, memory, operating systems, the Internet and networks."),
  objective("cs_programming", "computer_science", "programming", 2, "Programmer et raisonner", "Program and reason", "Apprendre à décomposer un problème, écrire des algorithmes et produire du code fiable.", "Learn to break down problems, design algorithms and produce reliable code."),
  objective("cs_software_data", "computer_science", "software_data", 3, "Construire des logiciels et gérer les données", "Build software and manage data", "Comprendre les bases de données, les API, l’architecture logicielle et la qualité d’un système.", "Understand databases, APIs, software architecture and system quality."),
  objective("ai_foundations", "artificial_intelligence", "foundations", 1, "Comprendre l’intelligence artificielle", "Understand artificial intelligence", "Comprendre comment les modèles apprennent, produisent des résultats, échouent et sont évalués.", "Understand how models learn, produce outputs, fail and are evaluated."),
  objective("ai_machine_learning", "artificial_intelligence", "machine_learning", 2, "Maîtriser les fondements du machine learning", "Master machine learning foundations", "Étudier les données, les statistiques, l’entraînement, les métriques et les principaux algorithmes.", "Study data, statistics, training, metrics and the main algorithms."),
  objective("ai_building", "artificial_intelligence", "building", 3, "Construire avec l’intelligence artificielle", "Build with artificial intelligence", "Apprendre à utiliser des modèles, des API, le RAG, les agents et les bonnes architectures produit.", "Learn to use models, APIs, RAG, agents and strong product architectures."),
  objective("blockchain_foundations", "blockchain", "foundations", 1, "Comprendre les fondements", "Understand the foundations", "Comprendre la cryptographie, les réseaux distribués, le consensus et le fonctionnement de Bitcoin.", "Understand cryptography, distributed networks, consensus and how Bitcoin works."),
  objective("blockchain_ecosystem", "blockchain", "ecosystem", 2, "Explorer l’écosystème et la DeFi", "Explore the ecosystem and DeFi", "Comprendre Ethereum, les tokens, les stablecoins, la finance décentralisée et leurs risques.", "Understand Ethereum, tokens, stablecoins, decentralized finance and their risks."),
  objective("blockchain_building", "blockchain", "building", 3, "Construire sur une blockchain", "Build on a blockchain", "Découvrir les smart contracts, les outils de développement, les tests et la sécurité.", "Discover smart contracts, developer tools, testing and security."),
  objective("quantum_intuition", "quantum_physics", "intuition", 1, "Développer une intuition quantique", "Develop quantum intuition", "Comprendre les grandes idées de la physique quantique avant d’entrer dans le formalisme avancé.", "Understand the big ideas of quantum physics before advanced formalism."),
  objective("quantum_mathematics", "quantum_physics", "mathematics", 2, "Comprendre le formalisme mathématique", "Understand the mathematical formalism", "Relier les états quantiques, les probabilités, les opérateurs et les mesures aux mathématiques nécessaires.", "Connect quantum states, probabilities, operators and measurement to the required mathematics."),
  objective("quantum_computing", "quantum_physics", "computing", 3, "Découvrir le calcul quantique", "Discover quantum computing", "Comprendre les qubits, les portes quantiques, les algorithmes et les limites des ordinateurs quantiques.", "Understand qubits, quantum gates, algorithms and the limits of quantum computers."),
  objective("math_foundations", "mathematics", "foundations", 1, "Renforcer les fondements et le raisonnement", "Strengthen foundations and reasoning", "Travailler l’algèbre, les fonctions, la logique, les démonstrations et la résolution de problèmes.", "Work on algebra, functions, logic, proofs and problem solving."),
  objective("math_probability", "mathematics", "probability", 2, "Comprendre les probabilités et les statistiques", "Understand probability and statistics", "Apprendre à raisonner sous incertitude, analyser des données et interpréter correctement les résultats.", "Learn to reason under uncertainty, analyze data and interpret results correctly."),
  objective("math_technology", "mathematics", "technology", 3, "Maîtriser les mathématiques de la technologie", "Master the mathematics of technology", "Étudier l’algèbre linéaire, le calcul différentiel et les mathématiques discrètes utiles en informatique, IA et physique.", "Study linear algebra, calculus and discrete mathematics useful in computer science, AI and physics."),
  objective("cyber_foundations", "cybersecurity", "foundations", 1, "Comprendre les menaces et les protections", "Understand threats and protections", "Comprendre les attaques courantes, l’identité, la cryptographie et les règles essentielles de sécurité numérique.", "Understand common attacks, identity, cryptography and essential digital security rules."),
  objective("cyber_network_defense", "cybersecurity", "network_defense", 2, "Défendre les réseaux et les systèmes", "Defend networks and systems", "Étudier les réseaux, la surveillance, les vulnérabilités, les incidents et les méthodes de défense.", "Study networks, monitoring, vulnerabilities, incidents and defense methods."),
  objective("cyber_app_cloud", "cybersecurity", "app_cloud", 3, "Sécuriser les applications et le cloud", "Secure applications and cloud", "Comprendre la sécurité web, les API, les permissions, le cloud et la conception sécurisée.", "Understand web security, APIs, permissions, cloud and secure design."),
  objective("medicine_body", "human_biology_medicine", "body", 1, "Comprendre le corps humain", "Understand the human body", "Étudier l’anatomie, la physiologie et le fonctionnement coordonné des principaux systèmes du corps.", "Study anatomy, physiology and the coordinated function of major body systems."),
  objective("medicine_disease", "human_biology_medicine", "disease", 2, "Comprendre les mécanismes des maladies", "Understand disease mechanisms", "Découvrir comment les maladies apparaissent, progressent et sont étudiées, sans produire de diagnostic personnel.", "Discover how diseases appear, progress and are studied, without producing a personal diagnosis."),
  objective("medicine_evidence", "human_biology_medicine", "evidence", 3, "Comprendre les médicaments et les preuves médicales", "Understand medicines and medical evidence", "Étudier la pharmacologie, les essais cliniques, les risques, la santé publique et la qualité des preuves.", "Study pharmacology, clinical trials, risks, public health and evidence quality.")
];

export const mockLearningPath: LearningPath = {
  id: "mock-learning-path-active",
  user_id: null,
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 2,
  target_level: 4,
  language: "en",
  status: "active",
  created_at: "2026-04-26T07:00:00Z",
  updated_at: "2026-04-26T07:00:00Z",
  archived_at: null
};

export const mockLearningSessions: LearningSession[] = [
  {
    id: "mock-learning-session-1",
    path_id: mockLearningPath.id,
    daily_drop_id: null,
    curriculum_step_key: "computer_science.cs_systems.001",
    session_number: 1,
    adaptation_mode: "normal",
    language: "en",
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
      "Act as my PersoNewsAP five-minute tutor. Teach me what an operating system really does in English. Start with a maximum 120-word explanation, keep the main explanation under 220 words, ask at most three questions one at a time, correct briefly, and end with a recap under 60 words.",
    generation_status: "ready",
    status: "available",
    available_on: "2026-04-26",
    opened_at: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-04-26T07:00:00Z"
  }
];

function domain(
  id: LearningDomain["id"],
  position: number,
  label_fr: string,
  label_en: string,
  description_fr: string,
  description_en: string
): LearningDomain {
  return { id, slug: id, position, label_fr, label_en, description_fr, description_en };
}

function objective(
  id: LearningObjective["id"],
  domain_id: LearningObjective["domain_id"],
  slug: LearningObjective["slug"],
  position: number,
  label_fr: string,
  label_en: string,
  description_fr: string,
  description_en: string
): LearningObjective {
  return { id, domain_id, slug, position, label_fr, label_en, description_fr, description_en };
}
