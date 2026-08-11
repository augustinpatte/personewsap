import { describe, expect, it } from "vitest";

import {
  LANGUAGE_CHANGE_NOTICE_KEY_V1,
  recordLanguageChangeNotice,
  shouldShowLanguageChangeNotice,
  shouldShowStoredLanguageChangeNotice
} from "./languageChangeNotice";

describe("language change notice", () => {
  it("does not show without a language change notice", () => {
    expect(
      shouldShowLanguageChangeNotice(null, {
        currentLanguage: "en",
        dropDate: "2026-08-10",
        isEditionDay: true,
        isEmptyDrop: true
      })
    ).toBe(false);
  });

  it("shows for today's empty edition after a matching language change", async () => {
    const storage = memoryStorage();
    await recordLanguageChangeNotice(storage, "fr", "2026-08-10");

    await expect(
      shouldShowStoredLanguageChangeNotice(storage, {
        currentLanguage: "fr",
        dropDate: "2026-08-10",
        isEditionDay: true,
        isEmptyDrop: true
      })
    ).resolves.toBe(true);
  });

  it("does not show for a different notice language", () => {
    expect(
      shouldShowLanguageChangeNotice(
        { language: "fr", changedOn: "2026-08-10" },
        {
          currentLanguage: "en",
          dropDate: "2026-08-10",
          isEditionDay: true,
          isEmptyDrop: true
        }
      )
    ).toBe(false);
  });

  it("clears and ignores an old notice", async () => {
    const storage = memoryStorage({
      [LANGUAGE_CHANGE_NOTICE_KEY_V1]: JSON.stringify({
        language: "fr",
        changedOn: "2026-08-09"
      })
    });

    await expect(
      shouldShowStoredLanguageChangeNotice(storage, {
        currentLanguage: "fr",
        dropDate: "2026-08-10",
        isEditionDay: true,
        isEmptyDrop: true
      })
    ).resolves.toBe(false);
    await expect(storage.getItem(LANGUAGE_CHANGE_NOTICE_KEY_V1)).resolves.toBeNull();
  });

  it("clears the notice when a non-empty daily drop is available", async () => {
    const storage = memoryStorage({
      [LANGUAGE_CHANGE_NOTICE_KEY_V1]: JSON.stringify({
        language: "fr",
        changedOn: "2026-08-10"
      })
    });

    await expect(
      shouldShowStoredLanguageChangeNotice(storage, {
        currentLanguage: "fr",
        dropDate: "2026-08-10",
        isEditionDay: true,
        isEmptyDrop: false
      })
    ).resolves.toBe(false);
    await expect(storage.getItem(LANGUAGE_CHANGE_NOTICE_KEY_V1)).resolves.toBeNull();
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
    async removeItem(key: string) {
      values.delete(key);
    }
  };
}
