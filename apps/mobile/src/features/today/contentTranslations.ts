import { supabase } from "../../lib/supabase";
import type { ContentItem } from "../../types/domain";
import type { ContentLanguage } from "./contentTypes";

/**
 * Cross-language identity of content items.
 *
 * An edition is stored once, in the language the reader had when it was
 * published, and its daily_drop_items point at content_items in that language.
 * The French and English renderings of one logical item are two rows produced
 * from the same editorial job, and they share exactly one of these metadata
 * keys (same value on both rows):
 *
 *   - staging_job_id    scheduled (staging-publish) editions
 *   - catalog_entry_id  curated launch catalog imports
 *   - entry_key         weekly payload editions
 *
 * This is the same rule as public.content_logical_key() in the database
 * (20260904121000_content_translation_access). Keep the two in sync.
 *
 * The resolver below swaps an item's *display* fields for the rendering in the
 * requested language while keeping the item's `id` — the id assigned through
 * the reader's own drop. That id is the anchor for content_interactions,
 * mini_case_responses and RLS assignment checks, so read/unread, saved and
 * mini-case state survive any number of language switches without copying a
 * single interaction row.
 */

const LOGICAL_KEY_FIELDS = ["staging_job_id", "catalog_entry_id", "entry_key"] as const;

const contentItemSelect =
  "id,content_type,topic_id,language,title,summary,body_md,difficulty,estimated_read_seconds,publication_date,version,status,generation_run_id,source_count,metadata,created_at,updated_at";

/** What cross-language resolution needs to read on a row. */
export type TranslatableContentRow = Pick<ContentItem, "id" | "content_type" | "language" | "metadata">;

/**
 * An archive/list row: what a list draws, never the body.
 *
 * `metadata` is reduced to the keys a list reads — the logical key (FR/EN
 * pairing, Team overlap, scored questions) and the topic fallbacks. The full
 * metadata carries mini-case bodies, questions and sources and is as heavy as
 * body_md, so it is not fetched for a list either. Opening an item goes through
 * the full reader path (fetchContentItemById), which reads the whole row.
 */
export type ContentItemListRow = Pick<
  ContentItem,
  "id" | "content_type" | "topic_id" | "language" | "title" | "source_count" | "metadata"
>;

/** How a query reads content rows: the PostgREST select, and the row it yields. */
export type ContentProjection<T extends TranslatableContentRow> = {
  select: string;
  fromRow: (row: Record<string, unknown>) => T;
};

const LIST_METADATA_FIELDS = [...LOGICAL_KEY_FIELDS, "topic", "category"] as const;

export const fullContentProjection: ContentProjection<ContentItem> = {
  select: contentItemSelect,
  fromRow: (row) => row as unknown as ContentItem
};

export const listContentProjection: ContentProjection<ContentItemListRow> = {
  select: [
    "id,content_type,topic_id,language,title,source_count",
    ...LIST_METADATA_FIELDS.map((field) => `meta_${field}:metadata->>${field}`)
  ].join(","),
  fromRow: (row) => {
    // A row that already carries metadata (a test double, or a caller that read
    // the full row) is reduced the same way, so both shapes behave alike.
    const source = isRecord(row.metadata) ? row.metadata : null;
    const metadata: Record<string, string> = {};

    for (const field of LIST_METADATA_FIELDS) {
      const value = source ? source[field] : row[`meta_${field}`];

      if (typeof value === "string" && value.length > 0) {
        metadata[field] = value;
      }
    }

    return {
      id: row.id as string,
      content_type: row.content_type as ContentItem["content_type"],
      topic_id: (row.topic_id ?? null) as ContentItem["topic_id"],
      language: row.language as ContentItem["language"],
      title: row.title as string,
      source_count: (row.source_count ?? 0) as number,
      metadata
    };
  }
};

export function getContentLogicalKey(
  metadata: ContentItem["metadata"] | null | undefined
): string | null {
  if (!isRecord(metadata)) {
    return null;
  }

  for (const field of LOGICAL_KEY_FIELDS) {
    const value = metadata[field];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

/**
 * Merge a translation onto an assigned item: every display field comes from the
 * rendering in the requested language, the identity stays the assigned row's.
 */
export function mergeTranslatedContentItem<T extends TranslatableContentRow>(
  assigned: T,
  translation: T
): T {
  return { ...translation, id: assigned.id };
}

/**
 * Return the given items rendered in `language` wherever a translation exists.
 *
 * Items already in `language`, items without a logical key, and items whose
 * translation cannot be found keep their original rendering — an old edition in
 * its original language is strictly better than a hole in the archive. Order
 * and ids are preserved, so callers can substitute the result one-for-one.
 */
export async function resolveContentItemsForLanguage<T extends TranslatableContentRow = ContentItem>(
  contentItems: T[],
  language: ContentLanguage | undefined,
  projection: ContentProjection<T> = fullContentProjection as unknown as ContentProjection<T>
): Promise<T[]> {
  if (!language || !supabase) {
    return contentItems;
  }

  const pending = contentItems.filter(
    (item) => item.language !== language && getContentLogicalKey(item.metadata) !== null
  );

  if (pending.length === 0) {
    return contentItems;
  }

  const logicalKeys = [
    ...new Set(
      pending
        .map((item) => getContentLogicalKey(item.metadata))
        .filter((key): key is string => key !== null)
    )
  ];

  const translationsByKey = await fetchTranslationsByLogicalKey(logicalKeys, language, projection);

  return contentItems.map((item) => {
    if (item.language === language) {
      return item;
    }

    const logicalKey = getContentLogicalKey(item.metadata);
    const translation = logicalKey ? translationsByKey.get(logicalKey) : undefined;

    if (!translation || translation.content_type !== item.content_type) {
      return item;
    }

    return mergeTranslatedContentItem(item, translation);
  });
}

async function fetchTranslationsByLogicalKey<T extends TranslatableContentRow>(
  logicalKeys: string[],
  language: ContentLanguage,
  projection: ContentProjection<T>
): Promise<Map<string, T>> {
  if (!supabase || logicalKeys.length === 0) {
    return new Map();
  }

  // The three key fields are disjoint (an item carries exactly one), so one
  // OR-query resolves every pending key in a single round trip.
  const orFilter = buildLogicalKeyOrFilter(logicalKeys);

  if (!orFilter) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("content_items")
    .select(projection.select)
    .eq("status", "published")
    .eq("language", language)
    .or(orFilter);

  if (error) {
    // Translation sits on top of a working archive: a failed lookup degrades to
    // the original language rather than turning the whole edition into an error.
    return new Map();
  }

  const translations = new Map<string, T>();

  for (const item of ((data ?? []) as unknown as Record<string, unknown>[]).map(projection.fromRow)) {
    const logicalKey = getContentLogicalKey(item.metadata);

    if (logicalKey && !translations.has(logicalKey)) {
      translations.set(logicalKey, item);
    }
  }

  return translations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every published rendering of the given logical keys, in one query.
 *
 * Used for content that reaches a reader WITHOUT a daily_drop_items row — Team
 * assignments, which are made on the logical key rather than on a row. Such an
 * item has no assigned id to anchor to, so the caller needs to see all of its
 * renderings: one to display, the rest to look completion up against when the
 * reader switches language.
 *
 * Returns the rows grouped by logical key. Failure is empty, not an exception:
 * Team content is additive to an edition and must never take it down.
 */
export async function fetchContentItemsByLogicalKeys<T extends TranslatableContentRow = ContentItem>(
  logicalKeys: string[],
  projection: ContentProjection<T> = fullContentProjection as unknown as ContentProjection<T>
): Promise<Map<string, T[]>> {
  const grouped = new Map<string, T[]>();

  if (!supabase || logicalKeys.length === 0) {
    return grouped;
  }

  const orFilter = buildLogicalKeyOrFilter([...new Set(logicalKeys)]);

  if (!orFilter) {
    return grouped;
  }

  const { data, error } = await supabase
    .from("content_items")
    .select(projection.select)
    .eq("status", "published")
    .or(orFilter);

  if (error) {
    return grouped;
  }

  for (const item of ((data ?? []) as unknown as Record<string, unknown>[]).map(projection.fromRow)) {
    const logicalKey = getContentLogicalKey(item.metadata);

    if (!logicalKey) {
      continue;
    }

    grouped.set(logicalKey, [...(grouped.get(logicalKey) ?? []), item]);
  }

  return grouped;
}

/**
 * The PostgREST `or` filter matching any of the three logical-key fields.
 *
 * Keys are quoted for the `in.(…)` list. They are UUIDs or slug-like
 * identifiers; anything carrying a quote or a backslash is dropped rather than
 * escaped into a filter that would mean something else.
 */
function buildLogicalKeyOrFilter(logicalKeys: string[]): string | null {
  const quotedKeys = logicalKeys
    .filter((key) => key.length > 0 && !key.includes('"') && !key.includes("\\"))
    .map((key) => `"${key}"`)
    .join(",");

  if (quotedKeys.length === 0) {
    return null;
  }

  return LOGICAL_KEY_FIELDS.map(
    (field) => `metadata->>${field}.in.(${quotedKeys})`
  ).join(",");
}
