#!/usr/bin/env node
/**
 * Build the isolated project directory that deploys the notification hotfix —
 * and ONLY the notification hotfix — to production.
 *
 *   node scripts/notification-hotfix-workdir.mjs
 *
 * WHY THIS EXISTS
 *
 * `supabase db push` has no way to name a file. Its flags are --dry-run,
 * --include-all, --include-roles, --include-seed, --linked, --local, --db-url
 * and --password; there is no --include <file>, and there never was. What it
 * pushes is "every local migration the remote history table has not recorded",
 * so from this repository it would push every unapplied migration at once, most
 * of them Teams:
 *
 *   $ supabase db push --dry-run --linked
 *   Would push these migrations:
 *    • 20260906080000_fix_push_notification_claim_ambiguity.sql
 *    • 20260906081000_notification_outbox.sql
 *    • 20260906082000_notification_dispatch_cron.sql
 *    • 20260906090000_edition_registry.sql
 *    • …the rest of the Teams batch…
 *    • 20260906102000_team_ownership_and_deletion.sql
 *
 * A production notification hotfix must not carry Teams with it. The isolation
 * is the project directory, not a flag: `--workdir` points the CLI at a
 * directory whose pending set is exactly the three notification migrations.
 *
 * WHAT THE DIRECTORY HAS TO CONTAIN, AND WHY IT IS NOT JUST THE THREE
 *
 * A directory holding only the three does not work, and the way it fails is
 * worth writing down because the CLI's own advice is the thing we must not do:
 *
 *   $ supabase db push --dry-run --linked --workdir <only-the-three>
 *   Remote migration versions not found in local migrations directory.
 *   … try repairing the migration history table:
 *   supabase migration repair --status reverted 20260202160716 …41 versions…
 *
 * `db push` refuses to run against a history containing versions it cannot see
 * locally, and offers to mark all forty-one applied migrations as reverted —
 * telling Supabase that work it did is work it did not do. That is a lie about
 * production and it is not on the table.
 *
 * So the directory is the whole history MINUS the Teams batch: every migration
 * this repository has, except the nine that are not part of this hotfix. Then
 * every remote version is present locally, nothing is repaired, nothing is
 * reverted, and the pending set — what is local and not remote — is exactly the
 * three notification migrations.
 *
 * Nothing here fakes history. Each of the three is genuinely executed and
 * genuinely recorded, under the same version string this repository uses, so a
 * later `db push` from the repository sees them as applied and skips them. No
 * `migration repair`, no hand-written schema_migrations row.
 *
 * WHY THE ORDER MATTERS
 *
 * These three sort BEFORE the Teams batch (0800–0820 against 0900–1020). That
 * is deliberate and it is what keeps the second deployment ordinary: after the
 * hotfix, the newest applied version is 20260906082000, every Teams migration is
 * still newer than it, and pushing them is a plain forward push. Had the hotfix
 * sorted last, the Teams batch would afterwards be "out of order" and would need
 * --include-all — the one flag whose entire job is to sweep up everything the
 * remote has not seen. The ordering is what makes that flag unnecessary.
 *
 * They can be ordered first because they depend on nothing in Teams: the three
 * touch push_notification_deliveries, daily_drops and notification_outbox, all
 * of which exist independently of it, and no Teams migration reads a push table.
 *
 * This script writes a directory and prints commands. It runs none of them.
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PRODUCTION_REF = "wkbviidrbmehmjbhvpeh";

/** In apply order, which is also filename order. */
const HOTFIX = [
  "20260906080000_fix_push_notification_claim_ambiguity.sql",
  "20260906081000_notification_outbox.sql",
  "20260906082000_notification_dispatch_cron.sql",
];

/**
 * The Teams batch, which must NOT ride along. Named one by one rather than
 * matched by a date prefix: a range would have silently swept up the three above,
 * which carry the same date, and a future migration landing on a Teams-shaped
 * filename must be an explicit decision rather than an accident of pattern
 * matching.
 *
 * Naming them one by one has a cost, and the guard below is what pays it: a new
 * Teams migration added to supabase/migrations and forgotten here would be
 * *included*, and the hotfix push would carry it to production. That is the one
 * outcome this whole script exists to prevent, so it is checked rather than
 * remembered.
 */
const EXCLUDED = [
  "20260906090000_edition_registry.sql",
  "20260906091000_player_identity.sql",
  "20260906092000_teams_foundation.sql",
  "20260906093000_scored_questions.sql",
  "20260906094000_question_attempts_and_scoring.sql",
  "20260906095000_realtime_and_moderation.sql",
  "20260906100000_publish_scored_questions.sql",
  "20260906101000_avatar_storage.sql",
  "20260906102000_team_ownership_and_deletion.sql",
  "20260906103000_team_content_assignments.sql",
  "20260906104000_edition_assignment_engine.sql",
  "20260906105000_verify_edition_game.sql",
  "20260906106000_team_read_surface_and_invite.sql",
];

const outFlag = process.argv.indexOf("--out");
const outDir = resolve(
  repoRoot,
  outFlag !== -1 ? process.argv[outFlag + 1] : ".supabase-hotfix/notification",
);

const source = join(repoRoot, "supabase", "migrations");
const target = join(outDir, "supabase", "migrations");

const all = readdirSync(source).filter((name) => name.endsWith(".sql")).sort();
const included = all.filter((name) => !EXCLUDED.includes(name));
const pending = included.filter((name) => HOTFIX.includes(name));

// If any of these three is missing the directory would push nothing and the
// operator would read "Finished" as success.
if (pending.length !== HOTFIX.length) {
  console.error(`✗ expected ${HOTFIX.length} hotfix migrations, found ${pending.length}`);
  process.exit(1);
}

// If an excluded name has been renamed, EXCLUDED silently stops excluding it and
// a Teams migration rides along on the next push. That must fail here, loudly.
const missingExclusions = EXCLUDED.filter((name) => !all.includes(name));
if (missingExclusions.length > 0) {
  console.error(`✗ these are no longer in supabase/migrations, so excluding them is meaningless:`);
  for (const name of missingExclusions) console.error(`    ${name}`);
  console.error("  Update EXCLUDED in this script before deploying anything.");
  process.exit(1);
}

// Anything dated 2026-09-06 or later that is neither the hotfix nor an explicit
// exclusion. Such a file would be copied in, would be absent from the remote
// history, and would therefore be pushed alongside the hotfix. Refuse to build
// the directory at all rather than produce one that looks right.
const unclassified = all.filter(
  (name) => name >= "20260906080000" && !HOTFIX.includes(name) && !EXCLUDED.includes(name),
);

if (unclassified.length > 0) {
  console.error("✗ these migrations are neither the hotfix nor excluded, so they would be pushed with it:");
  for (const name of unclassified) console.error(`    ${name}`);
  console.error("  Add each one to EXCLUDED (or to HOTFIX, deliberately) before deploying anything.");
  process.exit(1);
}

rmSync(join(outDir, "supabase", "migrations"), { recursive: true, force: true });
mkdirSync(target, { recursive: true });

writeFileSync(
  join(outDir, "supabase", "config.toml"),
  `# Generated by scripts/notification-hotfix-workdir.mjs. Do not edit; do not commit.
#
# A project directory that exists only so that "every migration the remote has
# not recorded" means the three notification migrations and nothing else. Its
# migrations are byte-identical copies of supabase/migrations at the repository
# root, minus the Teams batch.
project_id = "personewsap-notification-hotfix"
`,
);

for (const name of included) {
  copyFileSync(join(source, name), join(target, name));

  const original = readFileSync(join(source, name));
  const copy = readFileSync(join(target, name));

  if (!original.equals(copy)) {
    console.error(`✗ ${name} did not copy byte-for-byte`);
    process.exit(1);
  }
}

const shown = relative(repoRoot, outDir);

console.log(`✓ ${shown}/supabase/migrations holds ${included.length} migrations:`);
console.log(`    ${all.length - included.length} Teams migrations excluded`);
console.log(`    ${included.length - pending.length} already applied in production, so the CLI has a complete history`);
console.log(`    ${pending.length} pending, which is the hotfix:`);
for (const name of HOTFIX) console.log(`      ${name}`);

console.log(`
Deploy the hotfix, and only the hotfix (SUPABASE_ACCESS_TOKEN must be exported):

  # 1. Point the isolated directory at production.
  supabase link --project-ref ${PRODUCTION_REF} --workdir ${shown}

  # 2. Read what it would do. This must list these three files and NO OTHERS.
  #    If a Teams migration appears here, stop: the directory is wrong.
  supabase db push --dry-run --linked --workdir ${shown}

  # 3. Apply them. No --include-all: there is nothing out of order to include,
  #    and the flag would defeat the point of the directory.
  supabase db push --linked --workdir ${shown}

  # 4. Confirm the remote recorded exactly these three.
  supabase migration list --linked --workdir ${shown}

Then, from the repository root, the Teams batch is a normal forward push whenever
it is separately approved:

  supabase db push --dry-run --linked
  supabase db push --linked
`);
