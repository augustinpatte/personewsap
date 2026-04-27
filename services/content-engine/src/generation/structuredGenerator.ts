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
import { GENERATOR_VERSION, PROMPT_VERSION } from "./prompts.js";
import type { ContentGenerator, GenerationRequest } from "./types.js";

const CONCEPTS: Record<TopicId, { title: Record<Language, string>; definition: Record<Language, string>; mistake: Record<Language, string> }> = {
  business: {
    title: { en: "Pricing power", fr: "Pouvoir de prix" },
    definition: {
      en: "The ability to raise prices without losing enough customers to damage the business.",
      fr: "La capacite a augmenter les prix sans perdre assez de clients pour abimer l'activite."
    },
    mistake: { en: "Confusing popularity with pricing power.", fr: "Confondre popularite et capacite a faire payer." }
  },
  finance: {
    title: { en: "Duration risk", fr: "Risque de duration" },
    definition: {
      en: "The sensitivity of an asset's value to changes in interest rates.",
      fr: "La sensibilite de la valeur d'un actif aux variations de taux d'interet."
    },
    mistake: { en: "Thinking all bonds react the same way when rates move.", fr: "Croire que toutes les obligations reagissent pareil quand les taux bougent." }
  },
  tech_ai: {
    title: { en: "Switching costs", fr: "Couts de changement" },
    definition: {
      en: "The time, money, data, and habit a customer loses when changing products.",
      fr: "Le temps, l'argent, les donnees et les habitudes qu'un client perd en changeant de produit."
    },
    mistake: { en: "Assuming the best product always wins.", fr: "Supposer que le meilleur produit gagne toujours." }
  },
  law: {
    title: { en: "Regulatory moat", fr: "Barriere reglementaire" },
    definition: {
      en: "An advantage created when rules make it harder for competitors to enter or operate.",
      fr: "Un avantage cree quand les regles rendent l'entree ou l'exploitation plus difficile pour les concurrents."
    },
    mistake: { en: "Treating regulation only as a cost.", fr: "Voir la regulation seulement comme un cout." }
  },
  medicine: {
    title: { en: "Clinical endpoints", fr: "Criteres cliniques" },
    definition: {
      en: "The outcomes a study measures to judge whether a treatment works.",
      fr: "Les resultats qu'une etude mesure pour juger si un traitement fonctionne."
    },
    mistake: { en: "Reading a positive trial result without checking what was actually measured.", fr: "Lire un resultat positif sans verifier ce qui a ete mesure." }
  },
  engineering: {
    title: { en: "Operational redundancy", fr: "Redondance operationnelle" },
    definition: {
      en: "Extra capacity or backup paths that keep a system working when one part fails.",
      fr: "Une capacite ou des chemins de secours qui gardent un systeme actif quand une partie tombe."
    },
    mistake: { en: "Seeing redundancy as waste instead of resilience.", fr: "Voir la redondance comme du gaspillage au lieu d'une resilience." }
  },
  sport_business: {
    title: { en: "Media rights flywheel", fr: "Volant des droits medias" },
    definition: {
      en: "The cycle where audience demand raises rights fees, which funds better talent and production.",
      fr: "Le cycle ou la demande du public augmente les droits, puis finance de meilleurs talents et une meilleure production."
    },
    mistake: { en: "Judging a league only by ticket sales.", fr: "Juger une ligue seulement par la billetterie." }
  },
  culture_media: {
    title: { en: "Attention bundling", fr: "Regroupement de l'attention" },
    definition: {
      en: "Packaging content so audiences return regularly instead of consuming one isolated item.",
      fr: "Assembler du contenu pour faire revenir le public regulierement plutot que consommer un seul element isole."
    },
    mistake: { en: "Mistaking reach for loyalty.", fr: "Confondre portee et fidelite." }
  }
};

const TOPIC_LABELS: Record<TopicId, { en: string; fr: string }> = {
  business: { en: "Business", fr: "Business" },
  finance: { en: "Finance", fr: "Finance" },
  tech_ai: { en: "Tech/AI", fr: "Tech/IA" },
  law: { en: "Law", fr: "Droit" },
  medicine: { en: "Medicine", fr: "Medecine" },
  engineering: { en: "Engineering", fr: "Ingenierie" },
  sport_business: { en: "Sports Business", fr: "Sport business" },
  culture_media: { en: "Culture/Media", fr: "Culture/medias" }
};

const TOPIC_EDGES: Record<TopicId, { en: string; fr: string; watchEn: string; watchFr: string }> = {
  business: {
    en: "pricing, retention, and distribution decide whether the move survives contact with customers",
    fr: "le prix, la retention et la distribution montrent si la decision tient face aux clients",
    watchEn: "renewals, discounting, customer churn, or a change in sales cycle length",
    watchFr: "les renouvellements, les remises, le depart de clients ou la duree du cycle de vente"
  },
  finance: {
    en: "small rate or risk changes can reprice decisions that looked stable last week",
    fr: "un faible changement de taux ou de risque peut revaloriser une decision qui semblait stable",
    watchEn: "funding costs, default signals, deposit flows, or guidance on credit demand",
    watchFr: "les couts de financement, les signaux de defaut, les flux de depots ou la demande de credit"
  },
  tech_ai: {
    en: "the constraint is often compute, data access, distribution, or trust rather than the demo itself",
    fr: "la contrainte se situe souvent dans le calcul, les donnees, la distribution ou la confiance plus que dans la demo",
    watchEn: "capacity commitments, customer migrations, model access rules, or security reviews",
    watchFr: "les engagements de capacite, les migrations clients, les regles d'acces aux modeles ou les revues de securite"
  },
  law: {
    en: "rules change product defaults, compliance costs, and who can move fastest",
    fr: "les regles changent les choix par defaut, les couts de conformite et la vitesse d'execution",
    watchEn: "implementation deadlines, enforcement language, appeals, or revised product defaults",
    watchFr: "les delais d'application, le vocabulaire de sanction, les recours ou les choix produit modifies"
  },
  medicine: {
    en: "the real test is what was measured, for whom, and whether the effect changes care",
    fr: "le vrai test porte sur ce qui a ete mesure, pour quels patients, et si l'effet change les soins",
    watchEn: "endpoint detail, safety data, trial size, regulatory review, or clinician uptake",
    watchFr: "le detail des criteres, les donnees de securite, la taille de l'essai, l'examen regulatoire ou l'adoption clinique"
  },
  engineering: {
    en: "constraints in reliability, cost, and failure modes decide whether the design scales",
    fr: "la fiabilite, les couts et les modes de panne disent si la conception peut passer a l'echelle",
    watchEn: "incident rates, redundancy plans, maintenance cost, or deployment timelines",
    watchFr: "les taux d'incident, les plans de redondance, les couts de maintenance ou les calendriers de deploiement"
  },
  sport_business: {
    en: "audience demand becomes strategy only when rights, sponsorship, and fan behavior reinforce each other",
    fr: "la demande du public devient strategique quand droits, sponsoring et comportement des fans se renforcent",
    watchEn: "rights fees, attendance, subscriber trends, sponsorship renewals, or schedule changes",
    watchFr: "les droits medias, l'affluence, les abonnes, les renouvellements de sponsoring ou le calendrier"
  },
  culture_media: {
    en: "attention only compounds when the format, distribution, and audience habit all line up",
    fr: "l'attention ne s'accumule que si le format, la distribution et l'habitude du public s'alignent",
    watchEn: "repeat usage, subscriber conversion, licensing terms, or platform placement",
    watchFr: "l'usage repete, la conversion en abonnes, les licences ou la mise en avant par les plateformes"
  }
};

function sentence(article: RankedArticle): string {
  return article.summary?.replace(/\s+/g, " ").trim() || article.title;
}

function sourceUrls(articles: RankedArticle[]): string[] {
  return Array.from(new Set(articles.map((article) => article.url))).slice(0, 4);
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

function newsletterBody(request: GenerationRequest, article: RankedArticle, summary: string, why: string, index: number): string {
  const label = topicLabel(article.topic, request.language);
  const watch = watchSignal(article.topic, request.language);
  const source = sourceLine(article);
  const publishedDate = article.published_at?.slice(0, 10) ?? request.dropDate;
  const pattern = index % 3;

  if (pattern === 1) {
    return [
      languageLine(
        request.language,
        `${article.publisher} puts a concrete ${label} development on the table: ${summary}`,
        `${article.publisher} met sur la table un developpement concret en ${label} : ${summary}`
      ),
      languageLine(
        request.language,
        `The mechanism to keep is specific: ${topicEdge(article.topic, request.language)}. That is the part a student can reuse in a class discussion, market note, or interview answer.`,
        `Le mecanisme a garder est precis : ${topicEdge(article.topic, request.language)}. C'est la partie reutilisable en cours, dans une note de marche ou en entretien.`
      ),
      why,
      languageLine(
        request.language,
        `Next signal: ${watch}. Those signals will say more than another round of commentary on the ${publishedDate} update.`,
        `Prochain signal : ${watch}. Ces signaux diront plus qu'un nouveau commentaire sur l'actualite du ${publishedDate}.`
      ),
      source
    ].join("\n\n");
  }

  if (pattern === 2) {
    return [
      languageLine(
        request.language,
        `Treat this as a live ${label} case. The fact pattern is simple: ${summary}`,
        `Traite ce sujet comme un cas vivant de ${label}. Le fait de depart est simple : ${summary}`
      ),
      languageLine(
        request.language,
        `The practical read is not abstract. ${sentenceCase(topicEdge(article.topic, request.language))}.`,
        `La lecture pratique n'est pas abstraite. ${sentenceCase(topicEdge(article.topic, request.language))}.`
      ),
      languageLine(
        request.language,
        `For a five-minute briefing, separate the sourced fact from the judgment: the fact is the ${publishedDate} development; the judgment is whether it changes behavior, budgets, or timelines.`,
        `Pour un briefing de cinq minutes, separe le fait source du jugement : le fait est le developpement du ${publishedDate}; le jugement porte sur son effet sur les comportements, les budgets ou les calendriers.`
      ),
      `${why} ${languageLine(request.language, `Watch ${watch}.`, `Surveille ${watch}.`)}`,
      source
    ].join("\n\n");
  }

  return [
    summary,
    languageLine(
      request.language,
      `Read it through the ${label} lens: ${topicEdge(article.topic, request.language)}. That turns the item from a news update into a decision map.`,
      `Lis-le avec le prisme ${label} : ${topicEdge(article.topic, request.language)}. Le sujet devient alors une carte de decision, pas seulement une actualite.`
    ),
    why,
    languageLine(
      request.language,
      `Watch ${watch}. If those signals do not move after ${publishedDate}, the practical impact is still unproven.`,
      `Surveille ${watch}. Si ces signaux ne bougent pas apres le ${publishedDate}, l'impact pratique reste a prouver.`
    ),
    source
  ].join("\n\n");
}

export class StructuredContentGenerator implements ContentGenerator {
  async generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload> {
    const newsletter = this.generateNewsletter(request);
    const businessStory = this.generateBusinessStory(request);
    const miniCase = this.generateMiniCase(request);
    const concept = this.generateConcept(request);

    return {
      drop_date: request.dropDate,
      language: request.language,
      prompt_version: PROMPT_VERSION,
      generator_version: GENERATOR_VERSION,
      items: [...newsletter, businessStory, miniCase, concept]
    };
  }

  private generateNewsletter(request: GenerationRequest): NewsletterArticle[] {
    const selected: RankedArticle[] = [];

    for (const topic of request.newsletterTopics) {
      const match = request.articles.find(
        (article) => article.language === request.language && article.topic === topic && !selected.includes(article)
      );
      if (match) {
        selected.push(match);
      }
    }

    for (const article of request.articles) {
      if (selected.length >= request.newsletterArticleCount) {
        break;
      }
      if (article.language === request.language && !selected.includes(article)) {
        selected.push(article);
      }
    }

    return selected.slice(0, request.newsletterArticleCount).map((article, index): NewsletterArticle => {
      const summary = sentence(article);
      const label = topicLabel(article.topic, request.language);
      const why = languageLine(
        request.language,
        `${label}: ${topicEdge(article.topic, request.language)}.`,
        `${label} : ${topicEdge(article.topic, request.language)}.`
      );

      return {
        content_type: "newsletter_article",
        slot: "newsletter",
        topic: article.topic,
        language: request.language,
        title: article.title,
        published_date: article.published_at?.slice(0, 10) ?? request.dropDate,
        summary,
        body_md: newsletterBody(request, article, summary, why, index),
        why_it_matters: why,
        source_urls: [article.url],
        version: 1
      };
    });
  }

  private generateBusinessStory(request: GenerationRequest): BusinessStory {
    const article = this.pickArticle(request, ["business", "finance", "tech_ai"]);
    const setup = sentence(article);
    const label = topicLabel(article.topic, request.language);
    const watch = watchSignal(article.topic, request.language);

    return {
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
        `Un bon operateur transformerait l'actualite de ${article.publisher} en une contrainte, un responsable et une metrique a tester.`
      ),
      outcome: languageLine(
        request.language,
        `The next measurable outcome is ${watch}.`,
        `Le resultat mesurable a suivre : ${watch}.`
      ),
      lesson: languageLine(
        request.language,
        "The lesson is to find the constraint before judging the strategy.",
        "La lecon consiste a trouver la contrainte avant de juger la strategie."
      ),
      body_md: [
        setup,
        languageLine(
          request.language,
          `The business mechanism is concrete: ${topicEdge(article.topic, request.language)}.`,
          `Le mecanisme business est concret : ${topicEdge(article.topic, request.language)}.`
        ),
        languageLine(
          request.language,
          `The operator's job is to name the constraint, assign an owner, and choose a move that can be tested against ${watch}.`,
          `Le role de l'operateur est de nommer la contrainte, designer un responsable et choisir une action testable avec ${watch}.`
        ),
        languageLine(
          request.language,
          `For students, the useful move is to translate the ${article.published_at?.slice(0, 10) ?? request.dropDate} update into a decision: what would you do Monday morning, and which metric would prove you were wrong?`,
          `Pour un etudiant, le bon reflexe est de traduire l'actualite du ${article.published_at?.slice(0, 10) ?? request.dropDate} en decision : que ferais-tu lundi matin, et quelle metrique prouverait que tu avais tort ?`
        ),
        sourceLine(article)
      ].join("\n\n"),
      source_urls: [article.url],
      version: 1
    };
  }

  private generateMiniCase(request: GenerationRequest): MiniCaseChallenge {
    const article = this.pickArticle(request, request.newsletterTopics);
    const label = topicLabel(article.topic, request.language);
    const watch = watchSignal(article.topic, request.language);

    return {
      content_type: "mini_case",
      slot: "mini_case",
      topic: article.topic,
      language: request.language,
      title: languageLine(request.language, `Mini-case: brief the ${label} move`, `Mini-cas : briefer le mouvement ${label}`),
      difficulty: "medium",
      context: sentence(article),
      challenge: languageLine(
        request.language,
        `You are preparing a five-minute brief for someone deciding whether the ${article.publisher} development deserves action this week.`,
        `Tu prepares un brief de cinq minutes pour quelqu'un qui doit decider si le sujet signale par ${article.publisher} merite une action cette semaine.`
      ),
      constraints: languageLine(request.language, `Use only sourced facts; name the decision owner; watch ${watch}.`, `Utilise seulement des faits sources ; nomme le responsable de la decision ; surveille ${watch}.`)
        .split("; ")
        .map((item) => item.trim()),
      question: languageLine(
        request.language,
        "Would you recommend acting now, waiting for one signal, or narrowing the scope of the decision?",
        "Recommanderais-tu d'agir maintenant, d'attendre un signal, ou de reduire le perimetre de la decision ?"
      ),
      expected_reasoning: [
        languageLine(request.language, `State the sourced fact from ${article.published_at?.slice(0, 10) ?? request.dropDate}.`, `Enonce le fait source du ${article.published_at?.slice(0, 10) ?? request.dropDate}.`),
        languageLine(request.language, "Identify who has less room to maneuver after the update.", "Identifie qui a moins de marge de manoeuvre apres l'actualite."),
        languageLine(request.language, `Name the signal that would confirm or weaken the recommendation: ${watch}.`, `Nomme le signal qui confirmerait ou affaiblirait la recommandation : ${watch}.`)
      ],
      sample_answer: languageLine(
        request.language,
        `I would wait for one confirming signal before committing resources. The sourced fact is ${sentence(article)} The judgment is whether that changes behavior; I would test it through ${watch}.`,
        `J'attendrais un signal de confirmation avant d'engager des ressources. Le fait source est le suivant : ${sentence(article)} Le jugement porte sur le changement de comportement; je le testerais avec ${watch}.`
      ),
      body_md: [
        sentence(article),
        languageLine(
          request.language,
          `Your task is to brief a decision-maker in five minutes. Keep the sourced fact separate from your judgment, then recommend acting now, waiting, or narrowing the decision.`,
          `Ta mission est de briefer un decideur en cinq minutes. Garde le fait source separe de ton jugement, puis recommande d'agir, d'attendre ou de reduire la decision.`
        ),
        languageLine(
          request.language,
          `A strong answer names who owns the decision, who has less room to maneuver, and which signal to watch next: ${watch}.`,
          `Une bonne reponse nomme le responsable de la decision, l'acteur qui a moins de marge, et le signal a suivre : ${watch}.`
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
        `Utilise-le pour demander quelle contrainte le sujet ${label} revele et qui a moins d'options apres l'actualite.`
      ),
      example: sentence(article),
      why_it_matters: languageLine(
        request.language,
        `It gives you a reusable lens for the ${article.published_at?.slice(0, 10) ?? request.dropDate} source instead of leaving the item as a one-off update.`,
        `Il donne un prisme reutilisable pour la source du ${article.published_at?.slice(0, 10) ?? request.dropDate}, au lieu de laisser le sujet comme une actualite isolee.`
      ),
      how_to_use_it: languageLine(
        request.language,
        `In class or an interview, pair the concept with one signal to watch: ${watch}.`,
        `En cours ou en entretien, associe le concept a un signal a suivre : ${watch}.`
      ),
      common_mistake: concept.mistake[request.language],
      body_md: [
        concept.definition[request.language],
        languageLine(
          request.language,
          `Plain English: use the concept to ask what constraint the ${label} story exposes and who has fewer alternatives after the update.`,
          `En clair : utilise le concept pour demander quelle contrainte le sujet ${label} revele et qui a moins d'options apres l'actualite.`
        ),
        languageLine(
          request.language,
          `Example from today's source: ${sentence(article)}`,
          `Exemple tiré de la source du jour : ${sentence(article)}`
        ),
        languageLine(
          request.language,
          `Use it in class, interviews, or internships by pairing the concept with one observable signal: ${watch}. The common mistake is ${concept.mistake.en.toLowerCase()}`,
          `Utilise-le en cours, en entretien ou en stage en l'associant a un signal observable : ${watch}. L'erreur frequente consiste a ${concept.mistake.fr.toLowerCase()}`
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
