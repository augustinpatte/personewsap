import type { ArticleCandidate, RawArticle } from "../domain.js";
import { normalizeUrl, sha256 } from "../utils/hash.js";

export function prepareCandidates(articles: RawArticle[]): ArticleCandidate[] {
  return articles.map((article) => {
    const normalized_url = normalizeUrl(article.url);
    const content = [article.title, article.summary, article.body, normalized_url].filter(Boolean).join("\n");

    return {
      ...article,
      normalized_url,
      content_hash: sha256(content)
    };
  });
}

export function deduplicateArticles(articles: ArticleCandidate[]): ArticleCandidate[] {
  const byKey = new Map<string, ArticleCandidate>();

  for (const article of articles) {
    const key = article.normalized_url || article.content_hash;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, article);
      continue;
    }

    const existingScore = existing.credibility_score ?? 0;
    const incomingScore = article.credibility_score ?? 0;
    if (incomingScore > existingScore) {
      byKey.set(key, article);
    }
  }

  return Array.from(byKey.values());
}
