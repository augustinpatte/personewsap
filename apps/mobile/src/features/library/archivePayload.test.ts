import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";

/**
 * The archive draws lists, so it reads list fields only.
 *
 * A content row's body_md and full metadata (which carries mini-case bodies,
 * questions and sources) are the bulk of its weight. A list of 25 editions does
 * not need either. Opening an item reads the whole row through the reader path.
 *
 * The double below answers a select the way PostgREST does: it returns the
 * columns named, and `alias:metadata->>key` as a flat string. So a list that
 * still needed something it no longer selects would fail here, not on a device.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.stubGlobal("__DEV__", false);

const selects: Array<{ table: string; select: string }> = [];

type Row = Record<string, unknown>;
let dropRows: Row[] = [];
let dropItemRows: Row[] = [];
let contentRows: Row[] = [];
let searchRows: Row[] = [];

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => createQuery(table),
    rpc: async () => ({ data: [], error: null })
  },
  isLikelyNetworkError: () => false,
  normalizeSupabaseError: (error: unknown) => ({
    message: (error as { message?: string })?.message ?? "error"
  })
}));

vi.mock("../../lib/mockPolicy", () => ({ allowMockContent: false }));

const { fetchLibraryDrops, searchLibraryItems } = await import("./libraryData");
const { fetchContentItemById } = await import("../today/dailyDropData");

beforeEach(() => {
  clearMemoryCache();
  selects.length = 0;
  dropRows = [
    {
      id: "drop-1",
      user_id: USER,
      drop_date: "2026-09-07",
      language: "en",
      status: "published",
      hide_display_date: false
    }
  ];
  dropItemRows = [
    { daily_drop_id: "drop-1", content_item_id: "en-1", slot: "newsletter", position: 0, created_at: "" }
  ];
  contentRows = [
    content("en-1", "en", "The Fed blinked"),
    content("fr-1", "fr", "La Fed a cligné")
  ];
  searchRows = [];
});

describe("archive list payload", () => {
  it("never asks content_items for body_md or the full metadata", async () => {
    const page = await fetchLibraryDrops(USER, { language: "fr" });

    expect(page.source).toBe("supabase");
    const contentSelects = selects.filter((entry) => entry.table === "content_items");
    expect(contentSelects.length).toBeGreaterThan(0);

    for (const { select } of contentSelects) {
      const columns = select.split(",");
      expect(columns).not.toContain("body_md");
      expect(columns).not.toContain("summary");
      // Only named keys of metadata, never the column itself.
      expect(columns).not.toContain("metadata");
    }
  });

  it("still renders the edition in the reading language (FR/EN pairing survives)", async () => {
    const page = await fetchLibraryDrops(USER, { language: "fr" });
    const items = page.data[0]?.items ?? [];

    // The assigned id stays; the French rendering's title is shown.
    expect(items.map((item) => [item.id, item.title, item.language])).toEqual([
      ["en-1", "La Fed a cligné", "fr"]
    ]);
    expect(items[0].topic).toBe("finance");
    expect(items[0].source_count).toBe(3);
  });

  it("opening an archived item reads the full row, body included", async () => {
    await fetchLibraryDrops(USER, { language: "en" });
    selects.length = 0;

    const opened = await fetchContentItemById("en-1", { language: "en" });

    expect(selects.find((entry) => entry.table === "content_items")?.select.split(",")).toContain(
      "body_md"
    );
    const article = opened.data;
    expect(article?.content_type).toBe("newsletter_article");
    expect(article && "body_md" in article ? article.body_md : null).toBe("Full body of The Fed blinked");
  });

  it("archive search reads the topic fallback without the metadata object", async () => {
    searchRows = [
      {
        content_item_id: "en-1",
        drop_id: "drop-1",
        drop_date: "2026-09-07",
        content_type: "business_story",
        language: "en",
        title: "The pricing call",
        topic_id: null,
        source_count: 2,
        hide_display_date: false,
        metadata: { category: "career", body: "x".repeat(5000) }
      }
    ];

    const result = await searchLibraryItems(USER, { contentType: "business_story", text: "" });
    const searchSelect = selects.find((entry) => entry.table === "user_archive_search_items")?.select ?? "";

    expect(searchSelect.split(",")).not.toContain("metadata");
    expect(result.data.items[0]?.topic).toBe("career");
  });
});

function content(id: string, language: string, title: string): Row {
  return {
    id,
    content_type: "newsletter_article",
    topic_id: null,
    language,
    title,
    summary: `Summary of ${title}`,
    body_md: `Full body of ${title}`,
    status: "published",
    source_count: 3,
    publication_date: "2026-09-07",
    metadata: { staging_job_id: "job-1", topic: "finance", questions: ["q".repeat(2000)] }
  };
}

/** A PostgREST select: named columns, plus `alias:metadata->>key` as text. */
function project(row: Row, select: string): Row {
  const projected: Row = {};

  for (const column of select.split(",")) {
    const arrow = /^(\w+):(\w+)->>(\w+)$/.exec(column);

    if (arrow) {
      const json = row[arrow[2]] as Row | undefined;
      const value = json?.[arrow[3]];
      projected[arrow[1]] = value === undefined || value === null ? null : String(value);
    } else if (column in row) {
      projected[column] = row[column];
    }
  }

  return projected;
}

function createQuery(table: string) {
  let select = "*";
  const eq: Record<string, unknown> = {};
  let ids: string[] | null = null;
  let or: string | null = null;
  let single = false;

  const resolve = () => {
    let rows: Row[] =
      table === "daily_drops"
        ? dropRows
        : table === "daily_drop_items"
          ? dropItemRows
          : table === "content_items"
            ? contentRows
            : table === "user_archive_search_items"
              ? searchRows
              : [];

    if (table === "content_items") {
      if (ids) rows = rows.filter((row) => ids?.includes(row.id as string));
      if (eq.id) rows = rows.filter((row) => row.id === eq.id);
      if (eq.language) rows = rows.filter((row) => row.language === eq.language);
      if (or) {
        const keys = [...or.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
        rows = rows.filter((row) => keys.includes((row.metadata as Row).staging_job_id as string));
      }
    }

    const data = rows.map((row) => (select === "*" ? row : project(row, select)));
    return { data: single ? (data[0] ?? null) : data, error: null };
  };

  const builder: Record<string, unknown> = {
    select: (value: string) => {
      select = value;
      selects.push({ table, select: value });
      return builder;
    },
    eq: (column: string, value: unknown) => {
      eq[column] = value;
      return builder;
    },
    in: (column: string, values: string[]) => {
      if (column === "id") ids = values;
      return builder;
    },
    or: (filter: string) => {
      or = filter;
      return builder;
    },
    lt: () => builder,
    gte: () => builder,
    ilike: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      single = true;
      return Promise.resolve(resolve());
    }
  };

  builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled);

  return builder;
}
