import type { RawArticle } from "../domain.js";
import type { SourceConnector, SourceFetchRequest } from "./types.js";
import { CURATED_SOURCE_COVERAGE, CURATED_SOURCES } from "./curatedSources.js";
import { RssFeedConnector } from "./rssFetcher.js";
import { sourceLog, sourceWarning } from "./sourceLogger.js";

type SourceMode = "sample" | "rss" | "mixed";

export class SourceFetcher {
  private readonly connectors: SourceConnector[];

  constructor(connectors: SourceConnector[]) {
    this.connectors = applySourceEnvPolicy(connectors);
  }

  async fetch(request: SourceFetchRequest): Promise<RawArticle[]> {
    const connectorNames = this.connectors.map((connector) => connector.name);
    const sampleContentEnabled = connectorNames.includes("sample_articles");
    const liveRss = connectorNames.includes("rss");

    sourceLog("fetch_started", {
      connector_count: this.connectors.length,
      connectors: connectorNames,
      source_mode: resolveSourceMode(sampleContentEnabled, liveRss),
      sample_content_enabled: sampleContentEnabled,
      live_rss: liveRss,
      languages: request.languages,
      topics: request.topics
    });

    const results = await Promise.allSettled(this.connectors.map((connector) => connector.fetchArticles(request)));
    const articles: RawArticle[] = [];
    let failedConnectors = 0;
    let succeededConnectors = 0;

    results.forEach((result, index) => {
      const connector = this.connectors[index].name;

      if (result.status === "fulfilled") {
        articles.push(...result.value);
        succeededConnectors += 1;
        sourceLog("connector_fetch_completed", {
          connector,
          article_count: result.value.length
        });
        sourceLog("source_connector_health", {
          connector,
          attempted: 1,
          succeeded: 1,
          failed: 0,
          article_count: result.value.length,
          error: null
        });
        return;
      }

      failedConnectors += 1;
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      sourceWarning("connector_fetch_failed", {
        connector,
        error
      });
      sourceWarning("source_connector_health", {
        connector,
        attempted: 1,
        succeeded: 0,
        failed: 1,
        article_count: 0,
        error
      });
    });

    sourceLog("fetch_completed", {
      connector_count: this.connectors.length,
      attempted: this.connectors.length,
      succeeded: succeededConnectors,
      failed: failedConnectors,
      failed_connectors: failedConnectors,
      article_count: articles.length
    });

    if (failedConnectors === this.connectors.length) {
      throw new Error(
        `All source connectors failed. Checked connectors: ${this.connectors.map((connector) => connector.name).join(", ")}.`
      );
    }

    return articles;
  }
}

function resolveSourceMode(sampleContentEnabled: boolean, liveRss: boolean): SourceMode {
  if (sampleContentEnabled && liveRss) {
    return "mixed";
  }

  if (sampleContentEnabled) {
    return "sample";
  }

  return "rss";
}

function applySourceEnvPolicy(connectors: SourceConnector[]): SourceConnector[] {
  let resolved = connectors;

  if (isLiveRssEnabled() && !resolved.some((connector) => connector.name === "rss")) {
    sourceLog("live_rss_enabled", {
      source_count: CURATED_SOURCES.filter((source) => source.rssUrl).length,
      coverage: CURATED_SOURCE_COVERAGE
    });

    resolved = [...resolved, new RssFeedConnector(CURATED_SOURCES)];
  }

  if (isLiveRssOnlyEnabled() && isLiveRssEnabled()) {
    const withoutSamples = resolved.filter((connector) => connector.name !== "sample_articles");
    if (withoutSamples.length !== resolved.length) {
      sourceLog("sample_articles_disabled", {
        reason: "LIVE_RSS_ONLY=true",
        connectors: withoutSamples.map((connector) => connector.name)
      });
    }

    resolved = withoutSamples;
  }

  return resolved;
}

function isLiveRssEnabled(): boolean {
  return process.env.LIVE_RSS?.toLowerCase() === "true" || isLiveRssOnlyEnabled();
}

function isLiveRssOnlyEnabled(): boolean {
  return process.env.LIVE_RSS_ONLY?.toLowerCase() === "true";
}
