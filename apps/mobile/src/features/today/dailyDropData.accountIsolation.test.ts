import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";

const CONTENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type QueryCall = {
  table: string;
  eq: Array<{ column: string; value: unknown }>;
};

const calls: QueryCall[] = [];
let assignments = new Set<string>();

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

  it("does not serve a cached FR item into an EN reader", async () => {
    await expect(
      fetchContentItemById(CONTENT_ID, {
        language: "fr",
        userId: USER_A
      })
    ).resolves.toMatchObject({ source: "supabase" });

    const english = await fetchContentItemById(CONTENT_ID, {
      language: "en",
      userId: USER_A
    });

    expect(english.source).toBe("supabase");
    expect(english.data).toBeNull();
    expect(tableCalls("content_items")).toHaveLength(2);
  });
});

function createQuery(table: string) {
  const call: QueryCall = { table, eq: [] };
  calls.push(call);

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      call.eq.push({ column, value });
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
    const language = eqValue(call, "language");

    if (id === CONTENT_ID && status === "published" && language === "fr") {
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
  if (call.table === "content_item_sources") {
    return { data: [], error: null };
  }

  if (call.table === "sources") {
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
