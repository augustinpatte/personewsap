import {
  createCachedResult,
  createMockFallbackResult,
  createSupabaseResult,
  type DataFallbackReason,
  type DataFetchResult
} from "../../lib/dataState";
import { getUserLocalDateKey } from "../../lib/localDate";
import { getCachedValue, setCachedValue } from "../../lib/memoryCache";
import {
  fetchContentItemsByLogicalKeys,
  resolveContentItemsForLanguage
} from "./contentTranslations";
import { orderMiniCaseQuestionOptions } from "./miniCaseOptionOrder";
import {
  fetchTeamContentForEdition,
  indexTeamAssignmentsByIdentity,
  teamContentIdentity,
  type TeamAssignmentRef,
  type TeamContentAssignment
} from "./teamEditionContent";
import { mergedItems, mergeTeamAndPersonalContent } from "../quiz/teamMerge";
import { allowMockContent } from "../../lib/mockPolicy";
import { isLikelyNetworkError, normalizeSupabaseError, supabase } from "../../lib/supabase";
import {
  flattenDailyDropItems,
  getMockSourcesForItem,
  mockTodayDailyDropsByLanguage
} from "../../mocks";
import type { TopicId } from "../../constants/product";
import type { ContentItem, DailyDrop, DailyDropItem, Source } from "../../types/domain";
import type {
  BusinessStory,
  ContentTeamRef,
  LogicalQuestionRef,
  ContentDifficulty,
  ContentLanguage,
  DailyDropSlot,
  DailyDropContentItem,
  KeyConcept,
  MiniCaseChallenge,
  MiniCaseOption,
  MiniCaseOptionOutcome,
  MiniCaseQuestion,
  MiniCaseQuestionRole,
  NewsletterArticle,
  SourceMetadata,
  TodayDailyDrop
} from "./contentTypes";

type FetchTodayDropOptions = {
  cacheTtlMs?: number;
  language?: ContentLanguage;
};

type FetchContentByIdOptions = {
  cacheTtlMs?: number;
  language?: ContentLanguage;
  userId?: string | null;
};

type SourcesByContentItemId = Record<
  string,
  {
    sourceIds: string[];
    sources: SourceMetadata[];
  }
>;

/**
 * The scored questions and Team badges attached to the items of one edition.
 *
 * Keyed by the ASSIGNED content item id, which is the same key sources use and
 * the same key RLS grants on. A question is found through the item's
 * `content_logical_key`, so the FR and EN renderings of one article resolve to
 * the same question — that is what makes a French reader and an English reader
 * in the same Team play one game.
 */
type QuestionsByContentItemId = Record<string, LogicalQuestionRef[]>;

const logicalQuestionSelect =
  "id,content_logical_key,content_type,question_sequence,question_role";

const publishedDropStatuses = ["published", "read", "archived"] as const;
const todayDropCacheTtlMs = 60_000;
const contentSourcesCacheTtlMs = 5 * 60_000;
const liveDataProofMode = process.env.EXPO_PUBLIC_LIVE_DATA_PROOF_MODE === "true";
const contentItemSelect =
  "id,content_type,topic_id,language,title,summary,body_md,difficulty,estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata,created_at,updated_at";
const contentItemSourceSelect = "content_item_id,source_id,claim,source_order,created_at";
const dailyDropItemSelect = "daily_drop_id,content_item_id,slot,position,created_at";
const dailyDropSelect =
  "id,user_id,drop_date,language,status,hide_display_date,generated_at,published_at,created_at,updated_at";
const sourceSelect =
  "id,url,title,publisher,author,published_at,retrieved_at,language,credibility_score,content_hash,created_at,updated_at";

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

export async function fetchTodayDrop(
  userId: string | null | undefined,
  date: string | Date,
  options: FetchTodayDropOptions = {}
): Promise<DataFetchResult<TodayDailyDrop>> {
  const dropDate = normalizeDropDate(date);
  const fallbackDrop = getFallbackTodayDrop(options.language ?? "en", dropDate);

  if (!userId) {
    logTodayDataProof("mock_fallback", {
      drop_date: dropDate,
      reason: "missing_auth_session"
    });

    return createMockFallbackResult(
      fallbackDrop,
      "missing_auth_session",
      normalizeSupabaseError({
        code: "missing_auth_session",
        message: "Sign in to load your edition."
      })
    );
  }

  if (!supabase) {
    logTodayDataProof("mock_fallback", {
      drop_date: dropDate,
      reason: "missing_supabase_config"
    });

    return createMockFallbackResult(
      fallbackDrop,
      "missing_supabase_config",
      normalizeSupabaseError({
        code: "missing_supabase_config",
        message: "Live editions are not configured for this build.",
        hint:
          "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
      })
    );
  }

  try {
    const cacheKey = getTodayDropCacheKey(userId, dropDate, options.language);
    const cachedDrop = getCachedValue<TodayDailyDrop>(cacheKey);

    if (cachedDrop) {
      logTodayDataProof("live_daily_drop_cache_hit", {
        drop_date: cachedDrop.drop_date,
        daily_drop_id: cachedDrop.id,
        item_count: flattenDailyDropItems(cachedDrop).length,
        user_id: redactIdentifier(userId)
      });

      return createCachedResult(cachedDrop);
    }

    // One drop per (user, date), whatever language it was published in. The
    // reader's current language is applied afterwards by translating the items
    // (see resolveContentItemsForLanguage), so switching language mid-day never
    // hides an edition that already exists in the other language.
    const { data: drop, error: dropError } = await supabase
      .from("daily_drops")
      .select(dailyDropSelect)
      .eq("user_id", userId)
      .eq("drop_date", dropDate)
      .in("status", [...publishedDropStatuses])
      .maybeSingle();

    if (dropError) {
      const normalizedError = normalizeSupabaseError(dropError);
      const fallbackReason = getFallbackReasonForError(normalizedError);

      logTodayDataProof("mock_fallback", {
        drop_date: dropDate,
        reason: fallbackReason
      });

      return createMockFallbackResult(
        fallbackDrop,
        fallbackReason,
        normalizedError
      );
    }

    // A reader with no drop of their own can still have an edition: every
    // module switched off, or an account created after the personal build ran,
    // and a Team that was assigned content today. Team content is a second
    // source, not a decoration on the first, so it is read even when the first
    // is empty — and a synthetic shell carries it so every screen downstream
    // keeps working on one TodayDailyDrop.
    const editionShell = drop ?? buildTeamOnlyDropShell(userId, dropDate, options.language);

    const mappedDrop = await assembleEditionFromBothSources({
      drop: editionShell,
      personalDropItems: drop ? await fetchDropItems(drop.id) : [],
      language: options.language
    });

    if (!mappedDrop) {
      logTodayDataProof("no_edition", {
        daily_drop_id: drop?.id ?? null,
        drop_date: dropDate,
        reason: drop
          ? "daily_drop_has_no_displayable_items"
          : "no_personal_or_team_content"
      });

      return createSupabaseResult(buildEmptyTodayDrop(options.language ?? "en", dropDate));
    }

    setCachedValue(cacheKey, mappedDrop, options.cacheTtlMs ?? todayDropCacheTtlMs);

    logTodayDataProof("live_daily_drop", {
      daily_drop_id: mappedDrop.id,
      drop_date: mappedDrop.drop_date,
      item_count: flattenDailyDropItems(mappedDrop).length,
      language: mappedDrop.language,
      user_id: redactIdentifier(userId)
    });

    return createSupabaseResult(mappedDrop);
  } catch (error) {
    const normalizedError = normalizeSupabaseError(error);
    const fallbackReason = getFallbackReasonForError(normalizedError);

    logTodayDataProof("mock_fallback", {
      drop_date: dropDate,
      reason: fallbackReason
    });

    return createMockFallbackResult(
      fallbackDrop,
      fallbackReason,
      normalizedError
    );
  }
}

export async function fetchContentItemSources(
  contentItemId: string,
  options: FetchContentByIdOptions = {}
): Promise<DataFetchResult<SourceMetadata[]>> {
  const fallbackSources = allowMockContent
    ? getMockSourcesForContentItem(contentItemId)
    : [];

  if (!supabase) {
    return createMockFallbackResult(
      fallbackSources,
      "missing_supabase_config",
      normalizeSupabaseError({
        code: "missing_supabase_config",
        message: "Live source details are not configured for this build.",
        hint:
          "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
      })
    );
  }

  try {
    const cacheKey = getContentSourcesCacheKey(contentItemId, options);
    const cachedSources = getCachedValue<SourceMetadata[]>(cacheKey);

    if (cachedSources) {
      return createCachedResult(cachedSources);
    }

    const { data: sourceLinks, error: sourceLinksError } = await supabase
      .from("content_item_sources")
      .select(contentItemSourceSelect)
      .eq("content_item_id", contentItemId)
      .order("source_order", { ascending: true });

    if (sourceLinksError) {
      const normalizedError = normalizeSupabaseError(sourceLinksError);

      return createMockFallbackResult(
        fallbackSources,
        getFallbackReasonForError(normalizedError),
        normalizedError
      );
    }

    const sourceIds = sourceLinks?.map((link) => link.source_id) ?? [];

    if (sourceIds.length === 0) {
      return createMockFallbackResult(fallbackSources, "no_supabase_data");
    }

    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select(sourceSelect)
      .in("id", sourceIds);

    if (sourcesError) {
      const normalizedError = normalizeSupabaseError(sourcesError);

      return createMockFallbackResult(
        fallbackSources,
        getFallbackReasonForError(normalizedError),
        normalizedError
      );
    }

    const sourcesById = new Map((sources ?? []).map((source) => [source.id, source]));
    const orderedSources = sourceIds
      .map((sourceId) => sourcesById.get(sourceId))
      .filter(isSource)
      .map(mapSource);

    if (orderedSources.length === 0) {
      return createMockFallbackResult(fallbackSources, "no_supabase_data");
    }

    setCachedValue(cacheKey, orderedSources, contentSourcesCacheTtlMs);

    return createSupabaseResult(orderedSources);
  } catch (error) {
    const normalizedError = normalizeSupabaseError(error);

    return createMockFallbackResult(
      fallbackSources,
      getFallbackReasonForError(normalizedError),
      normalizedError
    );
  }
}

/**
 * Resolve a single content item by id and map it into the shape the readers
 * expect. This is what lets archived/library items open: today's drop only holds
 * the current edition, so any item that is not in it is fetched on demand here.
 * Returns `null` data (not a fallback) when the item genuinely no longer exists,
 * so the reader can show its "no longer available" state instead of a dead tap.
 */
export async function fetchContentItemById(
  contentItemId: string,
  options: FetchContentByIdOptions = {}
): Promise<DataFetchResult<DailyDropContentItem | null>> {
  const fallbackItem = allowMockContent ? getMockContentItemById(contentItemId) : null;

  if (!supabase) {
    return createMockFallbackResult(
      fallbackItem,
      "missing_supabase_config",
      normalizeSupabaseError({
        code: "missing_supabase_config",
        message: "Live reading is not configured for this build.",
        hint:
          "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
      })
    );
  }

  try {
    const cacheKey = getContentItemCacheKey(contentItemId, options);
    const cachedItem = getCachedValue<DailyDropContentItem>(cacheKey);

    if (cachedItem) {
      return createCachedResult(cachedItem);
    }

    // The id names the assigned row, whatever language it was published in;
    // the requested language is applied afterwards by translation so an item
    // from an edition published in the other language still opens.
    const { data: contentItem, error } = await supabase
      .from("content_items")
      .select(contentItemSelect)
      .eq("id", contentItemId)
      .eq("status", "published")
      .maybeSingle();

    if (error) {
      const normalizedError = normalizeSupabaseError(error);

      return createMockFallbackResult(
        fallbackItem,
        getFallbackReasonForError(normalizedError),
        normalizedError
      );
    }

    if (!contentItem) {
      // Authoritative "this item is gone" answer, not a fallback.
      return createSupabaseResult(null);
    }

    const slot = slotForContentType(contentItem.content_type);

    if (!slot) {
      return createSupabaseResult(null);
    }

    // BOTH ROUTES, on the archive path too. An item reaches a reader either
    // through their own drop or through a Team assignment for the edition it
    // was published in — and a Team-only article they read last week must open
    // from the archive, not 404 because it was never in a daily_drop_items row.
    //
    // The same call answers the entitlement question and supplies the badge, so
    // there is no second round trip and no way for the two to disagree.
    const teamAssignments = options.userId
      ? await fetchTeamContentForEdition(contentItem.publication_date, options.language)
      : [];
    const identity = identityOfContentItem(contentItem);
    const teamAssignmentsByIdentity = indexTeamAssignmentsByIdentity(teamAssignments);
    const hasTeamEntitlement = identity
      ? teamAssignmentsByIdentity.has(identity)
      : false;

    if (
      options.userId &&
      !hasTeamEntitlement &&
      !(await isContentItemAssignedToUser(contentItemId, options.userId))
    ) {
      return createSupabaseResult(null);
    }

    // Render in the requested language when a translation exists; the item
    // keeps its assigned id (and its own sources — both renderings of one job
    // cite the same source records).
    const [renderedItem] = await resolveContentItemsForLanguage(
      [contentItem],
      options.language
    );

    const sourcesByContentItemId = await fetchSourcesByContentItemIds([contentItemId]);
    // Questions are resolved from the ASSIGNED item, so an archived reading
    // opened after a language switch shows the same questions and the same
    // single attempt as it did on the day.
    const questionsByContentItemId = await fetchQuestionsByContentItemIds([contentItem]);

    // Only for a Team item, and only because it has no assigned id to anchor
    // to: its row changes with the reading language, so completion has to be
    // looked up across every rendering. A personal item keeps the id its drop
    // assigned, so it needs none of this.
    const translationIds = hasTeamEntitlement
      ? await fetchTranslationIdsForItem(contentItem)
      : [];

    const mappedItem = mapDailyDropContentItem(
      renderedItem ?? contentItem,
      synthesizeDropItem(contentItemId, slot),
      sourcesByContentItemId,
      questionsByContentItemId,
      teamAssignmentsByIdentity,
      translationIds
    );

    if (!mappedItem) {
      return createSupabaseResult(null);
    }

    setCachedValue(cacheKey, mappedItem, options.cacheTtlMs ?? todayDropCacheTtlMs);

    return createSupabaseResult(mappedItem);
  } catch (error) {
    const normalizedError = normalizeSupabaseError(error);

    return createMockFallbackResult(
      fallbackItem,
      getFallbackReasonForError(normalizedError),
      normalizedError
    );
  }
}

async function isContentItemAssignedToUser(
  contentItemId: string,
  userId: string
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { data, error } = await supabase
    .from("daily_drop_items")
    .select("content_item_id,daily_drops!inner(user_id)")
    .eq("content_item_id", contentItemId)
    .eq("daily_drops.user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

/** The other published renderings of one item's logical content, by row id. */
async function fetchTranslationIdsForItem(contentItem: ContentItem): Promise<string[]> {
  const key = readContentLogicalKey(contentItem);

  if (!key) {
    return [];
  }

  const itemsByLogicalKey = await fetchContentItemsByLogicalKeys([key]);

  return (itemsByLogicalKey.get(key) ?? [])
    .filter(
      (rendering: ContentItem) =>
        rendering.content_type === contentItem.content_type &&
        rendering.id !== contentItem.id
    )
    .map((rendering: ContentItem) => rendering.id);
}

/** The drop's own items, in the order the personal edition put them. */
async function fetchDropItems(dailyDropId: string): Promise<DailyDropItem[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("daily_drop_items")
    .select(dailyDropItemSelect)
    .eq("daily_drop_id", dailyDropId)
    .order("position", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * The edition row a Team-only edition is hung on.
 *
 * Not written anywhere and never confused for one that is: the id is prefixed
 * so it can never be mistaken for a UUID, and `isSupabaseContentItemId`-style
 * guards downstream keep working. It exists so that a reader whose only content
 * today came from a Team still gets a normal edition — same chrome, same
 * progress line, same readers — instead of the empty-edition screen.
 */
function buildTeamOnlyDropShell(
  userId: string,
  dropDate: string,
  language?: ContentLanguage
): DailyDrop {
  return {
    id: `team-edition:${dropDate}`,
    user_id: userId,
    drop_date: dropDate,
    language: language ?? "en",
    status: "published",
    hide_display_date: false,
    generated_at: dropDate,
    published_at: null,
    created_at: "",
    updated_at: ""
  };
}

/**
 * One edition, assembled from BOTH sources the reader is served by.
 *
 * A reader's edition used to be exactly their own daily drop. It is now that
 * plus whatever their Teams were assigned for the same edition — inside the
 * same editorial sections, not in a second feed, because "Newsletter" is a
 * place in the product and a Team article is still a newsletter article.
 *
 * FOUR QUERIES FOR A WHOLE EDITION, whatever the reader's life looks like.
 * Not four per Team and not four per item: a reader in four Teams, each with
 * six articles and a case, costs exactly the same as a reader in none.
 *
 *   1  the drop's items                    (already fetched by the caller)
 *   2  the content rows for them           one `in (…)`
 *   3  the Team edition                    one RPC, every Team folded in
 *   4  the content rows for Team-only work one `or (…)` over logical keys
 *
 * plus the two shared fetches for sources and questions, which take the union
 * of both sources and are therefore still one query each.
 *
 * Steps 2 and 3 run concurrently: neither needs the other's answer.
 */
async function assembleEditionFromBothSources(input: {
  drop: DailyDrop;
  personalDropItems: DailyDropItem[];
  language?: ContentLanguage;
}): Promise<TodayDailyDrop | null> {
  if (!supabase) {
    return null;
  }

  const personalContentItemIds = input.personalDropItems.map(
    (dropItem) => dropItem.content_item_id
  );

  const [assignedContentItems, teamAssignments] = await Promise.all([
    fetchPublishedContentItemsByIds(personalContentItemIds),
    // Best effort by construction: a Team fetch that fails returns [], and the
    // reader still gets their own edition. Losing both would be the worse bug.
    fetchTeamContentForEdition(input.drop.drop_date, input.language)
  ]);

  // Render the personal items in the reader's language. Ids stay the assigned
  // rows' — the anchor every interaction and every RLS check uses.
  const renderedContentItems = await resolveContentItemsForLanguage(
    assignedContentItems,
    input.language
  );
  const contentItemsById = new Map(
    renderedContentItems.map((contentItem) => [contentItem.id, contentItem])
  );

  // What the reader already has, by LOGICAL identity. An assignment matching
  // one of these is an overlap: the same article reached them twice, and it is
  // shown once.
  const personalIdentities = new Set(
    assignedContentItems
      .map((contentItem) => identityOfContentItem(contentItem))
      .filter((identity): identity is string => identity !== null)
  );
  const teamOnlyAssignments = teamAssignments.filter(
    (assignment) => !personalIdentities.has(teamContentIdentity(assignment))
  );
  const teamOnlyItems = await fetchTeamOnlyContentItems(teamOnlyAssignments);

  if (assignedContentItems.length === 0 && teamOnlyItems.length === 0) {
    return null;
  }

  const teamOnlyContentItems = teamOnlyItems.map((entry) => entry.contentItem);
  const allContentItems = [...assignedContentItems, ...teamOnlyContentItems];
  const allContentItemIds = allContentItems.map((contentItem) => contentItem.id);

  const sourcesByContentItemId = await fetchSourcesByContentItemIds(allContentItemIds);
  // Questions are resolved from the ASSIGNED rows, never the rendered ones, so
  // an archived reading opened after a language switch shows the same questions
  // and the same single attempt as it did on the day.
  const questionsByContentItemId = await fetchQuestionsByContentItemIds(allContentItems);
  const teamAssignmentsByIdentity = indexTeamAssignmentsByIdentity(teamAssignments);

  const mapItem = (
    contentItem: ContentItem,
    dropItem: DailyDropItem,
    translationIds: string[] = []
  ) =>
    mapDailyDropContentItem(
      contentItem,
      dropItem,
      sourcesByContentItemId,
      questionsByContentItemId,
      teamAssignmentsByIdentity,
      translationIds
    );

  const personalItems = input.personalDropItems
    .map((dropItem) => {
      const contentItem = contentItemsById.get(dropItem.content_item_id);

      return contentItem ? mapItem(contentItem, dropItem) : null;
    })
    .filter(isDailyDropContentItem);

  const teamOnlyMapped = teamOnlyItems
    .map((entry) => {
      const slot = slotForContentType(entry.contentItem.content_type);

      return slot
        ? mapItem(
            entry.contentItem,
            synthesizeDropItem(entry.contentItem.id, slot, entry.assignment.position),
            entry.translationIds
          )
        : null;
    })
    .filter(isDailyDropContentItem);

  const availableContentItems = personalItems
    .map((item) => contentItemsById.get(item.id))
    .filter(isContentItem);

  return assembleTodayDrop(
    // The edition's own chrome (title) follows the rendered language, not the
    // language the drop happened to be published in.
    { ...input.drop, language: input.language ?? input.drop.language },
    orderEditionItems([...personalItems, ...teamOnlyMapped]),
    [...availableContentItems, ...teamOnlyContentItems]
  );
}

/**
 * TEAM FIRST, THEN PERSONAL, DEDUPLICATED ON LOGICAL IDENTITY.
 *
 * Done here rather than in the three module screens, for two reasons that both
 * bite. Three screens each running their own merge is three chances for the
 * order to drift apart; and edition PROGRESS is counted over this list, so a
 * screen-level merge would leave the provider counting an overlapping article
 * twice — the reader told they had six things to read when they have five.
 *
 * Ordering is per section, because the sections are what the reader sees: the
 * lead of the Newsletter must be a Newsletter item, not whichever mini case
 * happened to sort first.
 */
function orderEditionItems(items: DailyDropContentItem[]): DailyDropContentItem[] {
  const bySlot = new Map<DailyDropSlot, DailyDropContentItem[]>();

  for (const item of items) {
    bySlot.set(item.slot, [...(bySlot.get(item.slot) ?? []), item]);
  }

  return [...bySlot.entries()].flatMap(([, slotItems]) =>
    mergedItems(
      mergeTeamAndPersonalContent({
        // An item with Teams IS a Team assignment, whether or not the reader's
        // own edition also carries it; one with none is purely personal.
        teamAssignments: slotItems
          .filter((item) => (item.teams ?? []).length > 0)
          .flatMap((item) =>
            (item.teams ?? []).map((team) => ({
              team,
              item,
              position: item.assignment_position ?? 0
            }))
          ),
        personalItems: slotItems.filter((item) => (item.teams ?? []).length === 0)
      })
    )
  );
}

/** The published content rows for a set of assigned ids. One query. */
async function fetchPublishedContentItemsByIds(
  contentItemIds: string[]
): Promise<ContentItem[]> {
  if (!supabase || contentItemIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("content_items")
    .select(contentItemSelect)
    .in("id", contentItemIds)
    .eq("status", "published");

  if (error) {
    throw error;
  }

  return (data ?? []).filter(isContentItem);
}

type TeamOnlyContentItem = {
  assignment: TeamContentAssignment;
  contentItem: ContentItem;
  /** The other renderings of the same logical content, by row id. */
  translationIds: string[];
};

/**
 * The content rows behind Team-only assignments — ALL renderings, in one query.
 *
 * By logical key rather than by the display id the RPC returned, because Team
 * content has no daily_drop_items row to pin an id to. The row that is shown
 * changes when the reader switches language, so completion has to be looked up
 * across every rendering or a Team article read in English would come back
 * unread in French. The display row is the one the database already chose;
 * the rest are carried as `translation_ids`.
 */
async function fetchTeamOnlyContentItems(
  assignments: TeamContentAssignment[]
): Promise<TeamOnlyContentItem[]> {
  if (assignments.length === 0) {
    return [];
  }

  const itemsByLogicalKey = await fetchContentItemsByLogicalKeys(
    assignments.map((assignment) => assignment.contentLogicalKey)
  );
  const teamOnlyItems: TeamOnlyContentItem[] = [];

  for (const assignment of assignments) {
    const renderings = (itemsByLogicalKey.get(assignment.contentLogicalKey) ?? []).filter(
      (contentItem: ContentItem) => contentItem.content_type === assignment.contentType
    );
    const displayItem =
      renderings.find(
        (contentItem: ContentItem) => contentItem.id === assignment.displayContentItemId
      ) ?? renderings[0];

    if (!displayItem) {
      continue;
    }

    teamOnlyItems.push({
      assignment,
      contentItem: displayItem,
      translationIds: renderings
        .filter((contentItem: ContentItem) => contentItem.id !== displayItem.id)
        .map((contentItem: ContentItem) => contentItem.id)
    });
  }

  return teamOnlyItems;
}


async function fetchSourcesByContentItemIds(
  contentItemIds: string[]
): Promise<SourcesByContentItemId> {
  if (!supabase || contentItemIds.length === 0) {
    return {};
  }

  const { data: sourceLinks, error } = await supabase
    .from("content_item_sources")
    .select(contentItemSourceSelect)
    .in("content_item_id", contentItemIds)
    .order("source_order", { ascending: true });

  if (error) {
    throw error;
  }

  const links = sourceLinks ?? [];
  const sourceIds = [...new Set(links.map((link) => link.source_id))];

  if (sourceIds.length === 0) {
    return {};
  }

  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select(sourceSelect)
    .in("id", sourceIds);

  if (sourcesError) {
    throw sourcesError;
  }

  const sourcesById = new Map((sources ?? []).map((source) => [source.id, source]));

  return links.reduce<SourcesByContentItemId>((sourcesByContentItem, link) => {
    const current = sourcesByContentItem[link.content_item_id] ?? {
      sourceIds: [],
      sources: []
    };
    const source = sourcesById.get(link.source_id);

    return {
      ...sourcesByContentItem,
      [link.content_item_id]: {
        sourceIds: [...current.sourceIds, link.source_id],
        sources: source ? [...current.sources, mapSource(source)] : current.sources
      }
    };
  }, {});
}

/**
 * The questions attached to a set of content items, and the Teams that assigned
 * them.
 *
 * TWO QUERIES FOR A WHOLE EDITION, not two per item. An edition is up to 23
 * items and a reader can be in any number of Teams; doing this per item would
 * be the N+1 that makes a Newsletter tab take a second to draw.
 *
 * Questions are matched on `content_logical_key`, read from the item's own
 * metadata by the same three keys `public.content_logical_key(jsonb)` uses. The
 * FR and EN renderings of one editorial job share that key, so a reader who
 * switches language keeps the same questions and the same single attempt.
 *
 * Both fetchers are BEST EFFORT: a failure returns empty rather than throwing.
 * A reader whose questions could not be loaded gets the article, which is the
 * product; a reader who got an error screen instead would have lost both.
 */
async function fetchQuestionsByContentItemIds(
  contentItems: ContentItem[]
): Promise<QuestionsByContentItemId> {
  if (!supabase || contentItems.length === 0) {
    return {};
  }

  const keyByItemId = new Map<string, string>();
  const logicalKeys = new Set<string>();

  for (const item of contentItems) {
    const key = readContentLogicalKey(item);

    if (key) {
      keyByItemId.set(item.id, key);
      logicalKeys.add(key);
    }
  }

  if (logicalKeys.size === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("logical_questions")
    .select(logicalQuestionSelect)
    .in("content_logical_key", [...logicalKeys])
    .order("question_sequence", { ascending: true });

  if (error || !data) {
    return {};
  }

  const byKey = new Map<string, LogicalQuestionRef[]>();

  for (const row of data) {
    const key = row.content_logical_key as string;
    const list = byKey.get(key) ?? [];

    list.push({
      logical_question_id: row.id as string,
      question_sequence: Number(row.question_sequence ?? 0),
      question_role: (row.question_role as string | null) ?? null
    });

    byKey.set(key, list);
  }

  const questions: QuestionsByContentItemId = {};

  for (const item of contentItems) {
    const key = keyByItemId.get(item.id);
    const list = key ? byKey.get(key) : undefined;

    // Content type has to match too: a mini case and a newsletter article can
    // share a staging batch but never a question set.
    if (list && list.length > 0) {
      questions[item.id] = list;
    }
  }

  return questions;
}

/**
 * The logical identity of a content row: the same `content_type` +
 * `content_logical_key` pair the Team assignments are written on.
 *
 * Null for content that predates the key. Such an item is only ever itself —
 * it can never be recognised as the other language rendering of anything, and
 * it can never be matched to a Team assignment, which is the honest answer
 * rather than a guess.
 */
function identityOfContentItem(contentItem: ContentItem): string | null {
  const key = readContentLogicalKey(contentItem);

  return key
    ? teamContentIdentity({ contentLogicalKey: key, contentType: contentItem.content_type })
    : null;
}


/** The three metadata keys `public.content_logical_key(jsonb)` reads, in order. */
function readContentLogicalKey(item: ContentItem): string | null {
  const metadata = getMetadata(item);

  for (const key of ["staging_job_id", "catalog_entry_id", "entry_key"]) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function assembleTodayDrop(
  drop: DailyDrop,
  items: DailyDropContentItem[],
  contentItems: ContentItem[]
): TodayDailyDrop | null {
  const newsletter = items.filter(isNewsletterArticle);
  const businessStory = items.find(isBusinessStory);
  // PLURAL. A reader can be handed a Finance case by one Team, an AI case by
  // another and their own Law case in the same edition; `find` could only ever
  // return one of the three, and which one was an accident of ordering.
  const miniCases = items.filter(isMiniCaseChallenge);
  const concept = items.find(isKeyConcept);

  if (newsletter.length === 0 && !businessStory && miniCases.length === 0 && !concept) {
    return null;
  }

  return {
    id: drop.id,
    drop_date: drop.drop_date,
    // Rows written before the column existed read as false: a normal dated
    // edition stays dated.
    hide_display_date: drop.hide_display_date === true,
    language: drop.language,
    title: drop.language === "fr" ? "Brief du jour" : "Today's briefing",
    prompt_version: readFirstContentMetadataString(
      contentItems,
      "prompt_version",
      "supabase_v1"
    ),
    generator_version: readFirstContentMetadataString(
      contentItems,
      "generator_version",
      "supabase_v1"
    ),
    estimated_read_minutes: estimateReadMinutes(contentItems),
    items: {
      newsletter,
      business_story: businessStory,
      mini_cases: miniCases,
      // Legacy alias, always mini_cases[0] — never a second source of truth.
      mini_case: miniCases[0],
      concept
    }
  };
}

function mapDailyDropContentItem(
  contentItem: ContentItem,
  dropItem: DailyDropItem,
  sourcesByContentItemId: SourcesByContentItemId,
  questionsByContentItemId: QuestionsByContentItemId = {},
  teamAssignmentsByIdentity: Map<string, TeamAssignmentRef> = new Map(),
  translationIds: string[] = []
): DailyDropContentItem | null {
  const metadata = getMetadata(contentItem);
  const sourceDetails = sourcesByContentItemId[contentItem.id] ?? {
    sourceIds: [],
    sources: []
  };
  const identity = identityOfContentItem(contentItem);
  // Badged by LOGICAL identity, not by row id. That is what puts the Team badge
  // on the reader's own copy of an article their Team was also assigned, and
  // what keeps it there across a language switch.
  const teamAssignment = identity ? teamAssignmentsByIdentity.get(identity) : undefined;
  const base = {
    id: contentItem.id,
    content_logical_key: readContentLogicalKey(contentItem),
    language: contentItem.language,
    source_ids: sourceDetails.sourceIds,
    sources: sourceDetails.sources,
    title: contentItem.title,
    translation_ids: translationIds.length > 0 ? translationIds : undefined,
    version: contentItem.version,
    // Absent when this item predates questions, which every reader treats as
    // "no quiz" without needing a flag of its own.
    logical_questions: questionsByContentItemId[contentItem.id],
    teams: teamAssignment && teamAssignment.teams.length > 0 ? teamAssignment.teams : undefined,
    // The Team's own position, never the personal edition's: an article that
    // reached the reader both ways still leads where its Team put it.
    assignment_position: teamAssignment?.position ?? dropItem.position
  };

  if (contentItem.content_type === "newsletter_article" && dropItem.slot === "newsletter") {
    return {
      ...base,
      body_md: contentItem.body_md,
      content_type: "newsletter_article",
      published_date: contentItem.publication_date,
      slot: "newsletter",
      summary: contentItem.summary ?? readString(metadata, "summary"),
      topic: readTopic(metadata, "topic", contentItem.topic_id),
      why_it_matters: readString(
        metadata,
        "why_it_matters",
        contentItem.summary ?? ""
      )
    };
  }

  if (contentItem.content_type === "business_story" && dropItem.slot === "business_story") {
    return {
      ...base,
      // Fallback follows the content language so FR stories never show an English label.
      company_or_market: readString(
        metadata,
        "company_or_market",
        contentItem.language === "fr" ? "Marché" : "Market"
      ),
      content_type: "business_story",
      decision: readString(metadata, "decision"),
      lesson: readString(metadata, "lesson", contentItem.summary ?? ""),
      outcome: readString(metadata, "outcome"),
      setup: readString(metadata, "setup", contentItem.body_md),
      slot: "business_story",
      story_date: readString(metadata, "story_date", contentItem.publication_date),
      tension: readString(metadata, "tension")
    };
  }

  if (contentItem.content_type === "mini_case" && dropItem.slot === "mini_case") {
    return {
      ...base,
      challenge: readString(metadata, "challenge", contentItem.summary ?? ""),
      constraints: readStringArray(metadata, "constraints"),
      content_type: "mini_case",
      context: readString(metadata, "context", contentItem.body_md),
      difficulty: mapDifficulty(contentItem.difficulty),
      expected_reasoning: readStringArray(metadata, "expected_reasoning"),
      final_takeaway: readString(metadata, "final_takeaway") || undefined,
      question: readString(metadata, "question"),
      questions: readMiniCaseQuestions(metadata),
      sample_answer: readString(metadata, "sample_answer"),
      score_max: readNumber(metadata, "score_max"),
      slot: "mini_case",
      surprise_fact: readString(metadata, "surprise_fact") || undefined,
      topic: readTopic(metadata, "topic", contentItem.topic_id)
    };
  }

  if (contentItem.content_type === "concept" && dropItem.slot === "concept") {
    return {
      ...base,
      category: readTopicOrCareer(metadata, "category", contentItem.topic_id),
      common_mistake: readString(metadata, "common_mistake"),
      content_type: "key_concept",
      definition: readString(
        metadata,
        "definition",
        contentItem.summary ?? contentItem.body_md
      ),
      example: readString(metadata, "example"),
      how_to_use_it: readString(metadata, "how_to_use_it"),
      plain_english: readString(metadata, "plain_english", contentItem.body_md),
      slot: "concept",
      why_it_matters: readString(metadata, "why_it_matters", contentItem.summary ?? "")
    };
  }

  return null;
}

function mapSource(source: Source): SourceMetadata {
  return {
    id: source.id,
    author: source.author,
    content_hash: source.content_hash ?? `supabase:${source.id}`,
    language: source.language ?? "multi",
    published_at: source.published_at,
    // No stand-ins. These used to become "Unknown publisher" and the raw URL,
    // which reads as a citation the source record does not actually make; the
    // Sources UI omits the line instead.
    publisher: source.publisher,
    retrieved_at: source.retrieved_at,
    title: source.title,
    url: source.url
  };
}

/**
 * What a data failure falls back to. Development and explicit preview builds
 * may show the sample edition; every other build gets an honest empty drop so
 * demo content is never presented as real (see lib/mockPolicy).
 */
export function getFallbackTodayDrop(
  language: ContentLanguage,
  dropDate: string
): TodayDailyDrop {
  if (allowMockContent) {
    return mockTodayDailyDropsByLanguage[language] ?? mockTodayDailyDropsByLanguage.en;
  }

  return buildEmptyTodayDrop(language, dropDate);
}

/**
 * A real, authoritative "no edition" drop with zero items. Returned to authenticated
 * users when Supabase has no assigned drop for the date (e.g. a quiet day in the
 * 4×/week cadence). The UI renders a deliberate empty-edition screen rather than
 * mock/sample content, which keeps the app free of any "sample" surface.
 */
export function buildEmptyTodayDrop(
  language: ContentLanguage,
  dropDate: string
): TodayDailyDrop {
  return {
    id: `no-edition:${dropDate}:${language}`,
    drop_date: dropDate,
    hide_display_date: false,
    language,
    title: language === "fr" ? "Aucune édition" : "No edition",
    prompt_version: "no_edition",
    generator_version: "no_edition",
    estimated_read_minutes: 0,
    items: {
      newsletter: [],
      business_story: undefined,
      mini_cases: [],
      mini_case: undefined,
      concept: undefined
    }
  };
}

function getMockContentItemById(contentItemId: string): DailyDropContentItem | null {
  return (
    Object.values(mockTodayDailyDropsByLanguage)
      .flatMap((drop) => flattenDailyDropItems(drop))
      .find((item) => item.id === contentItemId) ?? null
  );
}

function slotForContentType(
  contentType: ContentItem["content_type"]
): DailyDropItem["slot"] | null {
  switch (contentType) {
    case "newsletter_article":
      return "newsletter";
    case "business_story":
      return "business_story";
    case "mini_case":
      return "mini_case";
    case "concept":
      return "concept";
    default:
      return null;
  }
}

// A standalone content item has no daily_drop_items row; mapDailyDropContentItem
// reads the slot and the position, so we provide a minimal one anchored to the
// right slot and carrying the Team assignment's own position where there is one.
function synthesizeDropItem(
  contentItemId: string,
  slot: DailyDropItem["slot"],
  position = 0
): DailyDropItem {
  return {
    daily_drop_id: "",
    content_item_id: contentItemId,
    slot,
    position,
    created_at: ""
  };
}

function getMockSourcesForContentItem(contentItemId: string): SourceMetadata[] {
  const mockItem = Object.values(mockTodayDailyDropsByLanguage)
    .flatMap((drop) => flattenDailyDropItems(drop))
    .find((item) => item.id === contentItemId);

  return mockItem ? getMockSourcesForItem(mockItem) : [];
}

function getMetadata(contentItem: ContentItem): Record<string, unknown> {
  return isRecord(contentItem.metadata) ? contentItem.metadata : {};
}

function readFirstContentMetadataString(
  contentItems: ContentItem[],
  key: string,
  fallback: string
): string {
  for (const contentItem of contentItems) {
    const metadata = getMetadata(contentItem);
    const value = readString(metadata, key);

    if (value) {
      return value;
    }
  }

  return fallback;
}

function readString(
  metadata: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  const value = metadata[key];

  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNumber(
  metadata: Record<string, unknown>,
  key: string
): number | undefined {
  const value = metadata[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

const miniCaseOutcomes: readonly MiniCaseOptionOutcome[] = ["best", "viable", "weak"];
const miniCaseRoles: readonly MiniCaseQuestionRole[] = ["method", "application", "conclusion"];

// The content engine persists questions with the schema taxonomy
// (method_framework / technical_application / conclusion_decision). The reader
// uses the shorter mobile roles, so map the engine values onto them. Mock data
// already uses the short roles, so this is a no-op there.
const engineRoleToMobileRole: Record<string, MiniCaseQuestionRole> = {
  method_framework: "method",
  technical_application: "application",
  conclusion_decision: "conclusion"
};

function readMiniCaseQuestions(
  metadata: Record<string, unknown>
): MiniCaseQuestion[] | undefined {
  const value = metadata["questions"];

  if (!Array.isArray(value)) {
    return undefined;
  }

  const questions = value
    .map((entry, index) => parseMiniCaseQuestion(entry, index))
    .filter((question): question is MiniCaseQuestion => question !== null);

  if (questions.length === 0) {
    return undefined;
  }

  // Presentation order is decided here, on the way to the reader, rather than in
  // the row. Cases written before the engine ordered its own output — the whole
  // launch catalog — are served with the same deterministic order as new ones,
  // and no stored content has to be rewritten to get it. Option ids are
  // untouched, so stored answers still resolve.
  return orderMiniCaseQuestionOptions(questions, metadata);
}

// Accepts both the mobile/mock shape (prompt, options[].label/outcome/feedback)
// and the content-engine shape (question, options[].text/is_correct/feedback),
// so live Supabase content and mock content both render through one reader.
function parseMiniCaseQuestion(value: unknown, index: number): MiniCaseQuestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = firstTrimmedString(value.prompt, value.question);

  if (prompt.length === 0) {
    return null;
  }

  const options = Array.isArray(value.options)
    ? value.options
        .map((option, optionIndex) => parseMiniCaseOption(option, optionIndex))
        .filter((option): option is MiniCaseOption => option !== null)
    : [];

  if (options.length < 2) {
    return null;
  }

  return {
    id:
      typeof value.id === "string" && value.id.trim().length > 0
        ? value.id
        : `question-${index + 1}`,
    prompt,
    options,
    role: parseMiniCaseRole(value.role),
    explanation:
      typeof value.explanation === "string" && value.explanation.trim().length > 0
        ? value.explanation
        : undefined
  };
}

function parseMiniCaseRole(value: unknown): MiniCaseQuestionRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (miniCaseRoles.includes(value as MiniCaseQuestionRole)) {
    return value as MiniCaseQuestionRole;
  }

  return engineRoleToMobileRole[value];
}

function parseMiniCaseOption(value: unknown, index: number): MiniCaseOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = firstTrimmedString(value.label, value.text);

  if (label.length === 0) {
    return null;
  }

  const isCorrect = value.is_correct === true;

  // Prefer an explicit outcome (mock/legacy); otherwise derive it from the
  // engine's is_correct flag so the reader can highlight the strongest answer.
  const outcome: MiniCaseOptionOutcome = miniCaseOutcomes.includes(
    value.outcome as MiniCaseOptionOutcome
  )
    ? (value.outcome as MiniCaseOptionOutcome)
    : isCorrect
      ? "best"
      : "weak";

  // New engine content carries a single `feedback`. Legacy content carried
  // feedback_correct/feedback_incorrect, so fall back to the relevant one.
  const feedback = firstTrimmedString(
    value.feedback,
    isCorrect ? value.feedback_correct : value.feedback_incorrect
  );

  return {
    id:
      typeof value.id === "string" && value.id.trim().length > 0
        ? value.id
        : `option-${index + 1}`,
    label,
    outcome,
    feedback
  };
}

function firstTrimmedString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function readTopic(
  metadata: Record<string, unknown>,
  key: string,
  fallback: string | null
): TopicId {
  const value = metadata[key];

  if (typeof value === "string" && isTopicId(value)) {
    return value;
  }

  return isTopicId(fallback) ? fallback : "business";
}

function readTopicOrCareer(
  metadata: Record<string, unknown>,
  key: string,
  fallback: string | null
): TopicId | "career" {
  const value = metadata[key];

  if (value === "career" || (typeof value === "string" && isTopicId(value))) {
    return value;
  }

  return isTopicId(fallback) ? fallback : "business";
}

function mapDifficulty(difficulty: ContentItem["difficulty"]): ContentDifficulty {
  if (difficulty === "hard") {
    return "advanced";
  }

  if (difficulty === "medium") {
    return "intermediate";
  }

  return "intro";
}

function estimateReadMinutes(contentItems: ContentItem[]): number {
  const estimatedSeconds = contentItems.reduce((totalSeconds, contentItem) => {
    return totalSeconds + (contentItem.estimated_read_seconds ?? 0);
  }, 0);

  return Math.max(5, Math.ceil(estimatedSeconds / 60));
}

function normalizeDropDate(date: string | Date): string {
  // A Date must go through the reader's calendar day, never toISOString(): the
  // UTC slice is already tomorrow for most of the Americas every evening.
  return typeof date === "string" ? date.slice(0, 10) : getUserLocalDateKey(date);
}

/** Exported so the language-switch guard can assert the key really differs per language. */
export function getTodayDropCacheKey(
  userId: string,
  dropDate: string,
  language?: ContentLanguage
): string {
  return ["today-drop", userId, dropDate, language ?? "any"].join(":");
}

function getContentSourcesCacheKey(
  contentItemId: string,
  options: FetchContentByIdOptions = {}
): string {
  return [
    "content-sources",
    options.userId ?? "anonymous",
    options.language ?? "any",
    contentItemId
  ].join(":");
}

/** Exported so the language-switch guard can assert the key really differs per language. */
export function getContentItemCacheKey(
  contentItemId: string,
  options: FetchContentByIdOptions = {}
): string {
  return [
    "content-item",
    options.userId ?? "anonymous",
    options.language ?? "any",
    contentItemId
  ].join(":");
}

function getFallbackReasonForError(error: ReturnType<typeof normalizeSupabaseError>): DataFallbackReason {
  return isLikelyNetworkError(error) ? "network_unavailable" : "supabase_error";
}

function logTodayDataProof(
  event: "live_daily_drop" | "live_daily_drop_cache_hit" | "mock_fallback" | "no_edition",
  details: Record<string, unknown>
): void {
  if (__DEV__) {
    const payload = {
      event,
      proof_mode: liveDataProofMode,
      ...details
    };

    if (liveDataProofMode && event === "mock_fallback") {
      console.error("[Today data proof]", payload);
      return;
    }

    console.info("[Today data proof]", payload);
  }
}

function redactIdentifier(identifier: string): string {
  return identifier.length <= 8
    ? identifier
    : `${identifier.slice(0, 4)}...${identifier.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTopicId(value: unknown): value is TopicId {
  return typeof value === "string" && topicIds.includes(value as TopicId);
}

function isDailyDropContentItem(
  item: DailyDropContentItem | null
): item is DailyDropContentItem {
  return item !== null;
}

function isContentItem(contentItem: ContentItem | undefined): contentItem is ContentItem {
  return Boolean(contentItem);
}

function isNewsletterArticle(item: DailyDropContentItem): item is NewsletterArticle {
  return item.content_type === "newsletter_article";
}

function isBusinessStory(item: DailyDropContentItem): item is BusinessStory {
  return item.content_type === "business_story";
}

function isMiniCaseChallenge(item: DailyDropContentItem): item is MiniCaseChallenge {
  return item.content_type === "mini_case";
}

function isKeyConcept(item: DailyDropContentItem): item is KeyConcept {
  return item.content_type === "key_concept";
}

function isSource(source: Source | undefined): source is Source {
  return Boolean(source);
}
