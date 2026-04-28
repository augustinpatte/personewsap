import type { Language, RawArticle } from "../domain.js";
import { parseXmlFeed } from "./rssParser.js";
import type { CuratedSource, SourceArticleMetadata, SourceConnector, SourceFetchRequest } from "./types.js";
import { sourceLog, sourceWarning } from "./sourceLogger.js";

const DEFAULT_RSS_TIMEOUT_MS = 8_000;
const DEFAULT_RSS_LIMIT_PER_SOURCE = 5;
const DEFAULT_RSS_MAX_AGE_DAYS = 21;

function isAfterSince(article: RawArticle, since?: string): boolean {
  if (!since || !article.published_at) {
    return true;
  }

  const publishedAt = new Date(article.published_at);
  const sinceDate = new Date(since);
  if (Number.isNaN(publishedAt.getTime()) || Number.isNaN(sinceDate.getTime())) {
    return true;
  }

  return publishedAt >= sinceDate;
}

function isFreshEnough(article: RawArticle, maxAgeDays: number, now = new Date()): boolean {
  if (!article.published_at) {
    return true;
  }

  const publishedAt = new Date(article.published_at);
  if (Number.isNaN(publishedAt.getTime())) {
    return true;
  }

  const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / 86_400_000);
  return ageDays <= maxAgeDays;
}

function summarizeSources(sources: CuratedSource[]): Array<{
  source_id: string;
  publisher: string;
  topic: string;
  language: string;
}> {
  return sources.slice(0, 10).map((source) => ({
    source_id: source.id,
    publisher: source.publisher,
    topic: source.topic,
    language: source.language
  }));
}

export class RssFeedConnector implements SourceConnector {
  readonly name = "rss";

  constructor(
    private readonly sources: CuratedSource[],
    private readonly options: {
      timeoutMs?: number;
      limitPerSource?: number;
    } = {}
  ) {}

  async fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]> {
    const matchingSources = this.sources.filter(
      (source) => request.topics.includes(source.topic) && request.languages.includes(source.language)
    );
    const selected = matchingSources.filter((source) => source.rssUrl);
    const skippedNoRss = matchingSources.filter((source) => !source.rssUrl);
    const limitPerSource = this.resolveLimitPerSource(request);

    sourceLog("rss_fetch_started", {
      source_count: selected.length,
      skipped_no_rss_count: skippedNoRss.length,
      limit_per_source: limitPerSource,
      languages: request.languages,
      topics: request.topics
    });

    if (skippedNoRss.length > 0) {
      sourceWarning("rss_sources_skipped_no_rss_url", {
        skipped_count: skippedNoRss.length,
        sources: summarizeSources(skippedNoRss)
      });
    }

    const batches = await Promise.allSettled(selected.map((source) => this.fetchSource(source, limitPerSource, request.since)));
    const failures = batches
      .map((batch, index) => ({
        batch,
        source: selected[index]
      }))
      .filter((entry): entry is { batch: PromiseRejectedResult; source: CuratedSource } => entry.batch.status === "rejected");

    for (const failure of failures) {
      sourceWarning("rss_source_failed", {
        source_id: failure.source.id,
        publisher: failure.source.publisher,
        rss_url: failure.source.rssUrl,
        error: failure.batch.reason instanceof Error ? failure.batch.reason.message : String(failure.batch.reason)
      });
    }

    const articles = batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));

    sourceLog("rss_fetch_completed", {
      source_count: selected.length,
      skipped_no_rss_count: skippedNoRss.length,
      failed_sources: failures.length,
      article_count: articles.length
    });

    return articles;
  }

  private async fetchSource(source: CuratedSource, limit: number, since?: string): Promise<RawArticle[]> {
    if (!source.rssUrl) {
      return [];
    }

    sourceLog("rss_source_attempted", {
      source_id: source.id,
      publisher: source.publisher,
      topic: source.topic,
      language: source.language,
      region: source.region,
      rss_url: source.rssUrl
    });

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = this.resolveTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;

    try {
      response = await fetch(source.rssUrl, {
        headers: {
          "User-Agent": "PersoNewsAPContentEngine/0.1"
        },
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        sourceWarning("rss_source_health", {
          source_id: source.id,
          publisher: source.publisher,
          status: "failed",
          duration_ms: Date.now() - startedAt,
          kept_count: 0,
          skipped_count: 0,
          error: `RSS fetch timed out after ${timeoutMs}ms`
        });
        throw new Error(`RSS fetch timed out for ${source.id} after ${timeoutMs}ms`);
      }

      sourceWarning("rss_source_health", {
        source_id: source.id,
        publisher: source.publisher,
        status: "failed",
        duration_ms: Date.now() - startedAt,
        kept_count: 0,
        skipped_count: 0,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      sourceWarning("rss_source_health", {
        source_id: source.id,
        publisher: source.publisher,
        status: "failed",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
        kept_count: 0,
        skipped_count: 0
      });
      throw new Error(`RSS fetch failed for ${source.id}: ${response.status}`);
    }

    const xml = await response.text();
    const items = parseXmlFeed(xml);
    let skippedMissingFields = 0;
    let skippedStale = 0;
    let skippedInvalidUrl = 0;
    const maxAgeDays = this.resolveMaxAgeDays();

    if (items.length === 0) {
      sourceWarning("rss_source_skipped_no_items", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl
      });
    }

    const articles = items
      .map((item): (RawArticle & SourceArticleMetadata) | null => {
        if (!item.title || !item.url) {
          skippedMissingFields += 1;
          return null;
        }

        const resolvedUrl = resolveArticleUrl(item.url, source);
        if (!resolvedUrl) {
          skippedInvalidUrl += 1;
          return null;
        }

        return {
          source_id: source.id,
          source_region: source.region,
          source_type: source.source_type,
          credibility_tier: source.credibility_tier,
          url: resolvedUrl,
          title: item.title,
          publisher: item.publisher ?? source.publisher,
          published_at: item.publishedAt,
          retrieved_at: new Date().toISOString(),
          language: source.language as Language,
          summary: item.summary ?? undefined,
          sourceTopic: source.topic,
          credibility_score: source.credibility_score
        };
      })
      .filter((article): article is RawArticle & SourceArticleMetadata => article !== null)
      .filter((article) => {
        const keep = isAfterSince(article, since) && isFreshEnough(article, maxAgeDays);
        if (!keep) {
          skippedStale += 1;
        }

        return keep;
      })
      .slice(0, limit);

    if (skippedMissingFields > 0) {
      sourceWarning("rss_items_skipped_missing_fields", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl,
        skipped_count: skippedMissingFields
      });
    }

    if (skippedInvalidUrl > 0) {
      sourceWarning("rss_items_skipped_invalid_url", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl,
        skipped_count: skippedInvalidUrl
      });
    }

    if (items.length > 0 && articles.length === 0) {
      sourceWarning("rss_source_skipped_no_usable_items", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl,
        rss_items: items.length,
        skipped_missing_fields: skippedMissingFields,
        skipped_invalid_url: skippedInvalidUrl,
        skipped_stale: skippedStale
      });
    }

    const skippedCount = skippedMissingFields + skippedInvalidUrl + skippedStale + Math.max(0, items.length - skippedMissingFields - skippedInvalidUrl - skippedStale - articles.length);

    sourceLog("rss_source_succeeded", {
      source_id: source.id,
      publisher: source.publisher,
      topic: source.topic,
      language: source.language,
      region: source.region,
      rss_url: source.rssUrl,
      rss_items: items.length,
      kept_count: articles.length,
      skipped_count: skippedCount,
      skipped_missing_fields: skippedMissingFields,
      skipped_invalid_url: skippedInvalidUrl,
      skipped_stale: skippedStale,
      max_age_days: maxAgeDays,
      duration_ms: Date.now() - startedAt,
      article_count: articles.length
    });

    sourceLog("rss_source_health", {
      source_id: source.id,
      publisher: source.publisher,
      status: "ok",
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
      rss_items: items.length,
      kept_count: articles.length,
      skipped_count: skippedCount,
      article_count: articles.length
    });

    return articles;
  }

  private resolveLimitPerSource(request: SourceFetchRequest): number {
    const envLimit = Number(process.env.RSS_ARTICLES_PER_SOURCE);
    const limit =
      request.limitPerSource ??
      this.options.limitPerSource ??
      (Number.isInteger(envLimit) && envLimit > 0 ? envLimit : undefined) ??
      DEFAULT_RSS_LIMIT_PER_SOURCE;

    return Math.max(1, Math.min(limit, 25));
  }

  private resolveTimeoutMs(): number {
    const envTimeout = Number(process.env.RSS_TIMEOUT_MS);
    const timeoutMs =
      this.options.timeoutMs ??
      (Number.isInteger(envTimeout) && envTimeout > 0 ? envTimeout : undefined) ??
      DEFAULT_RSS_TIMEOUT_MS;

    return Math.max(1_000, Math.min(timeoutMs, 30_000));
  }

  private resolveMaxAgeDays(): number {
    const envMaxAgeDays = Number(process.env.RSS_MAX_AGE_DAYS);
    const maxAgeDays = Number.isInteger(envMaxAgeDays) && envMaxAgeDays > 0 ? envMaxAgeDays : DEFAULT_RSS_MAX_AGE_DAYS;

    return Math.max(1, Math.min(maxAgeDays, 120));
  }
}

function resolveArticleUrl(value: string, source: CuratedSource): string | null {
  try {
    return new URL(value, source.rssUrl ?? source.url).toString();
  } catch {
    return null;
  }
}
