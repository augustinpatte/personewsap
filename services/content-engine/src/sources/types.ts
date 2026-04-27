import type { Language, RawArticle, TopicId } from "../domain.js";

export type SourceFetchRequest = {
  topics: TopicId[];
  languages: Language[];
  since?: string;
  limitPerTopic?: number;
  limitPerSource?: number;
};

export type SourceConnector = {
  name: string;
  fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]>;
};

export type SourceCredibilityTier = "tier_1" | "tier_2" | "tier_3";
export type SourceRegion = "global" | "us" | "uk" | "eu" | "fr" | "north_america";

export type CuratedSourceType = "rss" | "institutional_site" | "publisher_section" | "specialist_publisher" | "aggregated_api";

export type CuratedSource = {
  id: string;
  topic: TopicId;
  language: Language;
  publisher: string;
  region: SourceRegion;
  url: string;
  rssUrl?: string;
  credibility_score: number;
  credibility_tier: SourceCredibilityTier;
  source_type: CuratedSourceType;
  description?: string;
  usage_notes?: string;
};

export type SourceArticleMetadata = {
  source_id: string;
  source_region: SourceRegion;
  source_type: CuratedSourceType;
  credibility_tier: SourceCredibilityTier;
};
