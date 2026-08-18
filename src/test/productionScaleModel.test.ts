import { describe, expect, it } from "vitest";

/**
 * Deterministic production-scale model.
 *
 * These fixtures do not touch Supabase. They exercise the invariants that must
 * stay true when the product moves from demo volume to real user/history
 * volume: keyset paging, idempotent daily drops, user-scoped local queues and
 * bounded backend batch plans.
 */

const USER_BATCH_SIZE = 100;
const ARCHIVE_PAGE_SIZE = 25;
const EDITIONS_PER_WEEK = 4;
const WEEKS_PER_YEAR = 52;

type UserFixture = {
  id: string;
  language: "fr" | "en";
};

type ArchiveRow = {
  id: string;
  dropDate: string;
  title: string;
  type: "business_story" | "mini_case";
};

describe("production scale model", () => {
  it.each([10, 100, 1000, 10000])("batches %i app users without giant IN filters", (count) => {
    const users = makeUsers(count);
    const batches = chunk(users.map((user) => user.id), USER_BATCH_SIZE);

    expect(batches.every((batch) => batch.length <= USER_BATCH_SIZE)).toBe(true);
    expect(batches.flat()).toHaveLength(count);
    expect(new Set(batches.flat()).size).toBe(count);
    expect(batches).toHaveLength(Math.ceil(count / USER_BATCH_SIZE));
  });

  it.each([100, 1000, 5000])("walks %i archive rows by keyset without gaps or duplicates", (count) => {
    const archive = createArchive(makeArchiveRows(count, "business_story"));
    const collected = pageThroughArchive(archive);

    expect(collected).toHaveLength(count);
    expect(new Set(collected.map((row) => row.id)).size).toBe(count);
    expect(collected).toEqual(archive.rows);
  });

  it("models one year of 4x/week editions without changing the one-drop invariant", () => {
    const users = makeUsers(1000);
    const dates = makeEditionDates("2026-01-05", EDITIONS_PER_WEEK * WEEKS_PER_YEAR);
    const keys = new Set<string>();

    for (const user of users) {
      for (const dropDate of dates) {
        keys.add(`${user.id}:${dropDate}`);
        keys.add(`${user.id}:${dropDate}`); // retry or second worker
      }
    }

    expect(dates).toHaveLength(208);
    expect(keys.size).toBe(users.length * dates.length);
  });

  it("keeps learning and mini-case local queues scoped across account switches", () => {
    const accountA = "user-a";
    const accountB = "user-b";
    const learningOutbox = new Map<string, string[]>();
    const miniCaseResponses = new Map<string, string[]>();

    append(learningOutbox, scopedKey("learning", accountA), makeIds("learning-session-a", 120));
    append(miniCaseResponses, scopedKey("mini-case", accountA), makeIds("case-response-a", 5000));

    expect(learningOutbox.get(scopedKey("learning", accountB)) ?? []).toEqual([]);
    expect(miniCaseResponses.get(scopedKey("mini-case", accountB)) ?? []).toEqual([]);

    append(learningOutbox, scopedKey("learning", accountB), makeIds("learning-session-b", 3));
    append(miniCaseResponses, scopedKey("mini-case", accountB), makeIds("case-response-b", 2));

    expect(learningOutbox.get(scopedKey("learning", accountA))).toHaveLength(120);
    expect(miniCaseResponses.get(scopedKey("mini-case", accountA))).toHaveLength(5000);
    expect(learningOutbox.get(scopedKey("learning", accountB))).toHaveLength(3);
    expect(miniCaseResponses.get(scopedKey("mini-case", accountB))).toHaveLength(2);
  });

  it("keeps load-more retries idempotent when the same page is applied twice", () => {
    const archive = createArchive(makeArchiveRows(75, "mini_case"));
    const first = archive.query(null);
    const second = archive.query(first.cursor);
    const once = mergeById(first.items, second.items);
    const retried = mergeById(once, second.items);

    expect(once).toHaveLength(50);
    expect(retried).toHaveLength(50);
    expect(new Set(retried.map((row) => row.id)).size).toBe(50);
  });
});

function makeUsers(count: number): UserFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user-${String(index).padStart(5, "0")}`,
    language: index % 2 === 0 ? "fr" : "en"
  }));
}

function makeArchiveRows(count: number, type: ArchiveRow["type"]): ArchiveRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uuid(index),
    dropDate: `202${index % 7}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
    title: `${type} ${index}`,
    type
  }));
}

function makeEditionDates(startIsoDate: string, count: number): string[] {
  const start = new Date(`${startIsoDate}T00:00:00.000Z`);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + Math.floor(index / EDITIONS_PER_WEEK) * 7 + (index % EDITIONS_PER_WEEK) * 2);
    return date.toISOString().slice(0, 10);
  });
}

function makeIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index).padStart(5, "0")}`);
}

function createArchive(rows: ArchiveRow[]) {
  const sorted = [...rows].sort(
    (left, right) => right.dropDate.localeCompare(left.dropDate) || right.id.localeCompare(left.id)
  );

  return {
    rows: sorted,
    query(cursor: ArchiveRow | null) {
      const afterCursor = cursor
        ? sorted.filter(
            (row) =>
              row.dropDate < cursor.dropDate ||
              (row.dropDate === cursor.dropDate && row.id < cursor.id)
          )
        : sorted;
      const items = afterCursor.slice(0, ARCHIVE_PAGE_SIZE);
      const hasMore = afterCursor.length > ARCHIVE_PAGE_SIZE;

      return {
        items,
        hasMore,
        cursor: hasMore ? items[items.length - 1] ?? null : null
      };
    }
  };
}

function pageThroughArchive(archive: ReturnType<typeof createArchive>): ArchiveRow[] {
  let cursor: ArchiveRow | null = null;
  let collected: ArchiveRow[] = [];
  let pages = 0;

  do {
    const page = archive.query(cursor);
    collected = mergeById(collected, page.items);
    cursor = page.cursor;
    pages += 1;
    expect(pages).toBeLessThan(1000);
  } while (cursor);

  return collected;
}

function mergeById(existing: ArchiveRow[], incoming: ArchiveRow[]): ArchiveRow[] {
  const seen = new Set(existing.map((row) => row.id));
  const merged = [...existing];

  for (const row of incoming) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }

  return merged;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

function append(map: Map<string, string[]>, key: string, values: string[]) {
  map.set(key, [...(map.get(key) ?? []), ...values]);
}

function scopedKey(kind: string, userId: string): string {
  return `personewsap:${kind}:${userId}`;
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
