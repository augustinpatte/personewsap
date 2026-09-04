import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentItem } from "../../types/domain";

type QueryCall = {
  table: string;
  eq: Array<{ column: string; value: unknown }>;
  or: string[];
};

const calls: QueryCall[] = [];
let translationRows: ContentItem[] = [];
let translationError: { code: string; message: string } | null = null;

vi.stubGlobal("__DEV__", false);

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
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
        }
      };

      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: translationError ? null : translationRows, error: translationError }).then(
          resolve
        );

      return builder;
    }
  },
  normalizeSupabaseError: (error: unknown) => error,
  isLikelyNetworkError: () => false
}));

const { getContentLogicalKey, mergeTranslatedContentItem, resolveContentItemsForLanguage } =
  await import("./contentTranslations");

beforeEach(() => {
  calls.length = 0;
  translationRows = [];
  translationError = null;
});

function item(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    content_type: "newsletter_article",
    topic_id: "business",
    language: "en",
    title: "EN title",
    summary: "EN summary",
    body_md: "EN body",
    difficulty: null,
    estimated_read_seconds: 120,
    publication_date: "2026-09-01",
    version: 1,
    status: "published",
    generation_run_id: null,
    source_count: 1,
    metadata: { staging_job_id: "job-1" },
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    ...overrides
  } as ContentItem;
}

describe("getContentLogicalKey", () => {
  it("reads each keyed pipeline's field", () => {
    expect(getContentLogicalKey({ staging_job_id: "job-1" })).toBe("job-1");
    expect(getContentLogicalKey({ catalog_entry_id: "catalog-1" })).toBe("catalog-1");
    expect(getContentLogicalKey({ entry_key: "weekly-1" })).toBe("weekly-1");
  });

  it("prefers the staging job id when several are present", () => {
    expect(
      getContentLogicalKey({ staging_job_id: "job-1", entry_key: "weekly-1" })
    ).toBe("job-1");
  });

  it("returns null for legacy rows without a key", () => {
    expect(getContentLogicalKey({})).toBeNull();
    expect(getContentLogicalKey(null)).toBeNull();
    expect(getContentLogicalKey({ staging_job_id: "  " })).toBeNull();
  });
});

describe("mergeTranslatedContentItem", () => {
  it("takes every display field from the translation but keeps the assigned id", () => {
    const assigned = item({});
    const translation = item({
      id: "22222222-2222-4222-8222-222222222222",
      language: "fr",
      title: "Titre FR",
      body_md: "Corps FR"
    });

    const merged = mergeTranslatedContentItem(assigned, translation);

    expect(merged.id).toBe(assigned.id);
    expect(merged.language).toBe("fr");
    expect(merged.title).toBe("Titre FR");
    expect(merged.body_md).toBe("Corps FR");
  });
});

describe("resolveContentItemsForLanguage", () => {
  it("returns items untouched when they already match the requested language", async () => {
    const items = [item({})];

    const resolved = await resolveContentItemsForLanguage(items, "en");

    expect(resolved).toEqual(items);
    expect(calls).toHaveLength(0);
  });

  it("swaps display fields for the requested language and keeps ids and order", async () => {
    const first = item({});
    const second = item({
      id: "33333333-3333-4333-8333-333333333333",
      content_type: "mini_case",
      metadata: { entry_key: "weekly-1" },
      title: "EN mini case"
    });
    translationRows = [
      item({
        id: "44444444-4444-4444-8444-444444444444",
        language: "fr",
        title: "Titre FR",
        metadata: { staging_job_id: "job-1" }
      }),
      item({
        id: "55555555-5555-4555-8555-555555555555",
        content_type: "mini_case",
        language: "fr",
        title: "Mini cas FR",
        metadata: { entry_key: "weekly-1" }
      })
    ];

    const resolved = await resolveContentItemsForLanguage([first, second], "fr");

    expect(resolved.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(resolved[0]?.title).toBe("Titre FR");
    expect(resolved[0]?.language).toBe("fr");
    expect(resolved[1]?.title).toBe("Mini cas FR");

    // One round trip, filtered to published rows in the requested language.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.eq).toContainEqual({ column: "language", value: "fr" });
    expect(calls[0]?.eq).toContainEqual({ column: "status", value: "published" });
  });

  it("keeps the original rendering when no translation exists", async () => {
    const legacy = item({ metadata: {} });
    const keyed = item({
      id: "33333333-3333-4333-8333-333333333333",
      title: "EN with missing twin"
    });
    translationRows = [];

    const resolved = await resolveContentItemsForLanguage([legacy, keyed], "fr");

    expect(resolved[0]).toEqual(legacy);
    expect(resolved[1]).toEqual(keyed);
  });

  it("never crosses content types even when a key collides", async () => {
    const original = item({});
    translationRows = [
      item({
        id: "44444444-4444-4444-8444-444444444444",
        content_type: "mini_case",
        language: "fr",
        title: "Wrong type",
        metadata: { staging_job_id: "job-1" }
      })
    ];

    const resolved = await resolveContentItemsForLanguage([original], "fr");

    expect(resolved[0]).toEqual(original);
  });

  it("degrades to the original language when the lookup fails", async () => {
    const original = item({});
    translationError = { code: "500", message: "boom" };

    const resolved = await resolveContentItemsForLanguage([original], "fr");

    expect(resolved[0]).toEqual(original);
  });
});
