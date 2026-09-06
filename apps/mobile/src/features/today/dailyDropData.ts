import {
  createCachedResult,
  createMockFallbackResult,
  createSupabaseResult,
  type DataFallbackReason,
  type DataFetchResult
} from "../../lib/dataState";
import { getUserLocalDateKey } from "../../lib/localDate";
import { getCachedValue, setCachedValue } from "../../lib/memoryCache";
import { resolveContentItemsForLanguage } from "./contentTranslations";
import { orderMiniCaseQuestionOptions } from "./miniCaseOptionOrder";
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
type TeamsByContentItemId = Record<string, ContentTeamRef[]>;

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

    if (!drop) {
      logTodayDataProof("no_edition", {
        drop_date: dropDate,
        reason: "no_supabase_data",
        user_id: redactIdentifier(userId)
      });

      return createSupabaseResult(buildEmptyTodayDrop(options.language ?? "en", dropDate));
    }

    const mappedDrop = await fetchAndMapDailyDrop(drop, options.language);

    if (!mappedDrop) {
      logTodayDataProof("no_edition", {
        daily_drop_id: drop.id,
        drop_date: dropDate,
        reason: "daily_drop_has_no_displayable_items"
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

    if (options.userId && !(await isContentItemAssignedToUser(contentItemId, options.userId))) {
      return createSupabaseResult(null);
    }

    const slot = slotForContentType(contentItem.content_type);

    if (!slot) {
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
    const teamsByContentItemId = await fetchTeamsByContentItemIds({
      contentItems: [contentItem],
      questionsByContentItemId,
      editionDate: contentItem.publication_date
    });

    const mappedItem = mapDailyDropContentItem(
      renderedItem ?? contentItem,
      synthesizeDropItem(contentItemId, slot),
      sourcesByContentItemId,
      questionsByContentItemId,
      teamsByContentItemId
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

async function fetchAndMapDailyDrop(
  drop: DailyDrop,
  language?: ContentLanguage
): Promise<TodayDailyDrop | null> {
  if (!supabase) {
    return null;
  }

  const { data: dropItems, error: dropItemsError } = await supabase
    .from("daily_drop_items")
    .select(dailyDropItemSelect)
    .eq("daily_drop_id", drop.id)
    .order("position", { ascending: true });

  if (dropItemsError) {
    throw dropItemsError;
  }

  const orderedDropItems = dropItems ?? [];
  const contentItemIds = orderedDropItems.map((item) => item.content_item_id);

  if (contentItemIds.length === 0) {
    return null;
  }

  const { data: contentItems, error: contentItemsError } = await supabase
    .from("content_items")
    .select(contentItemSelect)
    .in("id", contentItemIds)
    .eq("status", "published");

  if (contentItemsError) {
    throw contentItemsError;
  }

  // Render in the reader's current language: display fields come from the
  // translation, ids stay the assigned rows' — the anchor for interactions.
  const renderedContentItems = await resolveContentItemsForLanguage(
    contentItems ?? [],
    language
  );

  const contentItemsById = new Map(
    renderedContentItems.map((contentItem) => [contentItem.id, contentItem])
  );
  const availableContentItems = orderedDropItems
    .map((dropItem) => contentItemsById.get(dropItem.content_item_id))
    .filter(isContentItem);
  // The assigned rows, not the rendered ones: sources, questions and team
  // assignments are all granted on the id the reader's own drop references.
  const assignedContentItems = (contentItems ?? []).filter(isContentItem);
  const sourcesByContentItemId = await fetchSourcesByContentItemIds(contentItemIds);
  const questionsByContentItemId = await fetchQuestionsByContentItemIds(assignedContentItems);
  const teamsByContentItemId = await fetchTeamsByContentItemIds({
    contentItems: assignedContentItems,
    questionsByContentItemId,
    editionDate: drop.drop_date
  });

  const mappedItems = orderedDropItems
    .map((dropItem) => {
      const contentItem = contentItemsById.get(dropItem.content_item_id);

      return contentItem
        ? mapDailyDropContentItem(
            contentItem,
            dropItem,
            sourcesByContentItemId,
            questionsByContentItemId,
            teamsByContentItemId
          )
        : null;
    })
    .filter(isDailyDropContentItem);

  // The edition's own chrome (title) follows the rendered language, not the
  // language the drop happened to be published in.
  return assembleTodayDrop(
    { ...drop, language: language ?? drop.language },
    mappedItems,
    availableContentItems
  );
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
 * Which of the reader's Teams were assigned each item, for the current edition.
 *
 * Eligibility is applied here, not in the UI: a member who joined mid-edition
 * is not eligible until the next one, and showing them a Team badge on content
 * that will not score for them would be a lie the leaderboard then contradicts.
 */
async function fetchTeamsByContentItemIds(input: {
  contentItems: ContentItem[];
  questionsByContentItemId: QuestionsByContentItemId;
  editionDate: string;
}): Promise<TeamsByContentItemId> {
  if (!supabase) {
    return {};
  }

  const logicalQuestionIds = [
    ...new Set(
      Object.values(input.questionsByContentItemId).flatMap((list) =>
        list.map((question) => question.logical_question_id)
      )
    )
  ];

  if (logicalQuestionIds.length === 0) {
    return {};
  }

  // RLS on team_question_assignments already scopes this to teams the reader is
  // an active member of, so no user filter is needed and none is sent.
  const { data, error } = await supabase
    .from("team_question_assignments")
    .select("team_id,logical_question_id,edition_date,teams!inner(id,name,name_status)")
    .eq("edition_date", input.editionDate)
    .in("logical_question_id", logicalQuestionIds);

  if (error || !data) {
    return {};
  }

  const teamsByQuestionId = new Map<string, ContentTeamRef[]>();

  for (const row of data) {
    const team = (row.teams ?? {}) as unknown as Record<string, unknown>;
    const questionId = row.logical_question_id as string;
    const list = teamsByQuestionId.get(questionId) ?? [];
    const teamId = String(team.id ?? row.team_id ?? "");

    if (!teamId || list.some((entry) => entry.id === teamId)) {
      continue;
    }

    list.push({
      id: teamId,
      // Moderation applied at read time: a hidden name renders as a neutral
      // label rather than disappearing, so the row still says "Team".
      name: team.name_status === "hidden" ? null : ((team.name as string) ?? null)
    });

    teamsByQuestionId.set(questionId, list);
  }

  const teams: TeamsByContentItemId = {};

  for (const [contentItemId, questions] of Object.entries(input.questionsByContentItemId)) {
    const merged: ContentTeamRef[] = [];

    for (const question of questions) {
      for (const team of teamsByQuestionId.get(question.logical_question_id) ?? []) {
        if (!merged.some((entry) => entry.id === team.id)) {
          merged.push(team);
        }
      }
    }

    if (merged.length > 0) {
      teams[contentItemId] = merged;
    }
  }

  return teams;
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
  const miniCase = items.find(isMiniCaseChallenge);
  const concept = items.find(isKeyConcept);

  if (newsletter.length === 0 && !businessStory && !miniCase && !concept) {
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
      mini_case: miniCase,
      concept
    }
  };
}

function mapDailyDropContentItem(
  contentItem: ContentItem,
  dropItem: DailyDropItem,
  sourcesByContentItemId: SourcesByContentItemId,
  questionsByContentItemId: QuestionsByContentItemId = {},
  teamsByContentItemId: TeamsByContentItemId = {}
): DailyDropContentItem | null {
  const metadata = getMetadata(contentItem);
  const sourceDetails = sourcesByContentItemId[contentItem.id] ?? {
    sourceIds: [],
    sources: []
  };
  const base = {
    id: contentItem.id,
    language: contentItem.language,
    source_ids: sourceDetails.sourceIds,
    sources: sourceDetails.sources,
    title: contentItem.title,
    version: contentItem.version,
    // Absent when this item predates questions, which every reader treats as
    // "no quiz" without needing a flag of its own.
    logical_questions: questionsByContentItemId[contentItem.id],
    teams: teamsByContentItemId[contentItem.id]
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
// only reads the slot, so we provide a minimal one anchored to the right slot.
function synthesizeDropItem(
  contentItemId: string,
  slot: DailyDropItem["slot"]
): DailyDropItem {
  return {
    daily_drop_id: "",
    content_item_id: contentItemId,
    slot,
    position: 0,
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
