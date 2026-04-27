import type { DailyDropPayload, Language, TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { SampleArticleConnector } from "../sources/sampleArticles.js";
import { SourceFetcher } from "../sources/sourceFetcher.js";
import { ContentRepository } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { sha256 } from "../utils/hash.js";
import { parseDryRunOptions, type DryRunOptions } from "./dryRun.js";

const PERSIST_TEST_NEWSLETTER_ARTICLE_COUNT = 1;

type PersistTestOptions = DryRunOptions;

export type PersistTestOutput = {
  mode: "persist-test";
  persisted: true;
  confirmation: "CONFIRM_PERSIST_TEST=true";
  testRunId: string;
  drop: {
    drop_date: string;
    language: Language;
    generated_items: number;
    stored_items: number;
    content_status: "draft";
    user_daily_drops_created: 0;
  };
  storedContentItems: Array<{
    content_item_id: string;
    content_type: string;
    slot: string;
    title: string;
  }>;
};

export async function runPersistTest(options: PersistTestOptions): Promise<PersistTestOutput> {
  assertPersistTestEnvironment();

  const runOptions: PersistTestOptions = {
    ...options,
    languages: [options.languages[0]],
    newsletterArticleCount: PERSIST_TEST_NEWSLETTER_ARTICLE_COUNT,
    liveRss: false
  };
  const language = runOptions.languages[0];
  const testRunId = buildTestRunId(runOptions.dropDate, language, runOptions.topics);

  logProgress("starting safe persistence test", {
    test_run_id: testRunId,
    drop_date: runOptions.dropDate,
    language,
    newsletter_articles: PERSIST_TEST_NEWSLETTER_ARTICLE_COUNT,
    content_status: "draft",
    live_rss: false
  });

  const sourceFetcher = new SourceFetcher([new SampleArticleConnector()]);
  const generator = new StructuredContentGenerator();
  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );

  logProgress("source fetch started", {
    test_run_id: testRunId,
    language,
    topics: runOptions.topics
  });

  const rawArticles = await sourceFetcher.fetch({
    topics: runOptions.topics,
    languages: [language],
    since: runOptions.dropDate,
    limitPerTopic: 10
  });

  logProgress("source fetch completed", {
    test_run_id: testRunId,
    fetched_articles: rawArticles.length
  });

  logProgress("processing started", {
    test_run_id: testRunId,
    candidate_articles: rawArticles.length
  });

  const rankedArticles = processArticles(rawArticles).filter((article) => article.language === language);

  logProgress("processing completed", {
    test_run_id: testRunId,
    processed_articles: rankedArticles.length
  });

  const payload = assembleDailyDropPayload(
    await generator.generateDailyDrop({
      dropDate: runOptions.dropDate,
      language,
      articles: rankedArticles,
      newsletterTopics: runOptions.topics,
      newsletterArticleCount: runOptions.newsletterArticleCount
    })
  );

  const testPayload = markPayloadAsTestData(payload);

  logProgress("validation started", {
    test_run_id: testRunId,
    generated_items: testPayload.items.length
  });

  assertValidDailyDropPayload(testPayload);

  logProgress("validation completed", {
    test_run_id: testRunId,
    generated_items: testPayload.items.length
  });

  logProgress("persistence started", {
    test_run_id: testRunId,
    generated_items: testPayload.items.length,
    content_status: "draft"
  });

  const stored = await repository.storeDailyPayload({
    payload: testPayload,
    articles: rankedArticles,
    contentStatus: "draft",
    metadata: {
      is_test_data: true,
      test_mode: "persist-test",
      test_run_id: testRunId,
      persisted_by: "services/content-engine npm run persist-test",
      safe_persistence_note:
        "Local persistence test data. Safe to delete after verification."
    }
  });

  logProgress("persistence completed", {
    test_run_id: testRunId,
    stored_items: stored.length,
    user_daily_drops_created: 0
  });

  return {
    mode: "persist-test",
    persisted: true,
    confirmation: "CONFIRM_PERSIST_TEST=true",
    testRunId,
    drop: {
      drop_date: testPayload.drop_date,
      language: testPayload.language,
      generated_items: testPayload.items.length,
      stored_items: stored.length,
      content_status: "draft",
      user_daily_drops_created: 0
    },
    storedContentItems: stored.map((storedItem) => ({
      content_item_id: storedItem.content_item_id,
      content_type: storedItem.item.content_type,
      slot: storedItem.item.slot,
      title: storedItem.item.title
    }))
  };
}

export function parsePersistTestOptions(args: string[]): PersistTestOptions {
  return {
    ...parseDryRunOptions(args),
    newsletterArticleCount: PERSIST_TEST_NEWSLETTER_ARTICLE_COUNT,
    liveRss: false
  };
}

function assertPersistTestEnvironment(): void {
  const missing = [
    process.env.SUPABASE_URL ? null : "SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY",
    process.env.CONFIRM_PERSIST_TEST === "true" ? null : "CONFIRM_PERSIST_TEST=true"
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `persist-test refused to write because the following required setting(s) are missing: ${missing.join(", ")}.`,
      "This command writes draft test content to the configured Supabase project.",
      "To run it intentionally, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CONFIRM_PERSIST_TEST=true.",
      "Use a local or disposable Supabase project. Do not point this command at production unless you are deliberately testing production persistence."
    ].join(" ")
  );
}

function markPayloadAsTestData(payload: DailyDropPayload): DailyDropPayload {
  return {
    ...payload,
    generator_version: `${payload.generator_version}_persist_test`,
    items: payload.items.map((item) => ({
      ...item,
      title: `[TEST] ${item.title}`
    }))
  };
}

function buildTestRunId(dropDate: string, language: Language, topics: TopicId[]): string {
  return `persist-test-${sha256([dropDate, language, ...topics].join("|")).slice(0, 12)}`;
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[persist-test] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
