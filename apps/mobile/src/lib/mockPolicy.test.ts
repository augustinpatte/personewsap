import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveMockContentAllowed } from "./mockPolicy";

describe("resolveMockContentAllowed", () => {
  it("allows mock content in development builds", () => {
    expect(resolveMockContentAllowed({ isDev: true, envFlag: undefined })).toBe(true);
  });

  it("allows mock content when a build explicitly opts in", () => {
    expect(resolveMockContentAllowed({ isDev: false, envFlag: "true" })).toBe(true);
  });

  it("never allows mock content in a production build without the opt-in", () => {
    expect(resolveMockContentAllowed({ isDev: false, envFlag: undefined })).toBe(false);
    expect(resolveMockContentAllowed({ isDev: false, envFlag: "" })).toBe(false);
    expect(resolveMockContentAllowed({ isDev: false, envFlag: "false" })).toBe(false);
    expect(resolveMockContentAllowed({ isDev: false, envFlag: "1" })).toBe(false);
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
