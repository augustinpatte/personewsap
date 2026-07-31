import type { BusinessStoryMemoryContext, DailyDropPayload, Language, MiniCaseTopicId, RankedArticle, TopicId } from "../domain.js";
import type { MiniCaseMemoryContext } from "../miniCase/editorialMemory.js";

export type GenerationRequest = {
  dropDate: string;
  language: Language;
  articles: RankedArticle[];
  newsletterTopics: TopicId[];
  newsletterArticleCount: number;
  // Number of newsletter articles generated PER editorial topic. Defaults to
  // NEWSLETTER_ITEMS_PER_TOPIC (2) when omitted. The total newsletter catalog is
  // always newsletterTopics.length * newsletterItemsPerTopic.
  newsletterItemsPerTopic?: number;
  miniCaseProductTopics?: MiniCaseTopicId[];
  miniCaseMemory?: MiniCaseMemoryContext;
  businessStoryMemory?: BusinessStoryMemoryContext;
  productionStrict?: boolean;
};

export type ContentGenerator = {
  generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload>;
};
