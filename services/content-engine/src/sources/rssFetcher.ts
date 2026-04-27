import type { Language, RawArticle } from "../domain.js";
import type { CuratedSource, SourceArticleMetadata, SourceConnector, SourceFetchRequest } from "./types.js";
import { sourceLog, sourceWarning } from "./sourceLogger.js";

const DEFAULT_RSS_TIMEOUT_MS = 8_000;
const DEFAULT_RSS_LIMIT_PER_SOURCE = 5;

function readTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()) : null;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function stripMarkup(value: string | null): string | undefined {
  const stripped = value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped || undefined;
}

function splitItems(xml: string): string[] {
  const matches = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi);
  return matches ?? [];
}

function readLink(item: string): string | null {
  const atomHref = item.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  return readTag(item, "link") ?? atomHref ?? null;
}

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
    const selected = this.sources.filter(
      (source) => source.rssUrl && request.topics.includes(source.topic) && request.languages.includes(source.language)
    );
    const limitPerSource = this.resolveLimitPerSource(request);

    sourceLog("rss_fetch_started", {
      source_count: selected.length,
      limit_per_source: limitPerSource,
      languages: request.languages,
      topics: request.topics
    });

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
      failed_sources: failures.length,
      article_count: articles.length
    });

    return articles;
  }

  private async fetchSource(source: CuratedSource, limit: number, since?: string): Promise<RawArticle[]> {
    if (!source.rssUrl) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.resolveTimeoutMs());

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
        throw new Error(`RSS fetch timed out for ${source.id} after ${this.resolveTimeoutMs()}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`RSS fetch failed for ${source.id}: ${response.status}`);
    }

    const xml = await response.text();
    return splitItems(xml)
      .map((item): (RawArticle & SourceArticleMetadata) | null => {
        const title = readTag(item, "title");
        const link = readLink(item);
        if (!title || !link) {
          return null;
        }

        return {
          source_id: source.id,
          source_type: source.source_type,
          credibility_tier: source.credibility_tier,
          url: link,
          title,
          publisher: source.publisher,
          published_at: readTag(item, "pubDate") ?? readTag(item, "published") ?? readTag(item, "updated"),
          retrieved_at: new Date().toISOString(),
          language: source.language as Language,
          summary: stripMarkup(readTag(item, "description") ?? readTag(item, "summary") ?? readTag(item, "content")),
          sourceTopic: source.topic,
          credibility_score: source.credibility_score
        };
      })
      .filter((article): article is RawArticle & SourceArticleMetadata => article !== null)
      .filter((article) => isAfterSince(article, since))
      .slice(0, limit);
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
}
