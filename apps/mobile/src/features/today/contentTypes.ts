import type { TopicId } from "../../constants/product";

export type ContentLanguage = "fr" | "en";

export type ContentType =
  | "newsletter_article"
  | "business_story"
  | "mini_case"
  | "key_concept";

export type DailyDropSlot =
  | "newsletter"
  | "business_story"
  | "mini_case"
  | "concept";

export type ContentDifficulty = "intro" | "intermediate" | "advanced";

export type SourceMetadata = {
  id: string;
  url: string;
  title: string;
  publisher: string;
  author: string | null;
  published_at: string | null;
  retrieved_at: string;
  language: ContentLanguage | "multi";
  content_hash: string;
};

type BaseContentItem = {
  id: string;
  content_type: ContentType;
  language: ContentLanguage;
  title: string;
  slot: DailyDropSlot;
  source_ids: string[];
  version: number;
};

export type NewsletterArticle = BaseContentItem & {
  content_type: "newsletter_article";
  slot: "newsletter";
  topic: TopicId;
  published_date: string;
  summary: string;
  body_md: string;
  why_it_matters: string;
};

export type BusinessStory = BaseContentItem & {
  content_type: "business_story";
  slot: "business_story";
  company_or_market: string;
  story_date: string;
  setup: string;
  tension: string;
  decision: string;
  outcome: string;
  lesson: string;
};

export type MiniCaseChallenge = BaseContentItem & {
  content_type: "mini_case";
  slot: "mini_case";
  topic: TopicId;
  difficulty: ContentDifficulty;
  context: string;
  challenge: string;
  constraints: string[];
  question: string;
  expected_reasoning: string[];
  sample_answer: string;
};

export type KeyConcept = BaseContentItem & {
  content_type: "key_concept";
  slot: "concept";
  category: TopicId | "career";
  definition: string;
  plain_english: string;
  example: string;
  why_it_matters: string;
  how_to_use_it: string;
  common_mistake: string;
};

export type DailyDropContentItem =
  | NewsletterArticle
  | BusinessStory
  | MiniCaseChallenge
  | KeyConcept;

export type TodayDailyDrop = {
  id: string;
  drop_date: string;
  language: ContentLanguage;
  title: string;
  prompt_version: string;
  generator_version: string;
  estimated_read_minutes: number;
  items: {
    newsletter: NewsletterArticle[];
    business_story: BusinessStory;
    mini_case: MiniCaseChallenge;
    concept: KeyConcept;
  };
};
