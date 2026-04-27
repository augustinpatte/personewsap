import { TOPIC_IDS, type DailyDropPayload, type Language, type TopicId, isLanguage, isTopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import { RssFeedConnector } from "../sources/rssFetcher.js";
import { SampleArticleConnector } from "../sources/sampleArticles.js";
import { SourceFetcher } from "../sources/sourceFetcher.js";
import { CURATED_SOURCES } from "../sources/curatedSources.js";
import type { SourceConnector } from "../sources/types.js";
import { toDateOnly } from "../utils/date.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";

export type DryRunOptions = {
  dropDate: string;
  languages: Language[];
  topics: TopicId[];
  newsletterArticleCount: number;
  liveRss: boolean;
};

export type DryRunOutput = {
  mode: "dry-run";
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

export async function runDryRun(options: DryRunOptions): Promise<DryRunOutput> {
  const connectors: SourceConnector[] = [new SampleArticleConnector()];

  if (options.liveRss) {
    connectors.push(new RssFeedConnector(CURATED_SOURCES));
  }

  const sourceFetcher = new SourceFetcher(connectors);
  const generator = new StructuredContentGenerator();
  const diagnostics: DryRunOutput["diagnostics"] = [];
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
    mode: "dry-run",
    persisted: false,
    diagnostics,
    drops
  };
}

export function parseDryRunOptions(args: string[]): DryRunOptions {
  const values = readFlags(args);
  const languages = parseLanguages(values.get("languages") ?? values.get("language") ?? "en");
  const topics = parseTopics(values.get("topics") ?? values.get("topic") ?? "business,finance,tech_ai,law,medicine");
  const newsletterArticleCount = Number(values.get("newsletter-count") ?? "4");

  if (!Number.isInteger(newsletterArticleCount) || newsletterArticleCount < 1) {
    throw new Error("--newsletter-count must be a positive integer.");
  }

  return {
    dropDate: values.get("date") ?? toDateOnly(new Date()),
    languages,
    topics,
    newsletterArticleCount,
    liveRss: values.has("live-rss")
  };
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = args[index + 1];

    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
      continue;
    }

    if (!nextValue || nextValue.startsWith("--")) {
      values.set(rawKey, "true");
      continue;
    }

    values.set(rawKey, nextValue);
    index += 1;
  }

  return values;
}

function parseLanguages(value: string): Language[] {
  const languages = value.split(",").map((language) => language.trim()).filter(Boolean);
  if (languages.length === 0 || languages.some((language) => !isLanguage(language))) {
    throw new Error("--languages must contain fr, en, or both as a comma-separated list.");
  }

  return languages as Language[];
}

function parseTopics(value: string): TopicId[] {
  const topics = value.split(",").map((topic) => topic.trim()).filter(Boolean);
  if (topics.length === 0 || topics.some((topic) => !isTopicId(topic))) {
    throw new Error(`--topics must use approved topic IDs: ${TOPIC_IDS.join(", ")}.`);
  }

  return topics as TopicId[];
}
