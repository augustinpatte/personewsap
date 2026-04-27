import type { Language, RawArticle } from "../domain.js";
import type { CuratedSource, SourceArticleMetadata, SourceConnector, SourceFetchRequest } from "./types.js";

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

  constructor(private readonly sources: CuratedSource[]) {}

  async fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]> {
    const selected = this.sources.filter(
      (source) => source.rssUrl && request.topics.includes(source.topic) && request.languages.includes(source.language)
    );

    const batches = await Promise.allSettled(selected.map((source) => this.fetchSource(source, request.limitPerTopic ?? 8, request.since)));

    return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
  }

  private async fetchSource(source: CuratedSource, limit: number, since?: string): Promise<RawArticle[]> {
    if (!source.rssUrl) {
      return [];
    }

    const response = await fetch(source.rssUrl, {
      headers: {
        "User-Agent": "PersoNewsAPContentEngine/0.1"
      }
    });

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
}
