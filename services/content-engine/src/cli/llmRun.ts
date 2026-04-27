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

const LLM_RUN_NEWSLETTER_ARTICLE_COUNT = 1;

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
  const runOptions: LlmRunOptions = {
    ...options,
    newsletterArticleCount: LLM_RUN_NEWSLETTER_ARTICLE_COUNT
  };

  logProgress("local test limit active", {
    newsletter_articles: LLM_RUN_NEWSLETTER_ARTICLE_COUNT,
    business_stories: 1,
    mini_cases: 1,
    concepts: 1
  });

  const connectors: SourceConnector[] = [new SampleArticleConnector()];

  if (options.liveRss) {
    connectors.push(new RssFeedConnector(CURATED_SOURCES));
  }

  const sourceFetcher = new SourceFetcher(connectors);
  const generator = new LlmContentGenerator({
    provider: new OpenAiJsonProvider(),
    onProgress: logProgress
  });
  const diagnostics: LlmRunOutput["diagnostics"] = [];
  const drops: DailyDropPayload[] = [];

  for (const language of options.languages) {
    logProgress("source fetch started", {
      language,
      topics: runOptions.topics,
      live_rss: runOptions.liveRss,
      limit_per_topic: 10
    });

    const rawArticles = await sourceFetcher.fetch({
      topics: runOptions.topics,
      languages: [language],
      since: runOptions.dropDate,
      limitPerTopic: 10
    });

    logProgress("source fetch completed", {
      language,
      fetched_articles: rawArticles.length
    });

    logProgress("processing started", {
      language,
      candidate_articles: rawArticles.length
    });

    const rankedArticles = processArticles(rawArticles).filter((article) => article.language === language);

    logProgress("processing completed", {
      language,
      processed_articles: rankedArticles.length
    });

    for (const item of plannedLlmItems(runOptions.newsletterArticleCount)) {
      logProgress("LLM generation started", {
        language,
        item: item.label,
        content_type: item.contentType
      });
    }

    const payload = assembleDailyDropPayload(
      await generator.generateDailyDrop({
        dropDate: runOptions.dropDate,
        language,
        articles: rankedArticles,
        newsletterTopics: runOptions.topics,
        newsletterArticleCount: runOptions.newsletterArticleCount
      })
    );

    for (const item of payload.items) {
      logProgress("LLM generation completed", {
        language,
        item: item.title,
        content_type: item.content_type,
        slot: item.slot
      });
    }

    logProgress("validation started", {
      language,
      generated_items: payload.items.length
    });

    assertValidDailyDropPayload(payload);

    logProgress("validation completed", {
      language,
      generated_items: payload.items.length
    });

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
  return {
    ...parseDryRunOptions(args),
    newsletterArticleCount: LLM_RUN_NEWSLETTER_ARTICLE_COUNT
  };
}

function plannedLlmItems(newsletterArticleCount: number): Array<{
  label: string;
  contentType: string;
}> {
  return [
    ...Array.from({ length: newsletterArticleCount }, (_, index) => ({
      label: `newsletter article ${index + 1}`,
      contentType: "newsletter_article"
    })),
    { label: "business story", contentType: "business_story" },
    { label: "mini-case", contentType: "mini_case" },
    { label: "concept", contentType: "concept" }
  ];
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[llm-run] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
