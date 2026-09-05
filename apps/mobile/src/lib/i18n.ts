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

/**
 * The value for a language only when the language is actually known.
 *
 * `localized` exists to always return something, and resolves an unknown
 * language to English. That is right for a screen the reader reaches after the
 * app knows who they are, and wrong for the first frames after launch: a French
 * reader would be shown an English sentence before their profile arrives.
 *
 * This returns null instead, so a caller can render nothing — or something
 * language-neutral — rather than guess.
 */
export function localizedOrNull<T>(
  values: LocalizedValue<T>,
  language: Language | null | undefined
): T | null {
  return language === "fr" || language === "en" ? values[language] : null;
}
