import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isLiveContentItem } from "./readerItemSource";

const MOCK_ITEM_ID = "mini-case-2026-04-26-fr-ai-notes";
const LIVE_ITEM_ID = "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c";

describe("isLiveContentItem", () => {
  it("is true only for a Supabase (or cached) item with a uuid id", () => {
    expect(isLiveContentItem("supabase", LIVE_ITEM_ID)).toBe(true);
    expect(isLiveContentItem("cache", LIVE_ITEM_ID)).toBe(true);
  });

  it("is false for a mock fallback, whatever the id looks like", () => {
    // The regression: a network drop returns a mock fallback, and treating it
    // as live made a sample reading write to content_interactions.
    expect(isLiveContentItem("mock", LIVE_ITEM_ID)).toBe(false);
    expect(isLiveContentItem("mock", MOCK_ITEM_ID)).toBe(false);
  });

  it("is false for a sample id even when the fetch claims Supabase", () => {
    expect(isLiveContentItem("supabase", MOCK_ITEM_ID)).toBe(false);
    expect(isLiveContentItem("cache", MOCK_ITEM_ID)).toBe(false);
  });
});

describe("ReaderItemProvider reports the source it was given", () => {
  const source = readFileSync(join(__dirname, "ReaderItemProvider.tsx"), "utf8");

  it("never hardcodes a supabase source into the reader context", () => {
    // It used to build the context with `source: "supabase", error: null`, so a
    // mock fallback was presented to every reader as live data.
    expect(source).not.toMatch(/source:\s*"supabase"/);
    expect(source).toMatch(/source:\s*fetchState\.source/);
    expect(source).toMatch(/error:\s*fetchState\.error/);
  });

  it("keeps the fetch result's own source and error in state", () => {
    expect(source).toMatch(/source:\s*result\.source/);
    expect(source).toMatch(/error:\s*result\.error/);
  });

  it("gates completion writes on the item being live", () => {
    expect(source).toMatch(/isLiveContentItem/);
    expect(source).toMatch(/if \(!persistsCompletion\)/);
  });
});
