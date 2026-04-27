import type { RawArticle } from "../domain.js";
import type { CuratedSource, SourceConnector, SourceFetchRequest } from "./types.js";

export class CuratedSourceConnector implements SourceConnector {
  readonly name = "curated_sources";

  constructor(private readonly sources: CuratedSource[]) {}

  async fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]> {
    return this.sources
      .filter((source) => request.topics.includes(source.topic) && request.languages.includes(source.language))
      .map((source) => ({
        url: source.url,
        title: `${source.publisher} editorial source`,
        publisher: source.publisher,
        author: null,
        published_at: null,
        retrieved_at: new Date().toISOString(),
        language: source.language,
        summary: `Curated source for ${source.topic}.`,
        sourceTopic: source.topic,
        credibility_score: source.credibility_score
      }));
  }
}
