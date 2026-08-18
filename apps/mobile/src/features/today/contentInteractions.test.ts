import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * content_interactions.content_item_id is a UUID too, so the same rule applies
 * as for mini-case results: a sample/demo reading is never written to the
 * account, and a snapshot never asks the database about ids it cannot parse.
 */

const MOCK_ITEM_ID = "mini-case-2026-04-26-fr-ai-notes";
const LIVE_ITEM_ID = "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c";

const fromMock = vi.fn();
const insertMock = vi.fn();
const selectRowsMock = vi.fn();
const getAuthSessionMock = vi.fn();

vi.stubGlobal("__DEV__", false);

vi.mock("../../lib/memoryCache", () => ({
  clearMemoryCache: () => {}
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args)
  },
  getAuthSession: () => getAuthSessionMock(),
  normalizeSupabaseError: (error: unknown, fallback?: string) => ({
    code: (error as { code?: string })?.code,
    message: (error as { message?: string })?.message ?? fallback ?? "error"
  })
}));

const { readContentInteractionSnapshot, writeContentInteraction } = await import(
  "./contentInteractions"
);

function query() {
  const builder: Record<string, unknown> = {};

  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = () => builder;
  }

  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve()
      .then(() => selectRowsMock())
      .then(resolve, reject);

  return builder;
}

beforeEach(() => {
  fromMock.mockReset();
  insertMock.mockReset();
  selectRowsMock.mockReset();
  getAuthSessionMock.mockReset();

  getAuthSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  insertMock.mockResolvedValue({ error: null });
  selectRowsMock.mockReturnValue({ data: [], error: null });
  fromMock.mockImplementation(() => ({
    ...query(),
    insert: (...args: unknown[]) => insertMock(...args)
  }));
});

describe("writeContentInteraction", () => {
  it("refuses a sample content item before any request", async () => {
    const result = await writeContentInteraction({
      contentItemId: MOCK_ITEM_ID,
      interactionType: "complete"
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("local_only_content_item");
    expect(fromMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("writes a completion for a real content item", async () => {
    const result = await writeContentInteraction({
      contentItemId: LIVE_ITEM_ID,
      interactionType: "complete"
    });

    expect(result).toEqual({ ok: true, outcome: "inserted" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content_item_id: LIVE_ITEM_ID,
        interaction_type: "complete",
        user_id: "user-1"
      })
    );
  });

  it("does not duplicate an existing completion", async () => {
    selectRowsMock.mockReturnValue({ data: [{ id: "row-1", rating: null }], error: null });

    const result = await writeContentInteraction({
      contentItemId: LIVE_ITEM_ID,
      interactionType: "complete"
    });

    expect(result).toEqual({ ok: true, outcome: "already_exists" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("normalises a dropped connection instead of rejecting", async () => {
    selectRowsMock.mockImplementation(() => {
      throw new TypeError("Network request failed");
    });

    const result = await writeContentInteraction({
      contentItemId: LIVE_ITEM_ID,
      interactionType: "complete"
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain("Network request failed");
  });
});

describe("readContentInteractionSnapshot", () => {
  it("returns an empty snapshot for an all-sample edition, with no query", async () => {
    const result = await readContentInteractionSnapshot([MOCK_ITEM_ID, "newsletter-2026-04-26-fr-1"]);

    expect(result.ok).toBe(true);
    expect(result.ok && result.snapshot.completedItemIds.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("asks only about the real content items in a mixed list", async () => {
    selectRowsMock.mockReturnValue({
      data: [
        {
          id: "row-1",
          user_id: "user-1",
          content_item_id: LIVE_ITEM_ID,
          interaction_type: "complete",
          rating: null,
          message: null,
          created_at: "2026-08-17T10:00:00.000Z"
        }
      ],
      error: null
    });

    const result = await readContentInteractionSnapshot([MOCK_ITEM_ID, LIVE_ITEM_ID]);

    expect(result.ok).toBe(true);
    expect(result.ok && [...result.snapshot.completedItemIds]).toEqual([LIVE_ITEM_ID]);
    expect(fromMock).toHaveBeenCalledWith("content_interactions");
  });

  it("reports an unreachable server rather than rejecting", async () => {
    selectRowsMock.mockImplementation(() => {
      throw new TypeError("Network request failed");
    });

    const result = await readContentInteractionSnapshot([LIVE_ITEM_ID]);

    expect(result.ok).toBe(false);
  });
});
