import { describe, expect, it } from "vitest";

import { resolveAccountDeletionEndpoint } from "./accountDeletionEndpoint";

const SUPABASE_URL = "https://wkbviidrbmehmjbhvpeh.supabase.co";
const DERIVED = `${SUPABASE_URL}/functions/v1/delete-account`;

describe("resolveAccountDeletionEndpoint", () => {
  it("derives the endpoint from the Supabase URL when no override is set", () => {
    expect(resolveAccountDeletionEndpoint(undefined, SUPABASE_URL)).toBe(DERIVED);
  });

  it("keeps the explicit endpoint when one is configured", () => {
    const override = "https://deletion.personewsap.com/delete";

    expect(resolveAccountDeletionEndpoint(override, SUPABASE_URL)).toBe(override);
  });

  it("treats a blank override as absent rather than as a configured value", () => {
    expect(resolveAccountDeletionEndpoint("   ", SUPABASE_URL)).toBe(DERIVED);
  });

  it("trims a trailing slash instead of producing a double slash", () => {
    expect(resolveAccountDeletionEndpoint(undefined, `${SUPABASE_URL}/`)).toBe(DERIVED);
  });

  // The caller reports deletion as unavailable on "", which is the honest
  // answer for a build that has no Supabase URL either.
  it("returns an empty string when there is nothing to derive from", () => {
    expect(resolveAccountDeletionEndpoint(undefined, undefined)).toBe("");
    expect(resolveAccountDeletionEndpoint("", "")).toBe("");
  });

  it("refuses a Supabase URL that is not a real http(s) URL", () => {
    expect(resolveAccountDeletionEndpoint(undefined, "not-a-url")).toBe("");
    expect(resolveAccountDeletionEndpoint(undefined, "ftp://example.com")).toBe("");
  });
});
