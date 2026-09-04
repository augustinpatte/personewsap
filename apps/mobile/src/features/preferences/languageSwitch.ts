import type { NormalizedSupabaseError } from "../../lib/supabase";
import type { Language } from "../../types/domain";
import { shouldApplyLanguageSaveResult } from "./languagePersistence";

type PersistLanguageResult = { ok: true } | { ok: false; error: NormalizedSupabaseError };

export type PerformLanguageChangeInput = {
  language: Language;
  previousLanguage: Language;
  userId: string | null;
  /** This attempt's id, from the caller's monotonic counter. */
  requestId: number;
  /** The counter's current value; a newer attempt makes this one stale. */
  getLatestRequestId: () => number;
  /** Apply the language to the app immediately (optimistic, app-wide). */
  applyLanguage: (language: Language) => void;
  /** Persist to the backend (profiles.language via update_profile_language). */
  persistLanguage: (userId: string, language: Language) => Promise<PersistLanguageResult>;
  clearError: () => void;
  showError: (previousLanguage: Language) => void;
  /** Runs only after a confirmed successful save (notice + auth refresh). */
  onPersisted: (language: Language) => Promise<void>;
};

/**
 * The whole language-switch flow, extracted from the Settings screen so the
 * contract is unit-testable:
 *
 *  - the UI switches immediately (optimistic apply);
 *  - a successful save is never reported as a failure;
 *  - a failed save restores the previous language and shows the error, in the
 *    language the reader is back in;
 *  - a save that lost the race to a newer attempt changes nothing;
 *  - with no signed-in user there is nothing to persist and the local switch
 *    stands.
 *
 * Returns true when the selected language is (still) applied.
 */
export async function performLanguageChange(
  input: PerformLanguageChangeInput
): Promise<boolean> {
  input.clearError();
  input.applyLanguage(input.language);

  if (!input.userId) {
    return true;
  }

  const result = await input.persistLanguage(input.userId, input.language);

  if (
    !shouldApplyLanguageSaveResult({
      requestId: input.requestId,
      latestRequestId: input.getLatestRequestId()
    })
  ) {
    return true;
  }

  if (!result.ok) {
    input.applyLanguage(input.previousLanguage);
    input.showError(input.previousLanguage);
    return false;
  }

  await input.onPersisted(input.language);
  return true;
}
