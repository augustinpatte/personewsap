import type { Language, RawArticle, TopicId } from "../domain.js";
import type { SourceArticleMetadata, SourceConnector, SourceFetchRequest } from "./types.js";

type NewsApiArticle = {
  title?: string;
  url?: string;
  source?: { name?: string };
  author?: string | null;
  publishedAt?: string;
  description?: string;
  content?: string;
};

const TOPIC_QUERIES: Record<TopicId, string> = {
  business: "business strategy OR economy",
  finance: "markets OR central bank OR finance",
  tech_ai: "artificial intelligence OR technology",
  law: "law OR regulation OR court",
  medicine: "medicine OR health research",
  engineering: "engineering OR infrastructure",
  sport_business: "sports business OR media rights",
  culture_media: "media industry OR culture business"
};

export class NewsApiConnector implements SourceConnector {
  readonly name = "news_api";

  constructor(
    private readonly options: {
      endpoint: string;
      apiKey: string;
    }
  ) {}

  async fetchArticles(request: SourceFetchRequest): Promise<RawArticle[]> {
    const results = await Promise.allSettled(
      request.topics.flatMap((topic) => request.languages.map((language) => this.fetchTopic(topic, language, request)))
    );

    return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  }

  private async fetchTopic(topic: TopicId, language: Language, request: SourceFetchRequest): Promise<RawArticle[]> {
    const url = new URL(this.options.endpoint);
    url.searchParams.set("q", TOPIC_QUERIES[topic]);
    url.searchParams.set("language", language);
    url.searchParams.set("pageSize", String(request.limitPerTopic ?? 8));
    url.searchParams.set("sortBy", "publishedAt");

    if (request.since) {
      url.searchParams.set("from", request.since);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`News API fetch failed for ${topic}/${language}: ${response.status}`);
    }

    const payload = (await response.json()) as { articles?: NewsApiArticle[] };

    return (payload.articles ?? [])
      .map((article): (RawArticle & SourceArticleMetadata) | null => {
        if (!article.title || !article.url) {
          return null;
        }

        return {
          source_id: `news-api-${topic}-${language}`,
          source_region: "global",
          source_type: "aggregated_api",
          credibility_tier: "tier_3",
          url: article.url,
          title: article.title,
          publisher: article.source?.name ?? "News API",
          author: article.author ?? null,
          published_at: article.publishedAt,
          retrieved_at: new Date().toISOString(),
          language,
          summary: article.description,
          body: article.content,
          sourceTopic: topic,
          credibility_score: 0.7
        };
      })
      .filter((article): article is RawArticle & SourceArticleMetadata => article !== null);
  }
}
