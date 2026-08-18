import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a finished mini case does to storage.
 *
 * The regression: a sample/demo case (text id) reached pushMiniCaseResponse and
 * therefore mini_case_responses.content_item_id, which is a UUID — a guaranteed
 * 22P02. The record must still be kept on the device; only the push is refused.
 *
 * The second rule tested here is which side wins in the device cache: the
 * reader's own freshly recorded result is never overwritten, but a record that
 * came from the server is, because Supabase is the source of truth.
 */

const MOCK_CASE_ID = "mini-case-2026-04-26-fr-ai-notes";
const LIVE_CASE_ID = "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c";

const storage = new Map<string, string>();
const pushMiniCaseResponseMock = vi.fn();
const getAuthSessionMock = vi.fn();

vi.stubGlobal("__DEV__", true);

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storage.get(key) ?? null),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }
  }
}));

vi.mock("../../lib/supabase", () => ({
  getAuthSession: () => getAuthSessionMock()
}));

vi.mock("./miniCaseSync", () => ({
  pushMiniCaseResponse: (...args: unknown[]) => pushMiniCaseResponseMock(...args)
}));

const {
  readAllMiniCaseResponses,
  readMiniCaseResponse,
  writeLocalMiniCaseResponses,
  writeMiniCaseResponse
} = await import("./miniCaseResponses");

const firstResult = {
  selections: { "question-1": "option-a" },
  score: 1,
  total: 3,
  completedAt: "2026-08-01T10:00:00.000Z"
};

const serverResult = {
  selections: { "question-1": "option-c" },
  score: 3,
  total: 3,
  completedAt: "2026-08-16T09:00:00.000Z"
};

beforeEach(() => {
  storage.clear();
  pushMiniCaseResponseMock.mockReset();
  getAuthSessionMock.mockReset();

  pushMiniCaseResponseMock.mockResolvedValue(true);
  getAuthSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("writeMiniCaseResponse", () => {
  it("keeps a sample-content result on the device and never pushes it", async () => {
    await writeMiniCaseResponse(MOCK_CASE_ID, firstResult);

    expect(await readMiniCaseResponse(MOCK_CASE_ID)).toEqual(firstResult);
    expect(pushMiniCaseResponseMock).not.toHaveBeenCalled();
    // No session is even read: nothing about a mock case concerns the server.
    expect(getAuthSessionMock).not.toHaveBeenCalled();
  });

  it("stores and pushes a real content item", async () => {
    await writeMiniCaseResponse(LIVE_CASE_ID, firstResult);

    expect(await readMiniCaseResponse(LIVE_CASE_ID)).toEqual(firstResult);
    expect(pushMiniCaseResponseMock).toHaveBeenCalledWith("user-1", LIVE_CASE_ID, firstResult);
  });

  it("records one finished case exactly once, however often the effect re-runs", async () => {
    await writeMiniCaseResponse(LIVE_CASE_ID, firstResult);
    await writeMiniCaseResponse(LIVE_CASE_ID, { ...firstResult, score: 3 });

    expect(await readMiniCaseResponse(LIVE_CASE_ID)).toEqual(firstResult);
    expect(pushMiniCaseResponseMock).toHaveBeenCalledTimes(1);
  });

  it("still stores the result when there is no session to push with", async () => {
    getAuthSessionMock.mockResolvedValue({ data: null, error: null });

    await writeMiniCaseResponse(LIVE_CASE_ID, firstResult);

    expect(await readMiniCaseResponse(LIVE_CASE_ID)).toEqual(firstResult);
    expect(pushMiniCaseResponseMock).not.toHaveBeenCalled();
  });
});

describe("writeLocalMiniCaseResponses", () => {
  it("does not let a device write overwrite an existing record", async () => {
    await writeLocalMiniCaseResponses({ [LIVE_CASE_ID]: firstResult });
    await writeLocalMiniCaseResponses({ [LIVE_CASE_ID]: serverResult });

    expect(await readMiniCaseResponse(LIVE_CASE_ID)).toEqual(firstResult);
  });

  it("lets a server record replace a stale local one", async () => {
    await writeLocalMiniCaseResponses({ [LIVE_CASE_ID]: firstResult });
    await writeLocalMiniCaseResponses(
      { [LIVE_CASE_ID]: serverResult },
      { origin: "server" }
    );

    expect(await readMiniCaseResponse(LIVE_CASE_ID)).toEqual(serverResult);
  });

  it("keeps every stored case readable, sample ones included", async () => {
    await writeLocalMiniCaseResponses({
      [MOCK_CASE_ID]: firstResult,
      [LIVE_CASE_ID]: serverResult
    });

    expect(await readAllMiniCaseResponses()).toEqual({
      [MOCK_CASE_ID]: firstResult,
      [LIVE_CASE_ID]: serverResult
    });
  });

  it("survives unreadable storage instead of throwing", async () => {
    storage.set("personews:mini-case-responses:v1", "{ not json");

    expect(await readAllMiniCaseResponses()).toEqual({});
  });
});
