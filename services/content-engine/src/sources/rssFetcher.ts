import type { Language, RawArticle } from "../domain.js";
import { parseXmlFeed } from "./rssParser.js";
import type { CuratedSource, SourceArticleMetadata, SourceConnector, SourceFetchRequest } from "./types.js";
import { sourceLog, sourceWarning } from "./sourceLogger.js";

const DEFAULT_RSS_TIMEOUT_MS = 8_000;
const DEFAULT_RSS_LIMIT_PER_SOURCE = 5;
const DEFAULT_RSS_MAX_AGE_DAYS = 21;

export type RssFetchDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  skippedNoRss: number;
  fetchedArticles: number;
  returnedArticles: number;
  duplicateArticlesSkipped: number;
  errors: Array<{
    source_id: string;
    publisher: string;
    error: string;
  }>;
};

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
  private lastDiagnostics: RssFetchDiagnostics = emptyDiagnostics();

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
    const deduped = deduplicateRssArticles(articles);
    const succeededSources = batches.filter((batch) => batch.status === "fulfilled").length;
    const errors = failures.slice(0, 10).map((failure) => ({
      source_id: failure.source.id,
      publisher: failure.source.publisher,
      error: failure.batch.reason instanceof Error ? failure.batch.reason.message : String(failure.batch.reason)
    }));

    if (deduped.duplicatesSkipped > 0) {
      sourceWarning("rss_items_deduplicated", {
        duplicate_count: deduped.duplicatesSkipped,
        before_count: articles.length,
        after_count: deduped.articles.length
      });
    }

    sourceLog("rss_fetch_completed", {
      source_count: selected.length,
      attempted: selected.length,
      succeeded: succeededSources,
      failed: failures.length,
      skipped_no_rss_count: skippedNoRss.length,
      failed_sources: failures.length,
      article_count: deduped.articles.length,
      fetched_article_count: articles.length,
      duplicate_articles_skipped: deduped.duplicatesSkipped
    });

    this.lastDiagnostics = {
      attempted: selected.length,
      succeeded: succeededSources,
      failed: failures.length,
      skippedNoRss: skippedNoRss.length,
      fetchedArticles: articles.length,
      returnedArticles: deduped.articles.length,
      duplicateArticlesSkipped: deduped.duplicatesSkipped,
      errors
    };

    sourceLog("rss_connector_health", {
      connector: this.name,
      attempted: selected.length,
      succeeded: succeededSources,
      failed: failures.length,
      article_count: deduped.articles.length,
      fetched_article_count: articles.length,
      duplicate_articles_skipped: deduped.duplicatesSkipped,
      skipped_no_rss_count: skippedNoRss.length,
      errors
    });

    if (selected.length > 0 && succeededSources === 0) {
      throw new Error(`All RSS sources failed. Attempted ${selected.length} feed(s); see rss_source_failed logs.`);
    }

    return deduped.articles;
  }

  getLastDiagnostics(): RssFetchDiagnostics {
    return this.lastDiagnostics;
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
    let items: ReturnType<typeof parseXmlFeed>;
    try {
      items = parseXmlFeed(xml);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sourceWarning("rss_source_health", {
        source_id: source.id,
        publisher: source.publisher,
        status: "failed",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
        kept_count: 0,
        skipped_count: 0,
        article_count: 0,
        error: `RSS parse failed: ${message}`
      });
      throw new Error(`RSS parse failed for ${source.id}: ${message}`);
    }

    let skippedMissingFields = 0;
    let skippedStale = 0;
    let skippedBeforeSince = 0;
    let skippedInvalidUrl = 0;
    let missingDateCount = 0;
    let invalidDateCount = 0;
    const maxAgeDays = this.resolveMaxAgeDays();
    const allowStale = this.resolveAllowStaleArticles();

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

        if (!item.rawDate) {
          missingDateCount += 1;
        } else if (!item.publishedAt) {
          invalidDateCount += 1;
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
        if (!isAfterSince(article, since)) {
          skippedBeforeSince += 1;
          return false;
        }

        if (!allowStale && !isFreshEnough(article, maxAgeDays)) {
          skippedStale += 1;
          return false;
        }

        return true;
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

    if (missingDateCount > 0) {
      sourceWarning("rss_items_missing_dates", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl,
        item_count: missingDateCount,
        handling: "kept_with_null_published_at"
      });
    }

    if (invalidDateCount > 0) {
      sourceWarning("rss_items_invalid_dates", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl,
        item_count: invalidDateCount,
        handling: "kept_with_null_published_at"
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

    if (skippedBeforeSince > 0) {
      sourceWarning("rss_items_skipped_before_since", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl,
        since,
        skipped_count: skippedBeforeSince
      });
    }

    if (skippedStale > 0) {
      sourceWarning("rss_items_skipped_stale", {
        source_id: source.id,
        publisher: source.publisher,
        rss_url: source.rssUrl,
        skipped_count: skippedStale,
        max_age_days: maxAgeDays,
        allow_stale: allowStale
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
        missing_date_count: missingDateCount,
        invalid_date_count: invalidDateCount,
        skipped_before_since: skippedBeforeSince,
        skipped_stale: skippedStale
      });
    }

    const skippedCount =
      skippedMissingFields +
      skippedInvalidUrl +
      skippedBeforeSince +
      skippedStale +
      Math.max(0, items.length - skippedMissingFields - skippedInvalidUrl - skippedBeforeSince - skippedStale - articles.length);

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
      missing_date_count: missingDateCount,
      invalid_date_count: invalidDateCount,
      skipped_before_since: skippedBeforeSince,
      skipped_stale: skippedStale,
      max_age_days: maxAgeDays,
      allow_stale: allowStale,
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
      skipped_before_since: skippedBeforeSince,
      skipped_stale: skippedStale,
      missing_date_count: missingDateCount,
      invalid_date_count: invalidDateCount,
      max_age_days: maxAgeDays,
      allow_stale: allowStale,
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

  private resolveAllowStaleArticles(): boolean {
    return process.env.RSS_ALLOW_STALE?.toLowerCase() === "true";
  }
}

function resolveArticleUrl(value: string, source: CuratedSource): string | null {
  try {
    return new URL(value, source.rssUrl ?? source.url).toString();
  } catch {
    return null;
  }
}

function emptyDiagnostics(): RssFetchDiagnostics {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedNoRss: 0,
    fetchedArticles: 0,
    returnedArticles: 0,
    duplicateArticlesSkipped: 0,
    errors: []
  };
}

function deduplicateRssArticles<T extends RawArticle>(articles: T[]): { articles: T[]; duplicatesSkipped: number } {
  const selected: T[] = [];
  const keyOwners = new Map<string, number>();
  let duplicatesSkipped = 0;

  for (const article of articles) {
    const keys = rssDedupeKeys(article);
    const existingIndex = keys.map((key) => keyOwners.get(key)).find((index) => index !== undefined);

    if (existingIndex === undefined) {
      const nextIndex = selected.length;
      selected.push(article);
      for (const key of keys) {
        keyOwners.set(key, nextIndex);
      }
      continue;
    }

    duplicatesSkipped += 1;
    const existing = selected[existingIndex];
    if (isBetterRssDuplicate(article, existing)) {
      selected[existingIndex] = article;
      for (const key of keys) {
        keyOwners.set(key, existingIndex);
      }
    }
  }

  return {
    articles: selected,
    duplicatesSkipped
  };
}

function rssDedupeKeys(article: RawArticle): string[] {
  const url = normalizeRssUrl(article.url);
  const title = titleKey(article.title);
  const publisher = publisherKey(article.publisher);
  const date = article.published_at?.slice(0, 10) ?? "";
  const keys = [`url:${url}`];

  if (title && publisher && date) {
    keys.push(`title-publisher-date:${title}|${publisher}|${date}`);
  } else if (title && publisher) {
    keys.push(`title-publisher:${title}|${publisher}`);
  }

  return keys;
}

function normalizeRssUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";

    for (const key of Array.from(parsed.searchParams.keys())) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src"].includes(normalizedKey)) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname.replace(/\/amp\/?$/i, "").replace(/\/$/, "");
    return parsed.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function titleKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/\b(exclusive|breaking|analysis|opinion|live|updated?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 16)
    .join(" ");
}

function publisherKey(value: string): string {
  return value.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
}

function isBetterRssDuplicate(incoming: RawArticle, existing: RawArticle): boolean {
  const incomingTime = parseTime(incoming.published_at);
  const existingTime = parseTime(existing.published_at);
  if (incomingTime !== existingTime) {
    return incomingTime > existingTime;
  }

  return (incoming.summary?.length ?? 0) > (existing.summary?.length ?? 0);
}

function parseTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
