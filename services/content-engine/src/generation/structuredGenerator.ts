import {
  MINI_CASE_TOPIC_IDS,
  miniCaseTopicToContentTopics
} from "../domain.js";
import type {
  BusinessStory,
  DailyDropPayload,
  GeneratedContentItem,
  KeyConcept,
  Language,
  MiniCaseChallenge,
  NewsletterArticle,
  RankedArticle,
  TopicId
} from "../domain.js";
import {
  MINI_CASE_CONCEPTS,
  MINI_CASE_CORRECT_ANSWER_PATTERNS,
  MINI_CASE_DECISION_TYPES,
  MINI_CASE_QUESTION_PATTERNS,
  MINI_CASE_SCENARIO_TYPES
} from "../miniCase/taxonomy.js";
import { normalizeMemoryKey } from "./editorialMemory.js";
import { GENERATOR_VERSION, PROMPT_VERSION } from "./prompts.js";
import type { ContentGenerator, GenerationRequest } from "./types.js";

const CONCEPTS: Record<TopicId, { title: Record<Language, string>; definition: Record<Language, string>; mistake: Record<Language, string> }> = {
  business: {
    title: { en: "Pricing power", fr: "Pouvoir de prix" },
    definition: {
      en: "The ability to raise prices without losing enough customers to damage the business.",
      fr: "La capacité à augmenter les prix sans perdre assez de clients pour abîmer l'activité."
    },
    mistake: { en: "Confusing popularity with pricing power.", fr: "Confondre popularité et capacité à faire payer." }
  },
  finance: {
    title: { en: "Duration risk", fr: "Risque de duration" },
    definition: {
      en: "The sensitivity of an asset's value to changes in interest rates.",
      fr: "La sensibilité de la valeur d'un actif aux variations de taux d'intérêt."
    },
    mistake: { en: "Thinking all bonds react the same way when rates move.", fr: "Croire que toutes les obligations réagissent pareil quand les taux bougent." }
  },
  tech_ai: {
    title: { en: "Switching costs", fr: "Coûts de changement" },
    definition: {
      en: "The time, money, data, and habit a customer loses when changing products.",
      fr: "Le temps, l'argent, les données et les habitudes qu'un client perd en changeant de produit."
    },
    mistake: { en: "Assuming the best product always wins.", fr: "Supposer que le meilleur produit gagne toujours." }
  },
  law: {
    title: { en: "Regulatory moat", fr: "Barrière réglementaire" },
    definition: {
      en: "An advantage created when rules make it harder for competitors to enter or operate.",
      fr: "Un avantage créé quand les règles rendent l'entrée ou l'exploitation plus difficile pour les concurrents."
    },
    mistake: { en: "Treating regulation only as a cost.", fr: "Voir la régulation seulement comme un coût." }
  },
  medicine: {
    title: { en: "Clinical endpoints", fr: "Critères cliniques" },
    definition: {
      en: "The outcomes a study measures to judge whether a treatment works.",
      fr: "Les résultats qu'une étude mesure pour juger si un traitement fonctionne."
    },
    mistake: { en: "Reading a positive trial result without checking what was actually measured.", fr: "Lire un résultat positif sans vérifier ce qui a été mesuré." }
  },
  engineering: {
    title: { en: "Operational redundancy", fr: "Redondance opérationnelle" },
    definition: {
      en: "Extra capacity or backup paths that keep a system working when one part fails.",
      fr: "Une capacité ou des chemins de secours qui gardent un système actif quand une partie tombe."
    },
    mistake: { en: "Seeing redundancy as waste instead of resilience.", fr: "Voir la redondance comme du gaspillage au lieu d'une résilience." }
  },
  sport_business: {
    title: { en: "Media rights flywheel", fr: "Volant des droits médias" },
    definition: {
      en: "The cycle where audience demand raises rights fees, which funds better talent and production.",
      fr: "Le cycle où la demande du public augmente les droits, puis finance de meilleurs talents et une meilleure production."
    },
    mistake: { en: "Judging a league only by ticket sales.", fr: "Juger une ligue seulement par la billetterie." }
  },
  culture_media: {
    title: { en: "Attention bundling", fr: "Regroupement de l'attention" },
    definition: {
      en: "Packaging content so audiences return regularly instead of consuming one isolated item.",
      fr: "Assembler du contenu pour faire revenir le public régulièrement plutôt que consommer un seul élément isolé."
    },
    mistake: { en: "Mistaking reach for loyalty.", fr: "Confondre portée et fidélité." }
  }
};

const TOPIC_LABELS: Record<TopicId, { en: string; fr: string }> = {
  business: { en: "Business", fr: "Business" },
  finance: { en: "Finance", fr: "Finance" },
  tech_ai: { en: "Tech/AI", fr: "Tech/IA" },
  law: { en: "Law", fr: "Droit" },
  medicine: { en: "Medicine", fr: "Médecine" },
  engineering: { en: "Engineering", fr: "Ingénierie" },
  sport_business: { en: "Sports Business", fr: "Sport business" },
  culture_media: { en: "Culture/Media", fr: "Culture/médias" }
};

const TOPIC_EDGES: Record<TopicId, { en: string; fr: string; watchEn: string; watchFr: string }> = {
  business: {
    en: "pricing, retention, and distribution decide whether the move survives contact with customers",
    fr: "le prix, la rétention et la distribution montrent si la décision tient face aux clients",
    watchEn: "renewals, discounting, customer churn, or a change in sales cycle length",
    watchFr: "les renouvellements, les remises, le départ de clients ou la durée du cycle de vente"
  },
  finance: {
    en: "small rate or risk changes can reprice decisions that looked stable last week",
    fr: "un faible changement de taux ou de risque peut revaloriser une décision qui semblait stable",
    watchEn: "funding costs, default signals, deposit flows, or guidance on credit demand",
    watchFr: "les coûts de financement, les signaux de défaut, les flux de dépôts ou la demande de crédit"
  },
  tech_ai: {
    en: "the constraint is often compute, data access, distribution, or trust rather than the demo itself",
    fr: "la contrainte se situe souvent dans le calcul, les données, la distribution ou la confiance plus que dans la démo",
    watchEn: "capacity commitments, customer migrations, model access rules, or security reviews",
    watchFr: "les engagements de capacité, les migrations clients, les règles d'accès aux modèles ou les revues de sécurité"
  },
  law: {
    en: "rules change product defaults, compliance costs, and who can move fastest",
    fr: "les règles changent les choix par défaut, les coûts de conformité et la vitesse d'exécution",
    watchEn: "implementation deadlines, enforcement language, appeals, or revised product defaults",
    watchFr: "les délais d'application, le vocabulaire de sanction, les recours ou les choix produit modifiés"
  },
  medicine: {
    en: "the real test is what was measured, for whom, and whether the effect changes care",
    fr: "le vrai test porte sur ce qui a été mesuré, pour quels patients, et si l'effet change les soins",
    watchEn: "endpoint detail, safety data, trial size, regulatory review, or clinician uptake",
    watchFr: "le détail des critères, les données de sécurité, la taille de l'essai, l'examen réglementaire ou l'adoption clinique"
  },
  engineering: {
    en: "constraints in reliability, cost, and failure modes decide whether the design scales",
    fr: "la fiabilité, les coûts et les modes de panne disent si la conception peut passer à l'échelle",
    watchEn: "incident rates, redundancy plans, maintenance cost, or deployment timelines",
    watchFr: "les taux d'incident, les plans de redondance, les coûts de maintenance ou les calendriers de déploiement"
  },
  sport_business: {
    en: "audience demand becomes strategy only when rights, sponsorship, and fan behavior reinforce each other",
    fr: "la demande du public devient stratégique quand droits, sponsoring et comportement des fans se renforcent",
    watchEn: "rights fees, attendance, subscriber trends, sponsorship renewals, or schedule changes",
    watchFr: "les droits médias, l'affluence, les abonnés, les renouvellements de sponsoring ou le calendrier"
  },
  culture_media: {
    en: "attention only compounds when the format, distribution, and audience habit all line up",
    fr: "l'attention ne s'accumule que si le format, la distribution et l'habitude du public s'alignent",
    watchEn: "repeat usage, subscriber conversion, licensing terms, or platform placement",
    watchFr: "l'usage répété, la conversion en abonnés, les licences ou la mise en avant par les plateformes"
  }
};

function sentence(article: RankedArticle): string {
  return article.summary?.replace(/\s+/g, " ").trim() || article.title;
}

function sourceUrls(articles: RankedArticle[]): string[] {
  return Array.from(new Set(articles.map((article) => article.url))).slice(0, 4);
}

function buildMiniCaseQuestions(
  language: Language,
  conceptTested: string,
  watchSignalText: string
): MiniCaseChallenge["questions"] {
  return [
    {
      id: "q1",
      role: "method_framework",
      question: languageLine(
        language,
        `Which framework should you use first to test ${conceptTested}?`,
        `Quel cadre utiliser d'abord pour tester ${conceptTested} ?`
      ),
      options: [
        correctOption(language, "A", languageLine(language, "Separate the sourced fact, decision owner, and next signal.", "Séparer le fait source, le responsable de la décision et le prochain signal.")),
        wrongOption(language, "B", languageLine(language, "Turn the update into an immediate recommendation.", "Transformer l'actualité en recommandation immédiate.")),
        wrongOption(language, "C", languageLine(language, "Pick the loudest interpretation of the headline.", "Choisir l'interprétation la plus bruyante du titre.")),
        wrongOption(language, "D", languageLine(language, "Wait for the story to disappear before acting.", "Attendre que le sujet disparaisse avant d'agir."))
      ]
    },
    {
      id: "q2",
      role: "technical_application",
      question: languageLine(language, "Which signal best tests the practical impact?", "Quel signal teste le mieux l'impact pratique ?"),
      options: [
        correctOption(language, "A", watchSignalText),
        wrongOption(language, "B", languageLine(language, "A louder headline with the same facts.", "Un titre plus bruyant avec les mêmes faits.")),
        wrongOption(language, "C", languageLine(language, "The number of times the story is shared.", "Le nombre de partages de l'actualité.")),
        wrongOption(language, "D", languageLine(language, "A competitor's unrelated announcement.", "L'annonce sans rapport d'un concurrent."))
      ]
    },
    {
      id: "q3",
      role: "conclusion_decision",
      question: languageLine(language, "What is the strongest conclusion?", "Quelle est la conclusion la plus solide ?"),
      options: [
        correctOption(language, "A", languageLine(language, "Wait for the named signal before escalating the decision.", "Attendre le signal nommé avant d'escalader la décision.")),
        wrongOption(language, "B", languageLine(language, "Assume the source proves every downstream consequence.", "Supposer que la source prouve toutes les conséquences.")),
        wrongOption(language, "C", languageLine(language, "Reverse the whole plan on one data point.", "Inverser tout le plan sur un seul élément.")),
        wrongOption(language, "D", languageLine(language, "Ignore the update because it is uncomfortable.", "Ignorer l'actualité parce qu'elle dérange."))
      ]
    }
  ];
}

function correctOption(language: Language, id: string, text: string): MiniCaseChallenge["questions"][number]["options"][number] {
  return {
    id,
    text,
    is_correct: true,
    feedback: languageLine(
      language,
      "Correct: this keeps the decision tied to evidence.",
      "Correct : cela garde la décision reliée aux preuves."
    )
  };
}

function wrongOption(language: Language, id: string, text: string): MiniCaseChallenge["questions"][number]["options"][number] {
  return {
    id,
    text,
    is_correct: false,
    feedback: languageLine(
      language,
      "Not quite: this skips the evidence discipline the case is testing.",
      "Pas tout à fait : cela ignore la discipline de preuve que le cas teste."
    )
  };
}

function pickRotating<T extends string>(values: readonly T[], offset: number, banned: readonly T[] = []): T {
  const allowed = values.filter((value) => !banned.includes(value));
  const source = allowed.length > 0 ? allowed : values;
  return source[offset % source.length];
}

function pickPreferred(values: readonly string[] | undefined, fallback: string): string {
  return values?.find((value) => value.trim().length > 0) ?? fallback;
}

function topicLabel(topic: TopicId, language: Language = "en"): string {
  return TOPIC_LABELS[topic][language];
}

function topicEdge(topic: TopicId, language: Language): string {
  const edge = TOPIC_EDGES[topic];
  return language === "fr" ? edge.fr : edge.en;
}

function watchSignal(topic: TopicId, language: Language): string {
  const edge = TOPIC_EDGES[topic];
  return language === "fr" ? edge.watchFr : edge.watchEn;
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function sourceLine(article: RankedArticle): string {
  const publishedDate = article.published_at?.slice(0, 10) ?? "unknown";
  const retrievedDate = article.retrieved_at.slice(0, 10);
  return `Source: [${article.publisher}](${article.url}), published ${publishedDate}, retrieved ${retrievedDate}.`;
}

function languageLine(language: Language, english: string, french: string): string {
  return language === "fr" ? french : english;
}

function newsletterBody(request: GenerationRequest, article: RankedArticle, topic: TopicId, summary: string, why: string, index: number): string {
  const label = topicLabel(topic, request.language);
  const watch = watchSignal(topic, request.language);
  const source = sourceLine(article);
  const publishedDate = article.published_at?.slice(0, 10) ?? request.dropDate;
  const pattern = index % 3;

  if (pattern === 1) {
    return [
      languageLine(
        request.language,
        `${article.publisher} puts a concrete ${label} development on the table: ${summary}`,
        `${article.publisher} met sur la table un développement concret en ${label} : ${summary}`
      ),
      languageLine(
        request.language,
        `The mechanism to keep is specific: ${topicEdge(topic, request.language)}. That is the part a student can reuse in a class discussion, market note, or interview answer.`,
        `Le mécanisme à garder est précis : ${topicEdge(topic, request.language)}. C'est la partie réutilisable en cours, dans une note de marché ou en entretien.`
      ),
      why,
      languageLine(
        request.language,
        `Next signal: ${watch}. Those signals will say more than another round of commentary on the ${publishedDate} update.`,
        `Prochain signal : ${watch}. Ces signaux diront plus qu'un nouveau commentaire sur l'actualité du ${publishedDate}.`
      ),
      source
    ].join("\n\n");
  }

  if (pattern === 2) {
    return [
      languageLine(
        request.language,
        `Treat this as a live ${label} case. The fact pattern is simple: ${summary}`,
        `Traite ce sujet comme un cas vivant de ${label}. Le fait de départ est simple : ${summary}`
      ),
      languageLine(
        request.language,
        `The practical read is not abstract. ${sentenceCase(topicEdge(topic, request.language))}.`,
        `La lecture pratique n'est pas abstraite. ${sentenceCase(topicEdge(topic, request.language))}.`
      ),
      languageLine(
        request.language,
        `For a five-minute briefing, separate the sourced fact from the judgment: the fact is the ${publishedDate} development; the judgment is whether it changes behavior, budgets, or timelines.`,
        `Pour un briefing de cinq minutes, sépare le fait source du jugement : le fait est le développement du ${publishedDate}; le jugement porte sur son effet sur les comportements, les budgets ou les calendriers.`
      ),
      `${why} ${languageLine(request.language, `Watch ${watch}.`, `Surveille ${watch}.`)}`,
      source
    ].join("\n\n");
  }

  return [
    summary,
    languageLine(
      request.language,
      `Read it through the ${label} lens: ${topicEdge(topic, request.language)}. That turns the item from a news update into a decision map.`,
      `Lis-le avec le prisme ${label} : ${topicEdge(topic, request.language)}. Le sujet devient alors une carte de décision, pas seulement une actualité.`
    ),
    why,
    languageLine(
      request.language,
      `Watch ${watch}. If those signals do not move after ${publishedDate}, the practical impact is still unproven.`,
      `Surveille ${watch}. Si ces signaux ne bougent pas après le ${publishedDate}, l'impact pratique reste à prouver.`
    ),
    source
  ].join("\n\n");
}

export class StructuredContentGenerator implements ContentGenerator {
  async generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload> {
    const newsletter = this.generateNewsletter(request);
    const businessStory = this.generateBusinessStory(request);
    const miniCases = this.generateMiniCases(request);
    const concept = this.generateConcept(request);

    return {
      drop_date: request.dropDate,
      language: request.language,
      prompt_version: PROMPT_VERSION,
      generator_version: GENERATOR_VERSION,
      items: [...newsletter, businessStory, ...miniCases, concept]
    };
  }

  // Generates the complete newsletter catalog: one article per editorial topic,
  // independent of any user. A topic without a matching source falls back to any
  // same-language article so every editorial topic is still covered.
  private generateNewsletter(request: GenerationRequest): NewsletterArticle[] {
    const sameLanguage = request.articles.filter((article) => article.language === request.language);
    if (sameLanguage.length === 0) {
      return [];
    }

    const topics = request.newsletterTopics;
    const articles: NewsletterArticle[] = [];

    for (let index = 0; index < request.newsletterArticleCount; index += 1) {
      const topic = topics[index % topics.length];
      const source =
        sameLanguage.find((article) => article.topic === topic) ?? sameLanguage[index % sameLanguage.length];
      const summary = sentence(source);
      const label = topicLabel(topic, request.language);
      const why = languageLine(
        request.language,
        `${label}: ${topicEdge(topic, request.language)}.`,
        `${label} : ${topicEdge(topic, request.language)}.`
      );

      articles.push({
        content_type: "newsletter_article",
        slot: "newsletter",
        topic,
        language: request.language,
        title: source.title,
        published_date: source.published_at?.slice(0, 10) ?? request.dropDate,
        summary,
        body_md: newsletterBody(request, source, topic, summary, why, index),
        why_it_matters: why,
        source_urls: [source.url],
        version: 1
      });
    }

    return articles;
  }

  private generateBusinessStory(request: GenerationRequest): BusinessStory {
    const article = this.pickBusinessStoryArticle(request);
    const setup = sentence(article);
    const label = topicLabel(article.topic, request.language);
    const watch = watchSignal(article.topic, request.language);
    const keyMechanism = pickPreferred(
      request.businessStoryMemory?.underusedMechanisms,
      topicEdge(article.topic, request.language)
    );
    const industry = pickPreferred(
      request.businessStoryMemory?.underusedIndustries,
      article.topic === "tech_ai" ? "software" : article.topic === "finance" ? "finance" : "consumer"
    );

    const story: BusinessStory = {
      content_type: "business_story",
      slot: "business_story",
      topic: article.topic,
      language: request.language,
      title: languageLine(request.language, `The business lesson inside ${article.title}`, `La leçon business derrière ${article.title}`),
      company_or_market: article.publisher,
      story_date: article.published_at?.slice(0, 10) ?? request.dropDate,
      setup,
      tension: languageLine(
        request.language,
        `The pressure sits in ${label}: ${topicEdge(article.topic, request.language)}.`,
        `La pression se situe dans ${label} : ${topicEdge(article.topic, request.language)}.`
      ),
      decision: languageLine(
        request.language,
        `A strong operator would turn ${article.publisher}'s update into one constraint, one owner, and one metric to test next.`,
        `Un bon opérateur transformerait l'actualité de ${article.publisher} en une contrainte, un responsable et une métrique à tester.`
      ),
      outcome: languageLine(
        request.language,
        `The next measurable outcome is ${watch}.`,
        `Le résultat mesurable à suivre : ${watch}.`
      ),
      lesson: languageLine(
        request.language,
        "The lesson is to find the constraint before judging the strategy.",
        "La leçon consiste à trouver la contrainte avant de juger la stratégie."
      ),
      body_md: [
        setup,
        languageLine(
          request.language,
          `The business mechanism is concrete: ${topicEdge(article.topic, request.language)}.`,
          `Le mécanisme business est concret : ${topicEdge(article.topic, request.language)}.`
        ),
        languageLine(
          request.language,
          `The operator's job is to name the constraint, assign an owner, and choose a move that can be tested against ${watch}.`,
          `Le rôle de l'opérateur est de nommer la contrainte, désigner un responsable et choisir une action testable avec ${watch}.`
        ),
        languageLine(
          request.language,
          `For students, the useful move is to translate the ${article.published_at?.slice(0, 10) ?? request.dropDate} update into a decision: what would you do Monday morning, and which metric would prove you were wrong?`,
          `Pour un étudiant, le bon réflexe est de traduire l'actualité du ${article.published_at?.slice(0, 10) ?? request.dropDate} en décision : que ferais-tu lundi matin, et quelle métrique prouverait que tu avais tort ?`
        ),
        sourceLine(article)
      ].join("\n\n"),
      source_urls: [article.url],
      editorial_memory: {
        entity_name: article.publisher,
        entity_type: "company",
        main_company: article.publisher,
        companies_mentioned: [article.publisher],
        industry,
        key_mechanism: keyMechanism,
        secondary_mechanisms: request.businessStoryMemory?.underusedMechanisms
          .filter((mechanism) => mechanism !== keyMechanism)
          .slice(0, 3) ?? [],
        strategic_angle: languageLine(
          request.language,
          `${keyMechanism}: turn one constraint into one owner and one metric.`,
          `${keyMechanism} : transformer une contrainte en un responsable et une métrique.`
        ),
        core_takeaway: languageLine(
          request.language,
          "Find the constraint before judging the strategy.",
          "Trouver la contrainte avant de juger la stratégie."
        ),
        year_period: article.published_at?.slice(0, 4) ?? request.dropDate.slice(0, 4)
      },
      version: 1
    };

    return story;
  }

  private pickBusinessStoryArticle(request: GenerationRequest): RankedArticle {
    const banned = new Set([
      ...(request.businessStoryMemory?.bannedEntities ?? []),
      ...(request.businessStoryMemory?.bannedCompanies ?? [])
    ].map(normalizeMemoryKey));
    const candidates = request.articles
      .filter((article) => article.language === request.language)
      .filter((article) => ["business", "finance", "tech_ai"].includes(article.topic))
      .filter((article) => !banned.has(normalizeMemoryKey(article.publisher)));

    return candidates[0] ?? this.pickArticle(request, ["business", "finance", "tech_ai"]);
  }

  private generateMiniCases(request: GenerationRequest): MiniCaseChallenge[] {
    const productTopics = request.miniCaseProductTopics?.length
      ? request.miniCaseProductTopics
      : [MINI_CASE_TOPIC_IDS[0]];

    return productTopics.map((productTopic, index) => {
      const contentTopics = miniCaseTopicToContentTopics(productTopic);
      const article = this.pickArticle(request, contentTopics);
      return this.generateMiniCase(request, productTopic, article, index);
    });
  }

  private generateMiniCase(
    request: GenerationRequest,
    productTopic: (typeof MINI_CASE_TOPIC_IDS)[number],
    article: RankedArticle,
    index: number
  ): MiniCaseChallenge {
    const label = topicLabel(article.topic, request.language);
    const watch = watchSignal(article.topic, request.language);
    const scenarioType = pickRotating(MINI_CASE_SCENARIO_TYPES, index, request.miniCaseMemory?.bannedScenarioTypes);
    const decisionType = pickRotating(MINI_CASE_DECISION_TYPES, index, request.miniCaseMemory?.bannedDecisionTypes);
    const conceptTested = pickRotating(MINI_CASE_CONCEPTS, index, request.miniCaseMemory?.bannedConcepts);
    const questionPattern = pickRotating(MINI_CASE_QUESTION_PATTERNS, index, request.miniCaseMemory?.bannedQuestionPatterns);
    const correctAnswerPattern = pickRotating(MINI_CASE_CORRECT_ANSWER_PATTERNS, index);

    return {
      content_type: "mini_case",
      slot: "mini_case",
      topic: article.topic,
      product_topic: productTopic,
      scenario_type: scenarioType,
      decision_type: decisionType,
      concept_tested: conceptTested,
      mechanism: languageLine(request.language, `The active mechanism is ${conceptTested} under a ${scenarioType} constraint.`, `Le mécanisme actif est ${conceptTested} sous une contrainte de type ${scenarioType}.`),
      question_pattern: questionPattern,
      correct_answer_pattern: correctAnswerPattern,
      core_takeaway: languageLine(request.language, `Use ${conceptTested} to choose the next evidence-backed step, not to overreact to one source.`, `Utilise ${conceptTested} pour choisir la prochaine étape fondée sur les preuves, pas pour surréagir à une seule source.`),
      language: request.language,
      title: languageLine(request.language, `Mini-case: brief the ${label} move`, `Mini-cas : briefer le mouvement ${label}`),
      difficulty: "medium",
      context: sentence(article),
      challenge: languageLine(
        request.language,
        `You are preparing a five-minute brief for someone deciding whether the ${article.publisher} development deserves action this week.`,
        `Tu prépares un brief de cinq minutes pour quelqu'un qui doit décider si le sujet signalé par ${article.publisher} mérite une action cette semaine.`
      ),
      constraints: languageLine(request.language, `Use only sourced facts; name the decision owner; watch ${watch}.`, `Utilise seulement des faits sourcés ; nomme le responsable de la décision ; surveille ${watch}.`)
        .split("; ")
        .map((item) => item.trim()),
      question: languageLine(
        request.language,
        "Would you recommend acting now, waiting for one signal, or narrowing the scope of the decision?",
        "Recommanderais-tu d'agir maintenant, d'attendre un signal, ou de réduire le périmètre de la décision ?"
      ),
      questions: buildMiniCaseQuestions(request.language, conceptTested, watch),
      expected_reasoning: [
        languageLine(request.language, `State the sourced fact from ${article.published_at?.slice(0, 10) ?? request.dropDate}.`, `Énonce le fait source du ${article.published_at?.slice(0, 10) ?? request.dropDate}.`),
        languageLine(request.language, "Identify who has less room to maneuver after the update.", "Identifie qui a moins de marge de manœuvre après l'actualité."),
        languageLine(request.language, `Name the signal that would confirm or weaken the recommendation: ${watch}.`, `Nomme le signal qui confirmerait ou affaiblirait la recommandation : ${watch}.`)
      ],
      sample_answer: languageLine(
        request.language,
        `I would wait for one confirming signal before committing resources. The sourced fact is ${sentence(article)} The judgment is whether that changes behavior; I would test it through ${watch}.`,
        `J'attendrais un signal de confirmation avant d'engager des ressources. Le fait source est le suivant : ${sentence(article)} Le jugement porte sur le changement de comportement ; je le testerais avec ${watch}.`
      ),
      conclusion: languageLine(
        request.language,
        `Final takeaway: separate the sourced fact from the recommendation, then use ${watch} to update the decision.`,
        `À retenir : sépare le fait source de la recommandation, puis utilise ${watch} pour mettre à jour la décision.`
      ),
      final_takeaway: languageLine(
        request.language,
        `Separate the sourced fact from your recommendation, then let ${watch} decide the next move.`,
        `Sépare le fait source de ta recommandation, puis laisse ${watch} décider du prochain mouvement.`
      ),
      score_max: 3,
      body_md: [
        sentence(article),
        languageLine(
          request.language,
          `Your task is to brief a decision-maker in five minutes. Keep the sourced fact separate from your judgment, then recommend acting now, waiting, or narrowing the decision.`,
          `Ta mission est de briefer un décideur en cinq minutes. Garde le fait source séparé de ton jugement, puis recommande d'agir, d'attendre ou de réduire la décision.`
        ),
        languageLine(
          request.language,
          `A strong answer names who owns the decision, who has less room to maneuver, and which signal to watch next: ${watch}.`,
          `Une bonne réponse nomme le responsable de la décision, l'acteur qui a moins de marge, et le signal à suivre : ${watch}.`
        ),
        sourceLine(article)
      ].join("\n\n"),
      source_urls: [article.url],
      version: 1
    };
  }

  private generateConcept(request: GenerationRequest): KeyConcept {
    const topTopic = request.newsletterTopics[0] ?? "business";
    const concept = CONCEPTS[topTopic];
    const article = this.pickArticle(request, [topTopic]);
    const label = topicLabel(topTopic, request.language);
    const watch = watchSignal(topTopic, request.language);

    return {
      content_type: "concept",
      slot: "concept",
      topic: topTopic,
      language: request.language,
      title: concept.title[request.language],
      category: topTopic,
      definition: concept.definition[request.language],
      plain_english: languageLine(
        request.language,
        `Use it to ask what constraint the ${label} story exposes and who has fewer alternatives after the update.`,
        `Utilise-le pour demander quelle contrainte le sujet ${label} révèle et qui a moins d'options après l'actualité.`
      ),
      example: sentence(article),
      why_it_matters: languageLine(
        request.language,
        `It gives you a reusable lens for the ${article.published_at?.slice(0, 10) ?? request.dropDate} source instead of leaving the item as a one-off update.`,
        `Il donne un prisme réutilisable pour la source du ${article.published_at?.slice(0, 10) ?? request.dropDate}, au lieu de laisser le sujet comme une actualité isolée.`
      ),
      how_to_use_it: languageLine(
        request.language,
        `In class or an interview, pair the concept with one signal to watch: ${watch}.`,
        `En cours ou en entretien, associe le concept à un signal à suivre : ${watch}.`
      ),
      common_mistake: concept.mistake[request.language],
      body_md: [
        concept.definition[request.language],
        languageLine(
          request.language,
          `Plain English: use the concept to ask what constraint the ${label} story exposes and who has fewer alternatives after the update.`,
          `En clair : utilise le concept pour demander quelle contrainte le sujet ${label} révèle et qui a moins d'options après l'actualité.`
        ),
        languageLine(
          request.language,
          `Example from today's source: ${sentence(article)}`,
          `Exemple tiré de la source du jour : ${sentence(article)}`
        ),
        languageLine(
          request.language,
          `Use it in class, interviews, or internships by pairing the concept with one observable signal: ${watch}. The common mistake is ${concept.mistake.en.toLowerCase()}`,
          `Utilise-le en cours, en entretien ou en stage en l'associant à un signal observable : ${watch}. L'erreur fréquente consiste à ${concept.mistake.fr.toLowerCase()}`
        ),
        sourceLine(article)
      ].join("\n\n"),
      source_urls: sourceUrls([article]),
      version: 1
    };
  }

  private pickArticle(request: GenerationRequest, topics: TopicId[]): RankedArticle {
    const article =
      request.articles.find((candidate) => candidate.language === request.language && topics.includes(candidate.topic)) ??
      request.articles.find((candidate) => candidate.language === request.language);

    if (!article) {
      throw new Error(`No article candidates available for ${request.language}`);
    }

    return article;
  }
}
