import { TOPIC_IDS, type Language, type RawArticle, type TopicId } from "../domain.js";
import { parseXmlFeed } from "./rssParser.js";
import type { CuratedSource, SourceArticleMetadata, SourceConnector, SourceFetchRequest } from "./types.js";
import { sourceLog, sourceWarning } from "./sourceLogger.js";

const DEFAULT_RSS_TIMEOUT_MS = 8_000;
const DEFAULT_RSS_LIMIT_PER_SOURCE = 5;
const DEFAULT_RSS_MAX_AGE_DAYS = 21;
const FR_RECENCY_LADDER_DAYS = [0, 1, 2] as const;

type RecencyFallbackLabel = "none" | "J-1" | "J-2";

type TopicThreshold = {
  minArticles: number;
  minSources: number;
};

type TopicFallbackDiagnostic = {
  threshold: TopicThreshold;
  selectedArticles: number;
  selectedSources: number;
  fallback: RecencyFallbackLabel;
  baseDate: string | null;
  cutoffDate: string | null;
  underThreshold: boolean;
};

const FR_TOPIC_THRESHOLDS: Record<TopicId, TopicThreshold> = {
  business: { minArticles: 1, minSources: 1 },
  finance: { minArticles: 1, minSources: 1 },
  tech_ai: { minArticles: 1, minSources: 1 },
  law: { minArticles: 1, minSources: 1 },
  medicine: { minArticles: 1, minSources: 1 },
  engineering: { minArticles: 1, minSources: 1 },
  sport_business: { minArticles: 1, minSources: 1 },
  culture_media: { minArticles: 1, minSources: 1 }
};

export type RssFetchDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  skippedNoRss: number;
  fetchedArticles: number;
  returnedArticles: number;
  duplicateArticlesSkipped: number;
  articlesByTopic: Record<TopicId, number>;
  sourcesByTopic: Record<TopicId, number>;
  staleFallbackUsedByTopic: Record<TopicId, RecencyFallbackLabel>;
  topicThresholds: Record<TopicId, TopicThreshold>;
  topicRecencyDiagnostics: Record<TopicId, TopicFallbackDiagnostic>;
  errors: Array<{
    source_id: string;
    publisher: string;
    error: string;
  }>;
};

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

    const batches = await Promise.allSettled(selected.map((source) => this.fetchSource(source, limitPerSource)));
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
    const recencySelection = selectArticlesByRecencyLadder(deduped.articles, request);
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
      article_count: recencySelection.articles.length,
      fetched_article_count: articles.length,
      duplicate_articles_skipped: deduped.duplicatesSkipped
    });

    this.lastDiagnostics = {
      attempted: selected.length,
      succeeded: succeededSources,
      failed: failures.length,
      skippedNoRss: skippedNoRss.length,
      fetchedArticles: articles.length,
      returnedArticles: recencySelection.articles.length,
      duplicateArticlesSkipped: deduped.duplicatesSkipped,
      articlesByTopic: recencySelection.articlesByTopic,
      sourcesByTopic: recencySelection.sourcesByTopic,
      staleFallbackUsedByTopic: recencySelection.staleFallbackUsedByTopic,
      topicThresholds: FR_TOPIC_THRESHOLDS,
      topicRecencyDiagnostics: recencySelection.topicRecencyDiagnostics,
      errors
    };

    sourceLog("rss_connector_health", {
      connector: this.name,
      attempted: selected.length,
      succeeded: succeededSources,
      failed: failures.length,
      article_count: recencySelection.articles.length,
      fetched_article_count: articles.length,
      duplicate_articles_skipped: deduped.duplicatesSkipped,
      skipped_no_rss_count: skippedNoRss.length,
      articles_by_topic: recencySelection.articlesByTopic,
      sources_by_topic: recencySelection.sourcesByTopic,
      stale_fallback_used_by_topic: recencySelection.staleFallbackUsedByTopic,
      errors
    });

    if (selected.length > 0 && succeededSources === 0) {
      throw new Error(`All RSS sources failed. Attempted ${selected.length} feed(s); see rss_source_failed logs.`);
    }

    return recencySelection.articles;
  }

  getLastDiagnostics(): RssFetchDiagnostics {
    return this.lastDiagnostics;
  }

  private async fetchSource(source: CuratedSource, limit: number): Promise<RawArticle[]> {
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
        skipped_stale: skippedStale
      });
    }

    const skippedCount =
      skippedMissingFields +
      skippedInvalidUrl +
      skippedStale +
      Math.max(0, items.length - skippedMissingFields - skippedInvalidUrl - skippedStale - articles.length);

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
    articlesByTopic: emptyTopicCounts(),
    sourcesByTopic: emptyTopicCounts(),
    staleFallbackUsedByTopic: emptyFallbackLabels(),
    topicThresholds: FR_TOPIC_THRESHOLDS,
    topicRecencyDiagnostics: emptyTopicRecencyDiagnostics(),
    errors: []
  };
}

function selectArticlesByRecencyLadder<T extends RawArticle>(
  articles: T[],
  request: SourceFetchRequest
): {
  articles: T[];
  articlesByTopic: Record<TopicId, number>;
  sourcesByTopic: Record<TopicId, number>;
  staleFallbackUsedByTopic: Record<TopicId, RecencyFallbackLabel>;
  topicRecencyDiagnostics: Record<TopicId, TopicFallbackDiagnostic>;
} {
  if (!request.since || !request.languages.includes("fr")) {
    const selected = request.since ? filterArticlesSince(articles, request.since) : articles;
    return {
      articles: selected,
      articlesByTopic: countArticlesByTopic(selected),
      sourcesByTopic: countSourcesByTopic(selected),
      staleFallbackUsedByTopic: emptyFallbackLabels(),
      topicRecencyDiagnostics: emptyTopicRecencyDiagnostics()
    };
  }

  const baseDate = normalizeDateOnly(request.since);
  if (!baseDate) {
    sourceWarning("rss_recency_ladder_skipped", {
      reason: "invalid_since_date",
      since: request.since
    });
    const selected = filterArticlesSince(articles, request.since);
    return {
      articles: selected,
      articlesByTopic: countArticlesByTopic(selected),
      sourcesByTopic: countSourcesByTopic(selected),
      staleFallbackUsedByTopic: emptyFallbackLabels(),
      topicRecencyDiagnostics: emptyTopicRecencyDiagnostics()
    };
  }

  const selected: T[] = filterArticlesSince(
    articles.filter((article) => article.language !== "fr"),
    request.since
  );
  const staleFallbackUsedByTopic = emptyFallbackLabels();
  const topicRecencyDiagnostics = emptyTopicRecencyDiagnostics(baseDate);

  for (const topic of request.topics) {
    const topicArticles = articles.filter((article) => article.language === "fr" && article.sourceTopic === topic);
    if (topicArticles.length === 0) {
      sourceWarning("rss_topic_under_threshold", {
        topic,
        language: "fr",
        reason: "no_candidate_articles_after_source_fetch",
        threshold: FR_TOPIC_THRESHOLDS[topic],
        base_date: baseDate
      });
      continue;
    }

    const datedArticles = topicArticles.filter((article) => normalizeArticleDate(article) !== null);
    const undatedCount = topicArticles.length - datedArticles.length;
    if (undatedCount > 0) {
      sourceWarning("rss_topic_articles_without_dates_excluded", {
        topic,
        language: "fr",
        base_date: baseDate,
        excluded_count: undatedCount,
        reason: "production_recency_ladder_requires_source_dates"
      });
    }

    const threshold = FR_TOPIC_THRESHOLDS[topic];
    let selectedForTopic: T[] = [];
    let fallbackDays: (typeof FR_RECENCY_LADDER_DAYS)[number] = 0;

    for (const days of FR_RECENCY_LADDER_DAYS) {
      const cutoffDate = addDays(baseDate, -days);
      const candidates = datedArticles.filter((article) => {
        const articleDate = normalizeArticleDate(article);
        return articleDate !== null && articleDate >= cutoffDate;
      });

      selectedForTopic = candidates;
      fallbackDays = days;

      if (meetsTopicThreshold(candidates, threshold)) {
        break;
      }

      if (days === 0) {
        sourceWarning("rss_topic_recency_fallback_needed", {
          topic,
          language: "fr",
          base_date: baseDate,
          selected_articles: candidates.length,
          selected_sources: countUniqueSources(candidates),
          threshold,
          next_window: "J-1"
        });
      } else if (days === 1) {
        sourceWarning("rss_topic_j2_fallback_needed", {
          topic,
          language: "fr",
          base_date: baseDate,
          selected_articles: candidates.length,
          selected_sources: countUniqueSources(candidates),
          threshold,
          next_window: "J-2",
          reason: "J_and_J-1_under_threshold"
        });
      }
    }

    const fallback = fallbackLabel(fallbackDays);
    const cutoffDate = addDays(baseDate, -fallbackDays);
    const selectedSources = countUniqueSources(selectedForTopic);
    const underThreshold = !meetsTopicThreshold(selectedForTopic, threshold);

    staleFallbackUsedByTopic[topic] = fallback;
    topicRecencyDiagnostics[topic] = {
      threshold,
      selectedArticles: selectedForTopic.length,
      selectedSources,
      fallback,
      baseDate,
      cutoffDate,
      underThreshold
    };

    if (fallback !== "none") {
      sourceWarning("rss_topic_stale_fallback_used", {
        topic,
        language: "fr",
        fallback,
        base_date: baseDate,
        cutoff_date: cutoffDate,
        selected_articles: selectedForTopic.length,
        selected_sources: selectedSources,
        threshold
      });
    }

    if (fallback === "J-2") {
      sourceWarning("rss_topic_j2_fallback_used", {
        topic,
        language: "fr",
        base_date: baseDate,
        cutoff_date: cutoffDate,
        selected_articles: selectedForTopic.length,
        selected_sources: selectedSources,
        threshold,
        reason: "topic_remained_under_threshold_after_J-1"
      });
    }

    if (underThreshold) {
      sourceWarning("rss_topic_under_threshold", {
        topic,
        language: "fr",
        base_date: baseDate,
        cutoff_date: cutoffDate,
        selected_articles: selectedForTopic.length,
        selected_sources: selectedSources,
        threshold,
        fallback
      });
    }

    sourceLog("rss_topic_recency_selected", {
      topic,
      language: "fr",
      base_date: baseDate,
      cutoff_date: cutoffDate,
      selected_articles: selectedForTopic.length,
      selected_sources: selectedSources,
      fallback,
      under_threshold: underThreshold
    });

    selected.push(...selectedForTopic);
  }

  const dedupedSelection = deduplicateRssArticles(selected);
  return {
    articles: dedupedSelection.articles,
    articlesByTopic: countArticlesByTopic(dedupedSelection.articles),
    sourcesByTopic: countSourcesByTopic(dedupedSelection.articles),
    staleFallbackUsedByTopic,
    topicRecencyDiagnostics
  };
}

function meetsTopicThreshold(articles: RawArticle[], threshold: TopicThreshold): boolean {
  return articles.length >= threshold.minArticles && countUniqueSources(articles) >= threshold.minSources;
}

function filterArticlesSince<T extends RawArticle>(articles: T[], since: string): T[] {
  const sinceDate = normalizeDateOnly(since);
  if (!sinceDate) {
    return articles;
  }

  return articles.filter((article) => {
    const articleDate = normalizeArticleDate(article);
    return articleDate === null || articleDate >= sinceDate;
  });
}

function countArticlesByTopic(articles: RawArticle[]): Record<TopicId, number> {
  const counts = emptyTopicCounts();
  for (const article of articles) {
    const topic = article.sourceTopic;
    if (topic) {
      counts[topic] += 1;
    }
  }
  return counts;
}

function countSourcesByTopic(articles: RawArticle[]): Record<TopicId, number> {
  const sourcesByTopic = new Map<TopicId, Set<string>>();
  for (const topic of TOPIC_IDS) {
    sourcesByTopic.set(topic, new Set());
  }

  for (const article of articles) {
    if (!article.sourceTopic) {
      continue;
    }
    sourcesByTopic.get(article.sourceTopic)?.add(sourceKey(article));
  }

  return Object.fromEntries(TOPIC_IDS.map((topic) => [topic, sourcesByTopic.get(topic)?.size ?? 0])) as Record<TopicId, number>;
}

function countUniqueSources(articles: RawArticle[]): number {
  return new Set(articles.map(sourceKey)).size;
}

function sourceKey(article: RawArticle): string {
  const maybeSourceId = (article as RawArticle & { source_id?: string }).source_id;
  return maybeSourceId ?? article.publisher;
}

function emptyTopicCounts(): Record<TopicId, number> {
  return Object.fromEntries(TOPIC_IDS.map((topic) => [topic, 0])) as Record<TopicId, number>;
}

function emptyFallbackLabels(): Record<TopicId, RecencyFallbackLabel> {
  return Object.fromEntries(TOPIC_IDS.map((topic) => [topic, "none"])) as Record<TopicId, RecencyFallbackLabel>;
}

function emptyTopicRecencyDiagnostics(baseDate: string | null = null): Record<TopicId, TopicFallbackDiagnostic> {
  return Object.fromEntries(
    TOPIC_IDS.map((topic) => [
      topic,
      {
        threshold: FR_TOPIC_THRESHOLDS[topic],
        selectedArticles: 0,
        selectedSources: 0,
        fallback: "none",
        baseDate,
        cutoffDate: baseDate,
        underThreshold: false
      }
    ])
  ) as Record<TopicId, TopicFallbackDiagnostic>;
}

function fallbackLabel(days: number): RecencyFallbackLabel {
  if (days === 1) {
    return "J-1";
  }
  if (days === 2) {
    return "J-2";
  }
  return "none";
}

function normalizeArticleDate(article: RawArticle): string | null {
  return normalizeDateOnly(article.published_at);
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
