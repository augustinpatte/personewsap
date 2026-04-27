import type { Language, RawArticle, TopicId } from "../domain.js";

export type SourceFetchRequest = {
  topics: TopicId[];
  languages: Language[];
  since?: string;
  limitPerTopic?: number;
};

export type SourceConnector = {
  name: string;
  fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]>;
};

export type CuratedSource = {
  id: string;
  topic: TopicId;
  language: Language;
  publisher: string;
  url: string;
  rssUrl?: string;
  credibility_score: number;
};
