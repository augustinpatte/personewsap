import type { ArticleCandidate, TopicId } from "../domain.js";

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

export function topicKeywordHits(article: ArticleCandidate, topic: TopicId): string[] {
  const haystack = `${article.title} ${article.summary ?? ""} ${article.body ?? ""}`.toLowerCase();
  return TOPIC_KEYWORDS[topic].filter((keyword) => haystack.includes(keyword));
}

export function categorizeArticle(article: ArticleCandidate): TopicId {
  if (article.sourceTopic) {
    return article.sourceTopic;
  }

  let bestTopic: TopicId = "business";
  let bestScore = 0;

  for (const topic of Object.keys(TOPIC_KEYWORDS) as TopicId[]) {
    const score = topicKeywordHits(article, topic).length;
    if (score > bestScore) {
      bestTopic = topic;
      bestScore = score;
    }
  }

  return bestTopic;
}
