import { describe, expect, it, vi } from "vitest";

import {
  BOOT_LANGUAGE_STORAGE_KEY,
  parseBootLanguage,
  readBootLanguage,
  resolveBootLanguage,
  writeBootLanguage,
  type BootLanguageStorage
} from "./bootLanguage";
import { localized, localizedOrNull } from "./i18n";

/**
 * The first sentence the app says.
 *
 * The device bug: a French account opened on "Loading your session", in
 * English, and only became French once the profile query came back. The cause
 * was structural rather than a bad string — `profiles.language` is the single
 * source of truth and it does not exist yet at that moment, and the fallback
 * for "unknown" was English.
 *
 * The rule these cases pin: the launch screen speaks the reader's language or
 * it speaks no language at all. It never guesses.
 */

function memoryStorage(initial?: Record<string, string>): BootLanguageStorage & {
  values: Record<string, string>;
} {
  const values: Record<string, string> = { ...initial };

  return {
    values,
    getItem: async (key) => values[key] ?? null,
    setItem: async (key, value) => {
      values[key] = value;
    }
  };
}

describe("parseBootLanguage", () => {
  it("accepts only the two languages the app ships", () => {
    expect(parseBootLanguage("fr")).toBe("fr");
    expect(parseBootLanguage("en")).toBe("en");
  });

  it("treats anything else as unknown", () => {
    for (const value of [null, undefined, "", "de", "FR", "fr-FR", "{}"]) {
      expect(parseBootLanguage(value)).toBeNull();
    }
  });
});

describe("resolveBootLanguage", () => {
  it("prefers the hydrated profile over anything cached", () => {
    // The canonical answer always wins, so a language change or a different
    // account signing in can never be overridden by a stale cache.
    expect(
      resolveBootLanguage({ profileLanguage: "en", cachedLanguage: "fr" })
    ).toBe("en");
    expect(
      resolveBootLanguage({ profileLanguage: "fr", cachedLanguage: "en" })
    ).toBe("fr");
  });

  it("falls back to the last language this device saw", () => {
    expect(
      resolveBootLanguage({ profileLanguage: null, cachedLanguage: "fr" })
    ).toBe("fr");
    expect(
      resolveBootLanguage({ profileLanguage: undefined, cachedLanguage: "en" })
    ).toBe("en");
  });

  it("reports unknown rather than defaulting to a language", () => {
    expect(
      resolveBootLanguage({ profileLanguage: null, cachedLanguage: null })
    ).toBeNull();
  });
});

describe("the boot language cache", () => {
  it("round-trips the language the profile resolved to", async () => {
    const storage = memoryStorage();

    await writeBootLanguage(storage, "fr");

    expect(storage.values[BOOT_LANGUAGE_STORAGE_KEY]).toBe("fr");
    expect(await readBootLanguage(storage)).toBe("fr");
  });

  it("follows a language change on the next start", async () => {
    const storage = memoryStorage();

    // FR → EN, then a restart.
    await writeBootLanguage(storage, "fr");
    await writeBootLanguage(storage, "en");
    expect(await readBootLanguage(storage)).toBe("en");

    // EN → FR, then a restart.
    await writeBootLanguage(storage, "fr");
    expect(await readBootLanguage(storage)).toBe("fr");
  });

  it("reads unknown, never a language, when storage fails", async () => {
    const storage: BootLanguageStorage = {
      getItem: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(async () => undefined)
    };

    // A private-mode / corrupted-storage device gets the neutral launch screen,
    // not an English one.
    expect(await readBootLanguage(storage)).toBeNull();
  });

  it("never throws when the write fails", async () => {
    const storage: BootLanguageStorage = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {
        throw new Error("disk full");
      })
    };

    await expect(writeBootLanguage(storage, "fr")).resolves.toBe(false);
  });

  it("ignores a value written by something other than this cache", async () => {
    const storage = memoryStorage({ [BOOT_LANGUAGE_STORAGE_KEY]: "es" });

    expect(await readBootLanguage(storage)).toBeNull();
  });
});

describe("localizedOrNull", () => {
  const copy = { en: "Premium educational app", fr: "Application éducative premium" };

  it("answers in the language it is given", () => {
    expect(localizedOrNull(copy, "fr")).toBe("Application éducative premium");
    expect(localizedOrNull(copy, "en")).toBe("Premium educational app");
  });

  it("answers nothing when the language is unknown", () => {
    // This is the whole difference from `localized`, which resolves unknown to
    // English and is what put an English sentence in front of a French reader.
    expect(localizedOrNull(copy, null)).toBeNull();
    expect(localizedOrNull(copy, undefined)).toBeNull();
    expect(localized(copy, null)).toBe("Premium educational app");
  });
});
