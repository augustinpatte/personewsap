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
const DEFAULT_LANGUAGES = "fr,en";
const DRY_RUN_NEWSLETTER_ARTICLE_COUNT = 4;
const LLM_NEWSLETTER_ARTICLE_COUNT = 1;
const RETRYABLE_STAGE_ATTEMPTS = 2;
const REQUIRED_SLOTS = ["newsletter", "business_story", "mini_case", "concept"] as const;
const CONTENT_STATUSES = ["draft", "review", "published"] as const;

type DailyJobContentStatus = (typeof CONTENT_STATUSES)[number];
type DailyJobMode = "daily-job" | "daily-job-test";

export type DailyJobRunOptions = {
  mode: DailyJobMode;
  dropDate: string;
  languages: Language[];
  topics: TopicId[];
  newsletterArticleCount: number;
  liveRss: boolean;
  useLlm: boolean;
  userLimit: number | null;
  contentStatus: DailyJobContentStatus;
  dryRun: boolean;
  testMode: boolean;
  logPrefix: string;
};

export type DailyJobTestOptions = {
  dropDate: string;
  languages: Language[];
  topics: TopicId[];
  newsletterArticleCount: number;
  liveRss: boolean;
  useLlm: boolean;
  userLimit: number;
  contentStatus: DailyJobContentStatus;
};

type StoredItems = Awaited<ReturnType<ContentRepository["storeDailyPayload"]>>;

export type DailyJobOutput = {
  mode: DailyJobMode;
  confirmation?: "CONFIRM_DAILY_JOB_TEST=true";
  persisted: boolean;
  dryRun: boolean;
  status: "completed" | "completed_with_failures" | "failed";
  generator: "dry-run" | "llm";
  liveRss: boolean;
  userLimit: number | null;
  contentStatus: DailyJobContentStatus;
  summary: {
    languagesRequested: number;
    languagesSucceeded: number;
    languagesFailed: number;
    totalFetchedArticles: number;
    totalProcessedArticles: number;
    totalGeneratedItems: number;
    totalStoredItems: number;
    totalUsersConsidered: number;
    totalUsersAssigned: number;
    totalUsersCreated: number;
    totalUsersUpdatedExistingDrop: number;
    totalUsersSkippedBeforeAssignment: number;
    totalUsersSkippedExistingDrop: number;
    totalUsersSkippedIncompleteSelection: number;
    totalStaleDailyDropItemsRemoved: number;
    totalDuplicateDailyDropItemsSkipped: number;
  };
  languages: Array<{
    language: Language;
    status: "completed" | "failed";
    testRunId: string;
    fetchedArticles: number;
    processedArticles: number;
    generatedItems: number;
    storedItems: number;
    usersConsidered: number;
    usersAssigned: number;
    usersCreated: number;
    usersUpdatedExistingDrop: number;
    usersSkippedBeforeAssignment: number;
    usersSkippedExistingDrop: number;
    usersSkippedIncompleteSelection: number;
    staleDailyDropItemsRemoved: number;
    duplicateDailyDropItemsSkipped: number;
    assignmentSkippedReason: string | null;
    error: string | null;
  }>;
};

export type DailyJobTestOutput = DailyJobOutput & {
  mode: "daily-job-test";
  confirmation: "CONFIRM_DAILY_JOB_TEST=true";
  persisted: true;
  dryRun: false;
};

type DailyJobLanguageResult = DailyJobOutput["languages"][number];

export async function runDailyJobTest(options: DailyJobTestOptions): Promise<DailyJobTestOutput> {
  const output = await runDailyJob({
    ...options,
    mode: "daily-job-test",
    dryRun: false,
    testMode: true,
    logPrefix: "daily-job-test"
  });

  return {
    ...output,
    mode: "daily-job-test",
    confirmation: "CONFIRM_DAILY_JOB_TEST=true",
    persisted: true,
    dryRun: false
  };
}

export async function runDailyJob(options: DailyJobRunOptions): Promise<DailyJobOutput> {
  assertDailyJobEnvironment(options);

  logProgress("job started", {
    drop_date: options.dropDate,
    languages: options.languages,
    topics: options.topics,
    use_llm: options.useLlm,
    live_rss: options.liveRss,
    user_limit: options.userLimit ?? "all",
    newsletter_articles: options.newsletterArticleCount,
    content_status: options.contentStatus,
    dry_run: options.dryRun
  }, options.logPrefix);

  const sourceFetcher = new SourceFetcher(buildSourceConnectors(options.liveRss));
  const generator = createGenerator(options.useLlm, options.logPrefix);
  const repository = options.dryRun
    ? undefined
    : new ContentRepository(
        createServiceRoleSupabaseClient({
          requireCredentials: true
        })
      );
  const languageResults: DailyJobLanguageResult[] = [];

  for (const language of options.languages) {
    const testRunId = buildRunId(options, language);

    try {
      languageResults.push(
        await runDailyJobLanguage({
          generator,
          language,
          options,
          repository,
          sourceFetcher,
          testRunId
        })
      );
    } catch (error) {
      const serializedError = serializePersistenceError(error);
      languageResults.push(emptyFailedLanguageResult(language, testRunId, serializedError.message));
      logProgress("language failed", {
        test_run_id: testRunId,
        language,
        error: serializedError
      }, options.logPrefix);
    }
  }

  const summary = summarizeLanguageResults(languageResults);
  const status =
    summary.languagesFailed === 0
      ? "completed"
      : summary.languagesSucceeded === 0
        ? "failed"
        : "completed_with_failures";

  logProgress("job completed", {
    status,
    ...toLogSummary(summary)
  }, options.logPrefix);

  if (status !== "completed") {
    process.exitCode = 1;
  }

  return {
    mode: options.mode,
    confirmation: options.testMode ? "CONFIRM_DAILY_JOB_TEST=true" : undefined,
    persisted: !options.dryRun,
    dryRun: options.dryRun,
    status,
    generator: options.useLlm ? "llm" : "dry-run",
    liveRss: options.liveRss,
    userLimit: options.userLimit,
    contentStatus: options.contentStatus,
    summary,
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
    languages: parseLanguages(flags.get("languages") ?? flags.get("language") ?? process.env.LANGUAGES ?? DEFAULT_LANGUAGES),
    topics,
    newsletterArticleCount,
    liveRss: envFlag("LIVE_RSS") || flags.has("live-rss"),
    useLlm,
    userLimit: parseUserLimit(process.env.USER_LIMIT),
    contentStatus: parseContentStatus(process.env.CONTENT_STATUS ?? "published")
  };
}

export function parseDailyJobOptions(args: string[]): DailyJobRunOptions {
  const flags = readFlags(args);
  const useLlm = envFlag("USE_LLM") || flags.has("llm");
  const topics = applyTopicLimit(parseTopics(flags.get("topics") ?? flags.get("topic") ?? TOPIC_IDS.join(",")));
  const explicitNewsletterCount = readPositiveInteger(flags.get("newsletter-count"), "--newsletter-count");
  const newsletterArticleCount =
    explicitNewsletterCount ?? Math.min(useLlm ? LLM_NEWSLETTER_ARTICLE_COUNT : DRY_RUN_NEWSLETTER_ARTICLE_COUNT, topics.length);

  return {
    mode: "daily-job",
    dropDate: flags.get("date") ?? toDateOnly(new Date()),
    languages: parseLanguages(flags.get("languages") ?? flags.get("language") ?? process.env.LANGUAGES ?? DEFAULT_LANGUAGES),
    topics,
    newsletterArticleCount,
    liveRss: envFlag("LIVE_RSS") || flags.has("live-rss"),
    useLlm,
    userLimit: parseOptionalUserLimit(process.env.USER_LIMIT),
    contentStatus: parseContentStatus(process.env.CONTENT_STATUS ?? "published"),
    dryRun: envFlag("DRY_RUN") || flags.has("dry-run"),
    testMode: false,
    logPrefix: "daily-job"
  };
}

async function runDailyJobLanguage(input: {
  generator: ContentGenerator;
  language: Language;
  options: DailyJobRunOptions;
  repository: ContentRepository | undefined;
  sourceFetcher: SourceFetcher;
  testRunId: string;
}): Promise<DailyJobLanguageResult> {
  const { generator, language, options, repository, sourceFetcher, testRunId } = input;

  logProgress("language started", {
    test_run_id: testRunId,
    language,
    content_status: options.contentStatus,
    dry_run: options.dryRun
  }, options.logPrefix);

  const rawArticles = await runStage(
    "source fetch",
    {
      test_run_id: testRunId,
      language,
      topics: options.topics,
      live_rss: options.liveRss
    },
    async () => {
      const articles = await sourceFetcher.fetch({
        topics: options.topics,
        languages: [language],
        since: options.dropDate,
        limitPerTopic: 10
      });

      if (articles.length === 0) {
        throw new Error(
          "Source fetch produced zero articles. Refusing to generate because all configured sources failed or returned no usable items."
        );
      }

      return articles;
    },
    { logPrefix: options.logPrefix }
  );

  const rankedArticles = await runStage(
    "processing",
    {
      test_run_id: testRunId,
      language,
      candidate_articles: rawArticles.length
    },
    async () => processArticles(rawArticles).filter((article) => article.language === language),
    { logPrefix: options.logPrefix }
  );

  if (rankedArticles.length === 0) {
    throw new Error(`Processing produced zero ranked ${language} articles. Check source language coverage and topic filters.`);
  }

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
      ),
    { logPrefix: options.logPrefix }
  );

  const jobPayload = options.testMode ? markPayloadAsTestData(payload, testRunId) : payload;

  await runStage(
    "validation",
    {
      test_run_id: testRunId,
      language,
      generated_items: jobPayload.items.length
    },
    async () => {
      assertValidDailyDropPayload(jobPayload);
    },
    { logPrefix: options.logPrefix }
  );

  let storedItems: StoredItems = [];

  if (options.dryRun) {
    logProgress("persistence skipped", {
      test_run_id: testRunId,
      language,
      reason: "dry_run"
    }, options.logPrefix);
  } else {
    if (!repository) {
      throw new Error("Daily job persistence requested without a ContentRepository.");
    }

    await runStage(
      "persistence preflight",
      {
        test_run_id: testRunId,
        language,
        tables: ["generation_runs", "sources", "content_items", "content_item_sources", "topics"]
      },
      async () => {
        await repository.assertPersistTestSchemaReady(options.topics);
      },
      { logPrefix: options.logPrefix }
    );

    storedItems = await runStage(
      "persistence",
      {
        test_run_id: testRunId,
        language,
        generated_items: jobPayload.items.length,
        content_status: options.contentStatus
      },
      async () =>
        repository.storeDailyPayload({
          payload: jobPayload,
          articles: rankedArticles,
          contentStatus: options.contentStatus,
          metadata: buildContentMetadata(options, testRunId)
        }),
      { maxAttempts: 1, logPrefix: options.logPrefix }
    );

    logProgress("content stored", {
      test_run_id: testRunId,
      language,
      content_status: options.contentStatus,
      stored_items: storedItems.length
    }, options.logPrefix);
  }

  const assignment =
    options.dryRun
      ? skippedAssignment("dry_run")
      : options.contentStatus === "published"
      ? await runStage(
          "assignment",
          {
            test_run_id: testRunId,
            language,
            user_limit: options.userLimit ?? "all",
            stored_items: storedItems.length
          },
          async () =>
            assignStoredDropToUsers({
              repository: repository ?? missingRepository(),
              storedItems,
              dropDate: jobPayload.drop_date,
              language,
              userLimit: options.userLimit,
              logPrefix: options.logPrefix
            }),
          { maxAttempts: 1, logPrefix: options.logPrefix }
        )
      : skippedAssignment(`content_status_${options.contentStatus}`);

  if (assignment.assignmentSkippedReason) {
    logProgress("assignment skipped", {
      test_run_id: testRunId,
      language,
      reason: assignment.assignmentSkippedReason
    }, options.logPrefix);
  }

  const result: DailyJobLanguageResult = {
    language,
    status: "completed",
    testRunId,
    fetchedArticles: rawArticles.length,
    processedArticles: rankedArticles.length,
    generatedItems: jobPayload.items.length,
    storedItems: storedItems.length,
    usersConsidered: assignment.usersConsidered,
    usersAssigned: assignment.usersAssigned,
    usersCreated: assignment.usersCreated,
    usersUpdatedExistingDrop: assignment.usersUpdatedExistingDrop,
    usersSkippedBeforeAssignment: assignment.usersSkippedBeforeAssignment,
    usersSkippedExistingDrop: assignment.usersSkippedExistingDrop,
    usersSkippedIncompleteSelection: assignment.usersSkippedIncompleteSelection,
    staleDailyDropItemsRemoved: assignment.staleDailyDropItemsRemoved,
    duplicateDailyDropItemsSkipped: assignment.duplicateDailyDropItemsSkipped,
    assignmentSkippedReason: assignment.assignmentSkippedReason,
    error: null
  };

  logProgress("language completed", {
    test_run_id: testRunId,
    language,
    fetched_articles: result.fetchedArticles,
    processed_articles: result.processedArticles,
    generated_items: result.generatedItems,
    stored_items: result.storedItems,
    users_considered: result.usersConsidered,
    users_assigned: result.usersAssigned,
    users_created: result.usersCreated,
    users_updated_existing_drop: result.usersUpdatedExistingDrop,
    stale_daily_drop_items_removed: result.staleDailyDropItemsRemoved,
    duplicate_daily_drop_items_skipped: result.duplicateDailyDropItemsSkipped,
    assignment_skipped_reason: result.assignmentSkippedReason
  }, options.logPrefix);

  return result;
}

async function assignStoredDropToUsers(input: {
  repository: ContentRepository;
  storedItems: StoredItems;
  dropDate: string;
  language: Language;
  userLimit: number | null;
  logPrefix: string;
}): Promise<{
  usersConsidered: number;
  usersAssigned: number;
  usersCreated: number;
  usersUpdatedExistingDrop: number;
  usersSkippedBeforeAssignment: number;
  usersSkippedExistingDrop: number;
  usersSkippedIncompleteSelection: number;
  staleDailyDropItemsRemoved: number;
  duplicateDailyDropItemsSkipped: number;
  assignmentSkippedReason: string | null;
}> {
  const selection = await input.repository.listUserDailyDropPreferenceSelection(input.language);
  const preferences = selection.preferences;
  const sortedPreferences = [...preferences].sort((left, right) => left.user_id.localeCompare(right.user_id));
  const candidates = input.userLimit === null ? sortedPreferences : sortedPreferences.slice(0, input.userLimit);

  for (const skippedUser of selection.skippedUsers) {
    logProgress("user skipped before assignment", {
      user_id: skippedUser.user_id,
      language: input.language,
      profile_language: skippedUser.language,
      expected_language: skippedUser.expectedLanguage,
      reason: skippedUser.reason,
      enabled_topic_count: skippedUser.enabledTopicCount ?? null
    }, input.logPrefix);
  }

  logProgress("users selected", {
    language: input.language,
    drop_date: input.dropDate,
    profiles_read: selection.profilesRead,
    user_preferences_read: selection.userPreferencesRead,
    user_topic_preferences_read: selection.userTopicPreferencesRead,
    preferences_loaded: preferences.length,
    users_skipped_before_limit: selection.skippedUsers.length,
    user_limit: input.userLimit ?? "all",
    users_considered: candidates.length,
    selection_rule:
      "profiles with matching language, user_preferences, and enabled user_topic_preferences; sorted by user_id; limited by USER_LIMIT"
  }, input.logPrefix);

  const existingDrops = await input.repository.listDailyDropsForUsersOnDate({
    userIds: candidates.map((preference) => preference.user_id),
    dropDate: input.dropDate
  });

  logProgress("existing drops checked", {
    language: input.language,
    drop_date: input.dropDate,
    users_considered: candidates.length,
    existing_drops_found: existingDrops.size,
    existing_drop_policy: "update_existing_drop_items"
  }, input.logPrefix);

  let usersAssigned = 0;
  let usersCreated = 0;
  let usersUpdatedExistingDrop = 0;
  const usersSkippedExistingDrop = 0;
  let usersSkippedIncompleteSelection = 0;
  let staleDailyDropItemsRemoved = 0;
  let duplicateDailyDropItemsSkipped = 0;

  for (const preference of candidates) {
    const existingDrop = existingDrops.get(preference.user_id);

    const selection = selectDailyDropItemsForUser(preference, input.storedItems);
    const itemIds = completeSelection(selection.items, input.storedItems);

    if (!hasRequiredSlots(itemIds)) {
      usersSkippedIncompleteSelection += 1;
      logProgress("assignment skipped incomplete selection", {
        user_id: preference.user_id,
        drop_date: input.dropDate,
        language: input.language,
        selected_items: itemIds.length,
        missing_slots: missingRequiredSlots(itemIds),
        topic_preferences: preference.topics.map((topic) => ({
          topic_id: topic.topic_id,
          articles_count: topic.articles_count,
          position: topic.position
        }))
      }, input.logPrefix);
      continue;
    }

    if (existingDrop) {
      logProgress("assignment updating existing drop", {
        user_id: preference.user_id,
        daily_drop_id: existingDrop.id,
        previous_status: existingDrop.status,
        drop_date: input.dropDate,
        linked_items: itemIds.length
      }, input.logPrefix);
    }

    const assignment = await input.repository.createDailyDropForUserWithResult({
      userId: preference.user_id,
      dropDate: input.dropDate,
      language: input.language,
      status: "published",
      itemIds
    });

    usersAssigned += 1;
    usersCreated += assignment.existingDropUpdated ? 0 : 1;
    usersUpdatedExistingDrop += assignment.existingDropUpdated ? 1 : 0;
    staleDailyDropItemsRemoved += assignment.staleItemsRemoved;
    duplicateDailyDropItemsSkipped += assignment.duplicateInputItemsSkipped;

    logProgress("assignment user completed", {
      user_id: preference.user_id,
      daily_drop_id: assignment.dailyDropId,
      existing_drop_updated: assignment.existingDropUpdated,
      linked_items: assignment.linkedItems,
      stale_daily_drop_items_removed: assignment.staleItemsRemoved,
      duplicate_daily_drop_items_skipped: assignment.duplicateInputItemsSkipped
    }, input.logPrefix);
  }

  return {
    usersConsidered: candidates.length,
    usersAssigned,
    usersCreated,
    usersUpdatedExistingDrop,
    usersSkippedBeforeAssignment: selection.skippedUsers.length,
    usersSkippedExistingDrop,
    usersSkippedIncompleteSelection,
    staleDailyDropItemsRemoved,
    duplicateDailyDropItemsSkipped,
    assignmentSkippedReason: null
  };
}

function skippedAssignment(reason: string): {
  usersConsidered: number;
  usersAssigned: number;
  usersCreated: number;
  usersUpdatedExistingDrop: number;
  usersSkippedBeforeAssignment: number;
  usersSkippedExistingDrop: number;
  usersSkippedIncompleteSelection: number;
  staleDailyDropItemsRemoved: number;
  duplicateDailyDropItemsSkipped: number;
  assignmentSkippedReason: string;
} {
  return {
    usersConsidered: 0,
    usersAssigned: 0,
    usersCreated: 0,
    usersUpdatedExistingDrop: 0,
    usersSkippedBeforeAssignment: 0,
    usersSkippedExistingDrop: 0,
    usersSkippedIncompleteSelection: 0,
    staleDailyDropItemsRemoved: 0,
    duplicateDailyDropItemsSkipped: 0,
    assignmentSkippedReason: reason
  };
}

function emptyFailedLanguageResult(language: Language, testRunId: string, error: string): DailyJobLanguageResult {
  return {
    language,
    status: "failed",
    testRunId,
    fetchedArticles: 0,
    processedArticles: 0,
    generatedItems: 0,
    storedItems: 0,
    usersConsidered: 0,
    usersAssigned: 0,
    usersCreated: 0,
    usersUpdatedExistingDrop: 0,
    usersSkippedBeforeAssignment: 0,
    usersSkippedExistingDrop: 0,
    usersSkippedIncompleteSelection: 0,
    staleDailyDropItemsRemoved: 0,
    duplicateDailyDropItemsSkipped: 0,
    assignmentSkippedReason: null,
    error
  };
}

function summarizeLanguageResults(results: DailyJobLanguageResult[]): DailyJobTestOutput["summary"] {
  return {
    languagesRequested: results.length,
    languagesSucceeded: results.filter((result) => result.status === "completed").length,
    languagesFailed: results.filter((result) => result.status === "failed").length,
    totalFetchedArticles: sumResults(results, "fetchedArticles"),
    totalProcessedArticles: sumResults(results, "processedArticles"),
    totalGeneratedItems: sumResults(results, "generatedItems"),
    totalStoredItems: sumResults(results, "storedItems"),
    totalUsersConsidered: sumResults(results, "usersConsidered"),
    totalUsersAssigned: sumResults(results, "usersAssigned"),
    totalUsersCreated: sumResults(results, "usersCreated"),
    totalUsersUpdatedExistingDrop: sumResults(results, "usersUpdatedExistingDrop"),
    totalUsersSkippedBeforeAssignment: sumResults(results, "usersSkippedBeforeAssignment"),
    totalUsersSkippedExistingDrop: sumResults(results, "usersSkippedExistingDrop"),
    totalUsersSkippedIncompleteSelection: sumResults(results, "usersSkippedIncompleteSelection"),
    totalStaleDailyDropItemsRemoved: sumResults(results, "staleDailyDropItemsRemoved"),
    totalDuplicateDailyDropItemsSkipped: sumResults(results, "duplicateDailyDropItemsSkipped")
  };
}

function sumResults(results: DailyJobLanguageResult[], key: keyof Pick<
  DailyJobLanguageResult,
  | "fetchedArticles"
  | "processedArticles"
  | "generatedItems"
  | "storedItems"
  | "usersConsidered"
  | "usersAssigned"
  | "usersCreated"
  | "usersUpdatedExistingDrop"
  | "usersSkippedBeforeAssignment"
  | "usersSkippedExistingDrop"
  | "usersSkippedIncompleteSelection"
  | "staleDailyDropItemsRemoved"
  | "duplicateDailyDropItemsSkipped"
>): number {
  return results.reduce((sum, result) => sum + result[key], 0);
}

function toLogSummary(summary: DailyJobTestOutput["summary"]): Record<string, number> {
  return {
    languages_requested: summary.languagesRequested,
    languages_succeeded: summary.languagesSucceeded,
    languages_failed: summary.languagesFailed,
    total_fetched_articles: summary.totalFetchedArticles,
    total_processed_articles: summary.totalProcessedArticles,
    total_generated_items: summary.totalGeneratedItems,
    total_stored_items: summary.totalStoredItems,
    total_users_considered: summary.totalUsersConsidered,
    total_users_assigned: summary.totalUsersAssigned,
    total_users_created: summary.totalUsersCreated,
    total_users_updated_existing_drop: summary.totalUsersUpdatedExistingDrop,
    total_users_skipped_before_assignment: summary.totalUsersSkippedBeforeAssignment,
    total_users_skipped_existing_drop: summary.totalUsersSkippedExistingDrop,
    total_users_skipped_incomplete_selection: summary.totalUsersSkippedIncompleteSelection,
    total_stale_daily_drop_items_removed: summary.totalStaleDailyDropItemsRemoved,
    total_duplicate_daily_drop_items_skipped: summary.totalDuplicateDailyDropItemsSkipped
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

function missingRequiredSlots(
  itemIds: Array<{
    slot: DailyDropSlot;
  }>
): DailyDropSlot[] {
  const slots = new Set(itemIds.map((item) => item.slot));
  return REQUIRED_SLOTS.filter((slot) => !slots.has(slot));
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
    logPrefix?: string;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RETRYABLE_STAGE_ATTEMPTS;
  const logPrefix = options.logPrefix ?? "daily-job-test";
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logProgress(`${stage} started`, {
      ...details,
      attempt,
      max_attempts: maxAttempts
    }, logPrefix);

    try {
      const result = await action();
      logProgress(`${stage} completed`, {
        ...details,
        attempt,
        max_attempts: maxAttempts
      }, logPrefix);
      return result;
    } catch (error) {
      lastError = error;
      logProgress(`${stage} failed`, {
        ...details,
        attempt,
        max_attempts: maxAttempts,
        error: serializePersistenceError(error)
      }, logPrefix);

      if (attempt < maxAttempts) {
        logProgress(`${stage} retrying`, {
          ...details,
          next_attempt: attempt + 1,
          max_attempts: maxAttempts
        }, logPrefix);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function createGenerator(useLlm: boolean, logPrefix: string): ContentGenerator {
  if (!useLlm) {
    return new StructuredContentGenerator();
  }

  return new LlmContentGenerator({
    provider: new OpenAiJsonProvider(),
    onProgress: (message, details) => logProgress(message, details, logPrefix)
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

function buildRunId(options: DailyJobRunOptions, language: Language): string {
  return `${options.mode}-${sha256(
    [options.dropDate, language, options.useLlm ? "llm" : "dry-run", options.liveRss ? "live-rss" : "sample", ...options.topics].join("|")
  ).slice(0, 12)}`;
}

function buildContentMetadata(options: DailyJobRunOptions, testRunId: string): Record<string, unknown> {
  if (options.testMode) {
    return {
      is_test_data: true,
      test_mode: "daily-job-test",
      test_run_id: testRunId,
      test_label: "TEST DAILY JOB CONTENT - safe to inspect and delete manually",
      persisted_by: "services/content-engine npm run daily-job-test",
      safe_persistence_note: "Local daily-job-test data. Created only after CONFIRM_DAILY_JOB_TEST=true.",
      content_status: options.contentStatus,
      use_llm: options.useLlm,
      live_rss: options.liveRss
    };
  }

  return {
    is_test_data: false,
    scheduler_mode: "daily-job",
    scheduler_run_id: testRunId,
    persisted_by: "services/content-engine npm run daily-job",
    content_status: options.contentStatus,
    use_llm: options.useLlm,
    live_rss: options.liveRss,
    safe_persistence_note: "Production daily job generated content."
  };
}

function assertDailyJobEnvironment(options: DailyJobRunOptions): void {
  const missing = [
    !options.dryRun && !process.env.SUPABASE_URL ? "SUPABASE_URL" : null,
    !options.dryRun && !process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    options.testMode && process.env.CONFIRM_DAILY_JOB_TEST !== "true" ? "CONFIRM_DAILY_JOB_TEST=true" : null,
    options.useLlm && !process.env.OPENAI_API_KEY ? "OPENAI_API_KEY when USE_LLM=true" : null
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    options.testMode
      ? [
          `daily-job-test refused to write because the following required setting(s) are missing: ${missing.join(", ")}.`,
          "This command persists published test content and assigns daily drops to a limited set of app users.",
          "To run it intentionally, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and CONFIRM_DAILY_JOB_TEST=true.",
          "Use USER_LIMIT=5 or lower for local checks, and use a local or disposable Supabase project by default."
        ].join(" ")
      : [
          `daily-job refused to run because the following required setting(s) are missing: ${missing.join(", ")}.`,
          options.dryRun
            ? "DRY_RUN=true prevents Supabase writes. USE_LLM=true still requires OPENAI_API_KEY."
            : "Production writes require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in a server-side environment."
        ].join(" ")
  );
}

function missingRepository(): never {
  throw new Error("Daily job assignment requested without a ContentRepository.");
}

function applyTopicLimit(topics: TopicId[]): TopicId[] {
  const topicLimit = readPositiveInteger(process.env.TOPIC_LIMIT, "TOPIC_LIMIT");
  return topicLimit ? topics.slice(0, topicLimit) : topics;
}

function parseUserLimit(value: string | undefined): number {
  const parsed = readPositiveInteger(value, "USER_LIMIT") ?? DEFAULT_USER_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_USER_LIMIT));
}

function parseOptionalUserLimit(value: string | undefined): number | null {
  return readPositiveInteger(value, "USER_LIMIT");
}

function parseContentStatus(value: string): DailyJobContentStatus {
  if (CONTENT_STATUSES.includes(value as DailyJobContentStatus)) {
    return value as DailyJobContentStatus;
  }

  throw new Error(`CONTENT_STATUS must be one of: ${CONTENT_STATUSES.join(", ")}.`);
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

function logProgress(message: string, details: Record<string, unknown>, prefix = "daily-job-test"): void {
  process.stderr.write(`[${prefix}] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
