import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";

const CONTENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type QueryCall = {
  table: string;
  eq: Array<{ column: string; value: unknown }>;
  or: string[];
};

const calls: QueryCall[] = [];
let assignments = new Set<string>();
let hasTwin = true;

vi.stubGlobal("__DEV__", false);

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => createQuery(table)
  },
  isLikelyNetworkError: () => false,
  normalizeSupabaseError: (error: unknown, fallback?: string) => ({
    code: (error as { code?: string })?.code,
    message: (error as { message?: string })?.message ?? fallback ?? "error"
  })
}));

const { fetchContentItemById } = await import("./dailyDropData");

beforeEach(() => {
  clearMemoryCache();
  calls.length = 0;
  assignments = new Set([`${USER_A}:${CONTENT_ID}`]);
  hasTwin = true;
});

describe("reader content cache account isolation", () => {
  it("does not serve account A's cached reader item to account B", async () => {
    const first = await fetchContentItemById(CONTENT_ID, {
      language: "fr",
      userId: USER_A
    });

    expect(first.source).toBe("supabase");
    expect(first.data?.title).toBe("Story assigned to account A");
    expect(tableCalls("content_items")).toHaveLength(1);

    const second = await fetchContentItemById(CONTENT_ID, {
      language: "fr",
      userId: USER_B
    });

    expect(second.source).toBe("supabase");
    expect(second.data).toBeNull();
    expect(tableCalls("content_items")).toHaveLength(2);
    expect(tableCalls("daily_drop_items")).toHaveLength(2);

    const third = await fetchContentItemById(CONTENT_ID, {
      language: "fr",
      userId: USER_A
    });

    expect(third.source).toBe("cache");
    expect(third.data?.title).toBe("Story assigned to account A");
    expect(tableCalls("content_items")).toHaveLength(2);
  });

  it("serves the EN rendering of a FR item to an EN reader, under the same id", async () => {
    const french = await fetchContentItemById(CONTENT_ID, {
      language: "fr",
      userId: USER_A
    });

    expect(french.source).toBe("supabase");
    expect(french.data?.title).toBe("Story assigned to account A");

    const english = await fetchContentItemById(CONTENT_ID, {
      language: "en",
      userId: USER_A
    });

    expect(english.source).toBe("supabase");
    // The display comes from the EN twin; the id stays the assigned row's, so
    // interactions and completion keep one anchor across languages.
    expect(english.data?.id).toBe(CONTENT_ID);
    expect(english.data?.language).toBe("en");
    expect(english.data?.title).toBe("Story assigned to account A (EN)");
  });

  it("falls back to the item's own language when no translation exists", async () => {
    hasTwin = false;

    const english = await fetchContentItemById(CONTENT_ID, {
      language: "en",
      userId: USER_A
    });

    expect(english.source).toBe("supabase");
    expect(english.data?.id).toBe(CONTENT_ID);
    expect(english.data?.language).toBe("fr");
    expect(english.data?.title).toBe("Story assigned to account A");
  });
});

function createQuery(table: string) {
  const call: QueryCall = { table, eq: [], or: [] };
  calls.push(call);

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      call.eq.push({ column, value });
      return builder;
    },
    or: (filter: string) => {
      call.or.push(filter);
      return builder;
    },
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(resolveSingle(call))
  };

  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolveMany(call)).then(resolve);

  return builder;
}

function resolveSingle(call: QueryCall) {
  if (call.table === "content_items") {
    const id = eqValue(call, "id");
    const status = eqValue(call, "status");

    if (id === CONTENT_ID && status === "published") {
      return { data: contentItem(), error: null };
    }

    return { data: null, error: null };
  }

  if (call.table === "daily_drop_items") {
    const contentItemId = eqValue(call, "content_item_id");
    const userId = eqValue(call, "daily_drops.user_id");

    return {
      data: assignments.has(`${userId}:${contentItemId}`)
        ? { content_item_id: contentItemId, daily_drops: { user_id: userId } }
        : null,
      error: null
    };
  }

  return { data: null, error: null };
}

function resolveMany(call: QueryCall) {
  // The translation lookup: content_items filtered on language + an OR over
  // the logical-key metadata fields.
  if (call.table === "content_items" && call.or.length > 0) {
    const language = eqValue(call, "language");

    if (hasTwin && language === "en" && call.or[0]?.includes("job-1")) {
      return { data: [englishTwin()], error: null };
    }

    return { data: [], error: null };
  }

  return { data: [], error: null };
}

function eqValue(call: QueryCall, column: string): unknown {
  return call.eq.find((entry) => entry.column === column)?.value;
}

function tableCalls(table: string): QueryCall[] {
  return calls.filter((call) => call.table === table);
}

function contentItem() {
  return {
    id: CONTENT_ID,
    content_type: "business_story",
    topic_id: "business",
    language: "fr",
    title: "Story assigned to account A",
    summary: "A short summary.",
    body_md: "A short story body.",
    difficulty: "medium",
    estimated_read_seconds: 180,
    publication_date: "2026-08-18",
    version: 1,
    status: "published",
    generation_run_id: null,
    source_count: 0,
    metadata: {
      staging_job_id: "job-1",
      company_or_market: "Marché",
      decision: "Choisir le bon rythme.",
      lesson: "La cadence compte.",
      outcome: "L'équipe garde de la marge.",
      setup: "Une équipe prépare son lancement.",
      story_date: "2026-08-18",
      tension: "Croissance ou qualité."
    },
    created_at: "2026-08-18T10:00:00.000Z",
    updated_at: "2026-08-18T10:00:00.000Z"
  };
}

function englishTwin() {
  return {
    ...contentItem(),
    id: "22222222-2222-4222-8222-222222222222",
    language: "en",
    title: "Story assigned to account A (EN)",
    metadata: {
      staging_job_id: "job-1",
      company_or_market: "Market",
      decision: "Pick the right pace.",
      lesson: "Cadence matters.",
      outcome: "The team keeps slack.",
      setup: "A team prepares its launch.",
      story_date: "2026-08-18",
      tension: "Growth or quality."
    }
  };
}
