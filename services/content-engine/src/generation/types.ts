import type { BusinessStoryMemoryContext, DailyDropPayload, Language, MiniCaseTopicId, RankedArticle, TopicId } from "../domain.js";
import type { MiniCaseMemoryContext } from "../miniCase/editorialMemory.js";

export type GenerationRequest = {
  dropDate: string;
  language: Language;
  articles: RankedArticle[];
  newsletterTopics: TopicId[];
  newsletterArticleCount: number;
  miniCaseProductTopics?: MiniCaseTopicId[];
  miniCaseMemory?: MiniCaseMemoryContext;
  businessStoryMemory?: BusinessStoryMemoryContext;
  productionStrict?: boolean;
};

export type ContentGenerator = {
  generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload>;
};
