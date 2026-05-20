import type { Language } from "../types/domain";

export type LocalizedValue<T> = Record<Language, T>;

export function resolveLanguage(language: Language | null | undefined): Language {
  return language === "fr" ? "fr" : "en";
}

export function localized<T>(
  values: LocalizedValue<T>,
  language: Language | null | undefined
): T {
  return values[resolveLanguage(language)];
}

export function formatLanguageName(
  language: Language | null | undefined,
  uiLanguage: Language | null | undefined
) {
  if (language === "fr") {
    return localized({ en: "French", fr: "Français" }, uiLanguage);
  }

  if (language === "en") {
    return localized({ en: "English", fr: "Anglais" }, uiLanguage);
  }

  return localized({ en: "Not set", fr: "Non défini" }, uiLanguage);
}
