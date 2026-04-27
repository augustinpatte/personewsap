import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DailyDropStatus,
  DailyDropPayload,
  DailyDropSlot,
  GeneratedContentItem,
  Language,
  RankedArticle,
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

type DailyDropRow = {
  id: string;
};

export class ContentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  assertPersistenceAvailable(): void {
    void this.supabase.from;
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
      throw error;
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
      throw error;
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
      throw error;
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
      throw error;
    }

    return new Map((data ?? []).map((source) => [source.url, source.id]));
  }

  async insertContentItem(insert: ContentItemInsert): Promise<string> {
    const { data, error } = await this.supabase.from("content_items").insert(insert).select("id").single<ContentItemRow>();

    if (error) {
      throw error;
    }

    return data.id;
  }

  async insertContentItemSources(sourceLinks: ContentItemSourceInsert[]): Promise<void> {
    if (sourceLinks.length === 0) {
      return;
    }

    const { error } = await this.supabase.from("content_item_sources").insert(sourceLinks);

    if (error) {
      throw error;
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
        await this.failGenerationRun(runId, error instanceof Error ? error.message : String(error));
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
      throw profileError;
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
      throw error;
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
      throw error;
    }
  }
}
