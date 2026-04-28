import type { ArticleCandidate, RawArticle } from "../domain.js";
import { normalizeUrl, sha256 } from "../utils/hash.js";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_name",
  "utm_reader",
  "utm_viz_id",
  "utm_pubreferrer",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "cmpid",
  "cid",
  "smid",
  "ref",
  "ref_src"
]);

export function prepareCandidates(articles: RawArticle[]): ArticleCandidate[] {
  return articles.map((article) => {
    const normalized_url = normalizeArticleUrl(article.url);
    const content = [article.title, article.summary, article.body, normalized_url].filter(Boolean).join("\n");

    return {
      ...article,
      normalized_url,
      content_hash: sha256(content)
    };
  });
}

export function deduplicateArticles(articles: ArticleCandidate[]): ArticleCandidate[] {
  const selected: ArticleCandidate[] = [];

  for (const article of articles) {
    const duplicateIndex = selected.findIndex((existing) => isDuplicate(existing, article));

    if (duplicateIndex === -1) {
      selected.push(article);
      continue;
    }

    if (isBetterDuplicate(article, selected[duplicateIndex])) {
      selected[duplicateIndex] = article;
    }
  }

  return selected;
}

function normalizeArticleUrl(url: string): string {
  try {
    const parsed = new URL(normalizeUrl(url));
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname.replace(/\/amp\/?$/i, "").replace(/\/$/, "");
    return parsed.toString();
  } catch {
    return url.trim().replace(/#.*$/, "").replace(/[?&](utm_[^=&]+|fbclid|gclid|mc_cid|mc_eid)=[^&]+/gi, "");
  }
}

function dedupeKeys(article: ArticleCandidate): string[] {
  return [
    `url:${article.normalized_url}`,
    `hash:${article.content_hash}`,
    `title:${titleFingerprint(article.title)}`
  ].filter((key) => !key.endsWith(":"));
}

function isDuplicate(left: ArticleCandidate, right: ArticleCandidate): boolean {
  const leftKeys = new Set(dedupeKeys(left));
  if (dedupeKeys(right).some((key) => leftKeys.has(key))) {
    return true;
  }

  const similarity = titleSimilarity(left.title, right.title);
  if (similarity < 0.86) {
    return false;
  }

  const samePublisher = publisherKey(left.publisher) === publisherKey(right.publisher);
  const datesClose = publishedDatesClose(left.published_at, right.published_at);
  return samePublisher || datesClose;
}

function isBetterDuplicate(incoming: ArticleCandidate, existing: ArticleCandidate): boolean {
  const incomingScore = incoming.credibility_score ?? 0;
  const existingScore = existing.credibility_score ?? 0;
  if (incomingScore !== existingScore) {
    return incomingScore > existingScore;
  }

  const incomingPublishedAt = parseTime(incoming.published_at);
  const existingPublishedAt = parseTime(existing.published_at);
  if (incomingPublishedAt !== existingPublishedAt) {
    return incomingPublishedAt > existingPublishedAt;
  }

  return (incoming.summary?.length ?? 0) > (existing.summary?.length ?? 0);
}

function titleFingerprint(title: string): string {
  return titleTokens(title)
    .slice(0, 14)
    .join(" ");
}

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/\b(exclusive|breaking|analysis|opinion|live|update|updated)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !["the", "and", "for", "with", "from", "that", "this", "are", "was", "has", "have"].includes(word));
}

function titleSimilarity(leftTitle: string, rightTitle: string): number {
  const left = new Set(titleTokens(leftTitle));
  const right = new Set(titleTokens(rightTitle));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = Array.from(left).filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function publisherKey(publisher: string | undefined): string {
  return (publisher ?? "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function publishedDatesClose(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftTime = parseTime(left);
  const rightTime = parseTime(right);
  if (leftTime === 0 || rightTime === 0) {
    return false;
  }

  return Math.abs(leftTime - rightTime) <= 3 * 86_400_000;
}

function parseTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
