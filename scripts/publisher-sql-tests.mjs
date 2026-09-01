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
 */

const SUITES = [
  {
    name: "staging hard gate",
    ref: "kukyotcgbnchsoeriqoz",
    file: "supabase-staging/supabase/tests/scheduled_publication_gate.test.sql",
  },
  {
    name: "production publisher refusals",
    ref: "wkbviidrbmehmjbhvpeh",
    file: "supabase/tests/scheduled_edition_publication.test.sql",
  },
];

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
  const sql = await readFile(suite.file, "utf8");

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
  const mark = report.failed === 0 ? "✓" : "✗";
  console.log(`${mark} ${suite.name}: ${report.passed}/${report.checks} checks passed`);

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
