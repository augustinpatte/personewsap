export const TOPIC_IDS = [
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering",
  "sport_business",
  "culture_media"
] as const;

export const MINI_CASE_TOPIC_IDS = [
  "finance_economy",
  "stock_market",
  "ai",
  "law_compliance",
  "health_pharma",
  "engineering_operations"
] as const;

export const GOAL_IDS = [
  "understand_world",
  "prepare_career",
  "learn_business",
  "explore_stem",
  "become_sharper_daily"
] as const;

export const LANGUAGES = ["fr", "en"] as const;
export const CONTENT_TYPES = ["newsletter_article", "business_story", "mini_case", "concept", "quick_quiz"] as const;
export const DAILY_DROP_SLOTS = ["newsletter", "business_story", "mini_case", "concept"] as const;
export const CONTENT_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const BUSINESS_STORY_ENTITY_TYPES = [
  "founder",
  "ceo",
  "investor",
  "company",
  "product",
  "crisis",
  "acquisition",
  "strategy",
  "other"
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];
export type MiniCaseTopicId = (typeof MINI_CASE_TOPIC_IDS)[number];
export type GoalId = (typeof GOAL_IDS)[number];
export type Language = (typeof LANGUAGES)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];
export type DailyDropSlot = (typeof DAILY_DROP_SLOTS)[number];
export type ContentDifficulty = (typeof CONTENT_DIFFICULTIES)[number];
export type BusinessStoryEntityType = (typeof BUSINESS_STORY_ENTITY_TYPES)[number];
export type ContentStatus = "draft" | "review" | "published" | "archived";
export type DailyDropStatus = "generated" | "published" | "read" | "archived";
export type PreferenceFrequency = "daily" | "weekdays" | "weekly";

export type SourceMetadata = {
  id?: string;
  url: string;
  title: string;
  publisher: string;
  author: string | null;
  published_at: string | null;
  retrieved_at: string;
  language: Language | null;
  content_hash: string;
  credibility_score: number;
};

export type RawArticle = {
  url: string;
  title: string;
  publisher: string;
  author?: string | null;
  published_at?: string | null;
  retrieved_at: string;
  language: Language;
  summary?: string;
  body?: string;
  sourceTopic?: TopicId;
  credibility_score?: number;
};

export type ArticleCandidate = RawArticle & {
  content_hash: string;
  normalized_url: string;
};

export type RankedArticle = ArticleCandidate & {
  topic: TopicId;
  importance_score: number;
  rank_reasons: string[];
};

type BaseGeneratedItem = {
  content_type: ContentType;
  slot: DailyDropSlot;
  language: Language;
  title: string;
  topic: TopicId | null;
  source_urls: string[];
  version: number;
};

export type NewsletterArticle = BaseGeneratedItem & {
  content_type: "newsletter_article";
  slot: "newsletter";
  topic: TopicId;
  published_date: string;
  summary: string;
  body_md: string;
  why_it_matters: string;
};

export type BusinessStory = BaseGeneratedItem & {
  content_type: "business_story";
  slot: "business_story";
  company_or_market: string;
  story_date: string;
  setup: string;
  tension: string;
  decision: string;
  outcome: string;
  lesson: string;
  body_md: string;
  editorial_memory?: BusinessStoryEditorialMemoryFields;
};

export type BusinessStoryEditorialMemoryFields = {
  entity_name: string;
  entity_type: BusinessStoryEntityType;
  main_company: string;
  companies_mentioned: string[];
  industry: string;
  key_mechanism: string;
  secondary_mechanisms: string[];
  strategic_angle: string;
  core_takeaway: string;
  year_period: string;
};

export type MiniCaseChallenge = BaseGeneratedItem & {
  content_type: "mini_case";
  slot: "mini_case";
  topic: TopicId;
  product_topic: MiniCaseTopicId;
  scenario_type: string;
  decision_type: string;
  concept_tested: string;
  mechanism: string;
  question_pattern: string;
  correct_answer_pattern: string;
  core_takeaway: string;
  difficulty: ContentDifficulty;
  context: string;
  challenge: string;
  constraints: string[];
  question: string;
  questions: Array<{
    id: string;
    role: "method_framework" | "technical_application" | "conclusion_decision";
    question: string;
    options: Array<{
      id: string;
      text: string;
      is_correct: boolean;
      feedback_correct: string;
      feedback_incorrect: string;
    }>;
  }>;
  expected_reasoning: string[];
  sample_answer: string;
  conclusion: string;
  body_md: string;
};

export type KeyConcept = BaseGeneratedItem & {
  content_type: "concept";
  slot: "concept";
  category: TopicId | "career";
  definition: string;
  plain_english: string;
  example: string;
  why_it_matters: string;
  how_to_use_it: string;
  common_mistake: string;
  body_md: string;
};

export type GeneratedContentItem = NewsletterArticle | BusinessStory | MiniCaseChallenge | KeyConcept;

export type DailyDropPayload = {
  drop_date: string;
  language: Language;
  prompt_version: string;
  generator_version: string;
  items: GeneratedContentItem[];
};

export type BusinessStoryEditorialMemoryEntry = BusinessStoryEditorialMemoryFields & {
  id?: string;
  content_item_id: string | null;
  title: string;
  slug: string;
  language: Language;
  published_date: string;
  created_at?: string;
};

export type BusinessStoryMemoryContext = {
  recentStories: BusinessStoryEditorialMemoryEntry[];
  bannedEntities: string[];
  bannedCompanies: string[];
  recentMechanisms: string[];
  recentIndustries: string[];
  recentStrategicAngles: string[];
  underusedIndustries: string[];
  underusedMechanisms: string[];
  underusedEntityTypes: BusinessStoryEntityType[];
  underusedGeographies: string[];
  underusedTimePeriods: string[];
};

export type UserDailyDropPreference = {
  user_id: string;
  language: Language;
  goal: GoalId;
  frequency: PreferenceFrequency;
  newsletter_article_count: number;
  mini_case_topics: Array<{
    topic_id: MiniCaseTopicId;
    position: number | null;
  }>;
  modules: {
    newsletter: boolean;
    business_story: boolean;
    mini_case: boolean;
  };
  topics: Array<{
    topic_id: TopicId;
    articles_count: number;
    position: number | null;
  }>;
};

export function isTopicId(value: string): value is TopicId {
  return TOPIC_IDS.includes(value as TopicId);
}

export function isMiniCaseTopicId(value: string): value is MiniCaseTopicId {
  return MINI_CASE_TOPIC_IDS.includes(value as MiniCaseTopicId);
}

export function miniCaseTopicToContentTopics(topicId: MiniCaseTopicId): TopicId[] {
  const mapping: Record<MiniCaseTopicId, TopicId[]> = {
    finance_economy: ["finance"],
    stock_market: ["finance", "business"],
    ai: ["tech_ai"],
    law_compliance: ["law"],
    health_pharma: ["medicine"],
    engineering_operations: ["engineering"]
  };

  return mapping[topicId];
}

export function isLanguage(value: string): value is Language {
  return LANGUAGES.includes(value as Language);
}
