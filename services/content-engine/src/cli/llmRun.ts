import type { DailyDropPayload, Language, TopicId } from "../domain.js";
import { LlmContentGenerator } from "../generation/llmGenerator.js";
import { OpenAiJsonProvider } from "../generation/openAiProvider.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { CURATED_SOURCES } from "../sources/curatedSources.js";
import { RssFeedConnector } from "../sources/rssFetcher.js";
import { SampleArticleConnector } from "../sources/sampleArticles.js";
import { SourceFetcher } from "../sources/sourceFetcher.js";
import type { SourceConnector } from "../sources/types.js";
import { parseDryRunOptions, type DryRunOptions } from "./dryRun.js";

export type LlmRunOptions = DryRunOptions;

export type LlmRunOutput = {
  mode: "llm-run";
  provider: "openai";
  persisted: false;
  diagnostics: Array<{
    language: Language;
    fetched_articles: number;
    processed_articles: number;
    generated_items: number;
    top_ranked_sources: Array<{
      title: string;
      topic: TopicId;
      importance_score: number;
      url: string;
    }>;
  }>;
  drops: DailyDropPayload[];
};

export async function runLlmRun(options: LlmRunOptions): Promise<LlmRunOutput> {
  const connectors: SourceConnector[] = [new SampleArticleConnector()];

  if (options.liveRss) {
    connectors.push(new RssFeedConnector(CURATED_SOURCES));
  }

  const sourceFetcher = new SourceFetcher(connectors);
  const generator = new LlmContentGenerator({
    provider: new OpenAiJsonProvider()
  });
  const diagnostics: LlmRunOutput["diagnostics"] = [];
  const drops: DailyDropPayload[] = [];

  for (const language of options.languages) {
    const rawArticles = await sourceFetcher.fetch({
      topics: options.topics,
      languages: [language],
      since: options.dropDate,
      limitPerTopic: 10
    });
    const rankedArticles = processArticles(rawArticles).filter((article) => article.language === language);
    const payload = assembleDailyDropPayload(
      await generator.generateDailyDrop({
        dropDate: options.dropDate,
        language,
        articles: rankedArticles,
        newsletterTopics: options.topics,
        newsletterArticleCount: options.newsletterArticleCount
      })
    );

    assertValidDailyDropPayload(payload);

    diagnostics.push({
      language,
      fetched_articles: rawArticles.length,
      processed_articles: rankedArticles.length,
      generated_items: payload.items.length,
      top_ranked_sources: rankedArticles.slice(0, 5).map((article) => ({
        title: article.title,
        topic: article.topic,
        importance_score: article.importance_score,
        url: article.url
      }))
    });
    drops.push(payload);
  }

  return {
    mode: "llm-run",
    provider: "openai",
    persisted: false,
    diagnostics,
    drops
  };
}

export function parseLlmRunOptions(args: string[]): LlmRunOptions {
  return parseDryRunOptions(args);
}
