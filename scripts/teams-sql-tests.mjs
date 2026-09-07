#!/usr/bin/env node
/**
 * Run the Teams / scored-questions SQL suite.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run teams:test:sql
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run teams:test:sql -- --staging
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run teams:test:sql -- --with-migrations
 *
 * Same harness as scripts/language-sql-tests.mjs. The suite is one transaction
 * ending in ROLLBACK: it creates throwaway readers, teams, editions, questions
 * and attempts, exercises the RLS and scoring contract, and leaves the database
 * byte-for-byte as it found it.
 *
 * --with-migrations prepends the six Teams migrations to the same transaction,
 * so the whole thing — schema and contract — is validated against a real
 * Postgres and then rolled back. That is how to check the migrations WITHOUT
 * applying them: nothing is committed, so the database is unchanged whether the
 * suite passes or fails. Use it before ever running `supabase db push`.
 *
 * Default target is staging, deliberately: production should only ever see
 * these migrations after they have passed here.
 */

const MIGRATIONS = [
  "supabase/migrations/20260906090000_edition_registry.sql",
  "supabase/migrations/20260906091000_player_identity.sql",
  "supabase/migrations/20260906092000_teams_foundation.sql",
  "supabase/migrations/20260906093000_scored_questions.sql",
  "supabase/migrations/20260906094000_question_attempts_and_scoring.sql",
  "supabase/migrations/20260906095000_realtime_and_moderation.sql",
];

const SUITE_FILE = "supabase/tests/teams_and_scored_questions.test.sql";

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
const label = `Teams & scored questions (${project.name}${withMigrations ? ", migrations inlined" : ""})`;

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
