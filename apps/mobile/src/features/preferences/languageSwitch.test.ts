import { describe, expect, it, vi } from "vitest";

import { performLanguageChange, type PerformLanguageChangeInput } from "./languageSwitch";

/**
 * The language-switch contract the Settings screen relies on:
 * a successful backend save is applied and never reported as an error, a
 * failed save restores the previous language, and a stale response can no
 * longer touch the UI. This is the regression net for the production bug where
 * update_profile_language failed on every call (42702) and the app kept
 * restoring the previous language.
 */

function makeInput(
  overrides: Partial<PerformLanguageChangeInput>
): PerformLanguageChangeInput & {
  applied: string[];
  errors: Array<string | null>;
  persisted: string[];
} {
  const applied: string[] = [];
  const errors: Array<string | null> = [];
  const persisted: string[] = [];

  return {
    applied,
    errors,
    persisted,
    language: "fr",
    previousLanguage: "en",
    userId: "user-1",
    requestId: 1,
    getLatestRequestId: () => 1,
    applyLanguage: (language) => {
      applied.push(language);
    },
    persistLanguage: async (_userId, language) => {
      persisted.push(language);
      return { ok: true as const };
    },
    clearError: () => {
      errors.push(null);
    },
    showError: (previousLanguage) => {
      errors.push(`error:${previousLanguage}`);
    },
    onPersisted: vi.fn(async () => {}),
    ...overrides
  };
}

describe("performLanguageChange", () => {
  it("TEST A/B: a successful save applies the language and confirms it", async () => {
    for (const [from, to] of [
      ["en", "fr"],
      ["fr", "en"]
    ] as const) {
      const input = makeInput({ language: to, previousLanguage: from });

      await expect(performLanguageChange(input)).resolves.toBe(true);

      expect(input.applied).toEqual([to]);
      expect(input.persisted).toEqual([to]);
      expect(input.onPersisted).toHaveBeenCalledWith(to);
      // No error was ever shown.
      expect(input.errors).toEqual([null]);
    }
  });

  it("TEST C: a failed save restores the previous language and says so", async () => {
    const input = makeInput({
      persistLanguage: async () => ({
        ok: false as const,
        error: { code: "42702", message: 'column reference "language" is ambiguous' }
      })
    });

    await expect(performLanguageChange(input)).resolves.toBe(false);

    // Optimistic apply, then rollback to the previous language.
    expect(input.applied).toEqual(["fr", "en"]);
    // The message is shown in the language the reader is back in.
    expect(input.errors).toEqual([null, "error:en"]);
    expect(input.onPersisted).not.toHaveBeenCalled();
  });

  it("TEST D: a successful save is never misreported as a failure", async () => {
    const input = makeInput({});

    await expect(performLanguageChange(input)).resolves.toBe(true);

    expect(input.errors).not.toContainEqual(expect.stringContaining("error"));
    expect(input.applied).toEqual(["fr"]);
  });

  it("a stale response neither restores nor confirms anything", async () => {
    const input = makeInput({
      requestId: 1,
      // A newer attempt (id 2) started while this save was in flight.
      getLatestRequestId: () => 2,
      persistLanguage: async () => ({
        ok: false as const,
        error: { code: "timeout", message: "late failure" }
      })
    });

    await expect(performLanguageChange(input)).resolves.toBe(true);

    // The optimistic apply happened, but the late failure changed nothing.
    expect(input.applied).toEqual(["fr"]);
    expect(input.errors).toEqual([null]);
    expect(input.onPersisted).not.toHaveBeenCalled();
  });

  it("keeps a local-only switch when no user is signed in", async () => {
    const input = makeInput({ userId: null });

    await expect(performLanguageChange(input)).resolves.toBe(true);

    expect(input.applied).toEqual(["fr"]);
    expect(input.persisted).toEqual([]);
    expect(input.onPersisted).not.toHaveBeenCalled();
  });
});
