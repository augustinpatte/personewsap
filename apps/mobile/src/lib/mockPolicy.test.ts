import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveLiveBackendConfigured, resolveMockContentAllowed } from "./mockPolicy";

describe("resolveMockContentAllowed", () => {
  it("allows mock content when a build explicitly opts in", () => {
    expect(
      resolveMockContentAllowed({ isDev: false, envFlag: "true", hasLiveBackend: false })
    ).toBe(true);
    expect(
      resolveMockContentAllowed({ isDev: false, envFlag: "true", hasLiveBackend: true })
    ).toBe(true);
  });

  it("allows mock content in a development build with no live backend", () => {
    expect(
      resolveMockContentAllowed({ isDev: true, envFlag: undefined, hasLiveBackend: false })
    ).toBe(true);
  });

  it("never substitutes mock content when the build points at real Supabase", () => {
    // The Expo Go regression: __DEV__ alone used to be enough, so a two-second
    // network drop replaced a signed-in reader's real edition with samples.
    expect(
      resolveMockContentAllowed({ isDev: true, envFlag: undefined, hasLiveBackend: true })
    ).toBe(false);
    expect(
      resolveMockContentAllowed({ isDev: true, envFlag: "false", hasLiveBackend: true })
    ).toBe(false);
  });

  it("never allows mock content in a production build without the opt-in", () => {
    for (const envFlag of [undefined, "", "false", "1"]) {
      expect(
        resolveMockContentAllowed({ isDev: false, envFlag, hasLiveBackend: false })
      ).toBe(false);
      expect(
        resolveMockContentAllowed({ isDev: false, envFlag, hasLiveBackend: true })
      ).toBe(false);
    }
  });
});

describe("resolveLiveBackendConfigured", () => {
  it("treats real-looking credentials as a live backend", () => {
    expect(
      resolveLiveBackendConfigured({
        url: "https://abcdefghijkl.supabase.co",
        anonKey: "eyJhbGciOiJIUzI1NiJ9.payload.signature"
      })
    ).toBe(true);
  });

  it("does not treat missing or placeholder credentials as a live backend", () => {
    expect(resolveLiveBackendConfigured({ url: undefined, anonKey: undefined })).toBe(false);
    expect(resolveLiveBackendConfigured({ url: "   ", anonKey: "key" })).toBe(false);
    expect(
      resolveLiveBackendConfigured({
        url: "https://your-project.supabase.co",
        anonKey: "your-anon-key"
      })
    ).toBe(false);
    expect(
      resolveLiveBackendConfigured({ url: "https://real.supabase.co", anonKey: "replace-me" })
    ).toBe(false);
  });
});

describe("mock policy wiring", () => {
  const featuresDir = join(__dirname, "..", "features");

  it.each([
    join(featuresDir, "today", "dailyDropData.ts"),
    join(featuresDir, "library", "libraryData.ts")
  ])("data layer %s gates its mock fallbacks behind the policy", (file) => {
    const source = readFileSync(file, "utf8");

    expect(source).toMatch(/allowMockContent/);
  });
});
