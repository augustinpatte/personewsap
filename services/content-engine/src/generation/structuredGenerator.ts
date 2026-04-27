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

const CONCEPTS: Record<TopicId, { title: string; definition: string; mistake: string }> = {
  business: {
    title: "Pricing power",
    definition: "The ability to raise prices without losing enough customers to damage the business.",
    mistake: "Confusing popularity with pricing power."
  },
  finance: {
    title: "Duration risk",
    definition: "The sensitivity of an asset's value to changes in interest rates.",
    mistake: "Thinking all bonds react the same way when rates move."
  },
  tech_ai: {
    title: "Switching costs",
    definition: "The time, money, data, and habit a customer loses when changing products.",
    mistake: "Assuming the best product always wins."
  },
  law: {
    title: "Regulatory moat",
    definition: "An advantage created when rules make it harder for competitors to enter or operate.",
    mistake: "Treating regulation only as a cost."
  },
  medicine: {
    title: "Clinical endpoints",
    definition: "The outcomes a study measures to judge whether a treatment works.",
    mistake: "Reading a positive trial result without checking what was actually measured."
  },
  engineering: {
    title: "Operational redundancy",
    definition: "Extra capacity or backup paths that keep a system working when one part fails.",
    mistake: "Seeing redundancy as waste instead of resilience."
  },
  sport_business: {
    title: "Media rights flywheel",
    definition: "The cycle where audience demand raises rights fees, which funds better talent and production.",
    mistake: "Judging a league only by ticket sales."
  },
  culture_media: {
    title: "Attention bundling",
    definition: "Packaging content so audiences return regularly instead of consuming one isolated item.",
    mistake: "Mistaking reach for loyalty."
  }
};

function sentence(article: RankedArticle): string {
  return article.summary?.replace(/\s+/g, " ").trim() || article.title;
}

function sourceUrls(articles: RankedArticle[]): string[] {
  return Array.from(new Set(articles.map((article) => article.url))).slice(0, 4);
}

function topicLabel(topic: TopicId): string {
  return topic.replace("_", " ");
}

function languageLine(language: Language, english: string, french: string): string {
  return language === "fr" ? french : english;
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

    return selected.slice(0, request.newsletterArticleCount).map((article): NewsletterArticle => {
      const summary = sentence(article);
      const why = languageLine(
        request.language,
        `This matters because ${topicLabel(article.topic)} stories like this change incentives, budgets, or career-relevant context.`,
        `C'est utile parce que ce type de sujet en ${topicLabel(article.topic)} modifie les incitations, les budgets ou le contexte professionnel.`
      );

      return {
        content_type: "newsletter_article",
        slot: "newsletter",
        topic: article.topic,
        language: request.language,
        title: article.title,
        published_date: article.published_at?.slice(0, 10) ?? request.dropDate,
        summary,
        body_md: [
          summary,
          languageLine(
            request.language,
            `The useful angle: watch what changes next for customers, regulators, competitors, or students preparing for this field.`,
            `L'angle utile : observe ce qui change ensuite pour les clients, les régulateurs, les concurrents ou les étudiants qui visent ce secteur.`
          ),
          `[Source](${article.url})`
        ].join("\n\n"),
        why_it_matters: why,
        source_urls: [article.url],
        version: 1
      };
    });
  }

  private generateBusinessStory(request: GenerationRequest): BusinessStory {
    const article = this.pickArticle(request, ["business", "finance", "tech_ai"]);
    const setup = sentence(article);

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
        "The pressure is not only the headline. It is the trade-off between growth, trust, regulation, and execution.",
        "La pression ne vient pas seulement du titre. Elle vient de l'arbitrage entre croissance, confiance, régulation et exécution."
      ),
      decision: languageLine(
        request.language,
        "A strong operator would identify the constraint first, then choose the move that preserves the most future options.",
        "Un bon opérateur identifierait d'abord la contrainte, puis choisirait l'option qui garde le plus de marge pour la suite."
      ),
      outcome: languageLine(
        request.language,
        "The next measurable outcome is whether stakeholders change behavior, not whether the announcement sounds impressive.",
        "Le résultat à suivre est le changement de comportement des parties prenantes, pas l'effet d'annonce."
      ),
      lesson: languageLine(
        request.language,
        "Business stories are usually incentive stories. Follow who gains leverage and who loses room to maneuver.",
        "Les histoires business sont souvent des histoires d'incitations. Regarde qui gagne du levier et qui perd de la marge de manoeuvre."
      ),
      body_md: [setup, `[Source](${article.url})`].join("\n\n"),
      source_urls: [article.url],
      version: 1
    };
  }

  private generateMiniCase(request: GenerationRequest): MiniCaseChallenge {
    const article = this.pickArticle(request, request.newsletterTopics);

    return {
      content_type: "mini_case",
      slot: "mini_case",
      topic: article.topic,
      language: request.language,
      title: languageLine(request.language, `Mini-case: respond to ${article.publisher}`, `Mini-cas : répondre à ${article.publisher}`),
      difficulty: "medium",
      context: sentence(article),
      challenge: languageLine(
        request.language,
        "You advise a student team, founder, or junior analyst who must brief a decision-maker in five minutes.",
        "Tu conseilles une équipe étudiante, un fondateur ou un analyste junior qui doit briefer un décideur en cinq minutes."
      ),
      constraints: languageLine(request.language, "Use only sourced facts; separate facts from judgment; name one risk.", "Utilise seulement des faits sourcés ; sépare les faits du jugement ; nomme un risque.")
        .split("; ")
        .map((item) => item.trim()),
      question: languageLine(
        request.language,
        "What recommendation would you make, and what evidence would you need before acting?",
        "Quelle recommandation ferais-tu, et quelle preuve voudrais-tu avant d'agir ?"
      ),
      expected_reasoning: [
        languageLine(request.language, "Identify the stakeholder with the strongest incentive.", "Identifier l'acteur qui a l'incitation la plus forte."),
        languageLine(request.language, "Separate the immediate move from the second-order effect.", "Séparer l'action immédiate de l'effet de second ordre."),
        languageLine(request.language, "Name the uncertainty that could change the answer.", "Nommer l'incertitude qui pourrait changer la réponse.")
      ],
      sample_answer: languageLine(
        request.language,
        "I would recommend a cautious first move: summarize the factual change, test the incentive impact, then wait for one confirming signal before committing resources.",
        "Je recommanderais une première action prudente : résumer le changement factuel, tester l'impact sur les incitations, puis attendre un signal de confirmation avant d'engager des ressources."
      ),
      body_md: [sentence(article), `[Source](${article.url})`].join("\n\n"),
      source_urls: [article.url],
      version: 1
    };
  }

  private generateConcept(request: GenerationRequest): KeyConcept {
    const topTopic = request.newsletterTopics[0] ?? "business";
    const concept = CONCEPTS[topTopic];
    const article = this.pickArticle(request, [topTopic]);

    return {
      content_type: "concept",
      slot: "concept",
      topic: topTopic,
      language: request.language,
      title: concept.title,
      category: topTopic,
      definition: concept.definition,
      plain_english: languageLine(
        request.language,
        "Ask what makes the decision hard, what changes the incentives, and who has fewer alternatives after the move.",
        "Demande-toi ce qui rend la décision difficile, ce qui change les incitations, et qui a moins d'options après le mouvement."
      ),
      example: sentence(article),
      why_it_matters: languageLine(
        request.language,
        "This concept helps you move from memorizing news to reading the mechanism underneath it.",
        "Ce concept t'aide à passer de la mémorisation de l'actualité à la lecture du mécanisme qui se cache dessous."
      ),
      how_to_use_it: languageLine(
        request.language,
        "Use it in class, interviews, or internships when someone asks why a decision might work.",
        "Utilise-le en cours, en entretien ou en stage quand quelqu'un demande pourquoi une décision peut fonctionner."
      ),
      common_mistake: concept.mistake,
      body_md: [concept.definition, `[Source](${article.url})`].join("\n\n"),
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
