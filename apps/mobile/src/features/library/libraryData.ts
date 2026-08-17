import {
  createCachedResult,
  createMockFallbackResult,
  createSupabaseResult,
  type DataFallbackReason,
  type DataFetchResult
} from "../../lib/dataState";
import { getCachedValue, setCachedValue } from "../../lib/memoryCache";
import { allowMockContent } from "../../lib/mockPolicy";
import { isLikelyNetworkError, normalizeSupabaseError, supabase } from "../../lib/supabase";
import { mockLibraryDrops } from "../../mocks";
import type { TopicId } from "../../constants/product";
import type { ContentInteraction, ContentItem, DailyDrop, DailyDropItem } from "../../types/domain";
import type { ContentLanguage } from "../today";
import { resolveEditionType } from "../today/editionCadence";
import type { LibraryDropSummary, LibraryItemSummary } from "./libraryTypes";

type FetchLibraryDropsOptions = {
  cacheTtlMs?: number;
  /** Editions per page. The archive is paginated, never loaded whole. */
  pageSize?: number;
  /**
   * Keyset cursor: only editions strictly older than this drop_date are
   * returned. Paging on drop_date (not offset) keeps pages stable while the
   * archive grows and never re-reads earlier pages.
   */
  beforeDate?: string | null;
  // Active reading language. When set, the archive is filtered to this language
  // so the library never lists or opens content in another language. Also keys
  // the cache so a language switch never reads stale other-language drops.
  language?: ContentLanguage;
};

/** One page of the archive, plus whether older editions remain. */
export type LibraryDropsPage = DataFetchResult<LibraryDropSummary[]> & {
  hasMore: boolean;
};

function withPageFlag(
  result: DataFetchResult<LibraryDropSummary[]>,
  hasMore: boolean
): LibraryDropsPage {
  return { ...result, hasMore };
}

// Sample archive only in dev/preview builds; production falls back to an empty,
// honest archive (see lib/mockPolicy).
const fallbackLibraryDrops = () => (allowMockContent ? mockLibraryDrops : []);

const archiveDropStatuses = ["published", "read", "archived"] as const;
const defaultLibraryDropLimit = 25;
const libraryDropCacheTtlMs = 60_000;
const liveDataProofMode = process.env.EXPO_PUBLIC_LIVE_DATA_PROOF_MODE === "true";
const maxLibraryDropLimit = 50;
const publishedContentStatus = "published";
const contentInteractionSelect =
  "id,user_id,content_item_id,interaction_type,rating,message,created_at";
const contentItemSelect =
  "id,content_type,topic_id,language,title,summary,body_md,difficulty,estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata,created_at,updated_at";
const dailyDropItemSelect = "daily_drop_id,content_item_id,slot,position,created_at";
const dailyDropSelect =
  "id,user_id,drop_date,language,status,generated_at,published_at,created_at,updated_at";
const slotOrder = {
  newsletter: 0,
  business_story: 1,
  mini_case: 2,
  concept: 3
} as const;

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
  userId: string | null | undefined,
  options: FetchLibraryDropsOptions = {}
): Promise<LibraryDropsPage> {
  if (!userId) {
    logLibraryDataProof("mock_fallback", {
      reason: "missing_auth_session"
    });

    return withPageFlag(
      createMockFallbackResult(
        fallbackLibraryDrops(),
        "missing_auth_session",
        normalizeSupabaseError({
          code: "missing_auth_session",
          message: "Sign in to load your library."
        })
      ),
      false
    );
  }

  if (!supabase) {
    logLibraryDataProof("mock_fallback", {
      reason: "missing_supabase_config"
    });

    return withPageFlag(
      createMockFallbackResult(
        fallbackLibraryDrops(),
        "missing_supabase_config",
        normalizeSupabaseError({
          code: "missing_supabase_config",
          message: "Live archive is not configured for this build.",
          hint:
            "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
        })
      ),
      false
    );
  }

  try {
    const pageSize = normalizeLibraryLimit(options.pageSize);
    const beforeDate = options.beforeDate ?? null;
    const cacheKey = getLibraryDropsCacheKey(userId, pageSize, options.language, beforeDate);
    const cachedPage = getCachedValue<{ drops: LibraryDropSummary[]; hasMore: boolean }>(cacheKey);

    if (cachedPage) {
      logLibraryDataProof("live_library_drops_cache_hit", {
        drop_count: cachedPage.drops.length,
        page_size: pageSize,
        user_id: redactIdentifier(userId)
      });

      return withPageFlag(createCachedResult(cachedPage.drops), cachedPage.hasMore);
    }

    let dropsQuery = supabase
      .from("daily_drops")
      .select(dailyDropSelect)
      .eq("user_id", userId)
      .in("status", [...archiveDropStatuses]);

    if (options.language) {
      dropsQuery = dropsQuery.eq("language", options.language);
    }

    if (beforeDate) {
      dropsQuery = dropsQuery.lt("drop_date", beforeDate);
    }

    // One extra row is the cheapest reliable "is there another page" signal.
    const { data: drops, error: dropsError } = await dropsQuery
      .order("drop_date", { ascending: false })
      .limit(pageSize + 1);

    if (dropsError) {
      const normalizedError = normalizeSupabaseError(dropsError);
      const fallbackReason = getFallbackReasonForError(normalizedError);

      logLibraryDataProof("mock_fallback", {
        reason: fallbackReason,
        user_id: redactIdentifier(userId)
      });

      return withPageFlag(
        createMockFallbackResult(fallbackLibraryDrops(), fallbackReason, normalizedError),
        false
      );
    }

    const hasMore = (drops?.length ?? 0) > pageSize;
    const pageDrops = (drops ?? []).slice(0, pageSize);

    if (pageDrops.length === 0) {
      logLibraryDataProof("mock_fallback", {
        reason: "no_supabase_data",
        user_id: redactIdentifier(userId)
      });

      // A first page with no data is a genuine empty archive; a later page with
      // no data simply means the end of history — never a mock fallback.
      return withPageFlag(
        beforeDate
          ? createSupabaseResult<LibraryDropSummary[]>([])
          : createMockFallbackResult(fallbackLibraryDrops(), "no_supabase_data"),
        false
      );
    }

    const summaries = await buildLibraryDropSummaries(pageDrops, userId);
    const displayableSummaries = summaries.filter((summary) => summary.item_count > 0);

    setCachedValue(
      cacheKey,
      { drops: displayableSummaries, hasMore },
      options.cacheTtlMs ?? libraryDropCacheTtlMs
    );

    logLibraryDataProof("live_library_drops", {
      drop_count: displayableSummaries.length,
      has_more: hasMore,
      latest_drop_date: displayableSummaries[0]?.drop_date ?? null,
      page_size: pageSize,
      user_id: redactIdentifier(userId)
    });

    return withPageFlag(createSupabaseResult(displayableSummaries), hasMore);
  } catch (error) {
    const normalizedError = normalizeSupabaseError(error);
    const fallbackReason = getFallbackReasonForError(normalizedError);

    logLibraryDataProof("mock_fallback", {
      reason: fallbackReason,
      user_id: redactIdentifier(userId)
    });

    return withPageFlag(
      createMockFallbackResult(fallbackLibraryDrops(), fallbackReason, normalizedError),
      false
    );
  }
}

/**
 * Search the user's whole archive for one content type, server-side.
 *
 * Paging the archive means the client only holds a window of it, so a search
 * restricted to loaded pages would silently miss older items. This queries
 * Supabase directly (title match and/or drop_date period) so an item from any
 * point in the history is findable. RLS still scopes every row to the caller;
 * the explicit user_id filter keeps the query index-friendly.
 */
export async function searchLibraryItems(
  userId: string | null | undefined,
  options: {
    contentType: "business_story" | "mini_case";
    text: string;
    from?: string | null;
    toExclusive?: string | null;
    language?: ContentLanguage;
    limit?: number;
  }
): Promise<DataFetchResult<LibraryItemSummary[]>> {
  if (!userId || !supabase) {
    return createMockFallbackResult<LibraryItemSummary[]>(
      [],
      userId ? "missing_supabase_config" : "missing_auth_session"
    );
  }

  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
  const text = options.text.trim();

  try {
    let query = supabase
      .from("daily_drop_items")
      .select(
        `content_item_id,
         daily_drops!inner(id,user_id,drop_date,language,status),
         content_items!inner(id,title,content_type,status,topic_id,language,source_count,metadata)`
      )
      .eq("daily_drops.user_id", userId)
      .in("daily_drops.status", [...archiveDropStatuses])
      .eq("content_items.status", publishedContentStatus)
      .eq("content_items.content_type", options.contentType);

    if (options.language) {
      query = query.eq("daily_drops.language", options.language);
    }

    if (text.length > 0) {
      query = query.ilike("content_items.title", `%${escapeLikePattern(text)}%`);
    }

    if (options.from) {
      query = query.gte("daily_drops.drop_date", options.from);
    }

    if (options.toExclusive) {
      query = query.lt("daily_drops.drop_date", options.toExclusive);
    }

    const { data, error } = await query
      .order("drop_date", { ascending: false, referencedTable: "daily_drops" })
      .limit(limit);

    if (error) {
      const normalizedError = normalizeSupabaseError(error);

      return createMockFallbackResult<LibraryItemSummary[]>(
        [],
        getFallbackReasonForError(normalizedError),
        normalizedError
      );
    }

    const rows = (data ?? []) as unknown as ArchiveSearchRow[];
    const contentItemIds = [...new Set(rows.map((row) => row.content_item_id))];
    const interactions = await fetchLibraryInteractions(userId, contentItemIds);
    const completedItemIds = getInteractedContentItemIds(interactions, "complete");
    const savedItemIds = getInteractedContentItemIds(interactions, "save");
    const seen = new Set<string>();
    const items: LibraryItemSummary[] = [];

    for (const row of rows) {
      const drop = firstRelated(row.daily_drops);
      const contentItem = firstRelated(row.content_items);

      if (!drop || !contentItem || seen.has(contentItem.id)) {
        continue;
      }

      seen.add(contentItem.id);
      const contentType = mapLibraryContentType(contentItem);

      if (!contentType) {
        continue;
      }

      items.push({
        id: contentItem.id,
        content_type: contentType,
        drop_date: drop.drop_date,
        drop_id: drop.id,
        is_completed: completedItemIds.has(contentItem.id),
        is_saved: savedItemIds.has(contentItem.id),
        language: contentItem.language,
        source_count: contentItem.source_count,
        title: contentItem.title,
        topic: readLibraryTopic(contentItem)
      });
    }

    items.sort((left, right) => right.drop_date.localeCompare(left.drop_date));

    return createSupabaseResult(items);
  } catch (error) {
    const normalizedError = normalizeSupabaseError(error);

    return createMockFallbackResult<LibraryItemSummary[]>(
      [],
      getFallbackReasonForError(normalizedError),
      normalizedError
    );
  }
}

type ArchiveSearchRow = {
  content_item_id: string;
  daily_drops: DailyDrop | DailyDrop[] | null;
  content_items: ContentItem | ContentItem[] | null;
};

// PostgREST returns an embedded row as an object or a single-element array
// depending on how it infers the relationship; accept both shapes.
function firstRelated<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

// `%` and `_` are wildcards in ILIKE; a user typing them must match literally.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
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
    .select(dailyDropItemSelect)
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
    const items = sortDropItemsForArchive(dropItemsByDropId[drop.id] ?? []);
    const contentItems = items
      .map((item) => contentItemsById.get(item.content_item_id))
      .filter(isContentItem);

    return {
      completed_item_count: countMatchingContentItems(contentItems, completedItemIds),
      drop_date: drop.drop_date,
      drop_id: drop.id,
      items: mapLibraryItems(drop, contentItems, completedItemIds, savedItemIds),
      item_count: contentItems.length,
      language: drop.language,
      saved_item_count: countMatchingContentItems(contentItems, savedItemIds),
      title: getLibraryDropTitle(drop),
      topics: getTopicsForContentItems(contentItems)
    };
  });
}

function mapLibraryItems(
  drop: DailyDrop,
  contentItems: ContentItem[],
  completedItemIds: Set<string>,
  savedItemIds: Set<string>
): LibraryItemSummary[] {
  return contentItems
    .map((contentItem) => {
      const contentType = mapLibraryContentType(contentItem);

      if (!contentType) {
        return null;
      }

      return {
        id: contentItem.id,
        content_type: contentType,
        drop_date: drop.drop_date,
        drop_id: drop.id,
        is_completed: completedItemIds.has(contentItem.id),
        is_saved: savedItemIds.has(contentItem.id),
        language: contentItem.language,
        source_count: contentItem.source_count,
        title: contentItem.title,
        topic: readLibraryTopic(contentItem)
      };
    })
    .filter(isLibraryItemSummary);
}

async function fetchContentItemsById(
  contentItemIds: string[]
): Promise<Map<string, ContentItem>> {
  if (!supabase || contentItemIds.length === 0) {
    return new Map();
  }

  const { data: contentItems, error } = await supabase
    .from("content_items")
    .select(contentItemSelect)
    .in("id", contentItemIds)
    .eq("status", publishedContentStatus);

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
    .select(contentInteractionSelect)
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

function sortDropItemsForArchive(dropItems: DailyDropItem[]): DailyDropItem[] {
  return [...dropItems].sort((left, right) => {
    const slotDelta = slotOrder[left.slot] - slotOrder[right.slot];

    if (slotDelta !== 0) {
      return slotDelta;
    }

    return left.position - right.position;
  });
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

function readLibraryTopic(contentItem: ContentItem): LibraryItemSummary["topic"] {
  const topic = readTopicFromContentItem(contentItem);

  if (topic) {
    return topic;
  }

  const metadata = isRecord(contentItem.metadata) ? contentItem.metadata : {};

  return metadata.category === "career" ? "career" : null;
}

function mapLibraryContentType(
  contentItem: ContentItem
): LibraryItemSummary["content_type"] | null {
  if (contentItem.content_type === "concept") {
    return "key_concept";
  }

  if (
    contentItem.content_type === "newsletter_article" ||
    contentItem.content_type === "business_story" ||
    contentItem.content_type === "mini_case"
  ) {
    return contentItem.content_type;
  }

  return null;
}

function getLibraryDropTitle(drop: DailyDrop): string {
  const isWeeklyDigest = resolveEditionType(drop.drop_date) === "weekly_digest";

  if (drop.language === "fr") {
    return isWeeklyDigest ? "Synthèse hebdomadaire" : "Brief quotidien";
  }

  return isWeeklyDigest ? "Weekly digest" : "Daily drop";
}

function normalizeLibraryLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return defaultLibraryDropLimit;
  }

  return Math.min(Math.max(Math.floor(limit), 1), maxLibraryDropLimit);
}

function getLibraryDropsCacheKey(
  userId: string,
  pageSize: number,
  language: ContentLanguage | undefined,
  beforeDate: string | null
): string {
  return [
    "library-drops",
    userId,
    pageSize,
    language ?? "any",
    beforeDate ?? "head"
  ].join(":");
}

function getFallbackReasonForError(error: ReturnType<typeof normalizeSupabaseError>): DataFallbackReason {
  return isLikelyNetworkError(error) ? "network_unavailable" : "supabase_error";
}

function logLibraryDataProof(
  event: "live_library_drops" | "live_library_drops_cache_hit" | "mock_fallback",
  details: Record<string, unknown>
): void {
  if (__DEV__) {
    const payload = {
      event,
      proof_mode: liveDataProofMode,
      ...details
    };

    if (liveDataProofMode && event === "mock_fallback") {
      console.error("[Library data proof]", payload);
      return;
    }

    console.info("[Library data proof]", payload);
  }
}

function redactIdentifier(identifier: string): string {
  return identifier.length <= 8
    ? identifier
    : `${identifier.slice(0, 4)}...${identifier.slice(-4)}`;
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

function isLibraryItemSummary(
  item: LibraryItemSummary | null
): item is LibraryItemSummary {
  return item !== null;
}
