import type { RawArticle } from "../domain.js";
import type { SourceConnector, SourceFetchRequest } from "./types.js";

export class SourceFetcher {
  constructor(private readonly connectors: SourceConnector[]) {}

  async fetch(request: SourceFetchRequest): Promise<RawArticle[]> {
    const results = await Promise.allSettled(this.connectors.map((connector) => connector.fetchArticles(request)));
    const articles: RawArticle[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        articles.push(...result.value);
      }
    }

    return articles;
  }
}
