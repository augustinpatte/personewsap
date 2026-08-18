import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";
import type { ArchiveSearchCursor } from "../archive/archiveSearchPaging";

/**
 * The search query as it is actually sent, against a stand-in that applies the
 * same rules Postgres would: the filters, the keyset `or=` predicate, the two
 * order keys and the pageSize + 1 probe are all interpreted here rather than
 * asserted as strings, so a wrong predicate fails the test by returning wrong
 * rows — not by looking different.
 */

const USER_ID = "44444444-4444-4444-8444-444444444444";

type Row = {
  user_id: string;
  content_item_id: string;
  drop_id: string;
  drop_date: string;
  content_type: string;
  language: string;
  title: string;
  topic_id: string | null;
  source_count: number;
  metadata: Record<string, unknown>;
};

let table: Row[] = [];
const requestedTables: string[] = [];
let failNextSearch: Error | null = null;

vi.stubGlobal("__DEV__", false);

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (name: string) => {
      requestedTables.push(name);
      return name === "user_archive_search_items" ? createSearchQuery() : createEmptyQuery();
    }
  },
  isLikelyNetworkError: () => false,
  normalizeSupabaseError: (error: unknown, fallback?: string) => ({
    code: (error as { code?: string })?.code,
    message: (error as { message?: string })?.message ?? fallback ?? "error"
  })
}));

const { searchLibraryItems } = await import("./libraryData");

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function row(overrides: Partial<Row> & { content_item_id: string; drop_date: string }): Row {
  return {
    user_id: USER_ID,
    drop_id: uuid(900000),
    content_type: "business_story",
    language: "fr",
    title: "Titre",
    topic_id: "business",
    source_count: 2,
    metadata: {},
    ...overrides
  };
}

/** Applies the client's filters to `table`, the way PostgREST would. */
function createSearchQuery() {
  const eq: Record<string, unknown> = {};
  let ilike: string | null = null;
  let gte: string | null = null;
  let lt: string | null = null;
  let keyset: ArchiveSearchCursor | null = null;
  const order: { column: string; ascending: boolean }[] = [];
  let limit = Number.POSITIVE_INFINITY;

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      eq[column] = value;
      return builder;
    },
    ilike: (column: string, pattern: string) => {
      expect(column).toBe("title");
      ilike = pattern;
      return builder;
    },
    gte: (column: string, value: string) => {
      expect(column).toBe("drop_date");
      gte = value;
      return builder;
    },
    lt: (column: string, value: string) => {
      expect(column).toBe("drop_date");
      lt = value;
      return builder;
    },
    or: (filter: string) => {
      keyset = parseKeysetFilter(filter);
      return builder;
    },
    order: (column: string, options: { ascending: boolean }) => {
      order.push({ column, ascending: options.ascending });
      return builder;
    },
    limit: (value: number) => {
      limit = value;
      return builder;
    }
  };

  builder.then = (resolve: (value: unknown) => unknown) => {
    if (failNextSearch) {
      const error = failNextSearch;
      failNextSearch = null;
      return Promise.resolve({ data: null, error }).then(resolve);
    }

    // The client must ask for both keys, newest first: without them the cursor
    // would be meaningless.
    expect(order).toEqual([
      { column: "drop_date", ascending: false },
      { column: "content_item_id", ascending: false }
    ]);

    const matched = table
      .filter((candidate) =>
        Object.entries(eq).every(([column, value]) => candidate[column as keyof Row] === value)
      )
      .filter((candidate) => (ilike ? matchesIlike(candidate.title, ilike) : true))
      .filter((candidate) => (gte ? candidate.drop_date >= gte : true))
      .filter((candidate) => (lt ? candidate.drop_date < lt : true))
      .filter((candidate) =>
        keyset
          ? candidate.drop_date < keyset.dropDate ||
            (candidate.drop_date === keyset.dropDate &&
              candidate.content_item_id < keyset.contentItemId)
          : true
      )
      .sort(
        (left, right) =>
          right.drop_date.localeCompare(left.drop_date) ||
          right.content_item_id.localeCompare(left.content_item_id)
      )
      .slice(0, limit);

    return Promise.resolve({ data: matched, error: null }).then(resolve);
  };

  return builder;
}

/** content_interactions and anything else: nothing recorded in these tests. */
function createEmptyQuery() {
  const builder: Record<string, unknown> = {};

  for (const method of ["select", "eq", "in", "order", "limit", "ilike", "gte", "lt", "or"]) {
    builder[method] = () => builder;
  }

  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);

  return builder;
}

/**
 * Parses exactly the predicate the client is expected to send, and nothing
 * else — an unrecognised shape fails the test instead of silently matching
 * every row.
 */
function parseKeysetFilter(filter: string): ArchiveSearchCursor {
  const match =
    /^drop_date\.lt\.(\d{4}-\d{2}-\d{2}),and\(drop_date\.eq\.(\d{4}-\d{2}-\d{2}),content_item_id\.lt\.([0-9a-f-]{36})\)$/.exec(
      filter
    );

  expect(match, `unsupported keyset filter: ${filter}`).not.toBeNull();
  expect(match?.[1]).toBe(match?.[2]);

  return { dropDate: match?.[1] ?? "", contentItemId: match?.[3] ?? "" };
}

function matchesIlike(value: string, pattern: string): boolean {
  const unescaped = pattern.slice(1, -1).replace(/\\([\\%_])/g, "$1");

  return value.toLowerCase().includes(unescaped.toLowerCase());
}

async function collectAllPages(options: {
  contentType: "business_story" | "mini_case";
  text: string;
  from?: string | null;
  toExclusive?: string | null;
  language?: "fr" | "en";
  pageSize?: number;
}) {
  const seen: string[] = [];
  let cursor: ArchiveSearchCursor | null = null;
  let pages = 0;

  for (;;) {
    const result = await searchLibraryItems(USER_ID, { ...options, cursor });

    expect(result.source).not.toBe("mock");
    seen.push(...result.data.items.map((item) => item.id));
    pages += 1;

    if (!result.data.hasMore || !result.data.nextCursor) {
      break;
    }

    cursor = result.data.nextCursor;
    expect(pages).toBeLessThan(500);
  }

  return { ids: seen, pages };
}

beforeEach(() => {
  table = [];
  requestedTables.length = 0;
  failNextSearch = null;
  clearMemoryCache("archive-search");
});

describe("search reads the scoped archive view", () => {
  it("queries the reader's own view, never a global content_items scan", async () => {
    table = [row({ content_item_id: uuid(1), drop_date: "2026-08-17" })];

    await searchLibraryItems(USER_ID, { contentType: "business_story", text: "titre" });

    expect(requestedTables).toContain("user_archive_search_items");
    expect(requestedTables).not.toContain("content_items");
    expect(requestedTables).not.toContain("daily_drop_items");
  });

  it("returns an empty page with no session", async () => {
    const result = await searchLibraryItems(null, {
      contentType: "business_story",
      text: "titre"
    });

    expect(result.source).toBe("mock");
    expect(result.data).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
});

describe("paging real query results", () => {
  it("walks 85 matches in 4 pages and returns 85 unique ids", async () => {
    table = Array.from({ length: 85 }, (_, index) =>
      row({
        content_item_id: uuid(index),
        drop_date: `2026-${String((index % 12) + 1).padStart(2, "0")}-15`,
        title: `OpenAI ${index}`
      })
    );

    const { ids, pages } = await collectAllPages({
      contentType: "business_story",
      text: "openai"
    });

    expect(pages).toBe(4);
    expect(ids).toHaveLength(85);
    expect(new Set(ids).size).toBe(85);
  });

  it("keeps every item when many share one drop_date", async () => {
    table = Array.from({ length: 60 }, (_, index) =>
      row({
        content_item_id: uuid(index),
        drop_date: ["2026-08-17", "2026-08-14"][index % 2],
        title: `OpenAI ${index}`
      })
    );

    const { ids } = await collectAllPages({ contentType: "business_story", text: "openai" });

    expect(new Set(ids).size).toBe(60);
  });

  it("reaches a two-year-old story by title", async () => {
    table = [
      ...Array.from({ length: 70 }, (_, index) =>
        row({
          content_item_id: uuid(index),
          drop_date: "2026-08-17",
          title: `Le pricing de OpenAI ${index}`
        })
      ),
      row({
        content_item_id: uuid(9999),
        drop_date: "2024-08-17",
        title: "Le pricing de OpenAI en 2024"
      })
    ];

    const { ids } = await collectAllPages({ contentType: "business_story", text: "openai" });

    expect(ids).toContain(uuid(9999));
    expect(ids[ids.length - 1]).toBe(uuid(9999));
  });

  it("stops with hasMore false at the end", async () => {
    table = Array.from({ length: 26 }, (_, index) =>
      row({ content_item_id: uuid(index), drop_date: "2026-08-17", title: "OpenAI" })
    );

    const first = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai"
    });
    expect(first.data.items).toHaveLength(25);
    expect(first.data.hasMore).toBe(true);

    const second = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai",
      cursor: first.data.nextCursor
    });

    expect(second.data.items).toHaveLength(1);
    expect(second.data.hasMore).toBe(false);
    expect(second.data.nextCursor).toBeNull();
  });

  it("is unaffected by an edition published between two pages", async () => {
    table = Array.from({ length: 40 }, (_, index) =>
      row({ content_item_id: uuid(index), drop_date: "2026-08-14", title: "OpenAI" })
    );

    const first = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai"
    });

    table.push(
      row({ content_item_id: uuid(999), drop_date: "2026-08-19", title: "OpenAI nouveau" })
    );

    const second = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai",
      cursor: first.data.nextCursor
    });

    const ids = [...first.data.items, ...second.data.items].map((item) => item.id);

    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
    expect(ids).not.toContain(uuid(999));
  });
});

describe("filters", () => {
  beforeEach(() => {
    table = [
      row({
        content_item_id: uuid(1),
        drop_date: "2026-08-17",
        title: "OpenAI et la capacité"
      }),
      row({ content_item_id: uuid(2), drop_date: "2026-08-14", title: "Nvidia et la marge" }),
      row({ content_item_id: uuid(3), drop_date: "2025-03-10", title: "OpenAI en 2025" }),
      row({
        content_item_id: uuid(4),
        drop_date: "2026-08-17",
        title: "Un mini cas OpenAI",
        content_type: "mini_case"
      })
    ];
  });

  it("title only", async () => {
    const result = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai"
    });

    expect(result.data.items.map((item) => item.id)).toEqual([uuid(1), uuid(3)]);
  });

  it("date only", async () => {
    const result = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "",
      from: "2026-08-01",
      toExclusive: "2026-09-01"
    });

    expect(result.data.items.map((item) => item.id)).toEqual([uuid(1), uuid(2)]);
  });

  it("title and date together", async () => {
    const result = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai",
      from: "2026-08-01",
      toExclusive: "2026-09-01"
    });

    expect(result.data.items.map((item) => item.id)).toEqual([uuid(1)]);
  });

  it("keeps the two content types apart", async () => {
    const stories = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai"
    });
    const cases = await searchLibraryItems(USER_ID, {
      contentType: "mini_case",
      text: "openai"
    });

    expect(stories.data.items.map((item) => item.id)).not.toContain(uuid(4));
    expect(cases.data.items.map((item) => item.id)).toEqual([uuid(4)]);
  });

  it("matches a title containing ILIKE wildcards literally", async () => {
    table = [
      row({ content_item_id: uuid(5), drop_date: "2026-08-17", title: "Marges 100% brutes" }),
      row({ content_item_id: uuid(6), drop_date: "2026-08-17", title: "Marges brutes" })
    ];

    const result = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "100%"
    });

    expect(result.data.items.map((item) => item.id)).toEqual([uuid(5)]);
  });
});

describe("language isolation", () => {
  beforeEach(() => {
    table = [
      row({
        content_item_id: uuid(1),
        drop_date: "2026-08-17",
        title: "OpenAI FR",
        language: "fr"
      }),
      row({
        content_item_id: uuid(2),
        drop_date: "2026-08-17",
        title: "OpenAI EN",
        language: "en"
      })
    ];
  });

  it("a FR search returns only FR content", async () => {
    const result = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai",
      language: "fr"
    });

    expect(result.data.items.map((item) => item.id)).toEqual([uuid(1)]);
  });

  it("an EN search returns only EN content", async () => {
    const result = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai",
      language: "en"
    });

    expect(result.data.items.map((item) => item.id)).toEqual([uuid(2)]);
  });
});

describe("failures", () => {
  it("reports a failed page without inventing an empty result set", async () => {
    table = [row({ content_item_id: uuid(1), drop_date: "2026-08-17", title: "OpenAI" })];
    failNextSearch = Object.assign(new Error("Network request failed"), {
      code: "network_request_failed"
    });

    const result = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai"
    });

    // source "mock" is how the caller knows this is not an authoritative
    // "no results": the hook keeps what it already shows.
    expect(result.source).toBe("mock");
    expect(result.error?.message).toContain("Network request failed");
    expect(result.data.hasMore).toBe(false);
  });

  it("serves the same page from cache on a retry of the same cursor", async () => {
    table = Array.from({ length: 30 }, (_, index) =>
      row({ content_item_id: uuid(index), drop_date: "2026-08-17", title: "OpenAI" })
    );

    const first = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai"
    });
    const again = await searchLibraryItems(USER_ID, {
      contentType: "business_story",
      text: "openai"
    });

    expect(again.source).toBe("cache");
    expect(again.data.items.map((item) => item.id)).toEqual(
      first.data.items.map((item) => item.id)
    );
  });
});
