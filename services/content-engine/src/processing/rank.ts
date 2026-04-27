import type { ArticleCandidate, RankedArticle } from "../domain.js";
import { daysBetween } from "../utils/date.js";
import { categorizeArticle } from "./categorize.js";

const IMPORTANCE_TERMS = [
  "regulation",
  "launch",
  "earnings",
  "investigation",
  "acquisition",
  "bankruptcy",
  "approval",
  "trial",
  "lawsuit",
  "strategy",
  "inflation",
  "rates"
];

export function rankArticles(articles: ArticleCandidate[], now = new Date()): RankedArticle[] {
  return articles
    .map((article) => {
      const publishedAt = article.published_at ? new Date(article.published_at) : now;
      const ageDays = Number.isNaN(publishedAt.getTime()) ? 7 : daysBetween(now, publishedAt);
      const recencyScore = Math.max(0, 1 - ageDays / 14);
      const credibilityScore = article.credibility_score ?? 0.6;
      const haystack = `${article.title} ${article.summary ?? ""}`.toLowerCase();
      const termHits = IMPORTANCE_TERMS.filter((term) => haystack.includes(term));
      const termScore = Math.min(1, termHits.length / 3);
      const hasSummaryScore = article.summary ? 0.1 : 0;
      const importance_score = Number((credibilityScore * 0.4 + recencyScore * 0.35 + termScore * 0.15 + hasSummaryScore).toFixed(4));

      return {
        ...article,
        topic: categorizeArticle(article),
        importance_score,
        rank_reasons: [
          `credibility:${credibilityScore.toFixed(2)}`,
          `recency:${recencyScore.toFixed(2)}`,
          ...termHits.map((term) => `term:${term}`)
        ]
      };
    })
    .sort((left, right) => right.importance_score - left.importance_score);
}
