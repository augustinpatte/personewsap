import type { ArticleCandidate, TopicId } from "../domain.js";

const TOPIC_KEYWORDS: Record<TopicId, string[]> = {
  business: ["company", "strategy", "market", "retail", "startup", "ceo", "pricing", "supply chain"],
  finance: ["stock", "bond", "rates", "inflation", "bank", "fund", "earnings", "market"],
  tech_ai: ["ai", "artificial intelligence", "software", "chip", "semiconductor", "data", "cloud"],
  law: ["court", "law", "regulation", "judge", "antitrust", "privacy", "legal"],
  medicine: ["trial", "drug", "patient", "clinical", "health", "vaccine", "hospital", "medical"],
  engineering: ["engineering", "infrastructure", "energy", "battery", "manufacturing", "robot", "aerospace"],
  sport_business: ["league", "club", "rights", "sponsorship", "stadium", "athlete", "sports"],
  culture_media: ["media", "film", "music", "streaming", "publisher", "culture", "creator"]
};

export function categorizeArticle(article: ArticleCandidate): TopicId {
  if (article.sourceTopic) {
    return article.sourceTopic;
  }

  const haystack = `${article.title} ${article.summary ?? ""} ${article.body ?? ""}`.toLowerCase();
  let bestTopic: TopicId = "business";
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as Array<[TopicId, string[]]>) {
    const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestTopic = topic;
      bestScore = score;
    }
  }

  return bestTopic;
}
