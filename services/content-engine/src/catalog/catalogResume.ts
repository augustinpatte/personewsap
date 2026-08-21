import type { GeneratedContentItem, Language } from "../domain.js";
import { orderMiniCaseOptions } from "../miniCase/optionOrder.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";

/**
 * Resuming an interrupted catalog run.
 *
 * A catalog entry id is deterministic — `<runId>-<kind>[-<topic>]-<NN>` — so the
 * work a run was asked to do can be compared against what it already stored,
 * before a single token is spent. Everything already there is left exactly as it
 * is: not regenerated, not rewritten, not relinked.
 *
 * The awkward case is a half-written pair. When the French version of an entry
 * exists and the English one does not, the English version must still be that
 * same case in another language, not a new case that happens to fill the slot.
 * So the persisted version is read back and handed to the generator as the
 * reference, exactly as the in-memory reference would have been.
 */

export function versionKey(entryId: string, language: Language): string {
  return `${entryId}::${language}`;
}

export function indexExistingVersions(
  records: CatalogEntryVersionRecord[]
): Map<string, CatalogEntryVersionRecord> {
  const index = new Map<string, CatalogEntryVersionRecord>();

  for (const record of records) {
    // First write wins: if a run somehow stored an entry twice, the resume must
    // not pick a different one on each pass.
    const key = versionKey(record.catalogEntryId, record.language);

    if (!index.has(key)) {
      index.set(key, record);
    }
  }

  return index;
}

/**
 * Rebuild the generated item a persisted version came from, well enough to be
 * the reference half of a language pair.
 *
 * The stored metadata carries the item's own fields, so this is a rehydration
 * rather than a reconstruction. What matters for pairing is that the counterpart
 * is anchored to the same scenario and — through `source_urls` — to the same
 * source packet the reference cited.
 */
export function referenceItemFromRecord(
  record: CatalogEntryVersionRecord
): GeneratedContentItem | null {
  const metadata = record.metadata;
  const sourceUrls = Array.isArray(metadata.source_urls)
    ? metadata.source_urls.filter((url): url is string => typeof url === "string")
    : [];

  if (sourceUrls.length === 0) {
    // Without the cited sources there is no packet to pair against, and
    // generating anyway would produce an unrelated counterpart.
    return null;
  }

  const { source_urls: _ignored, ...itemFields } = metadata;

  const item = {
    ...itemFields,
    content_type: record.contentType,
    language: record.language,
    topic: record.topic,
    title: record.title,
    summary: record.summary ?? undefined,
    body_md: record.bodyMd ?? "",
    difficulty: record.difficulty ?? undefined,
    source_urls: sourceUrls
  } as unknown as GeneratedContentItem;

  // Normalized to today's presentation contract before it is used as a pairing
  // reference. A version stored before option ordering existed still carries the
  // model's own A/B/C/D, and its counterpart would be refused for disagreeing
  // with it. The ordering is deterministic and idempotent, so a version stored
  // after it is unchanged — and the stored row itself is never rewritten here.
  return item.content_type === "mini_case" ? orderMiniCaseOptions(item) : item;
}
