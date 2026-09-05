import type { Language } from "../types/domain";

/**
 * The language the launch screen may speak before the profile has loaded.
 *
 * `profiles.language` stays the single source of truth for the app's language:
 * nothing here is ever read as an authority, written back to the server, or
 * used once the profile has arrived. It exists solely because of a
 * bootstrapping gap — on a cold start the app has to render something while it
 * asks Supabase who the reader is, and for that half-second the canonical
 * answer does not exist yet.
 *
 * Before this, the launch screen resolved an unknown language to English, so a
 * French reader was greeted by "Loading your session" and then an entirely
 * French app. The cache closes that gap by remembering the language the
 * reader's own profile last resolved to, on this device.
 *
 * Deliberately minimal: one key, one value, no schema, no migration path. If
 * nothing has been cached yet the launch screen stays language-neutral rather
 * than guessing — a wrong language is worse than no sentence at all.
 */
export const BOOT_LANGUAGE_STORAGE_KEY = "personewsap.boot-language.v1";

export type BootLanguageStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/** A stored value only counts when it is one of the two languages we ship. */
export function parseBootLanguage(raw: string | null | undefined): Language | null {
  return raw === "fr" || raw === "en" ? raw : null;
}

/**
 * Never throws and never rejects: an unreadable cache is the same situation as
 * an empty one — the launch screen stays neutral and the profile answers a
 * moment later.
 */
export async function readBootLanguage(
  storage: BootLanguageStorage
): Promise<Language | null> {
  try {
    return parseBootLanguage(await storage.getItem(BOOT_LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Returns whether the write landed; a failure is not worth telling anyone about. */
export async function writeBootLanguage(
  storage: BootLanguageStorage,
  language: Language
): Promise<boolean> {
  try {
    await storage.setItem(BOOT_LANGUAGE_STORAGE_KEY, language);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the launch screen should speak: the profile when it has arrived, the
 * last language this device saw otherwise, and null when neither is known.
 *
 * The order matters — a hydrated profile always wins, so a cached value can
 * never survive a language change or outlive a different account signing in.
 */
export function resolveBootLanguage(input: {
  profileLanguage: Language | null | undefined;
  cachedLanguage: Language | null | undefined;
}): Language | null {
  return input.profileLanguage ?? input.cachedLanguage ?? null;
}
