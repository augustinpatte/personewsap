import {
  LANGUAGES,
  MINI_CASE_TOPIC_IDS,
  isLanguage,
  isMiniCaseTopicId,
  type Language,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import {
  DEFAULT_BUSINESS_STORY_COUNT,
  DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
  runBootstrapCatalog,
  type BootstrapCatalogOptions,
  type BootstrapCatalogOutput
} from "../catalog/bootstrapCatalog.js";
import { LlmContentGenerator } from "../generation/llmGenerator.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator } from "../generation/types.js";
import { processArticles } from "../processing/pipeline.js";
import { CURATED_SOURCES } from "../sources/curatedSources.js";
import { RssFeedConnector } from "../sources/rssFetcher.js";
import { SampleArticleConnector } from "../sources/sampleArticles.js";
import { SourceFetcher } from "../sources/sourceFetcher.js";
import type { SourceConnector } from "../sources/types.js";
import { ContentRepository } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { toDateOnly } from "../utils/date.js";

/**
 * `bootstrap-catalog` CLI.
 *
 * Default mode is NO-WRITE. Persisting the catalog needs both an explicit
 * `--persist` (or PERSIST_BOOTSTRAP_CATALOG=true) and the confirmation env var
 * CONFIRM_BOOTSTRAP_CATALOG=true, matching how persist-test and daily-job-test
 * already gate writes in this engine.
 */
export type BootstrapCatalogCliOptions = BootstrapCatalogOptions & {
  liveRss: boolean;
  liveRssOnly: boolean;
  sourceLimitPerTopic: number;
};

export async function runBootstrapCatalogCli(
  options: BootstrapCatalogCliOptions
): Promise<BootstrapCatalogOutput> {
  const connectors: SourceConnector[] = [];
  if (!options.liveRssOnly) {
    connectors.push(new SampleArticleConnector());
  }
  if (options.liveRss) {
    connectors.push(new RssFeedConnector(CURATED_SOURCES));
  }

  const sourceFetcher = new SourceFetcher(connectors);
  const generator = createGenerator(options.useLlm);
  const repository = options.persist
    ? new ContentRepository(createServiceRoleSupabaseClient({ requireCredentials: true }))
    : undefined;

  logProgress("bootstrap catalog started", {
    dry_run: !options.persist,
    persist: options.persist,
    languages: options.languages,
    business_story_count: options.businessStoryCount,
    mini_case_count_per_topic: options.miniCaseCountPerTopic,
    mini_case_topics: options.miniCaseTopics,
    generator: options.useLlm ? "llm" : "deterministic",
    live_rss: options.liveRss,
    live_rss_only: options.liveRssOnly,
    sample_content_enabled: !options.liveRssOnly
  });

  const articleCache = new Map<Language, RankedArticle[]>();

  return runBootstrapCatalog(options, {
    generator,
    repository,
    loadArticles: async (language) => {
      const cached = articleCache.get(language);
      if (cached) {
        return cached;
      }

      const raw = await sourceFetcher.fetch({
        topics: SOURCE_TOPICS,
        languages: [language],
        since: options.dropDate,
        limitPerTopic: options.sourceLimitPerTopic
      });
      const ranked = processArticles(raw).filter((article) => article.language === language);
      articleCache.set(language, ranked);

      logProgress("source pool ready", {
        language,
        fetched_articles: raw.length,
        ranked_articles: ranked.length
      });

      return ranked;
    }
  });
}

const SOURCE_TOPICS: TopicId[] = [
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering"
];

export function parseBootstrapCatalogOptions(args: string[]): BootstrapCatalogCliOptions {
  const flags = readFlags(args);
  const persistRequested = flags.has("persist") || envFlag("PERSIST_BOOTSTRAP_CATALOG");
  const confirmed = process.env.CONFIRM_BOOTSTRAP_CATALOG === "true";

  if (persistRequested && !confirmed) {
    throw new Error(
      "bootstrap-catalog refused to persist. Writes require CONFIRM_BOOTSTRAP_CATALOG=true together with --persist. Run without --persist for the default no-write dry run."
    );
  }

  const languages = parseLanguages(
    flags.get("languages") ?? flags.get("language") ?? process.env.LANGUAGES ?? "fr,en"
  );
  const miniCaseTopics = parseMiniCaseTopics(
    flags.get("mini-case-topics") ?? process.env.MINI_CASE_TOPICS ?? MINI_CASE_TOPIC_IDS.join(",")
  );
  const businessStoryCount = parseCount(
    flags.get("business-story-count") ?? process.env.BUSINESS_STORY_COUNT,
    DEFAULT_BUSINESS_STORY_COUNT,
    "BUSINESS_STORY_COUNT"
  );
  const miniCaseCountPerTopic = parseCount(
    flags.get("mini-case-count") ?? process.env.MINI_CASE_COUNT_PER_TOPIC,
    DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
    "MINI_CASE_COUNT_PER_TOPIC"
  );
  const liveRssOnly = flags.has("live-rss-only") || envFlag("LIVE_RSS_ONLY");
  const dropDate = flags.get("date") ?? toDateOnly(new Date());

  return {
    dropDate,
    languages,
    businessStoryCount,
    miniCaseCountPerTopic,
    miniCaseTopics,
    persist: persistRequested && confirmed,
    contentStatus: parseContentStatus(process.env.CONTENT_STATUS ?? "review"),
    runId: process.env.BOOTSTRAP_RUN_ID || flags.get("run-id") || `bootstrap-catalog-${dropDate}`,
    useLlm: envFlag("USE_LLM") || flags.has("llm"),
    liveRss: liveRssOnly || envFlag("LIVE_RSS") || flags.has("live-rss"),
    liveRssOnly,
    sourceLimitPerTopic: parseCount(
      flags.get("limit-per-topic") ?? process.env.RSS_ARTICLES_PER_SOURCE,
      10,
      "--limit-per-topic"
    )
  };
}

function createGenerator(useLlm: boolean): ContentGenerator {
  if (!useLlm) {
    return new StructuredContentGenerator();
  }

  return new LlmContentGenerator({
    onProgress: (message, details) => logProgress(message, details)
  });
}

function parseLanguages(value: string): Language[] {
  const languages = value.split(",").map((language) => language.trim()).filter(Boolean);

  if (languages.length === 0 || languages.some((language) => !isLanguage(language))) {
    throw new Error(`LANGUAGES must be a comma-separated list of: ${LANGUAGES.join(", ")}.`);
  }

  return languages as Language[];
}

function parseMiniCaseTopics(value: string): MiniCaseTopicId[] {
  const topics = value.split(",").map((topic) => topic.trim()).filter(Boolean);

  if (topics.length === 0 || topics.some((topic) => !isMiniCaseTopicId(topic))) {
    throw new Error(`MINI_CASE_TOPICS must be a comma-separated list of: ${MINI_CASE_TOPIC_IDS.join(", ")}.`);
  }

  return topics as MiniCaseTopicId[];
}

function parseCount(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

function parseContentStatus(value: string): BootstrapCatalogOptions["contentStatus"] {
  if (value === "draft" || value === "review" || value === "published") {
    return value;
  }

  throw new Error("CONTENT_STATUS must be draft, review, or published.");
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

function envFlag(name: string): boolean {
  return process.env[name]?.toLowerCase() === "true";
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[bootstrap-catalog] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
