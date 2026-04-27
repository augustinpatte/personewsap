import type { ArticleCandidate, RankedArticle, TopicId } from "../domain.js";
import type { CuratedSourceType, SourceCredibilityTier } from "../sources/types.js";
import { daysBetween } from "../utils/date.js";
import { categorizeArticle, topicKeywordHits } from "./categorize.js";

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

const STUDENT_CAREER_TERMS = [
  "career",
  "hiring",
  "internship",
  "graduate",
  "student",
  "university",
  "skill",
  "training",
  "entry-level",
  "salary",
  "jobs",
  "labor market",
  "strategy",
  "case study",
  "startup",
  "product",
  "clinical trial",
  "regulation",
  "market structure",
  "business model",
  "engineering",
  "research",
  "scholarship",
  "early career",
  "founder",
  "apprenticeship",
  "credential",
  "certification",
  "campus"
];

const TIER_SCORE: Record<SourceCredibilityTier, number> = {
  tier_1: 1,
  tier_2: 0.82,
  tier_3: 0.68
};

type CandidateSourceMetadata = {
  credibility_tier?: SourceCredibilityTier;
  source_id?: string;
  source_type?: CuratedSourceType;
};

type RankDraft = {
  article: ArticleCandidate & CandidateSourceMetadata;
  topic: TopicId;
  baseScore: number;
  reasons: string[];
  publisherKey: string;
};

function sourceCredibilityScore(article: ArticleCandidate & CandidateSourceMetadata): number {
  const numericScore = article.credibility_score ?? 0.6;
  const tierScore = article.credibility_tier ? TIER_SCORE[article.credibility_tier] : numericScore;
  return Math.min(1, Math.max(0, numericScore * 0.7 + tierScore * 0.3));
}

function freshnessScore(article: ArticleCandidate, now: Date): number {
  const publishedAt = article.published_at ? new Date(article.published_at) : now;
  const ageDays = Number.isNaN(publishedAt.getTime()) ? 14 : Math.max(0, daysBetween(now, publishedAt));
  return Math.max(0, 1 - ageDays / 10);
}

function topicRelevanceScore(article: ArticleCandidate, topic: ReturnType<typeof categorizeArticle>): { score: number; hits: string[] } {
  const hits = topicKeywordHits(article, topic);
  const sourceTopicBoost = article.sourceTopic === topic ? 0.65 : 0;
  return {
    score: Math.min(1, sourceTopicBoost + hits.length / 4),
    hits
  };
}

function studentCareerRelevance(article: ArticleCandidate): { score: number; hits: string[] } {
  const haystack = `${article.title} ${article.summary ?? ""} ${article.body ?? ""}`.toLowerCase();
  const hits = STUDENT_CAREER_TERMS.filter((term) => haystack.includes(term));
  return {
    score: Math.min(1, hits.length / 3),
    hits
  };
}

function sourceDiversityKey(article: ArticleCandidate & CandidateSourceMetadata): string {
  return (article.publisher ?? article.source_id ?? article.normalized_url).toLowerCase().trim();
}

function sourceDiversityScore(
  draft: RankDraft,
  seenPublishers: Set<string>,
  seenTopicPublishers: Set<string>
): number {
  if (!seenPublishers.has(draft.publisherKey)) {
    return 1;
  }

  if (!seenTopicPublishers.has(`${draft.topic}:${draft.publisherKey}`)) {
    return 0.72;
  }

  return 0.42;
}

function topicDiversityScore(draft: RankDraft, seenTopicCounts: Map<TopicId, number>): number {
  const seenCount = seenTopicCounts.get(draft.topic) ?? 0;

  if (seenCount === 0) {
    return 1;
  }

  if (seenCount === 1) {
    return 0.74;
  }

  return 0.48;
}

export function rankArticles(articles: ArticleCandidate[], now = new Date()): RankedArticle[] {
  const drafts = articles
    .map((article): RankDraft => {
      const topic = categorizeArticle(article);
      const freshScore = freshnessScore(article, now);
      const credibilityScore = sourceCredibilityScore(article);
      const haystack = `${article.title} ${article.summary ?? ""}`.toLowerCase();
      const termHits = IMPORTANCE_TERMS.filter((term) => haystack.includes(term));
      const importanceTermScore = Math.min(1, termHits.length / 3);
      const topicRelevance = topicRelevanceScore(article, topic);
      const careerRelevance = studentCareerRelevance(article);
      const hasSummaryScore = article.summary ? 0.04 : 0;
      const baseScore =
        freshScore * 0.28 +
        credibilityScore * 0.24 +
        topicRelevance.score * 0.22 +
        careerRelevance.score * 0.14 +
        importanceTermScore * 0.08 +
        hasSummaryScore;

      return {
        article,
        topic,
        baseScore,
        publisherKey: sourceDiversityKey(article),
        reasons: [
          `freshness:${freshScore.toFixed(2)}`,
          `credibility:${credibilityScore.toFixed(2)}`,
          `topic_relevance:${topicRelevance.score.toFixed(2)}`,
          `student_career:${careerRelevance.score.toFixed(2)}`,
          ...termHits.map((term) => `term:${term}`)
            .slice(0, 3),
          ...topicRelevance.hits.map((term) => `topic:${term}`).slice(0, 3),
          ...careerRelevance.hits.map((term) => `career:${term}`).slice(0, 3)
        ]
      };
    })
    .sort((left, right) => right.baseScore - left.baseScore);

  const seenPublishers = new Set<string>();
  const seenTopicPublishers = new Set<string>();
  const seenTopicCounts = new Map<TopicId, number>();

  return drafts
    .map((draft) => {
      const diversityScore = sourceDiversityScore(draft, seenPublishers, seenTopicPublishers);
      const topicBalanceScore = topicDiversityScore(draft, seenTopicCounts);
      seenPublishers.add(draft.publisherKey);
      seenTopicPublishers.add(`${draft.topic}:${draft.publisherKey}`);
      seenTopicCounts.set(draft.topic, (seenTopicCounts.get(draft.topic) ?? 0) + 1);

      return {
        ...draft.article,
        topic: draft.topic,
        importance_score: Number((draft.baseScore * 0.84 + diversityScore * 0.08 + topicBalanceScore * 0.08).toFixed(4)),
        rank_reasons: [
          ...draft.reasons,
          `source_diversity:${diversityScore.toFixed(2)}`,
          `topic_diversity:${topicBalanceScore.toFixed(2)}`
        ]
      };
    })
    .sort((left, right) => right.importance_score - left.importance_score);
}
