/**
 * Which migration files make up the Teams / scored-questions feature.
 *
 * This used to be a hand-written array, and it was wrong: three migrations
 * (publish_scored_questions, avatar_storage, team_ownership_and_deletion) were
 * never added to it, so `teams:test:sql -- --with-migrations` validated ten
 * migrations and reported success for thirteen. A list that has to be edited
 * every time a migration is written is a list that will be wrong again.
 *
 * So the set is derived instead. The rule is a boundary, not a pattern match:
 * the Teams work begins at 20260906090000_edition_registry, and every migration
 * from that version onward belongs to it. Ordering is the filename order the
 * Supabase CLI itself uses, so what is replayed here is what `db reset` would
 * replay, in the same sequence.
 *
 * The boundary is deliberately a floor and not a range. A migration written
 * after the feature lands is still part of the unapplied tail that has to be
 * proven before it reaches a remote database, so it is included automatically.
 * Nothing before the boundary is ever loaded: those are the historical
 * migrations that are already applied everywhere, and replaying them inside the
 * suite's transaction would prove nothing and fail loudly.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const MIGRATIONS_DIR = "supabase/migrations";

/** The first migration of the Teams / scored-questions feature. */
export const FIRST_TEAMS_VERSION = "20260906090000";

export function versionOf(filename) {
  const underscore = filename.indexOf("_");
  return underscore === -1 ? filename.replace(/\.sql$/, "") : filename.slice(0, underscore);
}

/**
 * Every Teams migration, ascending, as repo-relative paths.
 *
 * Versions are fixed-width digit strings, so a plain string sort is the numeric
 * sort — the same comparison the CLI makes.
 */
export async function teamsMigrationFiles(dir = MIGRATIONS_DIR) {
  const files = await readdir(dir);

  return files
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => versionOf(file) >= FIRST_TEAMS_VERSION)
    .sort()
    .map((file) => join(dir, file));
}
