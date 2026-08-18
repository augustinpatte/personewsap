import { NEWSLETTER_ITEMS_PER_TOPIC, TOPIC_IDS, type Language, type TopicId } from "../domain.js";
import type { ContentGenerator } from "../generation/types.js";
import type { SourceFetcher } from "../sources/sourceFetcher.js";
import type { ContentRepository } from "../storage/contentRepository.js";
import { runDailyJob } from "../cli/dailyJobTest.js";

export type DailyContentJobOptions = {
  dropDate: string;
  languages: Language[];
  topics?: TopicId[];
  newsletterArticleCount?: number;
  publish?: boolean;
  persist?: boolean;
};

export type DailyContentJobResult = {
  dropDate: string;
  languages: Array<{
    language: Language;
    fetchedArticles: number;
    processedArticles: number;
    generatedItems: number;
    storedItems: number;
    userDropsCreated: number;
  }>;
};

/**
 * Compatibility wrapper for the old programmatic API.
 *
 * Production has exactly one implementation: `runDailyJob`, the same function
 * called by `npm run content:prod-run`. This class remains only so older
 * callers of `createContentEngine().runDailyContentJob(...)` do not get a
 * second, divergent scheduler.
 */
export class DailyContentJob {
  constructor(
    private readonly sourceFetcher: Pick<SourceFetcher, "fetch">,
    private readonly generator: ContentGenerator,
    private readonly repository?: ContentRepository
  ) {}

  async run(options: DailyContentJobOptions): Promise<DailyContentJobResult> {
    const topics = options.topics ?? [...TOPIC_IDS];
    const output = await runDailyJob(
      {
        mode: "daily-job",
        dropDate: options.dropDate,
        languages: options.languages,
        topics,
        newsletterArticleCount: options.newsletterArticleCount ?? topics.length * NEWSLETTER_ITEMS_PER_TOPIC,
        liveRss: envFlag("LIVE_RSS"),
        liveRssOnly: envFlag("LIVE_RSS_ONLY"),
        useLlm: envFlag("USE_LLM"),
        userLimit: null,
        contentStatus: options.publish ? "published" : "review",
        dryRun: options.persist !== true,
        testMode: false,
        logPrefix: "daily-job",
        productionConfirmed: envFlag("PRODUCTION_DAILY_JOB"),
        strictAllLanguages: envFlag("STRICT_ALL_LANGUAGES"),
        runId: process.env.RUN_ID
      },
      {
        sourceFetcher: this.sourceFetcher,
        sourceConnectors: [],
        generator: this.generator,
        repository: this.repository
      }
    );

    return {
      dropDate: options.dropDate,
      languages: output.languages.map((language) => ({
        language: language.language,
        fetchedArticles: language.fetchedArticles,
        processedArticles: language.processedArticles,
        generatedItems: language.generatedItems,
        storedItems: language.storedItems,
        userDropsCreated: language.usersCreated
      }))
    };
  }
}

function envFlag(name: string): boolean {
  return process.env[name]?.toLowerCase() === "true";
}
