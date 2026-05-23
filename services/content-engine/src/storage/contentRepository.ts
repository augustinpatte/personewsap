import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isLanguage,
  isMiniCaseTopicId,
  isTopicId,
  type DailyDropStatus,
  type DailyDropPayload,
  type DailyDropSlot,
  type GeneratedContentItem,
  type BusinessStoryEditorialMemoryEntry,
  type BusinessStoryEntityType,
  type BusinessStoryMemoryContext,
  type Language,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId,
  type UserDailyDropPreference
} from "../domain.js";
import { buildBusinessStoryEditorialMemory, buildBusinessStoryMemoryContext } from "../generation/editorialMemory.js";
import {
  buildMiniCaseMemoryContext,
  miniCaseMemoryFromItem,
  type MiniCaseEditorialMemoryRecord,
  type MiniCaseMemoryContext
} from "../miniCase/editorialMemory.js";
import type {
  MiniCaseConcept,
  MiniCaseDecisionType,
  MiniCaseQuestionPattern,
  MiniCaseScenarioType
} from "../miniCase/taxonomy.js";
import { normalizeUrl, sha256 } from "../utils/hash.js";
import {
  assertDailyPayloadSourcesArePersistable,
  mapArticlesToSourceUpserts,
  mapContentItemSourceInserts,
  mapGeneratedItemToContentInsert,
  type ContentItemInsert,
  type ContentItemSourceInsert
} from "./mappers.js";
import { throwPersistenceError } from "./persistenceError.js";

type StoredGeneratedItem = {
  item: GeneratedContentItem;
  content_item_id: string;
  reused_existing_content_item: boolean;
  dedup_key: string | null;
};

type GenerationRunRow = {
  id: string;
};

export type JobRunStatus = "running" | "completed" | "partial_failed" | "failed";

export type JobRunRow = {
  id: string;
  run_id: string;
  job_type: "daily-job" | "daily-job-test";
  run_date: string;
  status: JobRunStatus;
  dry_run: boolean;
  generator: string;
  source_mode: string;
  languages: string[];
  topics: string[];
  metrics: Record<string, unknown>;
  operator_summary: Record<string, unknown>;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: string;
  url: string;
};

type ContentItemRow = {
  id: string;
};

type ContentItemDedupRow = {
  id: string;
};

type BusinessStoryHistoryRow = {
  id: string;
  content_item_id: string | null;
  title: string;
  slug: string;
  entity_name: string;
  entity_type: BusinessStoryEntityType;
  main_company: string;
  companies_mentioned: string[];
  industry: string;
  key_mechanism: string;
  secondary_mechanisms: string[];
  strategic_angle: string;
  core_takeaway: string;
  year_period: string;
  language: Language;
  published_date: string;
  created_at: string;
};

type MiniCaseHistoryRow = {
  id: string;
  content_item_id: string | null;
  title: string;
  slug: string;
  topic: MiniCaseTopicId;
  scenario_type: MiniCaseScenarioType;
  decision_type: MiniCaseDecisionType;
  concept_tested: MiniCaseConcept;
  mechanism: string;
  difficulty: string;
  question_pattern: MiniCaseQuestionPattern;
  correct_answer_pattern: string;
  core_takeaway: string;
  published_date: string;
  language: Language;
  created_at: string;
};

type PersistTestContentItemRow = {
  id: string;
  generation_run_id: string | null;
  title: string;
  status: string;
  metadata: unknown;
};

export type PublishedPersistTestContentItem = {
  id: string;
  content_type: string;
  topic_id: TopicId | null;
  language: Language;
  title: string;
  status: string;
  publication_date: string;
  metadata: unknown;
  created_at: string;
};

export type PublishedContentItem = {
  id: string;
  content_type: string;
  topic_id: TopicId | null;
  language: Language;
  title: string;
  publication_date: string;
  metadata: unknown;
  created_at: string;
};

type DailyDropRow = {
  id: string;
};

type DailyDropAssignmentRow = {
  id: string;
  user_id: string;
  status: DailyDropStatus;
};

type DailyDropItemRow = {
  content_item_id: string;
  slot: DailyDropSlot;
  position: number;
};

type DailyDropItemInput = {
  contentItemId: string;
  slot: DailyDropSlot;
  position: number;
};

type DebugProfileRow = {
  id: string;
  language: Language;
};

type DebugUserPreferenceRow = {
  user_id: string;
};

type DebugTopicPreferenceRow = {
  user_id: string;
  enabled: boolean | null;
};

type DebugMiniCaseTopicPreferenceRow = {
  user_id: string;
  enabled: boolean | null;
};

type DebugDailyDropRow = {
  user_id: string;
  status: DailyDropStatus;
  language: Language;
};

type AppProfilePreferenceRow = {
  id: string;
  language: string | null;
};

type AppUserPreferenceRow = {
  user_id: string;
  goal: string | null;
  frequency: string | null;
  newsletter_enabled: boolean | null;
  business_stories_enabled: boolean | null;
  mini_cases_enabled: boolean | null;
  newsletter_article_count: number | null;
};

type AppUserTopicPreferenceRow = {
  user_id: string;
  topic_id: string | null;
  articles_count: number | null;
  position: number | null;
  enabled: boolean | null;
};

type AppUserMiniCasePreferenceRow = {
  user_id: string;
  topic_id: string | null;
  position: number | null;
  enabled: boolean | null;
};

export type UserDailyDropPreferenceSkip = {
  user_id: string;
  reason:
    | "invalid_profile_language"
    | "language_mismatch"
    | "missing_user_preferences"
    | "missing_enabled_user_topic_preferences"
    | "missing_enabled_user_mini_case_preferences";
  language: string | null;
  expectedLanguage: Language;
  enabledTopicCount?: number;
};

export type UserDailyDropPreferenceSelection = {
  preferences: UserDailyDropPreference[];
  skippedUsers: UserDailyDropPreferenceSkip[];
  profilesRead: number;
  userPreferencesRead: number;
  userTopicPreferencesRead: number;
  userMiniCasePreferencesRead: number;
};

export type DailyDropWriteResult = {
  dailyDropId: string;
  existingDropUpdated: boolean;
  linkedItems: number;
  staleItemsRemoved: number;
  duplicateInputItemsSkipped: number;
};

export type DailyJobUserDebugResult = {
  target: {
    dropDate: string;
    language: Language;
    userLimit: number;
  };
  counts: {
    profiles: number;
    profilesMatchingLanguage: number;
    userPreferences: number;
    topicPreferences: number;
    enabledTopicPreferences: number;
    miniCaseTopicPreferences: number;
    enabledMiniCaseTopicPreferences: number;
    dailyDropsOnDate: number;
    dailyDropsOnDateForLanguage: number;
    dailyJobConsideredBeforeLimit: number;
    dailyJobConsideredAfterLimit: number;
    eligibleNewAssignments: number;
    wouldUpdateExistingDrop: number;
  };
  skipReasons: {
    no_profile: number;
    no_preferences: number;
    no_topics: number;
    no_mini_case_topics: number;
    language_mismatch: number;
    already_has_drop: number;
  };
  notes: string[];
};

export type PersistTestCleanupResult = {
  testRunId: string;
  matchedContentItems: number;
  deletedContentItemSources: number;
  deletedContentItems: number;
  deletedGenerationRuns: number;
  skippedContentItems: Array<{
    id: string;
    title: string;
    status: string;
    reason: string;
  }>;
};

export class ContentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  assertPersistenceAvailable(): void {
    void this.supabase.from;
  }

  async assertPersistTestSchemaReady(topics: TopicId[]): Promise<void> {
    await this.assertTableReadable({
      table: "generation_runs",
      action: "preflight select generation runs",
      columns: "id"
    });
    await this.assertTableReadable({
      table: "sources",
      action: "preflight select sources",
      columns: "id"
    });
    await this.assertTableReadable({
      table: "content_items",
      action: "preflight select content items",
      columns: "id"
    });
    await this.assertTableReadable({
      table: "content_item_sources",
      action: "preflight select content item sources",
      columns: "content_item_id"
    });
    await this.assertTableReadable({
      table: "business_story_history",
      action: "preflight select business story editorial memory",
      columns: "id"
    });
    await this.assertTableReadable({
      table: "mini_case_history",
      action: "preflight select mini-case editorial memory",
      columns: "id"
    });

    const { data, error } = await this.supabase.from("topics").select("id").in("id", topics);

    if (error) {
      throwPersistenceError({
        table: "topics",
        action: "preflight select topic seed rows",
        error
      });
    }

    const foundTopics = new Set((data ?? []).map((topic: { id: string }) => topic.id));
    const missingTopics = topics.filter((topic) => !foundTopics.has(topic));

    if (missingTopics.length > 0) {
      throwPersistenceError({
        table: "topics",
        action: "verify topic seed rows",
        error: new Error(
          `Missing required topic seed row(s): ${missingTopics.join(", ")}. Apply the additive mobile app foundation migration to the target Supabase project before running persist-test.`
        )
      });
    }
  }

  private async assertTableReadable(input: {
    table: string;
    action: string;
    columns: string;
  }): Promise<void> {
    const { error } = await this.supabase.from(input.table).select(input.columns).limit(1);

    if (error) {
      throwPersistenceError({
        table: input.table,
        action: input.action,
        error
      });
    }
  }

  async cleanupPersistTestContent(testRunId: string): Promise<PersistTestCleanupResult> {
    const { data, error } = await this.supabase
      .from("content_items")
      .select("id,generation_run_id,title,status,metadata")
      .eq("metadata->>test_run_id", testRunId)
      .eq("metadata->>test_mode", "persist-test")
      .returns<PersistTestContentItemRow[]>();

    if (error) {
      throwPersistenceError({
        table: "content_items",
        action: "select persist-test content items for cleanup",
        error
      });
    }

    const rows = data ?? [];
    const verifiedRows = rows.filter((row) => isPersistTestContentItem(row, testRunId));
    const skippedContentItems = rows
      .filter((row) => !verifiedRows.includes(row))
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        reason: "metadata or title did not match persist-test safety markers"
      }));
    const draftRows = verifiedRows.filter((row) => row.status === "draft");
    const nonDraftRows = verifiedRows.filter((row) => row.status !== "draft");
    const deletableIds = draftRows.map((row) => row.id);
    const generationRunIds = draftRows
      .map((row) => row.generation_run_id)
      .filter((id): id is string => Boolean(id));

    skippedContentItems.push(
      ...nonDraftRows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        reason: "content item is not draft"
      }))
    );

    if (deletableIds.length === 0) {
      return {
        testRunId,
        matchedContentItems: rows.length,
        deletedContentItemSources: 0,
        deletedContentItems: 0,
        deletedGenerationRuns: 0,
        skippedContentItems
      };
    }

    const deletedContentItemSources = await this.deleteRowsByIds({
      table: "content_item_sources",
      idColumn: "content_item_id",
      ids: deletableIds,
      action: "delete persist-test content item sources"
    });
    const deletedContentItems = await this.deleteRowsByIds({
      table: "content_items",
      idColumn: "id",
      ids: deletableIds,
      action: "delete persist-test draft content items"
    });
    const deletedGenerationRuns = await this.deleteRowsByIds({
      table: "generation_runs",
      idColumn: "id",
      ids: generationRunIds,
      action: "delete persist-test generation runs"
    });

    return {
      testRunId,
      matchedContentItems: rows.length,
      deletedContentItemSources,
      deletedContentItems,
      deletedGenerationRuns,
      skippedContentItems
    };
  }

  async listPublishedPersistTestContent(testRunId?: string): Promise<PublishedPersistTestContentItem[]> {
    let query = this.supabase
      .from("content_items")
      .select("id,content_type,topic_id,language,title,status,publication_date,metadata,created_at")
      .eq("status", "published")
      .eq("metadata->>test_mode", "persist-test")
      .eq("metadata->>is_test_data", "true")
      .order("created_at", { ascending: false });

    if (testRunId) {
      query = query.eq("metadata->>test_run_id", testRunId);
    }

    const { data, error } = await query.returns<PublishedPersistTestContentItem[]>();

    if (error) {
      throwPersistenceError({
        table: "content_items",
        action: "select published persist-test content items",
        error
      });
    }

    return (data ?? []).filter(isPublishedPersistTestContentItem);
  }

  async listPublishedContentItems(input: {
    languages: Language[];
    publicationDateLte: string;
  }): Promise<PublishedContentItem[]> {
    const uniqueLanguages = [...new Set(input.languages)];

    if (uniqueLanguages.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("content_items")
      .select("id,content_type,topic_id,language,title,publication_date,metadata,created_at")
      .eq("status", "published")
      .in("language", uniqueLanguages)
      .lte("publication_date", input.publicationDateLte)
      .order("publication_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<PublishedContentItem[]>();

    if (error) {
      throwPersistenceError({
        table: "content_items",
        action: "select published content items for personalization",
        error
      });
    }

    return data ?? [];
  }

  private async deleteRowsByIds(input: {
    table: string;
    idColumn: string;
    ids: string[];
    action: string;
  }): Promise<number> {
    const uniqueIds = [...new Set(input.ids)];

    if (uniqueIds.length === 0) {
      return 0;
    }

    const { data, error } = await this.supabase
      .from(input.table)
      .delete()
      .in(input.idColumn, uniqueIds)
      .select(input.idColumn);

    if (error) {
      throwPersistenceError({
        table: input.table,
        action: input.action,
        error
      });
    }

    return data?.length ?? 0;
  }

  async insertGenerationRun(input: {
    runDate: string;
    contentType: string;
    language: Language;
    promptVersion: string;
    generatorVersion: string;
    inputHash: string;
  }): Promise<string> {
    const { data, error } = await this.supabase
      .from("generation_runs")
      .insert({
        run_date: input.runDate,
        content_type: input.contentType,
        language: input.language,
        status: "running",
        prompt_version: input.promptVersion,
        generator_version: input.generatorVersion,
        input_hash: input.inputHash,
        started_at: new Date().toISOString()
      })
      .select("id")
      .single<GenerationRunRow>();

    if (error) {
      throwPersistenceError({
        table: "generation_runs",
        action: "insert generation run",
        error
      });
    }

    return data.id;
  }

  async createGenerationRun(input: {
    runDate: string;
    contentType: string;
    language: Language;
    promptVersion: string;
    generatorVersion: string;
    inputHash: string;
  }): Promise<string> {
    return this.insertGenerationRun(input);
  }

  async startJobRun(input: {
    runId: string;
    jobType: "daily-job" | "daily-job-test";
    runDate: string;
    dryRun: boolean;
    generator: "dry-run" | "llm";
    sourceMode: "sample" | "rss" | "mixed";
    languages: Language[];
    topics: TopicId[];
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.from("job_runs").upsert(
      {
        run_id: input.runId,
        job_type: input.jobType,
        run_date: input.runDate,
        status: "running",
        dry_run: input.dryRun,
        generator: input.generator,
        source_mode: input.sourceMode,
        languages: input.languages,
        topics: input.topics,
        metrics: {},
        operator_summary: {},
        error: null,
        started_at: now,
        completed_at: null,
        updated_at: now
      },
      { onConflict: "run_id" }
    );

    if (error) {
      throwPersistenceError({
        table: "job_runs",
        action: "upsert job run start",
        error
      });
    }
  }

  async completeJobRun(input: {
    runId: string;
    status: Exclude<JobRunStatus, "running">;
    metrics: Record<string, unknown>;
    operatorSummary: Record<string, unknown>;
    error?: string | null;
  }): Promise<void> {
    const { error } = await this.supabase
      .from("job_runs")
      .update({
        status: input.status,
        metrics: input.metrics,
        operator_summary: input.operatorSummary,
        error: input.error ?? null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("run_id", input.runId);

    if (error) {
      throwPersistenceError({
        table: "job_runs",
        action: "complete job run",
        error
      });
    }
  }

  async listJobRuns(input: {
    runDate?: string;
    limit: number;
  }): Promise<JobRunRow[]> {
    let query = this.supabase
      .from("job_runs")
      .select(
        "id,run_id,job_type,run_date,status,dry_run,generator,source_mode,languages,topics,metrics,operator_summary,error,started_at,completed_at,created_at,updated_at"
      )
      .order("run_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(input.limit);

    if (input.runDate) {
      query = query.eq("run_date", input.runDate);
    }

    const { data, error } = await query.returns<JobRunRow[]>();

    if (error) {
      throwPersistenceError({
        table: "job_runs",
        action: "select job runs",
        error
      });
    }

    return data ?? [];
  }

  async completeGenerationRun(id: string, outputHash: string, status: "generated" | "published" = "generated"): Promise<void> {
    const { error } = await this.supabase
      .from("generation_runs")
      .update({
        status,
        output_hash: outputHash,
        completed_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      throwPersistenceError({
        table: "generation_runs",
        action: "complete generation run",
        error
      });
    }
  }

  async failGenerationRun(id: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from("generation_runs")
      .update({
        status: "failed",
        error: errorMessage,
        completed_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      throwPersistenceError({
        table: "generation_runs",
        action: "mark generation run failed",
        error
      });
    }
  }

  async upsertSources(articles: RankedArticle[]): Promise<Map<string, string>> {
    const uniqueSources = mapArticlesToSourceUpserts(articles);

    if (uniqueSources.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from("sources")
      .upsert(uniqueSources, { onConflict: "url" })
      .select("id,url")
      .returns<SourceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "sources",
        action: "upsert sources",
        error
      });
    }

    return new Map((data ?? []).map((source) => [source.url, source.id]));
  }

  async insertContentItem(insert: ContentItemInsert): Promise<string> {
    const { data, error } = await this.supabase.from("content_items").insert(insert).select("id").single<ContentItemRow>();

    if (error) {
      throwPersistenceError({
        table: "content_items",
        action: "insert content item",
        error
      });
    }

    return data.id;
  }

  async findExistingContentItemByDedupKey(dedupKey: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("content_items")
      .select("id")
      .eq("metadata->>dedup_key", dedupKey)
      .neq("status", "archived")
      .limit(1)
      .returns<ContentItemDedupRow[]>();

    if (error) {
      throwPersistenceError({
        table: "content_items",
        action: "select content item by dedup key",
        error
      });
    }

    return data?.[0]?.id ?? null;
  }

  async insertContentItemSources(sourceLinks: ContentItemSourceInsert[]): Promise<void> {
    if (sourceLinks.length === 0) {
      return;
    }

    const { error } = await this.supabase.from("content_item_sources").insert(sourceLinks);

    if (error) {
      throwPersistenceError({
        table: "content_item_sources",
        action: "insert content item sources",
        error
      });
    }
  }

  async upsertBusinessStoryHistory(entry: BusinessStoryEditorialMemoryEntry): Promise<void> {
    const { error } = await this.supabase
      .from("business_story_history")
      .upsert(
        {
          content_item_id: entry.content_item_id,
          title: entry.title,
          slug: entry.slug,
          entity_name: entry.entity_name,
          entity_type: entry.entity_type,
          main_company: entry.main_company,
          companies_mentioned: entry.companies_mentioned,
          industry: entry.industry,
          key_mechanism: entry.key_mechanism,
          secondary_mechanisms: entry.secondary_mechanisms,
          strategic_angle: entry.strategic_angle,
          core_takeaway: entry.core_takeaway,
          year_period: entry.year_period,
          language: entry.language,
          published_date: entry.published_date
        },
        { onConflict: "slug" }
      );

    if (error) {
      throwPersistenceError({
        table: "business_story_history",
        action: "upsert business story editorial memory",
        error
      });
    }
  }

  async upsertMiniCaseHistory(entry: MiniCaseEditorialMemoryRecord): Promise<void> {
    const { error } = await this.supabase
      .from("mini_case_history")
      .upsert(
        {
          content_item_id: entry.content_item_id,
          title: entry.title,
          slug: entry.slug,
          topic: entry.topic,
          scenario_type: entry.scenario_type,
          decision_type: entry.decision_type,
          concept_tested: entry.concept_tested,
          mechanism: entry.mechanism,
          difficulty: entry.difficulty,
          question_pattern: entry.question_pattern,
          correct_answer_pattern: entry.correct_answer_pattern,
          core_takeaway: entry.core_takeaway,
          published_date: entry.published_date,
          language: entry.language
        },
        { onConflict: "slug" }
      );

    if (error) {
      throwPersistenceError({
        table: "mini_case_history",
        action: "upsert mini-case editorial memory",
        error
      });
    }
  }

  async storeDailyPayload(input: {
    payload: DailyDropPayload;
    articles: RankedArticle[];
    contentStatus: "draft" | "review" | "published";
    metadata?: Record<string, unknown>;
  }): Promise<StoredGeneratedItem[]> {
    assertDailyPayloadSourcesArePersistable({
      payload: input.payload,
      articles: input.articles
    });

    const sourceIdsByUrl = await this.upsertSources(input.articles);
    const storedItems: StoredGeneratedItem[] = [];

    for (const item of input.payload.items) {
      const runId = await this.insertGenerationRun({
        runDate: input.payload.drop_date,
        contentType: item.content_type,
        language: input.payload.language,
        promptVersion: input.payload.prompt_version,
        generatorVersion: input.payload.generator_version,
        inputHash: sha256(item.source_urls.join("|"))
      });

      try {
        const dedup = buildContentItemDedup({
          item,
          language: input.payload.language,
          metadata: input.metadata
        });
        const insert = mapGeneratedItemToContentInsert(
          item,
          input.payload.drop_date,
          input.contentStatus,
          runId,
          dedup
            ? {
                ...input.metadata,
                dedup_key: dedup.key,
                dedup_run_id: dedup.runId,
                source_url_fingerprint: dedup.sourceUrlFingerprint
              }
            : input.metadata
        );
        const existingContentItemId = dedup ? await this.findExistingContentItemByDedupKey(dedup.key) : null;
        const contentItemId = existingContentItemId ?? (await this.insertContentItem(insert));
        const sourceLinks = mapContentItemSourceInserts({
          contentItemId,
          sourceUrls: item.source_urls,
          sourceIdsByUrl
        });

        if (!existingContentItemId) {
          await this.insertContentItemSources(sourceLinks);
        }
        if (item.content_type === "business_story") {
          await this.upsertBusinessStoryHistory(
            buildBusinessStoryEditorialMemory({
              item,
              contentItemId,
              publishedDate: input.payload.drop_date
            })
          );
        }
        if (item.content_type === "mini_case") {
          const memory = miniCaseMemoryFromItem({
            item,
            contentItemId,
            publishedDate: input.payload.drop_date
          });
          if (memory) {
            await this.upsertMiniCaseHistory(memory);
          }
        }
        await this.completeGenerationRun(runId, sha256(JSON.stringify(item)), input.contentStatus === "published" ? "published" : "generated");
        storedItems.push({
          item,
          content_item_id: contentItemId,
          reused_existing_content_item: Boolean(existingContentItemId),
          dedup_key: dedup?.key ?? null
        });
      } catch (error) {
        await this.failGenerationRun(runId, error instanceof Error ? error.message : JSON.stringify(error));
        throw error;
      }
    }

    return storedItems;
  }

  async listBusinessStoryMemoryContext(input: {
    language: Language;
    dropDate: string;
  }): Promise<BusinessStoryMemoryContext> {
    const { data, error } = await this.supabase
      .from("business_story_history")
      .select(
        "id,content_item_id,title,slug,entity_name,entity_type,main_company,companies_mentioned,industry,key_mechanism,secondary_mechanisms,strategic_angle,core_takeaway,year_period,language,published_date,created_at"
      )
      .eq("language", input.language)
      .lte("published_date", input.dropDate)
      .order("published_date", { ascending: false })
      .limit(180)
      .returns<BusinessStoryHistoryRow[]>();

    if (error) {
      throwPersistenceError({
        table: "business_story_history",
        action: "select business story editorial memory",
        error
      });
    }

    return buildBusinessStoryMemoryContext({
      entries: (data ?? []).map(mapBusinessStoryHistoryRow),
      dropDate: input.dropDate,
      language: input.language
    });
  }

  async listMiniCaseMemoryContext(input: {
    language: Language;
    dropDate: string;
  }): Promise<MiniCaseMemoryContext> {
    const { data, error } = await this.supabase
      .from("mini_case_history")
      .select(
        "id,content_item_id,title,slug,topic,scenario_type,decision_type,concept_tested,mechanism,difficulty,question_pattern,correct_answer_pattern,core_takeaway,published_date,language,created_at"
      )
      .eq("language", input.language)
      .lte("published_date", input.dropDate)
      .order("published_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60)
      .returns<MiniCaseHistoryRow[]>();

    if (error) {
      throwPersistenceError({
        table: "mini_case_history",
        action: "select mini-case editorial memory",
        error
      });
    }

    return buildMiniCaseMemoryContext({
      records: (data ?? []).map(mapMiniCaseHistoryRow),
      dropDate: input.dropDate
    });
  }

  async listBusinessStoryHistoryReport(input: {
    language?: Language;
    dropDate: string;
    limit: number;
  }): Promise<BusinessStoryMemoryContext> {
    let query = this.supabase
      .from("business_story_history")
      .select(
        "id,content_item_id,title,slug,entity_name,entity_type,main_company,companies_mentioned,industry,key_mechanism,secondary_mechanisms,strategic_angle,core_takeaway,year_period,language,published_date,created_at"
      )
      .lte("published_date", input.dropDate)
      .order("published_date", { ascending: false })
      .limit(Math.max(180, input.limit));

    if (input.language) {
      query = query.eq("language", input.language);
    }

    const { data, error } = await query.returns<BusinessStoryHistoryRow[]>();

    if (error) {
      throwPersistenceError({
        table: "business_story_history",
        action: "select business story history report",
        error
      });
    }

    return buildBusinessStoryMemoryContext({
      entries: (data ?? []).map(mapBusinessStoryHistoryRow),
      dropDate: input.dropDate,
      language: input.language
    });
  }

  async listUserDailyDropPreferences(language: Language): Promise<UserDailyDropPreference[]> {
    return (await this.listUserDailyDropPreferenceSelection(language)).preferences;
  }

  async listUserDailyDropPreferenceSelection(language: Language): Promise<UserDailyDropPreferenceSelection> {
    const profiles = await this.listAppProfilesForPreferenceSelection();
    const profileIds = profiles.map((profile) => profile.id);
    const [preferences, topicPreferences, miniCaseTopicPreferences] = await Promise.all([
      this.listAppUserPreferences(profileIds),
      this.listAppUserTopicPreferences(profileIds),
      this.listAppUserMiniCaseTopicPreferences(profileIds)
    ]);
    const preferencesByUserId = new Map(preferences.map((preference) => [preference.user_id, preference]));
    const topicsByUserId = groupTopicPreferencesByUserId(topicPreferences);
    const miniCaseTopicsByUserId = groupMiniCaseTopicPreferencesByUserId(miniCaseTopicPreferences);
    const selectedPreferences: UserDailyDropPreference[] = [];
    const skippedUsers: UserDailyDropPreferenceSkip[] = [];

    for (const profile of profiles.sort((left, right) => left.id.localeCompare(right.id))) {
      if (!isLanguage(profile.language ?? "")) {
        skippedUsers.push({
          user_id: profile.id,
          reason: "invalid_profile_language",
          language: profile.language,
          expectedLanguage: language
        });
        continue;
      }

      if (profile.language !== language) {
        skippedUsers.push({
          user_id: profile.id,
          reason: "language_mismatch",
          language: profile.language,
          expectedLanguage: language
        });
        continue;
      }

      const preference = preferencesByUserId.get(profile.id);

      if (!preference) {
        skippedUsers.push({
          user_id: profile.id,
          reason: "missing_user_preferences",
          language: profile.language,
          expectedLanguage: language
        });
        continue;
      }

      const enabledTopics = (topicsByUserId.get(profile.id) ?? [])
        .filter((topic) => topic.enabled !== false)
        .filter((topic) => isTopicId(topic.topic_id ?? ""));

      const modules = {
        newsletter: preference.newsletter_enabled !== false,
        business_story: preference.business_stories_enabled !== false,
        mini_case: preference.mini_cases_enabled !== false
      };

      if (modules.newsletter && enabledTopics.length === 0) {
        skippedUsers.push({
          user_id: profile.id,
          reason: "missing_enabled_user_topic_preferences",
          language: profile.language,
          expectedLanguage: language,
          enabledTopicCount: 0
        });
        continue;
      }

      const enabledMiniCaseTopics = (miniCaseTopicsByUserId.get(profile.id) ?? [])
        .filter((topic) => topic.enabled !== false)
        .map((topic) => ({
          ...topic,
          topic_id: normalizeMiniCasePreferenceTopicId(topic.topic_id)
        }))
        .filter((topic): topic is AppUserMiniCasePreferenceRow & { topic_id: MiniCaseTopicId } =>
          Boolean(topic.topic_id)
        );

      if (modules.mini_case && enabledMiniCaseTopics.length === 0) {
        skippedUsers.push({
          user_id: profile.id,
          reason: "missing_enabled_user_mini_case_preferences",
          language: profile.language,
          expectedLanguage: language,
          enabledTopicCount: enabledTopics.length
        });
        continue;
      }

      selectedPreferences.push({
        user_id: profile.id,
        language,
        goal: String(preference.goal ?? "become_sharper_daily") as UserDailyDropPreference["goal"],
        frequency: String(preference.frequency ?? "daily") as UserDailyDropPreference["frequency"],
        newsletter_article_count: normalizeNewsletterArticleCount(preference.newsletter_article_count),
        modules,
        mini_case_topics: enabledMiniCaseTopics.map((topic) => ({
          topic_id: topic.topic_id,
          position: topic.position === null || topic.position === undefined ? null : Number(topic.position)
        })),
        topics: enabledTopics.map((topic) => ({
          topic_id: topic.topic_id as UserDailyDropPreference["topics"][number]["topic_id"],
          articles_count: normalizeArticlesCount(topic.articles_count),
          position: topic.position === null || topic.position === undefined ? null : Number(topic.position)
        }))
      });
    }

    return {
      preferences: selectedPreferences,
      skippedUsers,
      profilesRead: profiles.length,
      userPreferencesRead: preferences.length,
      userTopicPreferencesRead: topicPreferences.length,
      userMiniCasePreferencesRead: miniCaseTopicPreferences.length
    };
  }

  async debugDailyJobUsers(input: {
    dropDate: string;
    language: Language;
    userLimit: number;
  }): Promise<DailyJobUserDebugResult> {
    const [profiles, preferences, topicPreferences, miniCaseTopicPreferences, dailyDrops] = await Promise.all([
      this.listDebugProfiles(),
      this.listDebugUserPreferences(),
      this.listDebugTopicPreferences(),
      this.listDebugMiniCaseTopicPreferences(),
      this.listDebugDailyDrops(input.dropDate)
    ]);
    const profileIds = new Set(profiles.map((profile) => profile.id));
    const preferencesByUser = new Set(preferences.map((preference) => preference.user_id));
    const enabledTopicsByUser = new Set(
      topicPreferences
        .filter((topic) => topic.enabled !== false)
        .map((topic) => topic.user_id)
    );
    const enabledMiniCaseTopicsByUser = new Set(
      miniCaseTopicPreferences
        .filter((topic) => topic.enabled !== false)
        .map((topic) => topic.user_id)
    );
    const dailyDropsByUser = new Set(dailyDrops.map((drop) => drop.user_id));
    const orphanUserIds = new Set<string>();

    for (const preference of preferences) {
      if (!profileIds.has(preference.user_id)) {
        orphanUserIds.add(preference.user_id);
      }
    }

    for (const topic of topicPreferences) {
      if (!profileIds.has(topic.user_id)) {
        orphanUserIds.add(topic.user_id);
      }
    }

    for (const topic of miniCaseTopicPreferences) {
      if (!profileIds.has(topic.user_id)) {
        orphanUserIds.add(topic.user_id);
      }
    }

    for (const drop of dailyDrops) {
      if (!profileIds.has(drop.user_id)) {
        orphanUserIds.add(drop.user_id);
      }
    }

    const profilesMatchingLanguage = profiles.filter((profile) => profile.language === input.language);
    const assignmentReadyProfiles = profilesMatchingLanguage.filter((profile) => {
      return (
        preferencesByUser.has(profile.id) &&
        enabledTopicsByUser.has(profile.id) &&
        enabledMiniCaseTopicsByUser.has(profile.id)
      );
    });
    const dailyJobConsideredBeforeLimit = assignmentReadyProfiles.length;
    const alreadyHasDrop = assignmentReadyProfiles.filter((profile) => dailyDropsByUser.has(profile.id)).length;

    return {
      target: {
        dropDate: input.dropDate,
        language: input.language,
        userLimit: input.userLimit
      },
      counts: {
        profiles: profiles.length,
        profilesMatchingLanguage: profilesMatchingLanguage.length,
        userPreferences: preferences.length,
        topicPreferences: topicPreferences.length,
        enabledTopicPreferences: topicPreferences.filter((topic) => topic.enabled !== false).length,
        miniCaseTopicPreferences: miniCaseTopicPreferences.length,
        enabledMiniCaseTopicPreferences: miniCaseTopicPreferences.filter((topic) => topic.enabled !== false).length,
        dailyDropsOnDate: dailyDrops.length,
        dailyDropsOnDateForLanguage: dailyDrops.filter((drop) => drop.language === input.language).length,
        dailyJobConsideredBeforeLimit,
        dailyJobConsideredAfterLimit: Math.min(dailyJobConsideredBeforeLimit, input.userLimit),
        eligibleNewAssignments: assignmentReadyProfiles.length - alreadyHasDrop,
        wouldUpdateExistingDrop: alreadyHasDrop
      },
      skipReasons: {
        no_profile: orphanUserIds.size,
        no_preferences: profilesMatchingLanguage.filter((profile) => !preferencesByUser.has(profile.id)).length,
        no_topics: profilesMatchingLanguage.filter((profile) => {
          return preferencesByUser.has(profile.id) && !enabledTopicsByUser.has(profile.id);
        }).length,
        no_mini_case_topics: profilesMatchingLanguage.filter((profile) => {
          return (
            preferencesByUser.has(profile.id) &&
            enabledTopicsByUser.has(profile.id) &&
            !enabledMiniCaseTopicsByUser.has(profile.id)
          );
        }).length,
        language_mismatch: profiles.filter((profile) => profile.language !== input.language).length,
        already_has_drop: alreadyHasDrop
      },
      notes: [
        "No emails are selected or printed by this diagnostic.",
        "dailyJobConsideredBeforeLimit mirrors daily-job-test user selection: matching profile language, user_preferences, at least one enabled newsletter topic, and at least one enabled mini-case topic.",
        "eligibleNewAssignments additionally requires no daily_drops row for the target date.",
        "daily-job-test updates existing user/date drops; already_has_drop explains why a user is not a new assignment."
      ]
    };
  }

  private async listAppProfilesForPreferenceSelection(): Promise<AppProfilePreferenceRow[]> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id,language")
      .returns<AppProfilePreferenceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "profiles",
        action: "select profiles for daily drop preference selection",
        error
      });
    }

    return data ?? [];
  }

  private async listAppUserPreferences(userIds: string[]): Promise<AppUserPreferenceRow[]> {
    const uniqueUserIds = [...new Set(userIds)];

    if (uniqueUserIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("user_preferences")
      .select("user_id,goal,frequency,newsletter_enabled,business_stories_enabled,mini_cases_enabled,newsletter_article_count")
      .in("user_id", uniqueUserIds)
      .returns<AppUserPreferenceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "user_preferences",
        action: "select user preferences for daily drop preference selection",
        error
      });
    }

    return data ?? [];
  }

  private async listAppUserMiniCaseTopicPreferences(userIds: string[]): Promise<AppUserMiniCasePreferenceRow[]> {
    const uniqueUserIds = [...new Set(userIds)];

    if (uniqueUserIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("user_mini_case_topic_preferences")
      .select("user_id,topic_id,position,enabled")
      .in("user_id", uniqueUserIds)
      .order("position", { ascending: true, nullsFirst: false })
      .order("topic_id", { ascending: true })
      .returns<AppUserMiniCasePreferenceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "user_mini_case_topic_preferences",
        action: "select mini-case topic preferences for daily drop preference selection",
        error
      });
    }

    return data ?? [];
  }

  private async listAppUserTopicPreferences(userIds: string[]): Promise<AppUserTopicPreferenceRow[]> {
    const uniqueUserIds = [...new Set(userIds)];

    if (uniqueUserIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("user_topic_preferences")
      .select("user_id,topic_id,articles_count,position,enabled")
      .in("user_id", uniqueUserIds)
      .order("position", { ascending: true, nullsFirst: false })
      .order("topic_id", { ascending: true })
      .returns<AppUserTopicPreferenceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "user_topic_preferences",
        action: "select user topic preferences for daily drop preference selection",
        error
      });
    }

    return data ?? [];
  }

  private async listDebugProfiles(): Promise<DebugProfileRow[]> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id,language")
      .returns<DebugProfileRow[]>();

    if (error) {
      throwPersistenceError({
        table: "profiles",
        action: "select profiles for user debug",
        error
      });
    }

    return data ?? [];
  }

  private async listDebugUserPreferences(): Promise<DebugUserPreferenceRow[]> {
    const { data, error } = await this.supabase
      .from("user_preferences")
      .select("user_id")
      .returns<DebugUserPreferenceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "user_preferences",
        action: "select user preferences for user debug",
        error
      });
    }

    return data ?? [];
  }

  private async listDebugTopicPreferences(): Promise<DebugTopicPreferenceRow[]> {
    const { data, error } = await this.supabase
      .from("user_topic_preferences")
      .select("user_id,enabled")
      .returns<DebugTopicPreferenceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "user_topic_preferences",
        action: "select topic preferences for user debug",
        error
      });
    }

    return data ?? [];
  }

  private async listDebugMiniCaseTopicPreferences(): Promise<DebugMiniCaseTopicPreferenceRow[]> {
    const { data, error } = await this.supabase
      .from("user_mini_case_topic_preferences")
      .select("user_id,enabled")
      .returns<DebugMiniCaseTopicPreferenceRow[]>();

    if (error) {
      throwPersistenceError({
        table: "user_mini_case_topic_preferences",
        action: "select mini-case topic preferences for user debug",
        error
      });
    }

    return data ?? [];
  }

  private async listDebugDailyDrops(dropDate: string): Promise<DebugDailyDropRow[]> {
    const { data, error } = await this.supabase
      .from("daily_drops")
      .select("user_id,status,language")
      .eq("drop_date", dropDate)
      .returns<DebugDailyDropRow[]>();

    if (error) {
      throwPersistenceError({
        table: "daily_drops",
        action: "select daily drops for user debug",
        error
      });
    }

    return data ?? [];
  }

  async listDailyDropsForUsersOnDate(input: {
    userIds: string[];
    dropDate: string;
  }): Promise<Map<string, DailyDropAssignmentRow>> {
    const userIds = [...new Set(input.userIds)];

    if (userIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from("daily_drops")
      .select("id,user_id,status")
      .eq("drop_date", input.dropDate)
      .in("user_id", userIds)
      .returns<DailyDropAssignmentRow[]>();

    if (error) {
      throwPersistenceError({
        table: "daily_drops",
        action: "select existing daily drops for users on date",
        error
      });
    }

    return new Map((data ?? []).map((drop) => [drop.user_id, drop]));
  }

  async createDailyDropForUser(input: {
    userId: string;
    dropDate: string;
    language: Language;
    status: DailyDropStatus;
    itemIds: DailyDropItemInput[];
  }): Promise<string> {
    return (await this.createDailyDropForUserWithResult(input)).dailyDropId;
  }

  async createDailyDropForUserWithResult(input: {
    userId: string;
    dropDate: string;
    language: Language;
    status: DailyDropStatus;
    itemIds: DailyDropItemInput[];
  }): Promise<DailyDropWriteResult> {
    const existingDrop = await this.listDailyDropsForUsersOnDate({
      userIds: [input.userId],
      dropDate: input.dropDate
    });
    const dailyDropId = await this.insertDailyDrop({
      userId: input.userId,
      dropDate: input.dropDate,
      language: input.language,
      status: input.status
    });
    const replaceResult = await this.replaceDailyDropItems(dailyDropId, input.itemIds);

    return {
      dailyDropId,
      existingDropUpdated: existingDrop.has(input.userId),
      linkedItems: replaceResult.linkedItems,
      staleItemsRemoved: replaceResult.staleItemsRemoved,
      duplicateInputItemsSkipped: replaceResult.duplicateInputItemsSkipped
    };
  }

  async insertDailyDrop(input: {
    userId: string;
    dropDate: string;
    language: Language;
    status: DailyDropStatus;
  }): Promise<string> {
    const publishedAt = input.status === "published" ? new Date().toISOString() : null;
    const { data, error } = await this.supabase
      .from("daily_drops")
      .upsert(
        {
          user_id: input.userId,
          drop_date: input.dropDate,
          language: input.language,
          status: input.status,
          published_at: publishedAt,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id,drop_date" }
      )
      .select("id")
      .single<DailyDropRow>();

    if (error) {
      throwPersistenceError({
        table: "daily_drops",
        action: "upsert daily drop",
        error
      });
    }

    return data.id;
  }

  async insertDailyDropItems(
    items: Array<{
      dailyDropId: string;
      contentItemId: string;
      slot: DailyDropSlot;
      position: number;
    }>
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const itemsByDrop = new Map<string, DailyDropItemInput[]>();

    for (const item of items) {
      const group = itemsByDrop.get(item.dailyDropId) ?? [];
      group.push({
        contentItemId: item.contentItemId,
        slot: item.slot,
        position: item.position
      });
      itemsByDrop.set(item.dailyDropId, group);
    }

    for (const [dailyDropId, dropItems] of itemsByDrop) {
      await this.replaceDailyDropItems(dailyDropId, dropItems);
    }
  }

  private async replaceDailyDropItems(
    dailyDropId: string,
    items: DailyDropItemInput[]
  ): Promise<{
    linkedItems: number;
    staleItemsRemoved: number;
    duplicateInputItemsSkipped: number;
  }> {
    const normalized = normalizeDailyDropItems(items);
    const existingItems = await this.listDailyDropItems(dailyDropId);
    const desiredPositions = new Set(normalized.items.map((item) => dailyDropItemPositionKey(item)));
    const desiredContentIds = new Set(normalized.items.map((item) => item.contentItemId));
    const staleItems = existingItems.filter((item) => !desiredPositions.has(dailyDropItemPositionKey(item)));
    const conflictingStaleItems = staleItems.filter((item) => desiredContentIds.has(item.content_item_id));
    const nonConflictingStaleItems = staleItems.filter((item) => !desiredContentIds.has(item.content_item_id));
    let staleItemsRemoved = 0;

    for (const staleItem of conflictingStaleItems) {
      staleItemsRemoved += await this.deleteDailyDropItem({
        dailyDropId,
        contentItemId: staleItem.content_item_id,
        slot: staleItem.slot,
        position: staleItem.position
      });
    }

    if (normalized.items.length > 0) {
      const { error } = await this.supabase.from("daily_drop_items").upsert(
        normalized.items.map((item) => ({
          daily_drop_id: dailyDropId,
          content_item_id: item.contentItemId,
          slot: item.slot,
          position: item.position
        })),
        { onConflict: "daily_drop_id,slot,position" }
      );

      if (error) {
        throwPersistenceError({
          table: "daily_drop_items",
          action: "replace daily drop items",
          error
        });
      }
    }

    for (const staleItem of nonConflictingStaleItems) {
      staleItemsRemoved += await this.deleteDailyDropItem({
        dailyDropId,
        contentItemId: staleItem.content_item_id,
        slot: staleItem.slot,
        position: staleItem.position
      });
    }

    return {
      linkedItems: normalized.items.length,
      staleItemsRemoved,
      duplicateInputItemsSkipped: normalized.duplicatesSkipped
    };
  }

  private async listDailyDropItems(dailyDropId: string): Promise<DailyDropItemRow[]> {
    const { data, error } = await this.supabase
      .from("daily_drop_items")
      .select("content_item_id,slot,position")
      .eq("daily_drop_id", dailyDropId)
      .returns<DailyDropItemRow[]>();

    if (error) {
      throwPersistenceError({
        table: "daily_drop_items",
        action: "select existing daily drop items",
        error
      });
    }

    return data ?? [];
  }

  private async deleteDailyDropItem(input: {
    dailyDropId: string;
    contentItemId: string;
    slot: DailyDropSlot;
    position: number;
  }): Promise<number> {
    const { data, error } = await this.supabase
      .from("daily_drop_items")
      .delete()
      .eq("daily_drop_id", input.dailyDropId)
      .eq("content_item_id", input.contentItemId)
      .eq("slot", input.slot)
      .eq("position", input.position)
      .select("content_item_id");

    if (error) {
      throwPersistenceError({
        table: "daily_drop_items",
        action: "delete stale daily drop item",
        error
      });
    }

    return data?.length ?? 0;
  }
}

function normalizeDailyDropItems(items: DailyDropItemInput[]): {
  items: DailyDropItemInput[];
  duplicatesSkipped: number;
} {
  const normalized: DailyDropItemInput[] = [];
  const seenSlotPositions = new Set<string>();
  const seenSlotContent = new Set<string>();
  let duplicatesSkipped = 0;

  for (const item of items) {
    const slotPositionKey = dailyDropItemPositionKey(item);
    const slotContentKey = `${item.slot}:${item.contentItemId}`;

    if (seenSlotPositions.has(slotPositionKey) || seenSlotContent.has(slotContentKey)) {
      duplicatesSkipped += 1;
      continue;
    }

    seenSlotPositions.add(slotPositionKey);
    seenSlotContent.add(slotContentKey);
    normalized.push(item);
  }

  return {
    items: normalized,
    duplicatesSkipped
  };
}

function dailyDropItemPositionKey(item: {
  slot: DailyDropSlot;
  position: number;
}): string {
  return `${item.slot}:${item.position}`;
}

function buildContentItemDedup(input: {
  item: GeneratedContentItem;
  language: Language;
  metadata?: Record<string, unknown>;
}): {
  key: string;
  runId: string;
  sourceUrlFingerprint: string;
} | null {
  const runId = readMetadataString(input.metadata, "scheduler_run_id") ?? readMetadataString(input.metadata, "run_id");
  const sourceUrls = normalizeSourceUrlsForDedup(input.item.source_urls);

  if (!runId || sourceUrls.length === 0) {
    return null;
  }

  const topic = input.item.topic ?? "none";
  const sourceUrlFingerprint = sha256(sourceUrls.join("|"));
  const key = sha256([runId, input.language, input.item.content_type, topic, sourceUrlFingerprint].join("|"));

  return {
    key,
    runId,
    sourceUrlFingerprint
  };
}

function normalizeSourceUrlsForDedup(urls: string[]): string[] {
  const normalized = new Set<string>();

  for (const url of urls) {
    try {
      normalized.add(normalizeUrl(url));
    } catch {
      normalized.add(url.trim());
    }
  }

  return Array.from(normalized).filter(Boolean).sort();
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function groupTopicPreferencesByUserId(
  rows: AppUserTopicPreferenceRow[]
): Map<string, AppUserTopicPreferenceRow[]> {
  const groupedRows = new Map<string, AppUserTopicPreferenceRow[]>();

  for (const row of rows) {
    groupedRows.set(row.user_id, [...(groupedRows.get(row.user_id) ?? []), row]);
  }

  return groupedRows;
}

function groupMiniCaseTopicPreferencesByUserId(
  rows: AppUserMiniCasePreferenceRow[]
): Map<string, AppUserMiniCasePreferenceRow[]> {
  const groupedRows = new Map<string, AppUserMiniCasePreferenceRow[]>();

  for (const row of rows) {
    groupedRows.set(row.user_id, [...(groupedRows.get(row.user_id) ?? []), row]);
  }

  return groupedRows;
}

function normalizeMiniCasePreferenceTopicId(value: string | null): MiniCaseTopicId | null {
  if (!value) {
    return null;
  }

  if (isMiniCaseTopicId(value)) {
    return value;
  }

  if (!isTopicId(value)) {
    switch (value) {
      case "ai":
      case "law_compliance":
      case "health_pharma":
      case "engineering_operations":
      case "finance_economy":
      case "stock_market":
        return value;
      case "artificial_intelligence":
        return "ai";
      case "health":
        return "health_pharma";
      case "market":
        return "stock_market";
      default:
        return null;
    }
  }

  switch (value) {
    case "law":
      return "law_compliance";
    case "finance":
      return "finance_economy";
    case "tech_ai":
      return "ai";
    case "business":
      return "stock_market";
    case "medicine":
      return "health_pharma";
    case "engineering":
      return "engineering_operations";
    case "sport_business":
      return "stock_market";
    case "culture_media":
      return "ai";
    default:
      return null;
  }
}

function mapBusinessStoryHistoryRow(row: BusinessStoryHistoryRow): BusinessStoryEditorialMemoryEntry {
  return {
    id: row.id,
    content_item_id: row.content_item_id,
    title: row.title,
    slug: row.slug,
    entity_name: row.entity_name,
    entity_type: row.entity_type,
    main_company: row.main_company,
    companies_mentioned: row.companies_mentioned ?? [],
    industry: row.industry,
    key_mechanism: row.key_mechanism,
    secondary_mechanisms: row.secondary_mechanisms ?? [],
    strategic_angle: row.strategic_angle,
    core_takeaway: row.core_takeaway,
    year_period: row.year_period,
    language: row.language,
    published_date: row.published_date,
    created_at: row.created_at
  };
}

function mapMiniCaseHistoryRow(row: MiniCaseHistoryRow): MiniCaseEditorialMemoryRecord {
  return {
    id: row.id,
    content_item_id: row.content_item_id,
    title: row.title,
    slug: row.slug,
    topic: row.topic,
    scenario_type: row.scenario_type,
    decision_type: row.decision_type,
    concept_tested: row.concept_tested,
    mechanism: row.mechanism,
    difficulty: row.difficulty,
    question_pattern: row.question_pattern,
    correct_answer_pattern: row.correct_answer_pattern,
    core_takeaway: row.core_takeaway,
    published_date: row.published_date,
    language: row.language,
    created_at: row.created_at
  };
}

function normalizeNewsletterArticleCount(value: number | null): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 8;
}

function normalizeArticlesCount(value: number | null): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}

function isPersistTestContentItem(row: PersistTestContentItemRow, testRunId: string): boolean {
  const metadata = isRecord(row.metadata) ? row.metadata : {};

  return (
    row.title.startsWith("[TEST persist-test]") &&
    metadata.is_test_data === true &&
    metadata.test_mode === "persist-test" &&
    metadata.test_run_id === testRunId
  );
}

function isPublishedPersistTestContentItem(row: PublishedPersistTestContentItem): boolean {
  const metadata = isRecord(row.metadata) ? row.metadata : {};

  return (
    row.title.startsWith("[TEST persist-test]") &&
    row.status === "published" &&
    metadata.is_test_data === true &&
    metadata.test_mode === "persist-test" &&
    typeof metadata.test_run_id === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
