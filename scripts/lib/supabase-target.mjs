/**
 * The project a script is about to write to, confirmed.
 *
 * Mirrors services/content-engine/src/storage/projectRef.ts for the .mjs
 * scripts that create disposable users or rows in a remote project: they
 * refuse unless EXPECTED_SUPABASE_REF names the project SUPABASE_URL points at
 * (or `local` for a loopback stack).
 */

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?(\/|$)/i;

export function resolveSupabaseTarget(url) {
  if (!url) return null;
  if (LOOPBACK.test(url.trim())) return "local";
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in|net)(\/|$)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

export function assertScriptTarget(scriptName, url, env = process.env) {
  const target = resolveSupabaseTarget(url);
  const expected = env.EXPECTED_SUPABASE_REF?.trim().toLowerCase();

  if (!target) {
    throw new Error(`${scriptName}: ${url ?? "(no URL)"} does not name a Supabase project or a local stack.`);
  }

  if (!expected) {
    throw new Error(
      `${scriptName} writes test users and rows to ${target}. Confirm with EXPECTED_SUPABASE_REF=${target}.`,
    );
  }

  if (expected !== target) {
    throw new Error(
      `${scriptName}: the URL points at ${target}, but EXPECTED_SUPABASE_REF is ${expected}. Refusing to write.`,
    );
  }

  return target;
}
