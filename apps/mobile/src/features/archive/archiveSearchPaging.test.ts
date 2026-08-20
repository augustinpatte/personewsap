import { describe, expect, it } from "vitest";

import type { LibraryItemSummary } from "../library/libraryTypes";
import {
  ARCHIVE_SEARCH_PAGE_SIZE,
  buildArchiveSearchKey,
  buildArchiveSearchKeysetFilter,
  decodeArchiveSearchCursor,
  encodeArchiveSearchCursor,
  isArchiveSearchCursor,
  mergeArchiveSearchPages,
  takeArchiveSearchPage,
  toArchiveSearchCursor,
  type ArchiveSearchCursor
} from "./archiveSearchPaging";

/**
 * The keyset itself: cursor shape, the predicate sent to PostgREST, page
 * slicing and merge. These are the pieces that decide whether a reader can
 * reach a result from years ago, so they are exercised at real scale here —
 * without a database, and without pretending a small fixture proves anything.
 */

function uuid(index: number): string {
  // Deterministic, ordered uuids: lexicographic order matches numeric order,
  // which is what lets a test assert the tie-breaker direction exactly.
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function item(index: number, dropDate: string): LibraryItemSummary {
  return {
    id: uuid(index),
    content_type: "business_story",
    drop_date: dropDate,
    hide_display_date: false,
    drop_id: uuid(900000 + index),
    is_completed: false,
    is_saved: false,
    language: "fr",
    source_count: 2,
    title: `Story ${index}`,
    topic: "business"
  };
}

describe("cursor", () => {
  it("needs both halves to be valid", () => {
    expect(isArchiveSearchCursor({ dropDate: "2026-08-17", contentItemId: uuid(1) })).toBe(
      true
    );
    // drop_date alone is not a cursor: several stories share one edition.
    expect(isArchiveSearchCursor({ dropDate: "2026-08-17" })).toBe(false);
    expect(isArchiveSearchCursor({ dropDate: "17/08/2026", contentItemId: uuid(1) })).toBe(
      false
    );
    expect(
      isArchiveSearchCursor({ dropDate: "2026-08-17", contentItemId: "mini-case-2026" })
    ).toBe(false);
    expect(isArchiveSearchCursor(null)).toBe(false);
    expect(isArchiveSearchCursor("2026-08-17")).toBe(false);
  });

  it("round-trips through its serialised form", () => {
    const cursor: ArchiveSearchCursor = { dropDate: "2026-08-17", contentItemId: uuid(42) };

    expect(decodeArchiveSearchCursor(encodeArchiveSearchCursor(cursor))).toEqual(cursor);
    expect(encodeArchiveSearchCursor(null)).toBe("");
    expect(decodeArchiveSearchCursor("")).toBeNull();
    expect(decodeArchiveSearchCursor("garbage")).toBeNull();
  });

  it("is built from the row it resumes after", () => {
    expect(toArchiveSearchCursor(item(7, "2026-08-17"))).toEqual({
      dropDate: "2026-08-17",
      contentItemId: uuid(7)
    });
  });
});

describe("keyset predicate", () => {
  it("is omitted on the first page", () => {
    expect(buildArchiveSearchKeysetFilter(null)).toBeNull();
  });

  it("compares the date, then the id on the boundary date", () => {
    expect(
      buildArchiveSearchKeysetFilter({ dropDate: "2026-08-17", contentItemId: uuid(5) })
    ).toBe(
      `drop_date.lt.2026-08-17,and(drop_date.eq.2026-08-17,content_item_id.lt.${uuid(5)})`
    );
  });

  it("refuses a malformed cursor rather than sending it", () => {
    expect(
      buildArchiveSearchKeysetFilter({
        dropDate: "2026-08-17",
        contentItemId: "mini-case-2026-04-26-fr-ai-notes"
      })
    ).toBeNull();
  });
});

describe("page slicing", () => {
  it("uses the extra row only as the hasMore signal", () => {
    const rows = Array.from({ length: ARCHIVE_SEARCH_PAGE_SIZE + 1 }, (_, index) =>
      item(index, "2026-08-17")
    );
    const page = takeArchiveSearchPage(rows);

    expect(page.items).toHaveLength(ARCHIVE_SEARCH_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({
      dropDate: "2026-08-17",
      contentItemId: uuid(ARCHIVE_SEARCH_PAGE_SIZE - 1)
    });
  });

  it("ends the listing when the extra row is absent", () => {
    const rows = Array.from({ length: 3 }, (_, index) => item(index, "2026-08-17"));
    const page = takeArchiveSearchPage(rows);

    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("handles an empty result", () => {
    expect(takeArchiveSearchPage([])).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });
  });
});

describe("merging pages", () => {
  it("appends without ever repeating an item", () => {
    const first = [item(1, "2026-08-17"), item(2, "2026-08-17")];
    const second = [item(2, "2026-08-17"), item(3, "2026-08-14")];

    expect(mergeArchiveSearchPages(first, second).map((row) => row.id)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3)
    ]);
  });

  it("keeps the rows already on screen in place", () => {
    const first = [item(1, "2026-08-17")];
    const repeated = [{ ...item(1, "2026-08-17"), title: "Rewritten" }];

    expect(mergeArchiveSearchPages(first, repeated)[0].title).toBe("Story 1");
  });
});

describe("request identity", () => {
  it("changes with anything that changes the results", () => {
    const base = {
      language: "fr",
      contentType: "business_story",
      text: "openai",
      from: "2026-08-01",
      toExclusive: "2026-09-01"
    };

    expect(buildArchiveSearchKey(base)).toBe(buildArchiveSearchKey({ ...base }));
    expect(buildArchiveSearchKey({ ...base, language: "en" })).not.toBe(
      buildArchiveSearchKey(base)
    );
    expect(buildArchiveSearchKey({ ...base, contentType: "mini_case" })).not.toBe(
      buildArchiveSearchKey(base)
    );
    expect(buildArchiveSearchKey({ ...base, text: "anthropic" })).not.toBe(
      buildArchiveSearchKey(base)
    );
    expect(buildArchiveSearchKey({ ...base, from: null })).not.toBe(
      buildArchiveSearchKey(base)
    );
  });

  it("ignores case and padding in the text", () => {
    const base = {
      language: "fr",
      contentType: "business_story",
      from: null,
      toExclusive: null
    };

    expect(buildArchiveSearchKey({ ...base, text: "  OpenAI " })).toBe(
      buildArchiveSearchKey({ ...base, text: "openai" })
    );
  });
});

/**
 * A stand-in for the database: rows sorted the way the view is ordered, sliced
 * by the same keyset the client sends. It answers exactly what Postgres would,
 * which is what makes the sequencing below a real proof rather than a mock.
 */
function createArchive(rows: LibraryItemSummary[]) {
  const sorted = [...rows].sort(
    (left, right) =>
      right.drop_date.localeCompare(left.drop_date) || right.id.localeCompare(left.id)
  );

  return {
    rows: sorted,
    query(cursor: ArchiveSearchCursor | null, pageSize: number) {
      const after = cursor
        ? sorted.filter(
            (row) =>
              row.drop_date < cursor.dropDate ||
              (row.drop_date === cursor.dropDate && row.id < cursor.contentItemId)
          )
        : sorted;

      return takeArchiveSearchPage(after.slice(0, pageSize + 1), pageSize);
    }
  };
}

function pageThrough(
  archive: ReturnType<typeof createArchive>,
  pageSize: number
): { items: LibraryItemSummary[]; pages: number } {
  let cursor: ArchiveSearchCursor | null = null;
  let collected: LibraryItemSummary[] = [];
  let pages = 0;

  for (;;) {
    const page = archive.query(cursor, pageSize);
    collected = mergeArchiveSearchPages(collected, page.items);
    pages += 1;

    if (!page.hasMore || !page.nextCursor) {
      break;
    }

    cursor = page.nextCursor;
    // A runaway loop would mean the cursor is not advancing.
    expect(pages).toBeLessThan(1000);
  }

  return { items: collected, pages };
}

describe("paging a whole result set", () => {
  it("walks 85 matches in 4 pages of 25, with exactly 85 unique ids", () => {
    const archive = createArchive(
      Array.from({ length: 85 }, (_, index) =>
        item(index, `2026-${String((index % 12) + 1).padStart(2, "0")}-15`)
      )
    );

    const { items, pages } = pageThrough(archive, ARCHIVE_SEARCH_PAGE_SIZE);

    expect(pages).toBe(4);
    expect(items).toHaveLength(85);
    expect(new Set(items.map((row) => row.id)).size).toBe(85);
    // And in the declared order, newest first.
    expect(items).toEqual(archive.rows);
  });

  it("does not lose or repeat items that share one drop_date", () => {
    // 60 results on three dates: every page boundary falls inside a date, which
    // is exactly where a drop_date-only cursor breaks.
    const archive = createArchive(
      Array.from({ length: 60 }, (_, index) =>
        item(index, ["2026-08-17", "2026-08-14", "2026-08-12"][index % 3])
      )
    );

    const { items } = pageThrough(archive, ARCHIVE_SEARCH_PAGE_SIZE);

    expect(items).toHaveLength(60);
    expect(new Set(items.map((row) => row.id)).size).toBe(60);
  });

  it("survives 100 results on a single date", () => {
    const archive = createArchive(
      Array.from({ length: 100 }, (_, index) => item(index, "2026-08-17"))
    );

    const { items, pages } = pageThrough(archive, ARCHIVE_SEARCH_PAGE_SIZE);

    expect(pages).toBe(4);
    expect(new Set(items.map((row) => row.id)).size).toBe(100);
  });

  it("is not disturbed by newer content published between two pages", () => {
    const archive = createArchive(
      Array.from({ length: 40 }, (_, index) => item(index, "2026-08-14"))
    );

    const firstPage = archive.query(null, ARCHIVE_SEARCH_PAGE_SIZE);
    let collected = firstPage.items;

    // A new edition lands while the reader is looking at page 1. It sorts above
    // the cursor, so it belongs to no later page: the walk stays exact.
    const withNewer = createArchive([...archive.rows, item(999, "2026-08-19")]);
    const secondPage = withNewer.query(firstPage.nextCursor, ARCHIVE_SEARCH_PAGE_SIZE);
    collected = mergeArchiveSearchPages(collected, secondPage.items);

    expect(collected).toHaveLength(40);
    expect(new Set(collected.map((row) => row.id)).size).toBe(40);
    expect(collected.some((row) => row.id === uuid(999))).toBe(false);
    expect(secondPage.hasMore).toBe(false);
  });

  it("ends with hasMore false and no cursor", () => {
    const archive = createArchive(
      Array.from({ length: 26 }, (_, index) => item(index, "2026-08-17"))
    );

    const first = archive.query(null, ARCHIVE_SEARCH_PAGE_SIZE);
    const second = archive.query(first.nextCursor, ARCHIVE_SEARCH_PAGE_SIZE);

    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it("re-requesting the same cursor after a failure adds no duplicate", () => {
    const archive = createArchive(
      Array.from({ length: 60 }, (_, index) => item(index, "2026-08-17"))
    );

    const first = archive.query(null, ARCHIVE_SEARCH_PAGE_SIZE);
    let collected = first.items;

    // The retry replays the very same cursor, as the hook does.
    const retried = archive.query(first.nextCursor, ARCHIVE_SEARCH_PAGE_SIZE);
    collected = mergeArchiveSearchPages(collected, retried.items);
    collected = mergeArchiveSearchPages(collected, retried.items);

    expect(collected).toHaveLength(50);
    expect(new Set(collected.map((row) => row.id)).size).toBe(50);
  });
});

describe("scale", () => {
  it("walks 5 000 results with no cap, no gap and no duplicate", () => {
    // Five years of a four-a-week product, all matching one query. Nothing here
    // depends on the set being small.
    const archive = createArchive(
      Array.from({ length: 5000 }, (_, index) => {
        const day = String((index % 28) + 1).padStart(2, "0");
        const month = String((index % 12) + 1).padStart(2, "0");
        const year = 2022 + (index % 5);

        return item(index, `${year}-${month}-${day}`);
      })
    );

    const { items, pages } = pageThrough(archive, ARCHIVE_SEARCH_PAGE_SIZE);

    expect(items).toHaveLength(5000);
    expect(new Set(items.map((row) => row.id)).size).toBe(5000);
    expect(pages).toBe(200);
    // Strictly descending on the full key: no reordering anywhere in the walk.
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      const ordered =
        previous.drop_date > current.drop_date ||
        (previous.drop_date === current.drop_date && previous.id > current.id);

      expect(ordered).toBe(true);
    }
  });

  it("reaches a two-year-old item on a later page", () => {
    const archive = createArchive([
      ...Array.from({ length: 200 }, (_, index) => item(index, "2026-08-17")),
      item(9999, "2024-08-17")
    ]);

    const { items } = pageThrough(archive, ARCHIVE_SEARCH_PAGE_SIZE);
    const oldest = items[items.length - 1];

    expect(oldest.id).toBe(uuid(9999));
    expect(oldest.drop_date).toBe("2024-08-17");
  });

  it("holds for every page size the product might use", () => {
    for (const pageSize of [20, 25, 30]) {
      const archive = createArchive(
        Array.from({ length: 1000 }, (_, index) => item(index, "2026-08-17"))
      );
      const { items, pages } = pageThrough(archive, pageSize);

      expect(new Set(items.map((row) => row.id)).size).toBe(1000);
      expect(pages).toBe(Math.ceil(1000 / pageSize));
    }
  });
});
