/**
 * What counts as a real Supabase content item id.
 *
 * public.content_items.id is a UUID, and every column that references it
 * (mini_case_responses.content_item_id, content_interactions.content_item_id,
 * content_item_sources.content_item_id …) is a UUID too. Sample/demo content
 * shipped in src/mocks uses readable text ids such as
 * "mini-case-2026-04-26-fr-ai-notes", which Postgres rejects outright:
 *
 *   22P02 invalid input syntax for type uuid: "mini-case-2026-04-26-fr-ai-notes"
 *
 * That is not a recoverable error — the row can never exist — so the fix is to
 * never send such an id in the first place. Every call site that is about to
 * put an id into a UUID column checks it here.
 *
 * Kept free of any Supabase/React Native import so it can be unit tested
 * directly and used from any layer.
 */

/**
 * Canonical 8-4-4-4-12 hex form, which is what Supabase returns and what
 * Postgres accepts. Deliberately version- and variant-agnostic: rejecting a
 * legitimate server id (a v7 uuid, the nil uuid) would be worse than accepting
 * a well-formed one, and the only thing this must separate is "server id" from
 * "local mock id".
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` may be written to a UUID column of public.content_items. */
export function isSupabaseContentItemId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

/** The subset of `ids` that are real Supabase content item ids. */
export function filterSupabaseContentItemIds(ids: readonly string[]): string[] {
  return ids.filter((id) => isSupabaseContentItemId(id));
}
