import {
  createMockFallbackResult,
  createSupabaseResult,
  type DataFetchResult
} from "../../lib/dataState";
import { normalizeSupabaseError, supabase } from "../../lib/supabase";
import { mockLibraryDrops } from "../../mocks";
import type { TopicId } from "../../constants/product";
import type { ContentInteraction, ContentItem, DailyDrop, DailyDropItem } from "../../types/domain";
import type { LibraryDropSummary } from "./libraryTypes";

const readableDropStatuses = ["published", "read", "archived"] as const;

const topicIds = [
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering",
  "sport_business",
  "culture_media"
] as const satisfies TopicId[];

export async function fetchLibraryDrops(
  userId: string
): Promise<DataFetchResult<LibraryDropSummary[]>> {
  if (!supabase) {
    return createMockFallbackResult(
      mockLibraryDrops,
      "missing_supabase_config",
      normalizeSupabaseError({
        code: "missing_supabase_config",
        message:
          "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
      })
    );
  }

  try {
    const { data: drops, error: dropsError } = await supabase
      .from("daily_drops")
      .select("*")
      .eq("user_id", userId)
      .in("status", [...readableDropStatuses])
      .order("drop_date", { ascending: false });

    if (dropsError) {
      return createMockFallbackResult(
        mockLibraryDrops,
        "supabase_error",
        normalizeSupabaseError(dropsError)
      );
    }

    if (!drops || drops.length === 0) {
      return createMockFallbackResult(mockLibraryDrops, "no_supabase_data");
    }

    const summaries = await buildLibraryDropSummaries(drops, userId);

    return summaries.length > 0
      ? createSupabaseResult(summaries)
      : createMockFallbackResult(mockLibraryDrops, "no_supabase_data");
  } catch (error) {
    return createMockFallbackResult(
      mockLibraryDrops,
      "supabase_error",
      normalizeSupabaseError(error)
    );
  }
}

async function buildLibraryDropSummaries(
  drops: DailyDrop[],
  userId: string
): Promise<LibraryDropSummary[]> {
  if (!supabase) {
    return [];
  }

  const dropIds = drops.map((drop) => drop.id);
  const { data: dropItems, error: dropItemsError } = await supabase
    .from("daily_drop_items")
    .select("*")
    .in("daily_drop_id", dropIds)
    .order("position", { ascending: true });

  if (dropItemsError) {
    throw dropItemsError;
  }

  const contentItemIds = [...new Set((dropItems ?? []).map((item) => item.content_item_id))];
  const contentItemsById = await fetchContentItemsById(contentItemIds);
  const interactions = await fetchLibraryInteractions(userId, contentItemIds);
  const completedItemIds = getInteractedContentItemIds(interactions, "complete");
  const savedItemIds = getInteractedContentItemIds(interactions, "save");
  const dropItemsByDropId = groupDropItemsByDropId(dropItems ?? []);

  return drops.map((drop) => {
    const items = dropItemsByDropId[drop.id] ?? [];
    const contentItems = items
      .map((item) => contentItemsById.get(item.content_item_id))
      .filter(isContentItem);

    return {
      completed_item_count: countMatchingContentItems(contentItems, completedItemIds),
      drop_date: drop.drop_date,
      drop_id: drop.id,
      item_count: contentItems.length,
      language: drop.language,
      saved_item_count: countMatchingContentItems(contentItems, savedItemIds),
      title: getLibraryDropTitle(drop),
      topics: getTopicsForContentItems(contentItems)
    };
  });
}

async function fetchContentItemsById(
  contentItemIds: string[]
): Promise<Map<string, ContentItem>> {
  if (!supabase || contentItemIds.length === 0) {
    return new Map();
  }

  const { data: contentItems, error } = await supabase
    .from("content_items")
    .select("*")
    .in("id", contentItemIds)
    .eq("status", "published");

  if (error) {
    throw error;
  }

  return new Map((contentItems ?? []).map((contentItem) => [contentItem.id, contentItem]));
}

async function fetchLibraryInteractions(
  userId: string,
  contentItemIds: string[]
): Promise<ContentInteraction[]> {
  if (!supabase || contentItemIds.length === 0) {
    return [];
  }

  const { data: interactions, error } = await supabase
    .from("content_interactions")
    .select("*")
    .eq("user_id", userId)
    .in("content_item_id", contentItemIds)
    .in("interaction_type", ["complete", "save"]);

  if (error) {
    throw error;
  }

  return interactions ?? [];
}

function groupDropItemsByDropId(
  dropItems: DailyDropItem[]
): Record<string, DailyDropItem[]> {
  return dropItems.reduce<Record<string, DailyDropItem[]>>((groups, item) => {
    const currentItems = groups[item.daily_drop_id] ?? [];

    return {
      ...groups,
      [item.daily_drop_id]: [...currentItems, item]
    };
  }, {});
}

function getInteractedContentItemIds(
  interactions: ContentInteraction[],
  interactionType: "complete" | "save"
): Set<string> {
  return new Set(
    interactions
      .filter((interaction) => interaction.interaction_type === interactionType)
      .map((interaction) => interaction.content_item_id)
  );
}

function countMatchingContentItems(
  contentItems: ContentItem[],
  contentItemIds: Set<string>
): number {
  return contentItems.filter((contentItem) => contentItemIds.has(contentItem.id)).length;
}

function getTopicsForContentItems(contentItems: ContentItem[]): TopicId[] {
  const topics = contentItems
    .map((contentItem) => readTopicFromContentItem(contentItem))
    .filter(isTopicId);

  return [...new Set(topics)];
}

function readTopicFromContentItem(contentItem: ContentItem): TopicId | null {
  if (isTopicId(contentItem.topic_id)) {
    return contentItem.topic_id;
  }

  const metadata = isRecord(contentItem.metadata) ? contentItem.metadata : {};
  const metadataTopic = metadata.topic ?? metadata.category;

  return isTopicId(metadataTopic) ? metadataTopic : null;
}

function getLibraryDropTitle(drop: DailyDrop): string {
  return drop.language === "fr" ? "Brief quotidien" : "Daily drop";
}

function isTopicId(value: unknown): value is TopicId {
  return typeof value === "string" && topicIds.includes(value as TopicId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContentItem(contentItem: ContentItem | undefined): contentItem is ContentItem {
  return Boolean(contentItem);
}
