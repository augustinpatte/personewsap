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
export function mergeTranslatedContentItem(
  assigned: ContentItem,
  translation: ContentItem
): ContentItem {
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
export async function resolveContentItemsForLanguage(
  contentItems: ContentItem[],
  language: ContentLanguage | undefined
): Promise<ContentItem[]> {
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

  const translationsByKey = await fetchTranslationsByLogicalKey(logicalKeys, language);

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

async function fetchTranslationsByLogicalKey(
  logicalKeys: string[],
  language: ContentLanguage
): Promise<Map<string, ContentItem>> {
  if (!supabase || logicalKeys.length === 0) {
    return new Map();
  }

  // The three key fields are disjoint (an item carries exactly one), so one
  // OR-query resolves every pending key in a single round trip. Values are
  // quoted for PostgREST's `in.(...)` list; the keys themselves are UUIDs or
  // slug-like identifiers, and anything containing a quote is skipped rather
  // than escaped into a malformed filter.
  const quotedKeys = logicalKeys
    .filter((key) => !key.includes('"') && !key.includes("\\"))
    .map((key) => `"${key}"`)
    .join(",");

  if (quotedKeys.length === 0) {
    return new Map();
  }

  const orFilter = LOGICAL_KEY_FIELDS.map(
    (field) => `metadata->>${field}.in.(${quotedKeys})`
  ).join(",");

  const { data, error } = await supabase
    .from("content_items")
    .select(contentItemSelect)
    .eq("status", "published")
    .eq("language", language)
    .or(orFilter);

  if (error) {
    // Translation sits on top of a working archive: a failed lookup degrades to
    // the original language rather than turning the whole edition into an error.
    return new Map();
  }

  const translations = new Map<string, ContentItem>();

  for (const item of (data ?? []) as ContentItem[]) {
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
