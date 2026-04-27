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
    const keys = dedupeKeys(article);
    const existing = keys.map((key) => byKey.get(key)).find(Boolean);

    if (!existing) {
      for (const key of keys) {
        byKey.set(key, article);
      }
      continue;
    }

    const existingScore = existing.credibility_score ?? 0;
    const incomingScore = article.credibility_score ?? 0;
    if (incomingScore > existingScore) {
      for (const key of keys) {
        byKey.set(key, article);
      }
    }
  }

  return Array.from(new Set(byKey.values()));
}

function dedupeKeys(article: ArticleCandidate): string[] {
  return [
    `url:${article.normalized_url}`,
    `hash:${article.content_hash}`,
    `title:${titleFingerprint(article.title)}`
  ].filter((key) => !key.endsWith(":"));
}

function titleFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 14)
    .join(" ");
}
