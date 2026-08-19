import type { ArticleCandidate, TopicId } from "../domain.js";
import { evaluateTopicRelevance } from "./topicRelevance.js";

export const TOPIC_KEYWORDS: Record<TopicId, string[]> = {
  business: ["company", "strategy", "market", "retail", "startup", "ceo", "pricing", "supply chain"],
  finance: ["stock", "bond", "rates", "inflation", "bank", "fund", "earnings", "market"],
  tech_ai: ["ai", "artificial intelligence", "software", "chip", "semiconductor", "data", "cloud"],
  law: ["court", "law", "regulation", "judge", "antitrust", "privacy", "legal"],
  medicine: ["trial", "drug", "patient", "clinical", "health", "vaccine", "hospital", "medical"],
  engineering: ["engineering", "infrastructure", "energy", "battery", "manufacturing", "robot", "aerospace"],
  sport_business: ["league", "club", "rights", "sponsorship", "stadium", "athlete", "sports"],
  culture_media: ["media", "film", "music", "streaming", "publisher", "culture", "creator"]
};

/**
 * Whether a keyword appears as a word, not as a fragment inside one.
 *
 * A plain `includes` made "ai" match inside ordinary French words — français,
 * faire, aide, travail — so almost any French article scored for tech_ai. The
 * bug was invisible while categorizeArticle returned sourceTopic immediately
 * and never reached the scoring; it surfaces the moment the feed category stops
 * being taken as proof.
 */
export function containsKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(haystack);
}

export function topicKeywordHits(article: ArticleCandidate, topic: TopicId): string[] {
  const haystack = `${article.title} ${article.summary ?? ""} ${article.body ?? ""}`.toLowerCase();
  return TOPIC_KEYWORDS[topic].filter((keyword) => containsKeyword(haystack, keyword));
}

/**
 * The topic an article should be filed under.
 *
 * `sourceTopic` is the feed's configured category. It used to be returned
 * immediately, which meant a Tech/Web feed could file a murder story as
 * tech_ai. It is now a prior that only wins when the text agrees with it —
 * corroboration is decided by processing/topicRelevance.ts, which owns the
 * editorial definitions.
 *
 * This function still always returns a topic, because ranking needs one for
 * every candidate. Whether the article may be *published* under that topic is a
 * separate question, answered by the relevance gate before generation.
 */
export function categorizeArticle(article: ArticleCandidate): TopicId {
  // The relevance gate already decided this article's editorial topic. Nothing
  // downstream may revisit it: one canonical decision flows through ranking,
  // source packets, generation and validation.
  if (article.canonicalTopic) {
    return article.canonicalTopic;
  }

  const decision = evaluateTopicRelevance(article);

  if (decision.status === "accepted") {
    return decision.topic;
  }

  // Ambiguous, not wrong. A legitimate finance article whose wording happens
  // not to match the evidence list must stay in finance: moving it on a weak
  // keyword score would empty its topic's source pool, and an empty pool is now
  // a hard refusal to generate. The hint therefore stands unless the text
  // points somewhere else strictly better.
  const hint = article.sourceTopic ?? null;
  let bestTopic: TopicId = hint ?? "business";
  let bestScore = hint ? topicKeywordHits(article, hint).length : 0;

  for (const topic of Object.keys(TOPIC_KEYWORDS) as TopicId[]) {
    const score = topicKeywordHits(article, topic).length;
    if (score > bestScore) {
      bestTopic = topic;
      bestScore = score;
    }
  }

  return bestTopic;
}
