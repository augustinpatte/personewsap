import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyDropStatus,
  DailyDropPayload,
  DailyDropSlot,
  GeneratedContentItem,
  Language,
  RankedArticle,
  TopicId,
  UserDailyDropPreference
} from "../domain.js";
import { sha256 } from "../utils/hash.js";
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
};

type GenerationRunRow = {
  id: string;
};

type SourceRow = {
  id: string;
  url: string;
};

type ContentItemRow = {
  id: string;
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

type DailyDropRow = {
  id: string;
};

type DailyDropAssignmentRow = {
  id: string;
  user_id: string;
  status: DailyDropStatus;
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
        const insert = mapGeneratedItemToContentInsert(item, input.payload.drop_date, input.contentStatus, runId, input.metadata);
        const contentItemId = await this.insertContentItem(insert);
        const sourceLinks = mapContentItemSourceInserts({
          contentItemId,
          sourceUrls: item.source_urls,
          sourceIdsByUrl
        });

        await this.insertContentItemSources(sourceLinks);
        await this.completeGenerationRun(runId, sha256(JSON.stringify(item)), input.contentStatus === "published" ? "published" : "generated");
        storedItems.push({ item, content_item_id: contentItemId });
      } catch (error) {
        await this.failGenerationRun(runId, error instanceof Error ? error.message : JSON.stringify(error));
        throw error;
      }
    }

    return storedItems;
  }

  async listUserDailyDropPreferences(language: Language): Promise<UserDailyDropPreference[]> {
    const { data: profiles, error: profileError } = await this.supabase
      .from("profiles")
      .select("id, language, user_preferences(goal, frequency, newsletter_article_count), user_topic_preferences(topic_id, articles_count, position, enabled)")
      .eq("language", language);

    if (profileError) {
      throwPersistenceError({
        table: "profiles",
        action: "select user daily drop preferences",
        error: profileError
      });
    }

    return (profiles ?? []).flatMap((profile: Record<string, unknown>) => {
      const preferences = Array.isArray(profile.user_preferences)
        ? (profile.user_preferences[0] as Record<string, unknown> | undefined)
        : (profile.user_preferences as Record<string, unknown> | null);

      if (!preferences) {
        return [];
      }

      const topics = Array.isArray(profile.user_topic_preferences) ? profile.user_topic_preferences : [];

      return [
        {
          user_id: String(profile.id),
          language,
          goal: String(preferences.goal ?? "become_sharper_daily") as UserDailyDropPreference["goal"],
          frequency: String(preferences.frequency ?? "daily") as UserDailyDropPreference["frequency"],
          newsletter_article_count: Number(preferences.newsletter_article_count ?? 8),
          topics: topics
            .filter((topic): topic is Record<string, unknown> => {
              return typeof topic === "object" && topic !== null && topic.enabled !== false;
            })
            .map((topic) => ({
              topic_id: String(topic.topic_id) as UserDailyDropPreference["topics"][number]["topic_id"],
              articles_count: Number(topic.articles_count ?? 1),
              position: topic.position === null || topic.position === undefined ? null : Number(topic.position)
            }))
        }
      ];
    });
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
    itemIds: Array<{
      contentItemId: string;
      slot: DailyDropSlot;
      position: number;
    }>;
  }): Promise<string> {
    const dailyDropId = await this.insertDailyDrop({
      userId: input.userId,
      dropDate: input.dropDate,
      language: input.language,
      status: input.status
    });

    await this.insertDailyDropItems(
      input.itemIds.map((item) => ({
        dailyDropId,
        contentItemId: item.contentItemId,
        slot: item.slot,
        position: item.position
      }))
    );

    return dailyDropId;
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
          published_at: publishedAt
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

    const { error } = await this.supabase.from("daily_drop_items").upsert(
      items.map((item) => ({
        daily_drop_id: item.dailyDropId,
        content_item_id: item.contentItemId,
        slot: item.slot,
        position: item.position
      })),
      { onConflict: "daily_drop_id,slot,position" }
    );

    if (error) {
      throwPersistenceError({
        table: "daily_drop_items",
        action: "upsert daily drop items",
        error
      });
    }
  }
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
