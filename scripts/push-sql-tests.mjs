#!/usr/bin/env node
/**
 * Run the push-notification claim / outbox SQL suite.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run push:test:sql
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run push:test:sql -- --production
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run push:test:sql:dry
 *
 * Same harness as scripts/teams-sql-tests.mjs. The suite is one transaction
 * ending in ROLLBACK: it creates a throwaway reader, two throwaway devices and
 * their delivery rows, exercises the claim lease and the outbox, and leaves the
 * database byte-for-byte as it found it. Nothing is sent to Expo — the suite
 * never leaves PostgreSQL.
 *
 * --with-migrations prepends the notification migrations to the same
 * transaction, so the schema and the contract are validated against a real
 * Postgres and then rolled back. That is how to check these migrations WITHOUT
 * applying them, and it is the only thing that can prove the 42702 fix before
 * production sees it.
 *
 * Default target is staging, deliberately.
 */

const MIGRATIONS = [
  "supabase/migrations/20260906080000_fix_push_notification_claim_ambiguity.sql",
  "supabase/migrations/20260906081000_notification_outbox.sql",
  // The dispatcher too: it is the only one of the three that can reach outside
  // PostgreSQL, so "does it even parse against the real catalog" is worth more
  // here than anywhere else. Its cron.schedule and any queued net.http_post are
  // rolled back with everything else, and the suite only ever invokes it when it
  // can see there is nothing pending for it to do.
  "supabase/migrations/20260906082000_notification_dispatch_cron.sql",
];

const SUITE_FILE = "supabase/tests/push_notification_claims.test.sql";

const PROJECTS = {
  staging: { name: "staging", ref: "kukyotcgbnchsoeriqoz" },
  production: { name: "production", ref: "wkbviidrbmehmjbhvpeh" },
};

const args = new Set(process.argv.slice(2));
const project = args.has("--production") ? PROJECTS.production : PROJECTS.staging;
const withMigrations = args.has("--with-migrations");

const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is required.\n" +
      "Create one at https://supabase.com/dashboard/account/tokens and export it for this command only.",
  );
  process.exit(2);
}

const { readFile } = await import("node:fs/promises");

let sql = await readFile(SUITE_FILE, "utf8");

if (withMigrations) {
  const bodies = [];

  for (const path of MIGRATIONS) {
    const body = await readFile(path, "utf8");

    // Each migration wraps itself in BEGIN/COMMIT. Inside this suite they have
    // to share the ONE transaction the suite rolls back at the end, so their own
    // transaction control is stripped. NOTIFY is dropped for the same reason:
    // it would fire a schema reload for a schema that is about to disappear.
    bodies.push(
      body
        .replace(/^\s*BEGIN;\s*$/gim, "")
        .replace(/^\s*COMMIT;\s*$/gim, "")
        .replace(/^\s*NOTIFY pgrst.*$/gim, ""),
    );
  }

  // A replacer FUNCTION, never a replacement string. `String.replace` treats
  // `$$`, `$&`, `$1` and friends as substitution patterns in a replacement
  // string, so inlining a migration that dollar-quotes a function body with a
  // bare `$$` silently sends `$` to the database and the suite fails on a
  // syntax error in SQL nobody wrote. The migration text must reach Postgres
  // byte-for-byte or this harness is proving something other than the migration.
  const inlined = `begin;\n\n${bodies.join("\n\n")}\n`;
  sql = sql.replace(/^begin;/im, () => inlined);
}

const response = await fetch(
  `https://api.supabase.com/v1/projects/${project.ref}/database/query`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  },
);

const body = await response.json();
const label = `Push notification claims (${project.name}${withMigrations ? ", migrations inlined" : ""})`;

if (!response.ok) {
  console.error(`✗ ${label}: ${body?.message ?? JSON.stringify(body)}`);
  process.exit(1);
}

const report = Array.isArray(body) ? body[0] : body;

if (!report || typeof report.checks !== "number") {
  console.error(`✗ ${label}: unexpected response ${JSON.stringify(body).slice(0, 400)}`);
  process.exit(1);
}

const mark = report.failed === 0 ? "✓" : "✗";
console.log(`${mark} ${label}: ${report.passed}/${report.checks} checks passed`);

if (report.failed > 0) {
  for (const failure of report.failures ?? []) {
    console.log(`    ${failure.test}`);
    console.log(`      expected: ${failure.expected}`);
    console.log(`      observed: ${failure.observed}`);
  }
  process.exit(1);
}
