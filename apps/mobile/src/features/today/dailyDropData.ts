import {
  createMockFallbackResult,
  createSupabaseResult,
  type DataFetchResult
} from "../../lib/dataState";
import { normalizeSupabaseError, supabase } from "../../lib/supabase";
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
  NewsletterArticle,
  SourceMetadata,
  TodayDailyDrop
} from "./contentTypes";

type FetchTodayDropOptions = {
  language?: ContentLanguage;
};

type SourceIdsByContentItemId = Record<string, string[]>;

const publishedDropStatuses = ["published", "read", "archived"] as const;

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
  userId: string,
  date: string | Date,
  options: FetchTodayDropOptions = {}
): Promise<DataFetchResult<TodayDailyDrop>> {
  const dropDate = normalizeDropDate(date);
  const fallbackDrop = getMockTodayDrop(options.language);

  if (!supabase) {
    return createMockFallbackResult(
      fallbackDrop,
      "missing_supabase_config",
      normalizeSupabaseError({
        code: "missing_supabase_config",
        message:
          "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
      })
    );
  }

  try {
    let dropQuery = supabase
      .from("daily_drops")
      .select("*")
      .eq("user_id", userId)
      .eq("drop_date", dropDate)
      .in("status", [...publishedDropStatuses]);

    if (options.language) {
      dropQuery = dropQuery.eq("language", options.language);
    }

    const { data: drop, error: dropError } = await dropQuery.maybeSingle();

    if (dropError) {
      return createMockFallbackResult(
        fallbackDrop,
        "supabase_error",
        normalizeSupabaseError(dropError)
      );
    }

    if (!drop) {
      return createMockFallbackResult(fallbackDrop, "no_supabase_data");
    }

    const mappedDrop = await fetchAndMapDailyDrop(drop);

    return mappedDrop
      ? createSupabaseResult(mappedDrop)
      : createMockFallbackResult(fallbackDrop, "no_supabase_data");
  } catch (error) {
    return createMockFallbackResult(
      fallbackDrop,
      "supabase_error",
      normalizeSupabaseError(error)
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
        message:
          "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
      })
    );
  }

  try {
    const { data: sourceLinks, error: sourceLinksError } = await supabase
      .from("content_item_sources")
      .select("*")
      .eq("content_item_id", contentItemId)
      .order("source_order", { ascending: true });

    if (sourceLinksError) {
      return createMockFallbackResult(
        fallbackSources,
        "supabase_error",
        normalizeSupabaseError(sourceLinksError)
      );
    }

    const sourceIds = sourceLinks?.map((link) => link.source_id) ?? [];

    if (sourceIds.length === 0) {
      return createMockFallbackResult(fallbackSources, "no_supabase_data");
    }

    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select("*")
      .in("id", sourceIds);

    if (sourcesError) {
      return createMockFallbackResult(
        fallbackSources,
        "supabase_error",
        normalizeSupabaseError(sourcesError)
      );
    }

    const sourcesById = new Map((sources ?? []).map((source) => [source.id, source]));
    const orderedSources = sourceIds
      .map((sourceId) => sourcesById.get(sourceId))
      .filter(isSource)
      .map(mapSource);

    return orderedSources.length > 0
      ? createSupabaseResult(orderedSources)
      : createMockFallbackResult(fallbackSources, "no_supabase_data");
  } catch (error) {
    return createMockFallbackResult(
      fallbackSources,
      "supabase_error",
      normalizeSupabaseError(error)
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
    .select("*")
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
    .select("*")
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
  const sourceIdsByContentItemId = await fetchSourceIdsByContentItemIds(contentItemIds);
  const mappedItems = orderedDropItems
    .map((dropItem) => {
      const contentItem = contentItemsById.get(dropItem.content_item_id);

      return contentItem
        ? mapDailyDropContentItem(contentItem, dropItem, sourceIdsByContentItemId)
        : null;
    })
    .filter(isDailyDropContentItem);

  return assembleTodayDrop(drop, mappedItems, availableContentItems);
}

async function fetchSourceIdsByContentItemIds(
  contentItemIds: string[]
): Promise<SourceIdsByContentItemId> {
  if (!supabase || contentItemIds.length === 0) {
    return {};
  }

  const { data: sourceLinks, error } = await supabase
    .from("content_item_sources")
    .select("*")
    .in("content_item_id", contentItemIds)
    .order("source_order", { ascending: true });

  if (error) {
    throw error;
  }

  return (sourceLinks ?? []).reduce<SourceIdsByContentItemId>((sourceIds, link) => {
    const currentSourceIds = sourceIds[link.content_item_id] ?? [];

    return {
      ...sourceIds,
      [link.content_item_id]: [...currentSourceIds, link.source_id]
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

  if (!businessStory || !miniCase || !concept) {
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
  sourceIdsByContentItemId: SourceIdsByContentItemId
): DailyDropContentItem | null {
  const metadata = getMetadata(contentItem);
  const base = {
    id: contentItem.id,
    language: contentItem.language,
    source_ids: sourceIdsByContentItemId[contentItem.id] ?? [],
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
      company_or_market: readString(metadata, "company_or_market", "Market"),
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
      question: readString(metadata, "question"),
      sample_answer: readString(metadata, "sample_answer"),
      slot: "mini_case",
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

function readStringArray(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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
