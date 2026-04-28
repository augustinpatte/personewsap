import type { RawArticle } from "../domain.js";
import type { SourceConnector, SourceFetchRequest } from "./types.js";
import { CURATED_SOURCE_COVERAGE, CURATED_SOURCES } from "./curatedSources.js";
import { RssFeedConnector } from "./rssFetcher.js";
import { sourceLog, sourceWarning } from "./sourceLogger.js";

export class SourceFetcher {
  private readonly connectors: SourceConnector[];

  constructor(connectors: SourceConnector[]) {
    this.connectors = withLiveRssConnector(connectors);
  }

  async fetch(request: SourceFetchRequest): Promise<RawArticle[]> {
    sourceLog("fetch_started", {
      connector_count: this.connectors.length,
      connectors: this.connectors.map((connector) => connector.name),
      live_rss: isLiveRssEnabled(),
      languages: request.languages,
      topics: request.topics
    });

    const results = await Promise.allSettled(this.connectors.map((connector) => connector.fetchArticles(request)));
    const articles: RawArticle[] = [];
    let failedConnectors = 0;

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        articles.push(...result.value);
        sourceLog("connector_fetch_completed", {
          connector: this.connectors[index].name,
          article_count: result.value.length
        });
        return;
      }

      failedConnectors += 1;
      sourceWarning("connector_fetch_failed", {
        connector: this.connectors[index].name,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
    });

    sourceLog("fetch_completed", {
      connector_count: this.connectors.length,
      failed_connectors: failedConnectors,
      article_count: articles.length
    });

    return articles;
  }
}

function withLiveRssConnector(connectors: SourceConnector[]): SourceConnector[] {
  if (!isLiveRssEnabled() || connectors.some((connector) => connector.name === "rss")) {
    return connectors;
  }

  sourceLog("live_rss_enabled", {
    source_count: CURATED_SOURCES.filter((source) => source.rssUrl).length,
    coverage: CURATED_SOURCE_COVERAGE
  });

  return [...connectors, new RssFeedConnector(CURATED_SOURCES)];
}

function isLiveRssEnabled(): boolean {
  return process.env.LIVE_RSS?.toLowerCase() === "true";
}
