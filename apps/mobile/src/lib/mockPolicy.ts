/**
 * Mock-content policy.
 *
 * Sample/demo content may never stand in for real editorial content. Two
 * separate risks are gated here:
 *
 *  1. A production build must never present demo articles as real. On error or
 *     missing data it shows loading, an honest empty state, or an explicit
 *     error instead.
 *  2. A development build *connected to the real Supabase project* must not
 *     either. This is the regression this rule was tightened for: with
 *     `__DEV__` alone as the condition, a two-second network drop in Expo Go
 *     replaced a signed-in reader's real edition with sample content — and the
 *     interactions performed on that sample content then tried to write mock
 *     ids into production tables.
 *
 * So the rule is: mock content is allowed only when a build explicitly opts in
 * (EXPO_PUBLIC_ALLOW_MOCK_CONTENT=true, used by preview/proof builds and by
 * tests that mock deliberately), or when there is no live backend configured at
 * all — a dev build with no Supabase credentials, where nothing real exists to
 * be replaced. A transient network error against a configured backend now
 * yields an offline/error state or cached data, never fake editorial content.
 */

export function resolveMockContentAllowed(input: {
  isDev: boolean;
  envFlag: string | undefined;
  /** True when this build points at a real Supabase project. */
  hasLiveBackend: boolean;
}): boolean {
  if (input.envFlag === "true") {
    return true;
  }

  // Connected to real data: an offline moment is an offline state, not a mock.
  if (input.hasLiveBackend) {
    return false;
  }

  return input.isDev;
}

/**
 * Whether this build points at a live Supabase project.
 *
 * A deliberately conservative mirror of the validation in lib/supabase.ts:
 * anything that looks like real credentials counts as a live backend, so the
 * mock gate errs towards refusing sample content rather than showing it. Kept
 * here (rather than imported) so this module stays free of React Native
 * imports and directly unit testable.
 */
export function resolveLiveBackendConfigured(input: {
  url: string | undefined;
  anonKey: string | undefined;
}): boolean {
  const url = input.url?.trim() ?? "";
  const anonKey = input.anonKey?.trim() ?? "";

  if (!url || !anonKey) {
    return false;
  }

  return !isPlaceholderValue(url) && !isPlaceholderValue(anonKey);
}

function isPlaceholderValue(value: string): boolean {
  const normalizedValue = value.toLowerCase();

  return (
    normalizedValue.includes("your-project") ||
    normalizedValue.includes("your-anon-key") ||
    normalizedValue.includes("replace-me")
  );
}

export const hasLiveBackendConfigured = resolveLiveBackendConfigured({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
});

export const allowMockContent = resolveMockContentAllowed({
  isDev: typeof __DEV__ !== "undefined" && __DEV__,
  envFlag: process.env.EXPO_PUBLIC_ALLOW_MOCK_CONTENT,
  hasLiveBackend: hasLiveBackendConfigured
});
