import { describe, expect, it } from "vitest";

import { filterSupabaseContentItemIds, isSupabaseContentItemId } from "./contentItemId";

/**
 * The device error this guard exists for:
 *
 *   [MiniCase] could not store result
 *   code 22P02 — invalid input syntax for type uuid:
 *   "mini-case-2026-04-26-fr-ai-notes"
 */
describe("isSupabaseContentItemId", () => {
  it("accepts a canonical Supabase uuid", () => {
    expect(isSupabaseContentItemId("2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c")).toBe(true);
    // Case-insensitive, and version/variant agnostic so a v7 or nil id from the
    // server is never mistaken for mock content.
    expect(isSupabaseContentItemId("2F9B8A1C-4D3E-7F5A-0B6C-7D8E9F0A1B2C")).toBe(true);
    expect(isSupabaseContentItemId("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isSupabaseContentItemId("  2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c  ")).toBe(true);
  });

  it("rejects the sample content ids that caused 22P02", () => {
    expect(isSupabaseContentItemId("mini-case-2026-04-26-fr-ai-notes")).toBe(false);
    expect(isSupabaseContentItemId("mini-case-2026-04-26-en-ai-notes")).toBe(false);
    expect(isSupabaseContentItemId("newsletter-2026-04-26-fr-1")).toBe(false);
  });

  it("rejects anything that is not a well-formed uuid string", () => {
    for (const value of [
      "",
      "   ",
      "2f9b8a1c4d3e4f5a9b6c7d8e9f0a1b2c",
      "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2",
      "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2cc",
      "zzzzzzzz-4d3e-4f5a-9b6c-7d8e9f0a1b2c",
      "{2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c}",
      null,
      undefined,
      42,
      {}
    ]) {
      expect(isSupabaseContentItemId(value)).toBe(false);
    }
  });
});

describe("filterSupabaseContentItemIds", () => {
  it("keeps only the ids a UUID column can accept", () => {
    expect(
      filterSupabaseContentItemIds([
        "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c",
        "mini-case-2026-04-26-fr-ai-notes",
        "8c7d6e5f-4a3b-4c2d-8e1f-0a1b2c3d4e5f"
      ])
    ).toEqual([
      "2f9b8a1c-4d3e-4f5a-9b6c-7d8e9f0a1b2c",
      "8c7d6e5f-4a3b-4c2d-8e1f-0a1b2c3d4e5f"
    ]);
  });

  it("returns nothing for an all-sample edition", () => {
    expect(filterSupabaseContentItemIds(["mini-case-2026-04-26-fr-ai-notes"])).toEqual([]);
  });
});
