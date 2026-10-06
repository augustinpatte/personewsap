import { clearMemoryCache } from "../../lib/memoryCache";
import { changedModuleFlags, type ModuleFlags } from "./moduleFlags";

/**
 * What has to be re-read when the reader changes what they follow.
 *
 * Saving preferences used to end at `refreshAuthState()`, which re-reads the
 * profile and nothing else. Every content response is memoised for a minute, so
 * a reader who enabled a module in Settings and walked straight back to it was
 * served the answer computed before the change — the app looked like it had
 * ignored them.
 *
 * These are the cache namespaces built by getTodayDropCacheKey,
 * getLibraryDropsCacheKey and getArchiveSearchCacheKey: the edition and archive
 * LISTS. They are listed here rather than cleared wholesale so that dropping
 * the cache stays a decision about content, and cannot quietly start throwing
 * away unrelated state.
 *
 * Not listed: content-item and content-sources. They are keyed by content id,
 * and a published content row and its sources do not change with anyone's
 * preferences — re-reading an article the reader already opened would cost a
 * request and return the same bytes.
 */
export const PREFERENCE_SENSITIVE_CACHE_PREFIXES = [
  "today-drop",
  "library-drops",
  "archive-search"
] as const;

/**
 * What a saved preference change has to refresh — and nothing else.
 *
 *   module flags      always, in memory (AuthProvider): the module tabs gate on
 *                     them, so a switch shows at once, with no request.
 *   Today + Archive   only when a CONTENT module (newsletter, stories, mini
 *                     cases) was switched. Topics, mini-case topics and article
 *                     counts shape the NEXT edition the publisher assigns;
 *                     nothing the reader already has changes, so there is
 *                     nothing to re-read.
 *   Learning          only when the learning path was switched. The provider
 *                     reacts to its flag itself (LearningPathProvider), so the
 *                     plan only reports it.
 *   auth / profile    a quiet background confirmation (refreshProfile), never
 *                     a blocking re-resolution, so nothing remounts.
 *
 * Unknown "before" flags (never read) are treated as everything changed.
 */
export type PreferenceSaveRefreshPlan = {
  moduleFlags: ModuleFlags;
  reloadEditionContent: boolean;
  learningChanged: boolean;
};

const CONTENT_MODULES = ["newsletter", "business_story", "mini_case"] as const;

export function planPreferenceSaveRefresh(
  before: ModuleFlags | null,
  after: ModuleFlags
): PreferenceSaveRefreshPlan {
  const changed = changedModuleFlags(before, after);

  return {
    moduleFlags: after,
    reloadEditionContent: CONTENT_MODULES.some((moduleId) => changed.includes(moduleId)),
    learningChanged: changed.includes("learning_path")
  };
}

/**
 * Forget every memoised content answer, so the next read asks the server again
 * with the preferences that are now stored.
 *
 * Deliberately narrow. It clears no auth, no session, no interaction history:
 * read/unread and completion live in `content_interactions` and are re-read
 * with the content, so a preference change can never cost the reader progress
 * they already made.
 */
export function clearPreferenceSensitiveContentCache(): void {
  for (const prefix of PREFERENCE_SENSITIVE_CACHE_PREFIXES) {
    clearMemoryCache(prefix);
  }
}
