import type { Language, RawArticle } from "../domain.js";
import type { CuratedSource, SourceConnector, SourceFetchRequest } from "./types.js";

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

function splitItems(xml: string): string[] {
  const matches = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi);
  return matches ?? [];
}

export class RssFeedConnector implements SourceConnector {
  readonly name = "rss";

  constructor(private readonly sources: CuratedSource[]) {}

  async fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]> {
    const selected = this.sources.filter(
      (source) => source.rssUrl && request.topics.includes(source.topic) && request.languages.includes(source.language)
    );

    const batches = await Promise.allSettled(selected.map((source) => this.fetchSource(source, request.limitPerTopic ?? 8)));

    return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
  }

  private async fetchSource(source: CuratedSource, limit: number): Promise<RawArticle[]> {
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
      .slice(0, limit)
      .map((item): RawArticle | null => {
        const title = readTag(item, "title");
        const link = readTag(item, "link") ?? item.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? null;
        if (!title || !link) {
          return null;
        }

        return {
          url: link,
          title,
          publisher: source.publisher,
          published_at: readTag(item, "pubDate") ?? readTag(item, "published") ?? readTag(item, "updated"),
          retrieved_at: new Date().toISOString(),
          language: source.language as Language,
          summary: readTag(item, "description") ?? readTag(item, "summary") ?? undefined,
          sourceTopic: source.topic,
          credibility_score: source.credibility_score
        };
      })
      .filter((article): article is RawArticle => article !== null);
  }
}
