#!/usr/bin/env node
/**
 * Run the scheduled-publication SQL suites against the real projects.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run publisher:test:sql
 *
 * Both suites are one transaction ending in ROLLBACK. They build fixtures, ask
 * the real gate and the real production publisher what they think, and leave
 * both databases byte-for-byte as they found them. No editorial content is
 * created, modified or deleted, and nothing is ever published.
 *
 * They run against the live projects on purpose: the rules under test live in
 * SQL functions that exist only there, so a local mock would be testing a copy.
 *
 *   --with-migrations   prepend each suite's unapplied migrations to the same
 *                       transaction, so schema AND contract are validated
 *                       against a real Postgres and then rolled back.
 *
 * That flag is how a migration is checked WITHOUT applying it: nothing is
 * committed, so both databases are unchanged whether the suite passes or fails.
 * Use it before ever running `supabase db push`.
 */

const SUITES = [
  {
    name: "staging hard gate",
    ref: "kukyotcgbnchsoeriqoz",
    file: "supabase-staging/supabase/tests/scheduled_publication_gate.test.sql",
    // Unapplied staging migrations the suite depends on, in apply order.
    migrations: ["supabase-staging/supabase/migrations/20260906110000_scored_question_preflight.sql"],
  },
  {
    name: "production publisher refusals",
    ref: "wkbviidrbmehmjbhvpeh",
    file: "supabase/tests/scheduled_edition_publication.test.sql",
    migrations: [],
  },
];

const withMigrations = process.argv.includes("--with-migrations");

const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is required.\n" +
      "Create one at https://supabase.com/dashboard/account/tokens and export it for this command only.",
  );
  process.exit(2);
}

const { readFile } = await import("node:fs/promises");

let failed = 0;

for (const suite of SUITES) {
  let sql = await readFile(suite.file, "utf8");

  if (withMigrations && suite.migrations.length > 0) {
    const bodies = [];

    for (const path of suite.migrations) {
      const body = await readFile(path, "utf8");

      // Each migration wraps itself in BEGIN/COMMIT. Inside a suite they have to
      // share the ONE transaction the suite rolls back, so their own transaction
      // control is stripped.
      bodies.push(
        body
          .replace(/^\s*BEGIN;\s*$/gim, "")
          .replace(/^\s*COMMIT;\s*$/gim, "")
          .replace(/^\s*NOTIFY pgrst.*$/gim, ""),
      );
    }

    // A replacer FUNCTION, never a replacement string: `String.replace` reads
    // `$$` in a replacement as a substitution pattern, and every dollar-quoted
    // function body in a migration would reach Postgres mangled.
    const inlined = `begin;\n\n${bodies.join("\n\n")}\n`;
    sql = sql.replace(/^begin;/im, () => inlined);
  }

  const response = await fetch(`https://api.supabase.com/v1/projects/${suite.ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error(`✗ ${suite.name}: ${body?.message ?? JSON.stringify(body)}`);
    failed += 1;
    continue;
  }

  const report = Array.isArray(body) ? body[0] : body;

  if (!report || typeof report.checks !== "number") {
    console.error(`✗ ${suite.name}: unexpected response ${JSON.stringify(body).slice(0, 400)}`);
    failed += 1;
    continue;
  }

  const mark = report.failed === 0 ? "✓" : "✗";
  const label = withMigrations && suite.migrations.length > 0
    ? `${suite.name} (migrations inlined)`
    : suite.name;
  console.log(`${mark} ${label}: ${report.passed}/${report.checks} checks passed`);

  if (report.failed > 0) {
    failed += 1;
    for (const failure of report.failures ?? []) {
      console.log(`    ${failure.test}`);
      console.log(`      expected: ${failure.expected}`);
      console.log(`      observed: ${failure.observed}`);
    }
  }
}

process.exit(failed === 0 ? 0 : 1);
