import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";

/**
 * The cross-language invariant of the archive, end to end over the data layer:
 *
 *   Switching the reading language re-renders the same editions in the other
 *   language and never moves a single read/unread, saved or mini-case state.
 *
 * The fixture is the exact stress scenario from the regression brief —
 * three EN editions with patterns R U R U / U R R U / R R U U — driven through
 * fetchLibraryDrops and fetchTodayDrop across EN→FR→EN→FR→EN→FR→EN→FR→EN.
 * Every interaction lives on the item id the edition assigned (the EN row);
 * the FR renderings are separate rows joined by metadata.staging_job_id, as in
 * production. If a switch ever resets history to unread, duplicates a row, or
 * leaks state between accounts, this fails on the first iteration.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  daily_drops: [],
  daily_drop_items: [],
  content_items: [],
  content_interactions: [],
  content_item_sources: [],
  sources: []
};

const interactionWrites: Row[] = [];

vi.stubGlobal("__DEV__", false);

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => createQuery(table)
  },
  isLikelyNetworkError: () => false,
  normalizeSupabaseError: (error: unknown, fallback?: string) => ({
    code: (error as { code?: string })?.code,
    message: (error as { message?: string })?.message ?? fallback ?? "error"
  }),
  getAuthSession: async () => ({ data: { user: { id: USER_A } }, error: null })
}));

const { fetchLibraryDrops } = await import("./libraryData");
const { fetchTodayDrop } = await import("../today/dailyDropData");
const { flattenDailyDropItems } = await import("../../mocks");

const SLOTS = ["newsletter", "newsletter", "mini_case", "business_story"] as const;
const CONTENT_TYPES = {
  newsletter: "newsletter_article",
  mini_case: "mini_case",
  business_story: "business_story"
} as const;

/** R = read (a complete interaction on the assigned EN row), U = unread. */
const EDITIONS = [
  { date: "2026-08-25", pattern: ["R", "U", "R", "U"] },
  { date: "2026-08-26", pattern: ["U", "R", "R", "U"] },
  { date: "2026-08-27", pattern: ["R", "R", "U", "U"] }
] as const;

function itemId(edition: number, index: number, language: "en" | "fr"): string {
  const suffix = language === "en" ? "e" : "f";
  return `${edition + 1}${index + 1}${suffix}00000-0000-4000-8000-000000000000`.slice(0, 36);
}

function seedFixtures() {
  tables.daily_drops.length = 0;
  tables.daily_drop_items.length = 0;
  tables.content_items.length = 0;
  tables.content_interactions.length = 0;
  interactionWrites.length = 0;

  EDITIONS.forEach((edition, editionIndex) => {
    const dropId = `d${editionIndex + 1}000000-0000-4000-8000-000000000000`.slice(0, 36);

    tables.daily_drops.push({
      id: dropId,
      user_id: USER_A,
      drop_date: edition.date,
      language: "en",
      status: "published",
      hide_display_date: false,
      generated_at: null,
      published_at: null,
      created_at: null,
      updated_at: null
    });

    edition.pattern.forEach((state, index) => {
      const slot = SLOTS[index]!;
      const jobId = `job-${editionIndex + 1}-${index + 1}`;

      for (const language of ["en", "fr"] as const) {
        tables.content_items.push({
          id: itemId(editionIndex, index, language),
          content_type: CONTENT_TYPES[slot],
          topic_id: "business",
          language,
          title: `${slot} ${language.toUpperCase()} ${editionIndex + 1}.${index + 1}`,
          summary: "Summary.",
          body_md: "Body.",
          difficulty: slot === "mini_case" ? "medium" : null,
          estimated_read_seconds: 120,
          publication_date: edition.date,
          version: 1,
          status: "published",
          generation_run_id: null,
          source_count: 0,
          metadata: { staging_job_id: jobId },
          created_at: null,
          updated_at: null
        });
      }

      tables.daily_drop_items.push({
        daily_drop_id: dropId,
        content_item_id: itemId(editionIndex, index, "en"),
        slot,
        position: index,
        created_at: null
      });

      if (state === "R") {
        tables.content_interactions.push({
          id: `i-${editionIndex}-${index}`,
          user_id: USER_A,
          content_item_id: itemId(editionIndex, index, "en"),
          interaction_type: "complete",
          rating: null,
          message: null,
          created_at: null
        });
      }
    });
  });

  // One bookmark, to prove saved state also survives the switches.
  tables.content_interactions.push({
    id: "i-save",
    user_id: USER_A,
    content_item_id: itemId(0, 0, "en"),
    interaction_type: "save",
    rating: null,
    message: null,
    created_at: null
  });

  // A second reader owning the same first edition content, with no history:
  // their archive must stay untouched by reader A's interactions.
  tables.daily_drops.push({
    id: "db000000-0000-4000-8000-000000000000",
    user_id: USER_B,
    drop_date: "2026-08-25",
    language: "en",
    status: "published",
    hide_display_date: false,
    generated_at: null,
    published_at: null,
    created_at: null,
    updated_at: null
  });
  tables.daily_drop_items.push({
    daily_drop_id: "db000000-0000-4000-8000-000000000000",
    content_item_id: itemId(0, 0, "en"),
    slot: "newsletter",
    position: 0,
    created_at: null
  });
}

beforeEach(() => {
  clearMemoryCache();
  seedFixtures();
});

type Snapshot = Array<{
  drop_date: string;
  items: Array<{ id: string; completed: boolean; saved: boolean }>;
}>;

async function readArchiveSnapshot(language: "en" | "fr"): Promise<{
  snapshot: Snapshot;
  titles: string[];
  dropTitles: string[];
}> {
  const page = await fetchLibraryDrops(USER_A, { language });

  expect(page.source).toBe("supabase");

  return {
    snapshot: page.data.map((drop) => ({
      drop_date: drop.drop_date,
      items: (drop.items ?? []).map((item) => ({
        id: item.id,
        completed: item.is_completed,
        saved: item.is_saved
      }))
    })),
    titles: page.data.flatMap((drop) => (drop.items ?? []).map((item) => item.title)),
    dropTitles: page.data.map((drop) => drop.title)
  };
}

describe("read/unread state across repeated language switches", () => {
  it("keeps every edition's logical pattern through EN→FR→EN→FR→EN→FR→EN→FR→EN", async () => {
    const reference = await readArchiveSnapshot("en");

    // The fixture pattern, asserted explicitly so an all-unread regression is
    // caught by the very first comparison rather than by drift. The archive
    // sorts each edition by slot (newsletters, business story, mini case), so
    // the stored R/U patterns appear in that display order, newest first.
    expect(reference.snapshot.map((drop) => drop.items.map((item) => item.completed))).toEqual([
      [true, true, false, false], // 2026-08-27: R R · U(story) U(mini)
      [false, true, false, true], // 2026-08-26: U R · U(story) R(mini)
      [true, false, false, true] // 2026-08-25: R U · U(story) R(mini)
    ]);

    const sequence: Array<"en" | "fr"> = ["fr", "en", "fr", "en", "fr", "en", "fr", "en"];

    for (const language of sequence) {
      clearMemoryCache();
      const view = await readArchiveSnapshot(language);

      // Same editions, same item ids (the assigned anchors), same states.
      expect(view.snapshot).toEqual(reference.snapshot);

      // Every displayed title is in the requested language.
      for (const title of view.titles) {
        expect(title).toContain(language.toUpperCase());
      }
      for (const dropTitle of view.dropTitles) {
        expect(dropTitle).toBe(language === "fr" ? "Brief du jour" : "Edition brief");
      }

      // A switch renders; it must never write interactions (no duplication,
      // no state forking across renderings).
      expect(interactionWrites).toHaveLength(0);
    }
  });

  it("keeps the saved bookmark and the completed mini-case across the switch", async () => {
    const french = await readArchiveSnapshot("fr");
    const oldest = french.snapshot[french.snapshot.length - 1]!;

    // Saved newsletter (edition 1, first item).
    expect(oldest.items[0]).toEqual({
      id: itemId(0, 0, "en"),
      completed: true,
      saved: true
    });
    // Completed mini-case stays completed in French (last in slot order).
    expect(oldest.items[3]).toEqual({
      id: itemId(0, 2, "en"),
      completed: true,
      saved: false
    });
  });

  it("pages the archive per language without breaking states", async () => {
    const firstPage = await fetchLibraryDrops(USER_A, { language: "fr", pageSize: 2 });

    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.data.map((drop) => drop.drop_date)).toEqual(["2026-08-27", "2026-08-26"]);

    const secondPage = await fetchLibraryDrops(USER_A, {
      language: "fr",
      pageSize: 2,
      beforeDate: firstPage.data[firstPage.data.length - 1]!.drop_date
    });

    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.data.map((drop) => drop.drop_date)).toEqual(["2026-08-25"]);

    for (const drop of [...firstPage.data, ...secondPage.data]) {
      for (const item of drop.items ?? []) {
        expect(item.title).toContain("FR");
      }
    }

    expect(secondPage.data[0]?.items?.map((item) => item.is_completed)).toEqual([
      true,
      false,
      false,
      true
    ]);
  });

  it("never leaks one reader's history into another account", async () => {
    const readerB = await fetchLibraryDrops(USER_B, { language: "fr" });

    expect(readerB.source).toBe("supabase");
    expect(readerB.data).toHaveLength(1);
    // Same content item, same logical pair — but reader B never read it.
    expect(readerB.data[0]?.items?.[0]).toMatchObject({
      id: itemId(0, 0, "en"),
      is_completed: false,
      is_saved: false
    });
  });
});

describe("Today across a language switch", () => {
  it("serves the same edition translated, with completion anchored to the assigned ids", async () => {
    const english = await fetchTodayDrop(USER_A, "2026-08-27", { language: "en" });
    expect(english.source).toBe("supabase");

    const englishItems = flattenDailyDropItems(english.data);
    expect(englishItems.map((item) => item.id)).toEqual([
      itemId(2, 0, "en"),
      itemId(2, 1, "en"),
      itemId(2, 3, "en"),
      itemId(2, 2, "en")
    ]);

    clearMemoryCache();
    const french = await fetchTodayDrop(USER_A, "2026-08-27", { language: "fr" });
    expect(french.source).toBe("supabase");
    expect(french.data.language).toBe("fr");
    expect(french.data.title).toBe("Brief du jour");

    const frenchItems = flattenDailyDropItems(french.data);
    // Same ids in the same order: the interaction snapshot the Today screen
    // loads by these ids yields identical read/unread state in both languages.
    expect(frenchItems.map((item) => item.id)).toEqual(englishItems.map((item) => item.id));
    for (const item of frenchItems) {
      expect(item.language).toBe("fr");
      expect(item.title).toContain("FR");
    }
  });
});

// ---------------------------------------------------------------------------
// In-memory PostgREST double
// ---------------------------------------------------------------------------

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "lt"; column: string; value: unknown }
  | { kind: "or"; filter: string };

function createQuery(table: string) {
  const filters: Filter[] = [];
  let orderBy: { column: string; ascending: boolean } | null = null;
  let limitCount: number | null = null;

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: (row: Row) => {
      interactionWrites.push({ table, ...row });
      return Promise.resolve({ data: null, error: null });
    },
    eq: (column: string, value: unknown) => {
      filters.push({ kind: "eq", column, value });
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      filters.push({ kind: "in", column, values });
      return builder;
    },
    lt: (column: string, value: unknown) => {
      filters.push({ kind: "lt", column, value });
      return builder;
    },
    or: (filter: string) => {
      filters.push({ kind: "or", filter });
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orderBy = { column, ascending: options?.ascending !== false };
      return builder;
    },
    limit: (count: number) => {
      limitCount = count;
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null })
  };

  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: run(), error: null }).then(resolve);

  return builder;

  function run(): Row[] {
    let rows = [...(tables[table] ?? [])];

    for (const filter of filters) {
      if (filter.kind === "eq") {
        rows = rows.filter((row) => row[filter.column] === filter.value);
      } else if (filter.kind === "in") {
        rows = rows.filter((row) => filter.values.includes(row[filter.column]));
      } else if (filter.kind === "lt") {
        rows = rows.filter((row) => String(row[filter.column]) < String(filter.value));
      } else {
        // The translation lookup's OR over the three logical-key fields.
        const keys = [...filter.filter.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
        rows = rows.filter((row) => {
          const metadata = row.metadata as Record<string, unknown> | null;
          const logicalKey =
            metadata?.staging_job_id ?? metadata?.catalog_entry_id ?? metadata?.entry_key;
          return typeof logicalKey === "string" && keys.includes(logicalKey);
        });
      }
    }

    if (orderBy) {
      const { column, ascending } = orderBy;
      rows.sort((left, right) => {
        const a = String(left[column] ?? "");
        const b = String(right[column] ?? "");
        return ascending ? a.localeCompare(b) : b.localeCompare(a);
      });
    }

    if (limitCount !== null) {
      rows = rows.slice(0, limitCount);
    }

    return rows;
  }
}
