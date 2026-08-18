import { isSupabaseContentItemId } from "../../lib/contentItemId";
import type { DataFetchSource } from "../../lib/dataState";

/**
 * Whether a reader-fetched item may have its progress persisted.
 *
 * Two conditions, both required:
 *  - it actually came from Supabase (or its in-memory cache). A mock fallback
 *    returned because the network dropped is not live data, and reporting it as
 *    such is what let sample content behave like real content;
 *  - its id is a real UUID, so content_interactions.content_item_id can hold it.
 *
 * Kept pure and separate from ReaderItemProvider so the rule is unit tested
 * rather than asserted on rendered output.
 */
export function isLiveContentItem(
  source: DataFetchSource,
  contentItemId: string
): boolean {
  return (
    (source === "supabase" || source === "cache") && isSupabaseContentItemId(contentItemId)
  );
}
