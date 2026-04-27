import {
  TOPIC_IDS,
  type DailyDropPayload,
  type DailyDropSlot,
  type Language,
  type TopicId,
  isLanguage,
  isTopicId
} from "../domain.js";
import { LlmContentGenerator } from "../generation/llmGenerator.js";
import { OpenAiJsonProvider } from "../generation/openAiProvider.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator } from "../generation/types.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import { assembleDailyDropPayload, selectDailyDropItemsForUser } from "../scheduler/dailyDropBuilder.js";
import { CURATED_SOURCES } from "../sources/curatedSources.js";
import { RssFeedConnector } from "../sources/rssFetcher.js";
import { SampleArticleConnector } from "../sources/sampleArticles.js";
import { SourceFetcher } from "../sources/sourceFetcher.js";
import type { SourceConnector } from "../sources/types.js";
import { ContentRepository } from "../storage/contentRepository.js";
import { serializePersistenceError } from "../storage/persistenceError.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { toDateOnly } from "../utils/date.js";
import { sha256 } from "../utils/hash.js";

const DEFAULT_USER_LIMIT = 5;
const MAX_USER_LIMIT = 25;
const DRY_RUN_NEWSLETTER_ARTICLE_COUNT = 4;
const LLM_NEWSLETTER_ARTICLE_COUNT = 1;
const RETRYABLE_STAGE_ATTEMPTS = 2;
const REQUIRED_SLOTS = ["newsletter", "business_story", "mini_case", "concept"] as const;

export type DailyJobTestOptions = {
  dropDate: string;
  languages: Language[];
  topics: TopicId[];
  newsletterArticleCount: number;
  liveRss: boolean;
  useLlm: boolean;
  userLimit: number;
};

type StoredItems = Awaited<ReturnType<ContentRepository["storeDailyPayload"]>>;

export type DailyJobTestOutput = {
  mode: "daily-job-test";
  confirmation: "CONFIRM_DAILY_JOB_TEST=true";
  persisted: true;
  generator: "dry-run" | "llm";
  liveRss: boolean;
  userLimit: number;
  languages: Array<{
    language: Language;
    testRunId: string;
    fetchedArticles: number;
    processedArticles: number;
    generatedItems: number;
    storedItems: number;
    usersConsidered: number;
    usersAssigned: number;
    usersSkippedExistingDrop: number;
    usersSkippedIncompleteSelection: number;
  }>;
};

export async function runDailyJobTest(options: DailyJobTestOptions): Promise<DailyJobTestOutput> {
  assertDailyJobTestEnvironment(options);

  logProgress("job started", {
    drop_date: options.dropDate,
    languages: options.languages,
    topics: options.topics,
    use_llm: options.useLlm,
    live_rss: options.liveRss,
    user_limit: options.userLimit,
    newsletter_articles: options.newsletterArticleCount
  });

  const sourceFetcher = new SourceFetcher(buildSourceConnectors(options.liveRss));
  const generator = createGenerator(options.useLlm);
  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );
  const languageResults: DailyJobTestOutput["languages"] = [];

  for (const language of options.languages) {
    const testRunId = buildTestRunId(options, language);

    logProgress("language started", {
      test_run_id: testRunId,
      language
    });

    const rawArticles = await runStage(
      "source fetch",
      {
        test_run_id: testRunId,
        language,
        topics: options.topics,
        live_rss: options.liveRss
      },
      () =>
        sourceFetcher.fetch({
          topics: options.topics,
          languages: [language],
          since: options.dropDate,
          limitPerTopic: 10
        })
    );

    const rankedArticles = await runStage(
      "processing",
      {
        test_run_id: testRunId,
        language,
        candidate_articles: rawArticles.length
      },
      async () => processArticles(rawArticles).filter((article) => article.language === language)
    );

    const payload = await runStage(
      "generation",
      {
        test_run_id: testRunId,
        language,
        generator: options.useLlm ? "llm" : "dry-run",
        source_articles: rankedArticles.length
      },
      async () =>
        assembleDailyDropPayload(
          await generator.generateDailyDrop({
            dropDate: options.dropDate,
            language,
            articles: rankedArticles,
            newsletterTopics: options.topics,
            newsletterArticleCount: options.newsletterArticleCount
          })
        )
    );

    const testPayload = markPayloadAsTestData(payload, testRunId);

    await runStage(
      "validation",
      {
        test_run_id: testRunId,
        language,
        generated_items: testPayload.items.length
      },
      async () => {
        assertValidDailyDropPayload(testPayload);
      }
    );

    await runStage(
      "persistence preflight",
      {
        test_run_id: testRunId,
        language,
        tables: ["generation_runs", "sources", "content_items", "content_item_sources", "topics"]
      },
      async () => {
        await repository.assertPersistTestSchemaReady(options.topics);
      }
    );

    const storedItems = await runStage(
      "persistence",
      {
        test_run_id: testRunId,
        language,
        generated_items: testPayload.items.length,
        content_status: "published"
      },
      async () =>
        repository.storeDailyPayload({
          payload: testPayload,
          articles: rankedArticles,
          contentStatus: "published",
          metadata: {
            is_test_data: true,
            test_mode: "daily-job-test",
            test_run_id: testRunId,
            test_label: "TEST DAILY JOB CONTENT - safe to inspect and delete manually",
            persisted_by: "services/content-engine npm run daily-job-test",
            safe_persistence_note:
              "Local daily-job-test data. Created only after CONFIRM_DAILY_JOB_TEST=true.",
            use_llm: options.useLlm,
            live_rss: options.liveRss
          }
        }),
      { maxAttempts: 1 }
    );

    const assignment = await runStage(
      "assignment",
      {
        test_run_id: testRunId,
        language,
        user_limit: options.userLimit,
        stored_items: storedItems.length
      },
      async () =>
        assignStoredDropToUsers({
          repository,
          storedItems,
          dropDate: testPayload.drop_date,
          language,
          userLimit: options.userLimit
        }),
      { maxAttempts: 1 }
    );

    languageResults.push({
      language,
      testRunId,
      fetchedArticles: rawArticles.length,
      processedArticles: rankedArticles.length,
      generatedItems: testPayload.items.length,
      storedItems: storedItems.length,
      usersConsidered: assignment.usersConsidered,
      usersAssigned: assignment.usersAssigned,
      usersSkippedExistingDrop: assignment.usersSkippedExistingDrop,
      usersSkippedIncompleteSelection: assignment.usersSkippedIncompleteSelection
    });

    logProgress("language completed", {
      test_run_id: testRunId,
      language,
      fetched_articles: rawArticles.length,
      processed_articles: rankedArticles.length,
      generated_items: testPayload.items.length,
      stored_items: storedItems.length,
      users_assigned: assignment.usersAssigned
    });
  }

  logProgress("job completed", {
    languages: languageResults.length,
    total_users_assigned: languageResults.reduce((sum, result) => sum + result.usersAssigned, 0)
  });

  return {
    mode: "daily-job-test",
    confirmation: "CONFIRM_DAILY_JOB_TEST=true",
    persisted: true,
    generator: options.useLlm ? "llm" : "dry-run",
    liveRss: options.liveRss,
    userLimit: options.userLimit,
    languages: languageResults
  };
}

export function parseDailyJobTestOptions(args: string[]): DailyJobTestOptions {
  const flags = readFlags(args);
  const useLlm = envFlag("USE_LLM");
  const topics = applyTopicLimit(parseTopics(flags.get("topics") ?? flags.get("topic") ?? TOPIC_IDS.join(",")));
  const explicitNewsletterCount = readPositiveInteger(flags.get("newsletter-count"), "--newsletter-count");
  const newsletterArticleCount =
    explicitNewsletterCount ?? Math.min(useLlm ? LLM_NEWSLETTER_ARTICLE_COUNT : DRY_RUN_NEWSLETTER_ARTICLE_COUNT, topics.length);

  return {
    dropDate: flags.get("date") ?? toDateOnly(new Date()),
    languages: parseLanguages(flags.get("languages") ?? flags.get("language") ?? "en"),
    topics,
    newsletterArticleCount,
    liveRss: envFlag("LIVE_RSS") || flags.has("live-rss"),
    useLlm,
    userLimit: parseUserLimit(process.env.USER_LIMIT)
  };
}

async function assignStoredDropToUsers(input: {
  repository: ContentRepository;
  storedItems: StoredItems;
  dropDate: string;
  language: Language;
  userLimit: number;
}): Promise<{
  usersConsidered: number;
  usersAssigned: number;
  usersSkippedExistingDrop: number;
  usersSkippedIncompleteSelection: number;
}> {
  const preferences = await input.repository.listUserDailyDropPreferences(input.language);
  const candidates = preferences.slice(0, input.userLimit);
  const existingDrops = await input.repository.listDailyDropsForUsersOnDate({
    userIds: candidates.map((preference) => preference.user_id),
    dropDate: input.dropDate
  });
  let usersAssigned = 0;
  let usersSkippedExistingDrop = 0;
  let usersSkippedIncompleteSelection = 0;

  for (const preference of candidates) {
    if (existingDrops.has(preference.user_id)) {
      usersSkippedExistingDrop += 1;
      continue;
    }

    const selection = selectDailyDropItemsForUser(preference, input.storedItems);
    const itemIds = completeSelection(selection.items, input.storedItems);

    if (!hasRequiredSlots(itemIds)) {
      usersSkippedIncompleteSelection += 1;
      continue;
    }

    await input.repository.createDailyDropForUser({
      userId: preference.user_id,
      dropDate: input.dropDate,
      language: input.language,
      status: "published",
      itemIds
    });
    usersAssigned += 1;
  }

  return {
    usersConsidered: candidates.length,
    usersAssigned,
    usersSkippedExistingDrop,
    usersSkippedIncompleteSelection
  };
}

function completeSelection(
  selected: Array<{
    contentItemId: string;
    slot: DailyDropSlot;
    position: number;
  }>,
  storedItems: StoredItems
): Array<{
  contentItemId: string;
  slot: DailyDropSlot;
  position: number;
}> {
  const completed = [...selected];

  for (const slot of REQUIRED_SLOTS) {
    if (completed.some((item) => item.slot === slot)) {
      continue;
    }

    const fallback = storedItems.find((stored) => stored.item.slot === slot);
    if (!fallback) {
      continue;
    }

    completed.push({
      contentItemId: fallback.content_item_id,
      slot,
      position: slot === "newsletter" ? nextNewsletterPosition(completed) : 0
    });
  }

  return completed;
}

function hasRequiredSlots(
  itemIds: Array<{
    slot: DailyDropSlot;
  }>
): boolean {
  const slots = new Set(itemIds.map((item) => item.slot));
  return REQUIRED_SLOTS.every((slot) => slots.has(slot));
}

function nextNewsletterPosition(
  selected: Array<{
    slot: DailyDropSlot;
    position: number;
  }>
): number {
  const newsletterPositions = selected.filter((item) => item.slot === "newsletter").map((item) => item.position);
  return newsletterPositions.length === 0 ? 0 : Math.max(...newsletterPositions) + 1;
}

async function runStage<T>(
  stage: string,
  details: Record<string, unknown>,
  action: () => Promise<T>,
  options: {
    maxAttempts?: number;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RETRYABLE_STAGE_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logProgress(`${stage} started`, {
      ...details,
      attempt,
      max_attempts: maxAttempts
    });

    try {
      const result = await action();
      logProgress(`${stage} completed`, {
        ...details,
        attempt,
        max_attempts: maxAttempts
      });
      return result;
    } catch (error) {
      lastError = error;
      logProgress(`${stage} failed`, {
        ...details,
        attempt,
        max_attempts: maxAttempts,
        error: serializePersistenceError(error)
      });

      if (attempt < maxAttempts) {
        logProgress(`${stage} retrying`, {
          ...details,
          next_attempt: attempt + 1,
          max_attempts: maxAttempts
        });
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function createGenerator(useLlm: boolean): ContentGenerator {
  if (!useLlm) {
    return new StructuredContentGenerator();
  }

  return new LlmContentGenerator({
    provider: new OpenAiJsonProvider(),
    onProgress: (message, details) => logProgress(message, details)
  });
}

function buildSourceConnectors(liveRss: boolean): SourceConnector[] {
  const connectors: SourceConnector[] = [new SampleArticleConnector()];

  if (liveRss) {
    connectors.push(new RssFeedConnector(CURATED_SOURCES));
  }

  return connectors;
}

function markPayloadAsTestData(payload: DailyDropPayload, testRunId: string): DailyDropPayload {
  return {
    ...payload,
    generator_version: `${payload.generator_version}_daily_job_test`,
    items: payload.items.map((item) => ({
      ...item,
      title: `[TEST daily-job-test] ${item.title}`
    }))
  };
}

function buildTestRunId(options: DailyJobTestOptions, language: Language): string {
  return `daily-job-test-${sha256(
    [options.dropDate, language, options.useLlm ? "llm" : "dry-run", options.liveRss ? "live-rss" : "sample", ...options.topics].join("|")
  ).slice(0, 12)}`;
}

function assertDailyJobTestEnvironment(options: DailyJobTestOptions): void {
  const missing = [
    process.env.SUPABASE_URL ? null : "SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY",
    process.env.CONFIRM_DAILY_JOB_TEST === "true" ? null : "CONFIRM_DAILY_JOB_TEST=true",
    options.useLlm && !process.env.OPENAI_API_KEY ? "OPENAI_API_KEY when USE_LLM=true" : null
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `daily-job-test refused to write because the following required setting(s) are missing: ${missing.join(", ")}.`,
      "This command persists published test content and assigns daily drops to a limited set of app users.",
      "To run it intentionally, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CONFIRM_DAILY_JOB_TEST=true.",
      "Use USER_LIMIT=5 or lower for local checks, and use a local or disposable Supabase project by default."
    ].join(" ")
  );
}

function applyTopicLimit(topics: TopicId[]): TopicId[] {
  const topicLimit = readPositiveInteger(process.env.TOPIC_LIMIT, "TOPIC_LIMIT");
  return topicLimit ? topics.slice(0, topicLimit) : topics;
}

function parseUserLimit(value: string | undefined): number {
  const parsed = readPositiveInteger(value, "USER_LIMIT") ?? DEFAULT_USER_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_USER_LIMIT));
}

function readPositiveInteger(value: string | undefined, label: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
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
  process.stderr.write(`[daily-job-test] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
