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
import {
  ARCHIVE_SEARCH_PAGE_SIZE,
  buildArchiveSearchKeysetFilter,
  encodeArchiveSearchCursor,
  takeArchiveSearchPage,
  type ArchiveSearchCursor,
  type ArchiveSearchPage
} from "../archive/archiveSearchPaging";
import type { TopicId } from "../../constants/product";
import type { ContentInteraction, ContentItem, DailyDrop, DailyDropItem } from "../../types/domain";
import { resolveContentItemsForLanguage } from "../today/contentTranslations";
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
const archiveSearchCacheTtlMs = 60_000;
// A page is what the reader asked for; the ceiling only guards a caller passing
// something unreasonable. It is not a result cap: further pages always follow.
const maxArchiveSearchPageSize = 50;
// Flat, de-duplicated view of the caller's own archive (see the
// 20260818090000_archive_search_keyset migration). Reading it rather than
// daily_drop_items is what makes drop_date and content_item_id top-level
// columns, and therefore a real keyset possible.
const archiveSearchView = "user_archive_search_items";
const archiveSearchSelect =
  "content_item_id,drop_id,drop_date,content_type,language,title,topic_id,source_count,metadata,hide_display_date";
const publishedContentStatus = "published";
const contentInteractionSelect =
  "id,user_id,content_item_id,interaction_type,rating,message,created_at";
const contentItemSelect =
  "id,content_type,topic_id,language,title,summary,body_md,difficulty,estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata,created_at,updated_at";
const dailyDropItemSelect = "daily_drop_id,content_item_id,slot,position,created_at";
const dailyDropSelect =
  "id,user_id,drop_date,language,status,hide_display_date,generated_at,published_at,created_at,updated_at";
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

    // Every edition the reader owns, whatever language each one was published
    // in. The current reading language is applied afterwards by translating the
    // items (resolveContentItemsForLanguage), so switching language re-renders
    // the same history instead of hiding the editions published in the other
    // language.
    let dropsQuery = supabase
      .from("daily_drops")
      .select(dailyDropSelect)
      .eq("user_id", userId)
      .in("status", [...archiveDropStatuses]);

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

    const summaries = await buildLibraryDropSummaries(pageDrops, userId, options.language);
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
 * One page of a search over the reader's whole archive, server-side.
 *
 * There is no result cap. The archive is paged, so filtering only the loaded
 * pages would silently hide older matches; instead this queries Supabase
 * directly (title match and/or drop_date period) over
 * public.user_archive_search_items, and walks the results with a keyset cursor
 * on (drop_date DESC, content_item_id DESC). A reader can therefore reach any
 * match, however far back, by asking for further pages — the only limit is how
 * many pages they choose to load.
 *
 * The view is scoped to the caller (RLS through security_invoker, plus its own
 * auth.uid() predicate), and only ever exposes content items assigned to them
 * through their own published drops. The explicit user_id filter is kept: it
 * states the intent at the call site and keeps the query on
 * idx_daily_drops_user_date.
 */
export async function searchLibraryItems(
  userId: string | null | undefined,
  options: {
    contentType: "business_story" | "mini_case";
    text: string;
    from?: string | null;
    toExclusive?: string | null;
    language?: ContentLanguage;
    /** Where to resume; omit or null for the first page. */
    cursor?: ArchiveSearchCursor | null;
    pageSize?: number;
  }
): Promise<DataFetchResult<ArchiveSearchPage>> {
  const emptyPage: ArchiveSearchPage = { items: [], nextCursor: null, hasMore: false };

  if (!userId || !supabase) {
    return createMockFallbackResult<ArchiveSearchPage>(
      emptyPage,
      userId ? "missing_supabase_config" : "missing_auth_session"
    );
  }

  const pageSize = Math.min(
    Math.max(options.pageSize ?? ARCHIVE_SEARCH_PAGE_SIZE, 1),
    maxArchiveSearchPageSize
  );
  const text = options.text.trim();
  const cursor = options.cursor ?? null;

  try {
    const cacheKey = getArchiveSearchCacheKey(userId, options, pageSize);
    const cachedPage = getCachedValue<ArchiveSearchPage>(cacheKey);

    if (cachedPage) {
      return createCachedResult(cachedPage);
    }

    let query = supabase
      .from(archiveSearchView)
      .select(archiveSearchSelect)
      .eq("user_id", userId)
      .eq("content_type", options.contentType);

    if (options.language) {
      // The view exposes the content item's own language, so a FR search can
      // never surface an EN item (or the reverse) through a mixed edition.
      query = query.eq("language", options.language);
    }

    if (text.length > 0) {
      query = query.ilike("title", `%${escapeLikePattern(text)}%`);
    }

    if (options.from) {
      query = query.gte("drop_date", options.from);
    }

    if (options.toExclusive) {
      query = query.lt("drop_date", options.toExclusive);
    }

    const keysetFilter = buildArchiveSearchKeysetFilter(cursor);

    if (keysetFilter) {
      query = query.or(keysetFilter);
    }

    // One row more than the page: its presence is the exact `hasMore` answer,
    // with no count over the whole history.
    const { data, error } = await query
      .order("drop_date", { ascending: false })
      .order("content_item_id", { ascending: false })
      .limit(pageSize + 1);

    if (error) {
      const normalizedError = normalizeSupabaseError(error);

      return createMockFallbackResult<ArchiveSearchPage>(
        emptyPage,
        getFallbackReasonForError(normalizedError),
        normalizedError
      );
    }

    const rows = (data ?? []) as unknown as ArchiveSearchRow[];
    const contentItemIds = [...new Set(rows.map((row) => row.content_item_id))];
    const interactions = await fetchLibraryInteractions(userId, contentItemIds);
    const completedItemIds = getInteractedContentItemIds(interactions, "complete");
    const savedItemIds = getInteractedContentItemIds(interactions, "save");
    const summaries: LibraryItemSummary[] = [];

    for (const row of rows) {
      const contentType = mapLibraryContentType(row);

      if (!contentType) {
        continue;
      }

      summaries.push({
        id: row.content_item_id,
        content_type: contentType,
        drop_date: row.drop_date,
        hide_display_date: row.hide_display_date === true,
        drop_id: row.drop_id,
        is_completed: completedItemIds.has(row.content_item_id),
        is_saved: savedItemIds.has(row.content_item_id),
        language: row.language,
        source_count: row.source_count,
        title: row.title,
        topic: readLibraryTopic(row)
      });
    }

    const page = takeArchiveSearchPage(summaries, pageSize);

    setCachedValue(cacheKey, page, archiveSearchCacheTtlMs);

    logLibraryDataProof("live_archive_search", {
      content_type: options.contentType,
      has_more: page.hasMore,
      is_first_page: cursor === null,
      result_count: page.items.length,
      user_id: redactIdentifier(userId)
    });

    return createSupabaseResult(page);
  } catch (error) {
    const normalizedError = normalizeSupabaseError(error);

    return createMockFallbackResult<ArchiveSearchPage>(
      emptyPage,
      getFallbackReasonForError(normalizedError),
      normalizedError
    );
  }
}

/**
 * One row of public.user_archive_search_items: already flat and already
 * de-duplicated per content item, so no embedded-shape handling is needed.
 */
type ArchiveSearchRow = {
  content_item_id: string;
  drop_id: string;
  drop_date: string;
  content_type: ContentItem["content_type"];
  language: ContentItem["language"];
  title: string;
  topic_id: ContentItem["topic_id"];
  source_count: number;
  metadata: ContentItem["metadata"];
  /** The edition's display rule, carried by the view. */
  hide_display_date: boolean | null;
};

/**
 * Cache key for one search page. It carries everything that changes the
 * result — reader, language, content type, normalised text, both date bounds,
 * page size and the cursor — so no two different searches can ever share an
 * entry, and a re-tap of "load more" is free.
 */
/** Exported so the language-switch guard can assert the key really differs per language. */
export function getArchiveSearchCacheKey(
  userId: string,
  options: {
    contentType: string;
    text: string;
    from?: string | null;
    toExclusive?: string | null;
    language?: ContentLanguage;
    cursor?: ArchiveSearchCursor | null;
  },
  pageSize: number
): string {
  return [
    "archive-search",
    userId,
    options.language ?? "any",
    options.contentType,
    options.text.trim().toLowerCase(),
    options.from ?? "",
    options.toExclusive ?? "",
    String(pageSize),
    encodeArchiveSearchCursor(options.cursor ?? null)
  ].join(":");
}

// `%` and `_` are wildcards in ILIKE; a user typing them must match literally.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function buildLibraryDropSummaries(
  drops: DailyDrop[],
  userId: string,
  language?: ContentLanguage
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
  const contentItemsById = await fetchContentItemsById(contentItemIds, language);
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
      // A row written before the column existed reads as false, so existing
      // editions keep showing their date.
      hide_display_date: drop.hide_display_date === true,
      drop_id: drop.id,
      items: mapLibraryItems(drop, contentItems, completedItemIds, savedItemIds),
      item_count: contentItems.length,
      language: language ?? drop.language,
      saved_item_count: countMatchingContentItems(contentItems, savedItemIds),
      title: getLibraryDropTitle(drop, language),
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
        hide_display_date: drop.hide_display_date === true,
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
  contentItemIds: string[],
  language?: ContentLanguage
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

  // Display fields in the requested language, ids unchanged (the assigned ids
  // are what interactions and reader routes key on).
  const renderedContentItems = await resolveContentItemsForLanguage(
    contentItems ?? [],
    language
  );

  return new Map(renderedContentItems.map((contentItem) => [contentItem.id, contentItem]));
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

/** Only the fields these helpers read, so a flat search row also fits. */
type TopicBearingRow = Pick<ContentItem, "topic_id" | "metadata">;

function readTopicFromContentItem(contentItem: TopicBearingRow): TopicId | null {
  if (isTopicId(contentItem.topic_id)) {
    return contentItem.topic_id;
  }

  const metadata = isRecord(contentItem.metadata) ? contentItem.metadata : {};
  const metadataTopic = metadata.topic ?? metadata.category;

  return isTopicId(metadataTopic) ? metadataTopic : null;
}

function readLibraryTopic(contentItem: TopicBearingRow): LibraryItemSummary["topic"] {
  const topic = readTopicFromContentItem(contentItem);

  if (topic) {
    return topic;
  }

  const metadata = isRecord(contentItem.metadata) ? contentItem.metadata : {};

  return metadata.category === "career" ? "career" : null;
}

function mapLibraryContentType(
  contentItem: Pick<ContentItem, "content_type">
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

function getLibraryDropTitle(drop: DailyDrop, language?: ContentLanguage): string {
  const isWeeklyDigest = resolveEditionType(drop.drop_date) === "weekly_digest";

  if ((language ?? drop.language) === "fr") {
    return isWeeklyDigest ? "Synthèse hebdomadaire" : "Brief du jour";
  }

  return isWeeklyDigest ? "Weekly digest" : "Edition brief";
}

function normalizeLibraryLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) {
    return defaultLibraryDropLimit;
  }

  return Math.min(Math.max(Math.floor(limit), 1), maxLibraryDropLimit);
}

/** Exported so the language-switch guard can assert the key really differs per language. */
export function getLibraryDropsCacheKey(
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
  event:
    | "live_archive_search"
    | "live_library_drops"
    | "live_library_drops_cache_hit"
    | "mock_fallback",
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
