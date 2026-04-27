import type { DailyDropPayload, DailyDropSlot, Language, TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { SampleArticleConnector } from "../sources/sampleArticles.js";
import { SourceFetcher } from "../sources/sourceFetcher.js";
import { ContentRepository } from "../storage/contentRepository.js";
import { serializePersistenceError } from "../storage/persistenceError.js";
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
    content_status: "draft" | "published";
    user_daily_drops_created: number;
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
  const testUserId = getOptionalTestUserId();
  const contentStatus = testUserId ? "published" : "draft";

  logProgress("starting safe persistence test", {
    test_run_id: testRunId,
    drop_date: runOptions.dropDate,
    language,
    newsletter_articles: PERSIST_TEST_NEWSLETTER_ARTICLE_COUNT,
    content_status: contentStatus,
    test_user_id: testUserId ?? null,
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
    content_status: contentStatus
  });

  logProgress("persistence preflight started", {
    test_run_id: testRunId,
    tables: ["generation_runs", "sources", "content_items", "content_item_sources", "topics"]
  });

  try {
    await repository.assertPersistTestSchemaReady(runOptions.topics);
  } catch (error) {
    logProgress("persistence preflight failed", {
      test_run_id: testRunId,
      error: serializePersistenceError(error)
    });
    throw error;
  }

  logProgress("persistence preflight completed", {
    test_run_id: testRunId
  });

  let stored: Awaited<ReturnType<ContentRepository["storeDailyPayload"]>>;

  try {
    stored = await repository.storeDailyPayload({
      payload: testPayload,
      articles: rankedArticles,
      contentStatus,
      metadata: {
        is_test_data: true,
        test_mode: "persist-test",
        test_run_id: testRunId,
        test_label: "TEST CONTENT - safe to delete with npm run cleanup-test",
        persisted_by: "services/content-engine npm run persist-test",
        safe_persistence_note:
          "Local persistence test data. Safe to delete after verification with npm run cleanup-test."
      }
    });
  } catch (error) {
    logProgress("persistence failed", {
      test_run_id: testRunId,
      error: serializePersistenceError(error)
    });
    throw error;
  }

  let userDailyDropsCreated = 0;

  if (testUserId) {
    logProgress("test user daily drop assignment started", {
      test_run_id: testRunId,
      test_user_id: testUserId,
      drop_date: testPayload.drop_date,
      linked_items: stored.length,
      daily_drop_status: "published"
    });

    try {
      await repository.createDailyDropForUser({
        userId: testUserId,
        dropDate: testPayload.drop_date,
        language: testPayload.language,
        status: "published",
        itemIds: buildDailyDropItemLinks(stored)
      });
      userDailyDropsCreated = 1;
    } catch (error) {
      logProgress("test user daily drop assignment failed", {
        test_run_id: testRunId,
        test_user_id: testUserId,
        error: serializePersistenceError(error)
      });
      throw error;
    }

    logProgress("test user daily drop assignment completed", {
      test_run_id: testRunId,
      test_user_id: testUserId,
      user_daily_drops_created: userDailyDropsCreated
    });
  } else {
    logProgress("no test user daily drop created", {
      test_run_id: testRunId,
      reason: "TEST_USER_ID is not set. Set TEST_USER_ID to assign this test drop to exactly one user."
    });
  }

  logProgress("persistence completed", {
    test_run_id: testRunId,
    stored_items: stored.length,
    user_daily_drops_created: userDailyDropsCreated
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
      content_status: contentStatus,
      user_daily_drops_created: userDailyDropsCreated
    },
    storedContentItems: stored.map((storedItem) => ({
      content_item_id: storedItem.content_item_id,
      content_type: storedItem.item.content_type,
      slot: storedItem.item.slot,
      title: storedItem.item.title
    }))
  };
}

function getOptionalTestUserId(): string | null {
  const testUserId = process.env.TEST_USER_ID?.trim();
  return testUserId && testUserId.length > 0 ? testUserId : null;
}

function buildDailyDropItemLinks(
  stored: Awaited<ReturnType<ContentRepository["storeDailyPayload"]>>
): Array<{
  contentItemId: string;
  slot: DailyDropSlot;
  position: number;
}> {
  const nextPositionBySlot = new Map<DailyDropSlot, number>();

  return stored.map((storedItem) => {
    const slot = storedItem.item.slot;
    const position = nextPositionBySlot.get(slot) ?? 0;
    nextPositionBySlot.set(slot, position + 1);

    return {
      contentItemId: storedItem.content_item_id,
      slot,
      position
    };
  });
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
      title: `[TEST persist-test] ${item.title}`
    }))
  };
}

function buildTestRunId(dropDate: string, language: Language, topics: TopicId[]): string {
  return `persist-test-${sha256([dropDate, language, ...topics].join("|")).slice(0, 12)}`;
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[persist-test] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
