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
import { classifyLlmFailure, serializeLlmFailure, type LlmFailureReason } from "../generation/llmErrors.js";
import { OpenAiJsonProvider } from "../generation/openAiProvider.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator } from "../generation/types.js";
import { assertValidDailyDropPayload } from "../generation/validation.js";
import {
  aggregateJobRunMetrics,
  buildFailedLanguageJobMetrics,
  buildLanguageJobMetrics,
  readPricingConfig,
  type JobRunMetrics,
  type LanguageJobMetrics,
  type PricingConfig,
  type RssMetricDiagnostics
} from "../ops/jobMetrics.js";
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
import { redactLogIdentifiers } from "../utils/redactIdentifier.js";

const DEFAULT_USER_LIMIT = 5;
const MAX_USER_LIMIT = 25;
const DEFAULT_LANGUAGES = "fr,en";
const DRY_RUN_NEWSLETTER_ARTICLE_COUNT = 4;
const LLM_NEWSLETTER_ARTICLE_COUNT = 1;
const RETRYABLE_STAGE_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 8_000;
const REQUIRED_SLOTS = ["newsletter", "business_story", "mini_case", "concept"] as const;
const CONTENT_STATUSES = ["draft", "review", "published"] as const;

type DailyJobContentStatus = (typeof CONTENT_STATUSES)[number];
type DailyJobMode = "daily-job" | "daily-job-test";
type SourceMode = "sample" | "rss" | "mixed";
type DailyJobStatus = "completed" | "partial_failed" | "failed";

type OperatorSummary = {
  runId: string;
  status: DailyJobStatus;
  headline: string;
  whatHappened: string;
  usersReceivedContent: boolean;
  rerunSafe: boolean;
  rerunRecommendation: string;
  generated: number;
  stored: number;
  assigned: number;
  deduplicatedContentItems: number;
  failedLanguages: Language[];
  failedTopics: TopicId[];
  failures: string[];
  recoveryHints: string[];
  deduplication: {
    contentItemsReused: number;
    activeDedupKeyUniqueIndexRequired: boolean;
  };
  costEstimate: {
    available: boolean;
    estimatedUsd: number | null;
    reason: string;
  };
  idempotency: {
    stableRunId: boolean;
    dailyDropsUpsertByUserDate: boolean;
    dailyDropItemsReplaceBySlotPosition: boolean;
    contentItemsDeduplicated: boolean;
  };
};

type AssignmentCompletion = {
  items: Array<{
    contentItemId: string;
    slot: DailyDropSlot;
    position: number;
  }>;
  fallbackSlots: DailyDropSlot[];
};

export type DailyJobRunOptions = {
  mode: DailyJobMode;
  dropDate: string;
  languages: Language[];
  topics: TopicId[];
  newsletterArticleCount: number;
  liveRss: boolean;
  liveRssOnly: boolean;
  useLlm: boolean;
  userLimit: number | null;
  contentStatus: DailyJobContentStatus;
  dryRun: boolean;
  testMode: boolean;
  logPrefix: string;
  productionConfirmed: boolean;
  strictAllLanguages: boolean;
  runId?: string;
};

export type DailyJobTestOptions = {
  dropDate: string;
  languages: Language[];
  topics: TopicId[];
  newsletterArticleCount: number;
  liveRss: boolean;
  liveRssOnly: boolean;
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
  status: DailyJobStatus;
  runId: string;
  generator: "dry-run" | "llm";
  liveRss: boolean;
  liveRssOnly: boolean;
  sourceMode: SourceMode;
  sampleContentEnabled: boolean;
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
    totalDeduplicatedContentItems: number;
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
  operatorSummary: OperatorSummary;
  metrics: JobRunMetrics;
  languages: Array<{
    language: Language;
    status: "completed" | "failed";
    testRunId: string;
    fetchedArticles: number;
    processedArticles: number;
    generatedItems: number;
    storedItems: number;
    deduplicatedContentItems: number;
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
    errorReason: LlmFailureReason | null;
    error: string | null;
    metrics: LanguageJobMetrics;
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
    logPrefix: "daily-job-test",
    productionConfirmed: false,
    strictAllLanguages: false
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
  const sourcePolicy = resolveSourcePolicy(options);
  const runId = options.runId ?? buildJobRunId(options);
  const pricing = readPricingConfig();

  logProgress("job started", {
    run_id: runId,
    drop_date: options.dropDate,
    languages: options.languages,
    topics: options.topics,
    use_llm: options.useLlm,
    live_rss: options.liveRss,
    live_rss_only: options.liveRssOnly,
    source_mode: sourcePolicy.sourceMode,
    sample_content_enabled: sourcePolicy.sampleContentEnabled,
    user_limit: options.userLimit ?? "all",
    newsletter_articles: options.newsletterArticleCount,
    content_status: options.contentStatus,
    dry_run: options.dryRun
  }, options.logPrefix);

  const sourceFetcher = new SourceFetcher(sourcePolicy.connectors);
  const generator = createGenerator(options.useLlm, options.logPrefix);
  const repository = options.dryRun
    ? undefined
    : new ContentRepository(
        createServiceRoleSupabaseClient({
          requireCredentials: true
        })
      );
  const languageResults: DailyJobLanguageResult[] = [];

  if (repository) {
    await repository.startJobRun({
      runId,
      jobType: options.mode,
      runDate: options.dropDate,
      dryRun: options.dryRun,
      generator: options.useLlm ? "llm" : "dry-run",
      sourceMode: sourcePolicy.sourceMode,
      languages: options.languages,
      topics: options.topics
    });
  }

  for (const language of options.languages) {
    const testRunId = buildLanguageRunId(runId, language);

    try {
      languageResults.push(
        await runDailyJobLanguage({
          generator,
          language,
          options,
          pricing,
          repository,
          sourceFetcher,
          sourceConnectors: sourcePolicy.connectors,
          runId,
          testRunId
        })
      );
    } catch (error) {
      const serializedError = serializePersistenceError(error);
      const errorReason = classifyLlmFailure(error);
      languageResults.push(emptyFailedLanguageResult(language, testRunId, errorReason, serializedError.message, options.useLlm));
      logProgress("language failed", {
        run_id: runId,
        test_run_id: testRunId,
        language,
        failure: serializeLlmFailure(error),
        error: serializedError
      }, options.logPrefix);
    }
  }

  const summary = summarizeLanguageResults(languageResults);
  const status = resolveJobStatus(summary, options);
  const metrics = aggregateJobRunMetrics(
    languageResults.map((result) => ({
      language: result.language,
      metrics: result.metrics
    })),
    pricing
  );
  const operatorSummary = buildOperatorSummary(runId, status, options, summary, languageResults, metrics);

  if (repository) {
    await repository.completeJobRun({
      runId,
      status,
      metrics: metrics as unknown as Record<string, unknown>,
      operatorSummary: operatorSummary as unknown as Record<string, unknown>,
      error:
        languageResults
          .filter((result) => result.status === "failed")
          .map((result) => `${result.language}: ${result.error}`)
          .join("\n") || null
    });
  }

  logProgress("job completed", {
    run_id: runId,
    status,
    operator_summary: operatorSummary,
    ...toLogSummary(summary)
  }, options.logPrefix);

  if (status === "failed") {
    process.exitCode = 1;
  }

  return {
    mode: options.mode,
    confirmation: options.testMode ? "CONFIRM_DAILY_JOB_TEST=true" : undefined,
    persisted: !options.dryRun,
    dryRun: options.dryRun,
    status,
    runId,
    generator: options.useLlm ? "llm" : "dry-run",
    liveRss: options.liveRss,
    liveRssOnly: options.liveRssOnly,
    sourceMode: sourcePolicy.sourceMode,
    sampleContentEnabled: sourcePolicy.sampleContentEnabled,
    userLimit: options.userLimit,
    contentStatus: options.contentStatus,
    summary,
    operatorSummary,
    metrics,
    languages: languageResults
  };
}

export function parseDailyJobTestOptions(args: string[]): DailyJobTestOptions {
  const flags = readFlags(args);
  const useLlm = envFlag("USE_LLM");
  const liveRssOnly = envFlag("LIVE_RSS_ONLY") || flags.has("live-rss-only");
  const topics = applyTopicLimit(parseTopics(flags.get("topics") ?? flags.get("topic") ?? TOPIC_IDS.join(",")));
  const explicitNewsletterCount = readPositiveInteger(flags.get("newsletter-count"), "--newsletter-count");
  const newsletterArticleCount =
    explicitNewsletterCount ?? Math.min(useLlm ? LLM_NEWSLETTER_ARTICLE_COUNT : DRY_RUN_NEWSLETTER_ARTICLE_COUNT, topics.length);

  return {
    dropDate: flags.get("date") ?? toDateOnly(new Date()),
    languages: parseLanguages(flags.get("languages") ?? flags.get("language") ?? process.env.LANGUAGES ?? DEFAULT_LANGUAGES),
    topics,
    newsletterArticleCount,
    liveRss: liveRssOnly || envFlag("LIVE_RSS") || flags.has("live-rss"),
    liveRssOnly,
    useLlm,
    userLimit: parseUserLimit(process.env.USER_LIMIT),
    contentStatus: parseContentStatus(process.env.CONTENT_STATUS ?? "published")
  };
}

export function parseDailyJobOptions(args: string[]): DailyJobRunOptions {
  const flags = readFlags(args);
  const useLlm = envFlag("USE_LLM") || flags.has("llm");
  const liveRssOnly = envFlag("LIVE_RSS_ONLY") || flags.has("live-rss-only");
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
    liveRss: liveRssOnly || envFlag("LIVE_RSS") || flags.has("live-rss"),
    liveRssOnly,
    useLlm,
    userLimit: parseOptionalUserLimit(process.env.USER_LIMIT),
    contentStatus: parseContentStatus(process.env.CONTENT_STATUS ?? "published"),
    dryRun: envFlag("DRY_RUN") || flags.has("dry-run"),
    testMode: false,
    logPrefix: "daily-job",
    productionConfirmed: envFlag("PRODUCTION_DAILY_JOB"),
    strictAllLanguages: envFlag("STRICT_ALL_LANGUAGES"),
    runId: process.env.RUN_ID || flags.get("run-id")
  };
}

async function runDailyJobLanguage(input: {
  generator: ContentGenerator;
  language: Language;
  options: DailyJobRunOptions;
  pricing: PricingConfig;
  repository: ContentRepository | undefined;
  runId: string;
  sourceFetcher: SourceFetcher;
  sourceConnectors: SourceConnector[];
  testRunId: string;
}): Promise<DailyJobLanguageResult> {
  const { generator, language, options, pricing, repository, runId, sourceFetcher, sourceConnectors, testRunId } = input;

  logProgress("language started", {
    run_id: runId,
    test_run_id: testRunId,
    language,
    content_status: options.contentStatus,
    dry_run: options.dryRun
  }, options.logPrefix);

  const rawArticles = await runStage(
    "source fetch",
    {
      run_id: runId,
      test_run_id: testRunId,
      language,
      topics: options.topics,
      live_rss: options.liveRss,
      live_rss_only: options.liveRssOnly,
      source_mode: resolveSourcePolicySummary(options).sourceMode,
      sample_content_enabled: resolveSourcePolicySummary(options).sampleContentEnabled,
      dry_run: options.dryRun
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
  const rssDiagnostics = collectRssDiagnostics(sourceConnectors);

  const rankedArticles = await runStage(
    "processing",
    {
      run_id: runId,
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

  const generationStartedAt = Date.now();
  const payload = await runStage(
    "generation",
    {
      run_id: runId,
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
  const llmLatencyMs = options.useLlm ? Date.now() - generationStartedAt : null;

  const jobPayload = options.testMode ? markPayloadAsTestData(payload, testRunId) : payload;

  await runStage(
    "validation",
    {
      run_id: runId,
      test_run_id: testRunId,
      language,
      generated_items: jobPayload.items.length
    },
    async () => {
      assertValidDailyDropPayload(jobPayload, {
        articles: rankedArticles,
        rssOnly: options.liveRssOnly
      });
      assertStrictProductionPayload(jobPayload, options);
    },
    { logPrefix: options.logPrefix }
  );

  let storedItems: StoredItems = [];

  if (options.dryRun) {
    logProgress("persistence skipped", {
      run_id: runId,
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
        run_id: runId,
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
        run_id: runId,
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
          metadata: buildContentMetadata(options, runId, testRunId)
        }),
      { maxAttempts: 1, logPrefix: options.logPrefix }
    );

    logProgress("content stored", {
      run_id: runId,
      test_run_id: testRunId,
      language,
      content_status: options.contentStatus,
      stored_items: storedItems.length,
      content_items_reused_by_dedup: countDeduplicatedContentItems(storedItems)
    }, options.logPrefix);
  }

  const assignment =
    options.dryRun
      ? skippedAssignment("dry_run")
      : options.contentStatus === "published"
      ? await runStage(
          "assignment",
          {
            run_id: runId,
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

  const metrics = buildLanguageJobMetrics({
    rssDiagnostics,
    rankedArticles,
    useLlm: options.useLlm,
    llmLatencyMs,
    llmTimedOut: false,
    payload: jobPayload,
    storedItems: storedItems.length,
    deduplicatedContentItems: countDeduplicatedContentItems(storedItems),
    assignedUsers: assignment.usersAssigned,
    pricing
  });

  if (assignment.assignmentSkippedReason) {
    logProgress("assignment skipped", {
      run_id: runId,
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
    deduplicatedContentItems: countDeduplicatedContentItems(storedItems),
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
    errorReason: null,
    error: null,
    metrics
  };

  logProgress("language completed", {
    run_id: runId,
    test_run_id: testRunId,
    language,
    fetched_articles: result.fetchedArticles,
    processed_articles: result.processedArticles,
    generated_items: result.generatedItems,
    stored_items: result.storedItems,
    content_items_reused_by_dedup: result.deduplicatedContentItems,
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
  assertAssignableStoredItems(input.storedItems, input.language);
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
    user_mini_case_topic_preferences_read: selection.userMiniCasePreferencesRead,
    preferences_loaded: preferences.length,
    users_skipped_before_limit: selection.skippedUsers.length,
    user_limit: input.userLimit ?? "all",
    users_considered: candidates.length,
    selection_rule:
      "profiles with matching language, user_preferences, enabled newsletter topic preferences, and enabled mini-case topic preferences; sorted by user_id; limited by USER_LIMIT"
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
    const completedSelection = completeSelection(selection.items, input.storedItems);
    const itemIds = completedSelection.items;
    const miniCaseItem = itemIds.find((item) => item.slot === "mini_case");

    logProgress("assignment topic selection", {
      user_id: preference.user_id,
      drop_date: input.dropDate,
      language: input.language,
      newsletter_topics_selected: selection.diagnostics.newsletter.selectedTopicIds,
      mini_case_topics_selected: selection.diagnostics.miniCase.allowedTopicIds,
      newsletter_items_assigned: selection.diagnostics.newsletter.assignedItems.length,
      mini_case_topic_assigned: selection.diagnostics.miniCase.selectedTopicId
    }, input.logPrefix);

    if (completedSelection.fallbackSlots.length > 0) {
      logProgress("assignment filled missing non-personalized slot", {
        user_id: preference.user_id,
        drop_date: input.dropDate,
        language: input.language,
        fallback_slots: completedSelection.fallbackSlots,
        fallback_policy: "same_run_same_language_content_only"
      }, input.logPrefix);
    }

    if (selection.diagnostics.miniCase.fallbackReason !== "none") {
      logProgress("mini-case topic fallback", {
        user_id: preference.user_id,
        drop_date: input.dropDate,
        language: input.language,
        requested_topic_id: selection.diagnostics.miniCase.requestedTopicId,
        selected_topic_id: selection.diagnostics.miniCase.selectedTopicId,
        fallback_reason: selection.diagnostics.miniCase.fallbackReason
      }, input.logPrefix);
    }

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
        })),
        mini_case_topics: preference.mini_case_topics,
        newsletter_topics_selected: selection.diagnostics.newsletter.selectedTopicIds,
        mini_case_topics_selected: selection.diagnostics.miniCase.allowedTopicIds,
        newsletter_items_assigned: itemIds.filter((item) => item.slot === "newsletter").length,
        mini_case_topic_assigned: selection.diagnostics.miniCase.selectedTopicId,
        mini_case_fallback_reason: selection.diagnostics.miniCase.fallbackReason
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
      newsletter_topics_selected: selection.diagnostics.newsletter.selectedTopicIds,
      mini_case_topics_selected: selection.diagnostics.miniCase.allowedTopicIds,
      newsletter_items_assigned: itemIds.filter((item) => item.slot === "newsletter").length,
      mini_case_topic_assigned: selection.diagnostics.miniCase.selectedTopicId,
      mini_case_content_item_id: miniCaseItem?.contentItemId ?? null,
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

function emptyFailedLanguageResult(
  language: Language,
  testRunId: string,
  errorReason: LlmFailureReason | null,
  error: string,
  useLlm: boolean
): DailyJobLanguageResult {
  return {
    language,
    status: "failed",
    testRunId,
    fetchedArticles: 0,
    processedArticles: 0,
    generatedItems: 0,
    storedItems: 0,
    deduplicatedContentItems: 0,
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
    errorReason,
    error,
    metrics: buildFailedLanguageJobMetrics({
      errorReason,
      error,
      useLlm
    })
  };
}

function countDeduplicatedContentItems(storedItems: StoredItems): number {
  return storedItems.filter((item) => item.reused_existing_content_item).length;
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
    totalDeduplicatedContentItems: sumResults(results, "deduplicatedContentItems"),
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
  | "deduplicatedContentItems"
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
    total_content_items_reused_by_dedup: summary.totalDeduplicatedContentItems,
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
): AssignmentCompletion {
  const completed = [...selected];
  const fallbackSlots: DailyDropSlot[] = [];

  for (const slot of REQUIRED_SLOTS) {
    if (completed.some((item) => item.slot === slot)) {
      continue;
    }

    if (slot === "newsletter" || slot === "mini_case") {
      continue;
    }

    const fallback = storedItems.find((stored) => stored.item.slot === slot);
    if (!fallback) {
      continue;
    }

    completed.push({
      contentItemId: fallback.content_item_id,
      slot,
      position: 0
    });
    fallbackSlots.push(slot);
  }

  return {
    items: completed,
    fallbackSlots
  };
}

function assertAssignableStoredItems(storedItems: StoredItems, language: Language): void {
  if (storedItems.length === 0) {
    throw new Error("Assignment refused because no same-run stored content items are available.");
  }

  const wrongLanguageItems = storedItems.filter((stored) => stored.item.language !== language);

  if (wrongLanguageItems.length > 0) {
    throw new Error(
      `Assignment refused because ${wrongLanguageItems.length} stored item(s) do not match language ${language}.`
    );
  }
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
        failure: serializeLlmFailure(error),
        error: serializePersistenceError(error)
      }, logPrefix);

      if (attempt < maxAttempts) {
        const retryDelayMs = retryDelay(attempt);
        logProgress(`${stage} retrying`, {
          ...details,
          next_attempt: attempt + 1,
          max_attempts: maxAttempts,
          retry_delay_ms: retryDelayMs
        }, logPrefix);
        await sleep(retryDelayMs);
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

function collectRssDiagnostics(connectors: SourceConnector[]): RssMetricDiagnostics[] {
  return connectors
    .filter((connector): connector is RssFeedConnector => connector instanceof RssFeedConnector)
    .map((connector) => connector.getLastDiagnostics());
}

function buildSourceConnectors(options: DailyJobRunOptions): SourceConnector[] {
  const connectors: SourceConnector[] = [];

  if (isSampleContentEnabled(options)) {
    connectors.push(new SampleArticleConnector());
  }

  if (options.liveRss) {
    connectors.push(new RssFeedConnector(CURATED_SOURCES));
  }

  return connectors;
}

function resolveSourcePolicy(options: DailyJobRunOptions): {
  connectors: SourceConnector[];
  sourceMode: SourceMode;
  sampleContentEnabled: boolean;
} {
  const connectors = buildSourceConnectors(options);
  const summary = resolveSourcePolicySummary(options);

  if (connectors.length === 0) {
    throw new Error(
      [
        "daily-job refused to run because no source connector is enabled.",
        "Production writes require LIVE_RSS=true and LIVE_RSS_ONLY=true.",
        "Use DRY_RUN=true for local sample dry-runs, or daily-job-test/persist-test for marked sample persistence."
      ].join(" ")
    );
  }

  return {
    connectors,
    ...summary
  };
}

function resolveSourcePolicySummary(options: DailyJobRunOptions): {
  sourceMode: SourceMode;
  sampleContentEnabled: boolean;
} {
  const sampleContentEnabled = isSampleContentEnabled(options);
  return {
    sampleContentEnabled,
    sourceMode: resolveSourceMode(sampleContentEnabled, options.liveRss)
  };
}

function resolveSourceMode(sampleContentEnabled: boolean, liveRss: boolean): SourceMode {
  if (sampleContentEnabled && liveRss) {
    return "mixed";
  }

  if (sampleContentEnabled) {
    return "sample";
  }

  return "rss";
}

function isSampleContentEnabled(options: DailyJobRunOptions): boolean {
  return !options.liveRssOnly && (options.dryRun || options.testMode || envFlag("ALLOW_SAMPLE_CONTENT"));
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

function buildJobRunId(options: DailyJobRunOptions): string {
  const { sourceMode } = resolveSourcePolicySummary(options);
  return `${options.mode}-${sha256(
    [options.dropDate, options.useLlm ? "llm" : "dry-run", sourceMode, options.contentStatus, ...options.languages, ...options.topics].join("|")
  ).slice(0, 12)}`;
}

function buildLanguageRunId(runId: string, language: Language): string {
  return `${runId}-${language}`;
}

function resolveJobStatus(summary: DailyJobOutput["summary"], options: DailyJobRunOptions): DailyJobStatus {
  if (summary.languagesFailed === 0) {
    return "completed";
  }

  if (summary.languagesSucceeded === 0 || options.strictAllLanguages) {
    return "failed";
  }

  return "partial_failed";
}

function buildOperatorSummary(
  runId: string,
  status: DailyJobStatus,
  options: DailyJobRunOptions,
  summary: DailyJobOutput["summary"],
  languageResults: DailyJobLanguageResult[],
  metrics: JobRunMetrics
): OperatorSummary {
  const failedLanguages = languageResults
    .filter((result) => result.status === "failed")
    .map((result) => result.language);
  const failures = languageResults
    .filter((result) => result.status === "failed")
    .map((result) => `${result.language}: ${result.error ?? "unknown failure"}`);
  const usersReceivedContent = summary.totalUsersAssigned > 0;
  const rerunSafe = options.dryRun || status !== "failed";
  const headline =
    status === "completed"
      ? `Completed: ${summary.totalUsersAssigned} user assignment(s), ${summary.totalStoredItems} stored item link(s).`
      : status === "partial_failed"
      ? `Partial failure: ${summary.languagesSucceeded}/${summary.languagesRequested} language(s) completed; ${summary.totalUsersAssigned} user assignment(s).`
      : `Failed: no complete production daily job for ${options.dropDate}.`;
  const recoveryHints = buildOperatorRecoveryHints({
    status,
    options,
    summary,
    failedLanguages,
    metrics
  });

  return {
    runId,
    status,
    headline,
    whatHappened: `${summary.languagesSucceeded}/${summary.languagesRequested} language(s) completed; generated=${summary.totalGeneratedItems}, stored=${summary.totalStoredItems}, assigned=${summary.totalUsersAssigned}.`,
    usersReceivedContent,
    rerunSafe,
    rerunRecommendation: rerunSafe
      ? "Rerun is safe at daily_drop level: drops upsert by user/date and links upsert by slot/position. Review failed languages before rerunning all languages."
      : "Do not rerun blindly. Inspect failures and run content:prod-dry-run before any write retry.",
    generated: summary.totalGeneratedItems,
    stored: summary.totalStoredItems,
    assigned: summary.totalUsersAssigned,
    deduplicatedContentItems: summary.totalDeduplicatedContentItems,
    failedLanguages,
    failedTopics: failedLanguages.length > 0 ? options.topics : [],
    failures,
    recoveryHints,
    deduplication: {
      contentItemsReused: summary.totalDeduplicatedContentItems,
      activeDedupKeyUniqueIndexRequired: true
    },
    costEstimate: {
      available: metrics.estimated_cost_available,
      estimatedUsd: metrics.estimated_cost_usd,
      reason: metrics.estimated_cost_reason
    },
    idempotency: {
      stableRunId: true,
      dailyDropsUpsertByUserDate: true,
      dailyDropItemsReplaceBySlotPosition: true,
      contentItemsDeduplicated: true
    }
  };
}

function buildOperatorRecoveryHints(input: {
  status: DailyJobStatus;
  options: DailyJobRunOptions;
  summary: DailyJobOutput["summary"];
  failedLanguages: Language[];
  metrics: JobRunMetrics;
}): string[] {
  const hints: string[] = [];

  if (input.failedLanguages.length > 0) {
    hints.push(`Failed languages: ${input.failedLanguages.join(", ")}. Rerun only failed language(s) after a production dry-run passes.`);
  }

  if (input.metrics.rss_failed > 0) {
    hints.push(`RSS failures reported: ${input.metrics.rss_failed}. Check connector logs and content:job-health before publishing another run.`);
  }

  if (input.metrics.llm_timeout_count > 0) {
    hints.push(`LLM timeouts reported: ${input.metrics.llm_timeout_count}. Review timeout/model config before retry.`);
  }

  if (Object.keys(input.metrics.validation_failures_by_rule).length > 0) {
    hints.push(`Validation failures by rule: ${JSON.stringify(input.metrics.validation_failures_by_rule)}.`);
  }

  if (!input.options.dryRun && input.summary.totalStoredItems > 0 && input.summary.totalUsersAssigned === 0) {
    hints.push("Content was stored but no users were assigned. Check onboarding eligibility and assignment logs.");
  }

  if (input.status === "failed") {
    hints.push("Failed job_runs should be treated as stop conditions until content:prod-dry-run and content:job-health are reviewed.");
  }

  return hints;
}

function buildContentMetadata(options: DailyJobRunOptions, runId: string, testRunId: string): Record<string, unknown> {
  if (options.testMode) {
    return {
      is_test_data: true,
      test_mode: "daily-job-test",
      run_id: runId,
      test_run_id: testRunId,
      test_label: "TEST DAILY JOB CONTENT - safe to inspect and delete manually",
      persisted_by: "services/content-engine npm run daily-job-test",
      safe_persistence_note: "Local daily-job-test data. Created only after CONFIRM_DAILY_JOB_TEST=true.",
      content_status: options.contentStatus,
      use_llm: options.useLlm,
      live_rss: options.liveRss,
      live_rss_only: options.liveRssOnly,
      source_mode: resolveSourcePolicySummary(options).sourceMode,
      sample_content_enabled: resolveSourcePolicySummary(options).sampleContentEnabled
    };
  }

  return {
    is_test_data: false,
    scheduler_mode: "daily-job",
    scheduler_run_id: runId,
    language_run_id: testRunId,
    persisted_by: "services/content-engine npm run daily-job",
    content_status: options.contentStatus,
    use_llm: options.useLlm,
    live_rss: options.liveRss,
    live_rss_only: options.liveRssOnly,
    source_mode: resolveSourcePolicySummary(options).sourceMode,
    sample_content_enabled: resolveSourcePolicySummary(options).sampleContentEnabled,
    safe_persistence_note: "Production daily job generated content."
  };
}

function assertStrictProductionPayload(payload: DailyDropPayload, options: DailyJobRunOptions): void {
  if (!isProductionWrite(options)) {
    return;
  }

  const issues: string[] = [];
  const slots = new Set(payload.items.map((item) => item.slot));

  for (const slot of REQUIRED_SLOTS) {
    if (!slots.has(slot)) {
      issues.push(`missing required slot ${slot}`);
    }
  }

  payload.items.forEach((item, index) => {
    if (item.title.startsWith("[TEST")) {
      issues.push(`items.${index}.title is test-marked`);
    }

    if (item.language !== payload.language) {
      issues.push(`items.${index}.language must match payload language`);
    }

    if (item.topic && !options.topics.includes(item.topic)) {
      issues.push(`items.${index}.topic ${item.topic} is outside requested topics`);
    }

    for (const sourceUrl of item.source_urls) {
      if (isSampleUrl(sourceUrl)) {
        issues.push(`items.${index}.source_urls contains sample URL ${sourceUrl}`);
      }
    }
  });

  if (issues.length > 0) {
    throw new Error(`Production daily job strict validation failed: ${issues.join("; ")}.`);
  }
}

function isProductionWrite(options: DailyJobRunOptions): boolean {
  return options.mode === "daily-job" && !options.testMode && !options.dryRun;
}

function isSampleUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "example.com" || hostname.endsWith(".example.com");
  } catch {
    return value.includes("example.com");
  }
}

function assertDailyJobEnvironment(options: DailyJobRunOptions): void {
  const productionWrite = isProductionWrite(options);
  const missing = [
    productionWrite && !options.productionConfirmed ? "PRODUCTION_DAILY_JOB=true" : null,
    productionWrite && process.env.DRY_RUN !== "false" ? "DRY_RUN=false" : null,
    productionWrite && !options.liveRss ? "LIVE_RSS=true" : null,
    productionWrite && !options.liveRssOnly ? "LIVE_RSS_ONLY=true" : null,
    productionWrite && !options.useLlm ? "USE_LLM=true" : null,
    productionWrite && envFlag("ALLOW_SAMPLE_CONTENT") ? "ALLOW_SAMPLE_CONTENT must be unset or false" : null,
    !options.dryRun && !process.env.SUPABASE_URL ? "SUPABASE_URL" : null,
    !options.dryRun && !process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    options.testMode && process.env.CONFIRM_DAILY_JOB_TEST !== "true" ? "CONFIRM_DAILY_JOB_TEST=true" : null,
    (options.useLlm || productionWrite) && !process.env.OPENAI_API_KEY ? "OPENAI_API_KEY when USE_LLM=true" : null
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
          "Local helper: copy services/content-engine/.env.example to services/content-engine/.env, fill server-side values, set CONFIRM_DAILY_JOB_TEST=true, then run npm run content:daily-job-test:local -- --language en --limit 3.",
          "Use USER_LIMIT=5 or lower for local checks, and use a local or disposable Supabase project by default.",
          "Never put SUPABASE_SERVICE_ROLE_KEY in apps/mobile/.env or any client-side env file."
        ].join(" ")
      : [
          `daily-job refused to run because the following required setting(s) are missing: ${missing.join(", ")}.`,
          options.dryRun
            ? "DRY_RUN=true prevents Supabase writes. USE_LLM=true still requires OPENAI_API_KEY."
            : [
                "Production writes require PRODUCTION_DAILY_JOB=true, DRY_RUN=false, LIVE_RSS=true, LIVE_RSS_ONLY=true, USE_LLM=true.",
                "Production writes never use sample_articles and require server-side Supabase service-role and OpenAI credentials."
              ].join(" ")
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

function retryDelay(attempt: number): number {
  const exponentialDelay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exponentialDelay + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function envFlag(name: string): boolean {
  return process.env[name]?.toLowerCase() === "true";
}

function logProgress(message: string, details: Record<string, unknown>, prefix = "daily-job-test"): void {
  process.stderr.write(
    `[${prefix}] ${new Date().toISOString()} ${message} ${JSON.stringify(redactLogIdentifiers(details))}\n`
  );
}
