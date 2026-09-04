#!/usr/bin/env node
/**
 * Run the reading-language SQL suite against the production project.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run language:test:sql
 *
 * The suite is one transaction ending in ROLLBACK: it creates throwaway
 * readers, content pairs and editions, exercises update_profile_language and
 * the cross-language RLS/view contract, and leaves the database byte-for-byte
 * as it found it. It asserts the POST-migration contract, so it expects
 * 20260904120000 and 20260904121000 to be applied; before them it fails with
 * the very 42702 those migrations fix.
 *
 * Same harness as scripts/publisher-sql-tests.mjs, kept separate so the
 * publisher gate and the language contract can be run independently.
 */

const SUITE = {
  name: "reading-language switch & cross-language archive",
  ref: "wkbviidrbmehmjbhvpeh",
  file: "supabase/tests/profile_language_switch.test.sql",
};

const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is required.\n" +
      "Create one at https://supabase.com/dashboard/account/tokens and export it for this command only.",
  );
  process.exit(2);
}

const { readFile } = await import("node:fs/promises");

const sql = await readFile(SUITE.file, "utf8");

const response = await fetch(`https://api.supabase.com/v1/projects/${SUITE.ref}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const body = await response.json();

if (!response.ok) {
  console.error(`✗ ${SUITE.name}: ${body?.message ?? JSON.stringify(body)}`);
  process.exit(1);
}

const report = Array.isArray(body) ? body[0] : body;
const mark = report.failed === 0 ? "✓" : "✗";
console.log(`${mark} ${SUITE.name}: ${report.passed}/${report.checks} checks passed`);

if (report.failed > 0) {
  for (const failure of report.failures ?? []) {
    console.log(`    ${failure.test}`);
    console.log(`      expected: ${failure.expected}`);
    console.log(`      observed: ${failure.observed}`);
  }
  process.exit(1);
}
