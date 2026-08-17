/**
 * Mock-content policy.
 *
 * Sample/demo content may only ever be shown in a development build or when a
 * build explicitly opts in (preview/proof builds via
 * EXPO_PUBLIC_ALLOW_MOCK_CONTENT=true). A production build must never present
 * demo articles as real: on error or missing data it shows loading, an honest
 * empty state, or an explicit error instead.
 */

export function resolveMockContentAllowed(input: {
  isDev: boolean;
  envFlag: string | undefined;
}): boolean {
  return input.isDev || input.envFlag === "true";
}

export const allowMockContent = resolveMockContentAllowed({
  isDev: typeof __DEV__ !== "undefined" && __DEV__,
  envFlag: process.env.EXPO_PUBLIC_ALLOW_MOCK_CONTENT
});
