import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MiniCaseResponseRecord } from "./miniCaseResponses";

/**
 * The mini-case sync contract, tested against the two failures seen on device:
 *
 *  - a sample/demo case (text id) was pushed to mini_case_responses, whose
 *    content_item_id is a UUID, producing a hard 22P02 on every archive open;
 *  - a result already stored on the server did not win over a stale local one.
 *
 * Both are behavioural: no request may leave for a non-UUID id, and Supabase is
 * the source of truth for a real case.
 */

const MOCK_CASE_ID = "mini-case-2026-04-26-fr-ai-notes";
const LIVE_CASE_ID = "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c";
const OTHER_LIVE_CASE_ID = "8c7d6e5f-4a3b-4c2d-8e1f-0a1b2c3d4e5f";

const fromMock = vi.fn();
const upsertMock = vi.fn();
const selectResultMock = vi.fn();
const getAuthSessionMock = vi.fn();

vi.stubGlobal("__DEV__", true);

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args)
  },
  getAuthSession: () => getAuthSessionMock(),
  normalizeSupabaseError: (error: unknown) => ({
    message: (error as { message?: string })?.message ?? "error",
    code: (error as { code?: string })?.code
  })
}));

const {
  fetchRemoteMiniCaseResponses,
  pushMiniCaseResponse,
  readMiniCaseResponseAnywhere,
  syncMiniCaseResponses
} = await import("./miniCaseSync");

function record(score: number, completedAt: string): MiniCaseResponseRecord {
  return {
    selections: { "question-1": `option-${score}` },
    score,
    total: 3,
    completedAt
  };
}

/** Chainable stub: every filter returns itself, awaiting yields the result. */
function query(result: () => unknown) {
  const builder: Record<string, unknown> = {};

  for (const method of ["select", "eq", "in", "order", "limit"]) {
    builder[method] = () => builder;
  }

  builder.maybeSingle = () => Promise.resolve(selectResultMock());
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve()
      .then(() => result())
      .then(resolve, reject);

  return builder;
}

beforeEach(() => {
  fromMock.mockReset();
  upsertMock.mockReset();
  selectResultMock.mockReset();
  getAuthSessionMock.mockReset();

  getAuthSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  upsertMock.mockResolvedValue({ error: null });
  selectResultMock.mockReturnValue({ data: null, error: null });
  fromMock.mockImplementation(() => ({
    ...query(() => ({ data: [], error: null })),
    upsert: (...args: unknown[]) => upsertMock(...args)
  }));
});

describe("pushMiniCaseResponse", () => {
  it("never sends a sample-content id to a uuid column", async () => {
    const result = await pushMiniCaseResponse("user-1", MOCK_CASE_ID, record(2, "2026-08-17T10:00:00.000Z"));

    expect(result).toBe(false);
    // The point of the fix: no request at all, so no 22P02 and no warning.
    expect(fromMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upserts a real content item idempotently", async () => {
    const result = await pushMiniCaseResponse("user-1", LIVE_CASE_ID, record(3, "2026-08-17T10:00:00.000Z"));

    expect(result).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("mini_case_responses");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ content_item_id: LIVE_CASE_ID, user_id: "user-1" }),
      { onConflict: "user_id,content_item_id", ignoreDuplicates: true }
    );
  });

  it("keeps a dropped connection to itself instead of rejecting", async () => {
    upsertMock.mockRejectedValue(new TypeError("Network request failed"));

    await expect(
      pushMiniCaseResponse("user-1", LIVE_CASE_ID, record(1, "2026-08-17T10:00:00.000Z"))
    ).resolves.toBe(false);
  });
});

describe("syncMiniCaseResponses", () => {
  it("ignores sample results entirely: no push, no retry, no warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const local = { [MOCK_CASE_ID]: record(2, "2026-08-17T10:00:00.000Z") };

    const result = await syncMiniCaseResponses(local);

    expect(result.offline).toBe(false);
    expect(result.pushed).toEqual([]);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    // The result stays readable on this device.
    expect(result.merged[MOCK_CASE_ID]).toEqual(local[MOCK_CASE_ID]);

    warn.mockRestore();
  });

  it("pushes a real local-only result", async () => {
    const local = { [LIVE_CASE_ID]: record(3, "2026-08-17T10:00:00.000Z") };

    const result = await syncMiniCaseResponses(local);

    expect(result.pushed).toEqual([LIVE_CASE_ID]);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("pushes only the real results when the device holds both kinds", async () => {
    const result = await syncMiniCaseResponses({
      [MOCK_CASE_ID]: record(1, "2026-08-17T10:00:00.000Z"),
      [LIVE_CASE_ID]: record(3, "2026-08-17T10:00:00.000Z")
    });

    expect(result.pushed).toEqual([LIVE_CASE_ID]);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("converges on the server when it already holds a different result", async () => {
    const stale = record(1, "2026-08-01T10:00:00.000Z");
    const server = {
      content_item_id: LIVE_CASE_ID,
      score: 1,
      score_max: 3,
      selections: { "question-1": "option-b" },
      completed_at: "2026-08-16T09:00:00.000Z",
      created_at: "2026-08-16T09:00:00.000Z"
    };

    fromMock.mockImplementation(() => ({
      ...query(() => ({ data: [server], error: null })),
      upsert: (...args: unknown[]) => upsertMock(...args)
    }));

    const result = await syncMiniCaseResponses({ [LIVE_CASE_ID]: stale });

    expect(result.merged[LIVE_CASE_ID]).toEqual({
      selections: { "question-1": "option-b" },
      score: 3,
      total: 3,
      completedAt: "2026-08-16T09:00:00.000Z"
    });
    // Already on the server: nothing to push back.
    expect(result.pushed).toEqual([]);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("reports offline and keeps the device view when the read fails", async () => {
    fromMock.mockImplementation(() => ({
      ...query(() => {
        throw new TypeError("Network request failed");
      }),
      upsert: (...args: unknown[]) => upsertMock(...args)
    }));

    const local = { [LIVE_CASE_ID]: record(2, "2026-08-17T10:00:00.000Z") };
    const result = await syncMiniCaseResponses(local);

    expect(result).toEqual({ merged: local, pushed: [], offline: true });
  });

  it("stays local-only with no session", async () => {
    getAuthSessionMock.mockResolvedValue({ data: null, error: null });

    const local = { [LIVE_CASE_ID]: record(2, "2026-08-17T10:00:00.000Z") };

    expect(await syncMiniCaseResponses(local)).toEqual({
      merged: local,
      pushed: [],
      offline: true
    });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("readMiniCaseResponseAnywhere", () => {
  it("returns the device record for sample content without querying", async () => {
    const local = record(2, "2026-08-17T10:00:00.000Z");

    expect(await readMiniCaseResponseAnywhere(MOCK_CASE_ID, local)).toBe(local);
    expect(fromMock).not.toHaveBeenCalled();
    expect(getAuthSessionMock).not.toHaveBeenCalled();
  });

  it("prefers the server result over a stale local one, without the archive tab", async () => {
    selectResultMock.mockReturnValue({
      data: {
        content_item_id: LIVE_CASE_ID,
        score: 2 / 3,
        score_max: 3,
        selections: { "question-1": "option-c" },
        completed_at: "2026-08-16T09:00:00.000Z",
        created_at: "2026-08-16T09:00:00.000Z"
      },
      error: null
    });

    const result = await readMiniCaseResponseAnywhere(
      LIVE_CASE_ID,
      record(1, "2026-08-01T10:00:00.000Z")
    );

    expect(result).toEqual({
      selections: { "question-1": "option-c" },
      score: 2,
      total: 3,
      completedAt: "2026-08-16T09:00:00.000Z"
    });
  });

  it("falls back to the device record when the server has nothing or is unreachable", async () => {
    const local = record(3, "2026-08-17T10:00:00.000Z");

    selectResultMock.mockReturnValue({ data: null, error: null });
    expect(await readMiniCaseResponseAnywhere(LIVE_CASE_ID, local)).toBe(local);

    selectResultMock.mockImplementation(() => {
      throw new TypeError("Network request failed");
    });
    await expect(readMiniCaseResponseAnywhere(LIVE_CASE_ID, local)).resolves.toBe(local);
  });
});

describe("fetchRemoteMiniCaseResponses", () => {
  it("keys the server view by content item id", async () => {
    fromMock.mockImplementation(() =>
      query(() => ({
        data: [
          {
            content_item_id: OTHER_LIVE_CASE_ID,
            score: 1,
            score_max: 3,
            selections: {},
            completed_at: "2026-08-10T08:00:00.000Z",
            created_at: null
          }
        ],
        error: null
      }))
    );

    const result = await fetchRemoteMiniCaseResponses("user-1");

    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.responses)).toEqual([OTHER_LIVE_CASE_ID]);
  });
});
