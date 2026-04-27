import type { RawArticle } from "../domain.js";
import type { SourceConnector, SourceFetchRequest } from "./types.js";

const SAMPLE_ARTICLES: RawArticle[] = [
  {
    url: "https://example.com/business/pricing-power-campus-software?utm_source=dry-run",
    title: "Campus software groups test pricing power as student budgets tighten",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-24T08:00:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "en",
    summary:
      "Several education software firms are changing packaging and discounts as universities push back on higher subscription costs.",
    body:
      "The useful signal is not the price increase alone. The story shows how recurring revenue businesses defend margins when buyers become more selective.",
    sourceTopic: "business",
    credibility_score: 0.86
  },
  {
    url: "https://example.com/business/pricing-power-campus-software",
    title: "Campus software groups test pricing power as student budgets tighten",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-24T08:00:00.000Z",
    retrieved_at: "2026-04-26T08:02:00.000Z",
    language: "en",
    summary:
      "Several education software firms are changing packaging and discounts as universities push back on higher subscription costs.",
    body:
      "This duplicate keeps the dry run honest: URL normalization and content hashing should collapse it before ranking.",
    sourceTopic: "business",
    credibility_score: 0.82
  },
  {
    url: "https://example.com/finance/rate-cuts-student-loans",
    title: "Rate-cut expectations shift the math for lenders and borrowers",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-25T09:30:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "en",
    summary:
      "Banks and borrowers are preparing for a different interest-rate path, changing how loans, savings products, and risk are priced.",
    sourceTopic: "finance",
    credibility_score: 0.84
  },
  {
    url: "https://example.com/tech-ai/ai-chip-supply",
    title: "AI chip supply becomes a strategy question, not only a hardware question",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-25T10:15:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "en",
    summary:
      "Cloud providers are rethinking capacity planning as demand for AI compute stays high and advanced chips remain constrained.",
    sourceTopic: "tech_ai",
    credibility_score: 0.85
  },
  {
    url: "https://example.com/law/platform-regulation",
    title: "New platform rules force product teams to redesign default choices",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-23T12:00:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "en",
    summary:
      "A regulatory update is pushing digital platforms to make consent, ranking, and data-sharing choices easier to inspect.",
    sourceTopic: "law",
    credibility_score: 0.8
  },
  {
    url: "https://example.com/medicine/trial-endpoints",
    title: "A clinical trial result raises the right question: what endpoint changed?",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-22T07:45:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "en",
    summary:
      "Researchers reported positive trial data, but the practical meaning depends on whether the measured endpoint reflects real patient benefit.",
    sourceTopic: "medicine",
    credibility_score: 0.87
  },
  {
    url: "https://example.com/business/logiciel-campus-prix",
    title: "Des editeurs de logiciels universitaires testent leur pouvoir de prix",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-24T08:00:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "fr",
    summary:
      "Plusieurs editeurs changent leurs offres et leurs remises alors que les universites contestent la hausse des abonnements.",
    sourceTopic: "business",
    credibility_score: 0.86
  },
  {
    url: "https://example.com/finance/taux-credit",
    title: "Les anticipations de baisse des taux changent le calcul du credit",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-25T09:30:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "fr",
    summary:
      "Banques et emprunteurs se preparent a une trajectoire de taux differente, avec un impact sur les prets, l'epargne et le risque.",
    sourceTopic: "finance",
    credibility_score: 0.84
  },
  {
    url: "https://example.com/tech-ai/puces-ia-capacite",
    title: "Les puces IA deviennent un sujet de strategie autant que de materiel",
    publisher: "PersoNewsAP Sample Desk",
    author: "Content Engine",
    published_at: "2026-04-25T10:15:00.000Z",
    retrieved_at: "2026-04-26T08:00:00.000Z",
    language: "fr",
    summary:
      "Les fournisseurs cloud revoient leur planification de capacite alors que la demande de calcul IA reste forte.",
    sourceTopic: "tech_ai",
    credibility_score: 0.85
  }
];

export class SampleArticleConnector implements SourceConnector {
  readonly name = "sample_articles";

  async fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]> {
    const limit = request.limitPerTopic ?? 10;
    const selected: RawArticle[] = [];

    for (const topic of request.topics) {
      for (const language of request.languages) {
        selected.push(
          ...SAMPLE_ARTICLES.filter((article) => article.sourceTopic === topic && article.language === language).slice(0, limit)
        );
      }
    }

    return selected;
  }
}

export { SAMPLE_ARTICLES };
