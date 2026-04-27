import type { DailyDropPayload, Language, RankedArticle, TopicId } from "../domain.js";

export type GenerationRequest = {
  dropDate: string;
  language: Language;
  articles: RankedArticle[];
  newsletterTopics: TopicId[];
  newsletterArticleCount: number;
};

export type ContentGenerator = {
  generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload>;
};
