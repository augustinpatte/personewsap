import { clearMemoryCache } from "../../lib/memoryCache";

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
 * getLibraryDropsCacheKey, getArchiveSearchCacheKey, getContentItemCacheKey and
 * getContentSourcesCacheKey. They are listed here rather than cleared wholesale
 * so that dropping the cache stays a decision about content, and cannot quietly
 * start throwing away unrelated state.
 */
export const PREFERENCE_SENSITIVE_CACHE_PREFIXES = [
  "today-drop",
  "library-drops",
  "archive-search",
  "content-item",
  "content-sources"
] as const;

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
