import {
  createCachedResult,
  createMockFallbackResult,
  createSupabaseResult,
  type DataFallbackReason,
  type DataFetchResult
} from "../../lib/dataState";
import { getCachedValue, setCachedValue } from "../../lib/memoryCache";
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

type SourcesByContentItemId = Record<
  string,
  {
    sourceIds: string[];
    sources: SourceMetadata[];
  }
>;

const publishedDropStatuses = ["published", "read", "archived"] as const;
const todayDropCacheTtlMs = 60_000;
const contentSourcesCacheTtlMs = 5 * 60_000;
const liveDataProofMode = process.env.EXPO_PUBLIC_LIVE_DATA_PROOF_MODE === "true";
const contentItemSelect =
  "id,content_type,topic_id,language,title,summary,body_md,difficulty,estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata,created_at,updated_at";
const contentItemSourceSelect = "content_item_id,source_id,claim,source_order,created_at";
const dailyDropItemSelect = "daily_drop_id,content_item_id,slot,position,created_at";
const dailyDropSelect =
  "id,user_id,drop_date,language,status,generated_at,published_at,created_at,updated_at";
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
  const fallbackDrop = getMockTodayDrop(options.language);

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
        message: "Sign in to load your assigned daily drop."
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
        message: "Live daily drops are not configured for this build.",
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

    let dropQuery = supabase
      .from("daily_drops")
      .select(dailyDropSelect)
      .eq("user_id", userId)
      .eq("drop_date", dropDate)
      .in("status", [...publishedDropStatuses]);

    if (options.language) {
      dropQuery = dropQuery.eq("language", options.language);
    }

    const { data: drop, error: dropError } = await dropQuery.maybeSingle();

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

    const mappedDrop = await fetchAndMapDailyDrop(drop);

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
  contentItemId: string
): Promise<DataFetchResult<SourceMetadata[]>> {
  const fallbackSources = getMockSourcesForContentItem(contentItemId);

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
    const cacheKey = getContentSourcesCacheKey(contentItemId);
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
  contentItemId: string
): Promise<DataFetchResult<DailyDropContentItem | null>> {
  const fallbackItem = getMockContentItemById(contentItemId);

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
    const cacheKey = getContentItemCacheKey(contentItemId);
    const cachedItem = getCachedValue<DailyDropContentItem>(cacheKey);

    if (cachedItem) {
      return createCachedResult(cachedItem);
    }

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

    const sourcesByContentItemId = await fetchSourcesByContentItemIds([contentItemId]);
    const mappedItem = mapDailyDropContentItem(
      contentItem,
      synthesizeDropItem(contentItemId, slot),
      sourcesByContentItemId
    );

    if (!mappedItem) {
      return createSupabaseResult(null);
    }

    setCachedValue(cacheKey, mappedItem, todayDropCacheTtlMs);

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

async function fetchAndMapDailyDrop(
  drop: DailyDrop
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

  const contentItemsById = new Map(
    (contentItems ?? []).map((contentItem) => [contentItem.id, contentItem])
  );
  const availableContentItems = orderedDropItems
    .map((dropItem) => contentItemsById.get(dropItem.content_item_id))
    .filter(isContentItem);
  const sourcesByContentItemId = await fetchSourcesByContentItemIds(contentItemIds);
  const mappedItems = orderedDropItems
    .map((dropItem) => {
      const contentItem = contentItemsById.get(dropItem.content_item_id);

      return contentItem
        ? mapDailyDropContentItem(contentItem, dropItem, sourcesByContentItemId)
        : null;
    })
    .filter(isDailyDropContentItem);

  return assembleTodayDrop(drop, mappedItems, availableContentItems);
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
  sourcesByContentItemId: SourcesByContentItemId
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
    version: contentItem.version
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
    publisher: source.publisher ?? "Unknown publisher",
    retrieved_at: source.retrieved_at,
    title: source.title ?? source.url,
    url: source.url
  };
}

function getMockTodayDrop(language: ContentLanguage = "en"): TodayDailyDrop {
  return mockTodayDailyDropsByLanguage[language] ?? mockTodayDailyDropsByLanguage.en;
}

/**
 * A real, authoritative "no edition" drop with zero items. Returned to authenticated
 * users when Supabase has no assigned drop for the date (e.g. a quiet day in the
 * 4×/week cadence). The UI renders a deliberate empty-edition screen rather than
 * mock/sample content, which keeps the app free of any "sample" surface.
 */
function buildEmptyTodayDrop(
  language: ContentLanguage,
  dropDate: string
): TodayDailyDrop {
  return {
    id: `no-edition:${dropDate}:${language}`,
    drop_date: dropDate,
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

  return questions.length > 0 ? questions : undefined;
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
  return typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

function getTodayDropCacheKey(
  userId: string,
  dropDate: string,
  language?: ContentLanguage
): string {
  return ["today-drop", userId, dropDate, language ?? "any"].join(":");
}

function getContentSourcesCacheKey(contentItemId: string): string {
  return ["content-sources", contentItemId].join(":");
}

function getContentItemCacheKey(contentItemId: string): string {
  return ["content-item", contentItemId].join(":");
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
