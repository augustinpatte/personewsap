import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preferences persistence", () => {
  it("does not directly update profiles.language from saveEditablePreferences", () => {
    const source = readFileSync("apps/mobile/src/features/preferences/preferencesPersistence.ts", "utf8");
    const saveFunctionBody = source.slice(
      source.indexOf("export async function saveEditablePreferences"),
      source.indexOf("/**\n * Persist only the reading language")
    );

    expect(saveFunctionBody).not.toContain('.from("profiles")');
    expect(saveFunctionBody).not.toContain("language: normalized.language");
  });
});
