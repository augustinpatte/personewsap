import { isSupabaseContentItemId } from "../../lib/contentItemId";
import type { LibraryItemSummary } from "../library/libraryTypes";

/**
 * Keyset pagination for archive search.
 *
 * Search covers the reader's whole history, so its result set can be larger
 * than any single response: it is paged, on an explicit tap, exactly like the
 * browse archive — but with its own cursor, kept entirely separate from the
 * ArchiveProvider's `beforeDate` paging.
 *
 * The key is (drop_date DESC, content_item_id DESC). drop_date alone is not
 * unique — one edition carries several stories — so it can only ever be half a
 * cursor: paging on it would drop or repeat the items sharing the boundary
 * date. The content item id is the unique tie-breaker, and the pair is stable
 * while the archive grows: a new edition published mid-search sorts above the
 * cursor, so it never shifts the rows still to come (which OFFSET would).
 *
 * Everything here is pure so the sequencing can be tested for real, at any
 * scale, without a database.
 */

/** Results per search page. Deliberately the same size as a browse page. */
export const ARCHIVE_SEARCH_PAGE_SIZE = 25;

export type ArchiveSearchCursor = {
  /** drop_date (YYYY-MM-DD) of the last row of the previous page. */
  dropDate: string;
  /** content_item_id of that same row: the unique tie-breaker. */
  contentItemId: string;
};

export type ArchiveSearchPage = {
  items: LibraryItemSummary[];
  /** Cursor to pass to get the next page, or null at the end of the results. */
  nextCursor: ArchiveSearchCursor | null;
  hasMore: boolean;
};

const DROP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isArchiveSearchCursor(value: unknown): value is ArchiveSearchCursor {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ArchiveSearchCursor>;

  return (
    typeof candidate.dropDate === "string" &&
    DROP_DATE_PATTERN.test(candidate.dropDate) &&
    isSupabaseContentItemId(candidate.contentItemId)
  );
}

/** The cursor that resumes the listing just after `item`. */
export function toArchiveSearchCursor(
  item: Pick<LibraryItemSummary, "id" | "drop_date">
): ArchiveSearchCursor | null {
  const cursor = { dropDate: item.drop_date, contentItemId: item.id };

  return isArchiveSearchCursor(cursor) ? cursor : null;
}

/** Serialisable form, so a cursor can be logged, cached or compared as a key. */
export function encodeArchiveSearchCursor(cursor: ArchiveSearchCursor | null): string {
  return cursor ? `${cursor.dropDate}|${cursor.contentItemId}` : "";
}

export function decodeArchiveSearchCursor(value: string): ArchiveSearchCursor | null {
  const [dropDate, contentItemId] = value.split("|");
  const cursor = { dropDate: dropDate ?? "", contentItemId: contentItemId ?? "" };

  return isArchiveSearchCursor(cursor) ? cursor : null;
}

/**
 * The PostgREST `or=` predicate for "strictly after this cursor" in
 * (drop_date DESC, content_item_id DESC) order:
 *
 *   drop_date < cursor.dropDate
 *   OR (drop_date = cursor.dropDate AND content_item_id < cursor.contentItemId)
 *
 * Returns null when there is no cursor (first page). The values are a date and
 * a validated uuid, so neither can carry PostgREST filter syntax.
 */
export function buildArchiveSearchKeysetFilter(
  cursor: ArchiveSearchCursor | null
): string | null {
  if (!cursor || !isArchiveSearchCursor(cursor)) {
    return null;
  }

  return [
    `drop_date.lt.${cursor.dropDate}`,
    `and(drop_date.eq.${cursor.dropDate},content_item_id.lt.${cursor.contentItemId})`
  ].join(",");
}

/**
 * Turn a raw response into a page.
 *
 * The query asks for one row more than the page size: its presence is the
 * "there is a next page" answer, and it is dropped from the returned items — a
 * cheap, exact `hasMore` that never needs a count over the whole history.
 */
export function takeArchiveSearchPage(
  rows: LibraryItemSummary[],
  pageSize: number = ARCHIVE_SEARCH_PAGE_SIZE
): ArchiveSearchPage {
  const size = Math.max(1, Math.trunc(pageSize));
  const hasMore = rows.length > size;
  const items = hasMore ? rows.slice(0, size) : [...rows];
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? toArchiveSearchCursor(last) : null
  };
}

/**
 * Append a page to what is already shown.
 *
 * De-duplication by content item id is kept here as well as in the database
 * view: a retry, a double tap or an item that moved between editions must never
 * produce the same row twice. Existing rows win, so the list a reader is
 * looking at never re-orders under them.
 */
export function mergeArchiveSearchPages(
  existing: LibraryItemSummary[],
  incoming: LibraryItemSummary[]
): LibraryItemSummary[] {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];

  for (const item of incoming) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    merged.push(item);
  }

  return merged;
}

/**
 * Identity of a search request: everything that changes what the results are.
 * A response is only applied when its key still matches the current one, so a
 * page from an abandoned query or a previous language can never land in the
 * list.
 */
export function buildArchiveSearchKey(input: {
  language: string;
  contentType: string;
  text: string;
  from: string | null;
  toExclusive: string | null;
}): string {
  return [
    input.language,
    input.contentType,
    input.text.trim().toLowerCase(),
    input.from ?? "",
    input.toExclusive ?? ""
  ].join("|");
}
