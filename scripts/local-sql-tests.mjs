#!/usr/bin/env node
/**
 * Run the SQL contract suites against a LOCAL Supabase stack.
 *
 *   npm run teams:test:sql:local          # Teams & scored questions
 *   npm run db:test:sql:local             # every production suite
 *   npm run staging:test:sql:local        # the staging publication gate
 *   node scripts/local-sql-tests.mjs teams language
 *
 * The remote runners (teams-sql-tests.mjs, push-sql-tests.mjs, …) drive the
 * Supabase Management API and need SUPABASE_ACCESS_TOKEN. This one needs no
 * token and cannot reach a remote project: it talks to the database container
 * the CLI started, addressed by container name (see lib/local-db.mjs).
 *
 * Each suite is one transaction ending in ROLLBACK, so the database is
 * byte-for-byte unchanged whether the run passes or fails — and because the
 * local database was built by `supabase db reset`, a pass here means the suite
 * passed against a schema replayed from zero out of supabase/migrations.
 */

import { readFile } from "node:fs/promises";

import { dbContainer, runSql, runSqlFile } from "./lib/local-db.mjs";

const SUITES = {
  teams: {
    label: "Teams & scored questions",
    file: "supabase/tests/teams_and_scored_questions.test.sql",
    stack: "production",
  },
  language: {
    label: "Profile language switch",
    file: "supabase/tests/profile_language_switch.test.sql",
    stack: "production",
  },
  push: {
    label: "Push notification claims",
    file: "supabase/tests/push_notification_claims.test.sql",
    stack: "production",
  },
  "question-contract": {
    label: "Scored-question contract verification",
    file: "supabase/tests/edition_question_contract.test.sql",
    stack: "production",
  },
  publisher: {
    label: "Scheduled edition publication",
    file: "supabase/tests/scheduled_edition_publication.test.sql",
    stack: "production",
  },
  "staging-gate": {
    label: "Staging publication gate",
    file: "supabase-staging/supabase/tests/scheduled_publication_gate.test.sql",
    stack: "staging",
    // Four functions the staging migrations call live only inside the remote
    // staging project and were never committed. Without stand-ins the suite
    // stops at the first call. Read the harness header before trusting a pass:
    // it says exactly which part of the gate a green run does and does not
    // prove.
    prelude: "supabase-staging/supabase/tests/local_harness.sql",
    // Concatenated into ONE psql session ahead of the suite. It has to be
    // concatenation and not a second prelude run: the fixture is pg_temp, and
    // pg_temp is per-connection — a separate invocation would build it into a
    // session that then disappears.
    with: ["supabase-staging/supabase/tests/lib/edition_fixture.sql"],
    caveat:
      "validate_generation_output is a local stand-in — the editorial rules " +
      "inside the remote definition are NOT covered by this run.",
  },
};

const STACKS = {
  production: { config: "supabase/config.toml", start: "supabase start" },
  staging: {
    config: "supabase-staging/supabase/config.toml",
    start: "supabase start --workdir supabase-staging",
  },
};

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const names = requested.length > 0 ? requested : Object.keys(SUITES);

for (const name of names) {
  if (!SUITES[name]) {
    console.error(`Unknown suite "${name}". Known: ${Object.keys(SUITES).join(", ")}`);
    process.exit(2);
  }
}

let failed = 0;

for (const name of names) {
  const suite = SUITES[name];
  const stack = STACKS[suite.stack];
  const container = await dbContainer(stack.config);

  if (suite.prelude) {
    const prelude = await runSqlFile(suite.prelude, { container });

    if (!prelude.ok) {
      console.log(`✗ ${suite.label} (local ${suite.stack}): prelude ${suite.prelude} failed`);
      console.log((prelude.stderr || "no stderr").trimEnd().split("\n").map((l) => `    ${l}`).join("\n"));
      failed += 1;
      continue;
    }
  }

  const parts = [];
  for (const path of [...(suite.with ?? []), suite.file]) {
    parts.push(await readFile(path, "utf8"));
  }

  const result = await runSql(parts.join("\n"), { container });

  if (!result.ok) {
    console.log(`✗ ${suite.label} (local ${suite.stack})`);
    // psql's own message, unabridged. A truncated SQL error is a guessing game.
    console.log(
      (result.stderr || "no stderr")
        .trimEnd()
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
    failed += 1;
    continue;
  }

  // The report is the last row psql printed: checks, passed, failed, failures.
  const row = result.rows.at(-1);
  const [checks, passed, failures, detail] = row ?? [];

  if (row === undefined || Number.isNaN(Number(checks))) {
    console.log(`✗ ${suite.label} (local ${suite.stack}): no report row`);
    console.log(`    stdout: ${result.stdout.slice(-400)}`);
    failed += 1;
    continue;
  }

  const mark = Number(failures) === 0 ? "✓" : "✗";
  console.log(`${mark} ${suite.label} (local ${suite.stack}): ${passed}/${checks} checks passed`);

  // Printed on a pass as much as on a failure. A caveat that only shows up when
  // something breaks is a caveat nobody reads.
  if (suite.caveat) console.log(`    ! ${suite.caveat}`);

  if (Number(failures) > 0) {
    failed += 1;
    for (const failure of JSON.parse(detail)) {
      console.log(`    ${failure.test}`);
      console.log(`      expected: ${failure.expected}`);
      console.log(`      observed: ${failure.observed}`);
    }
  }
}

if (failed > 0) {
  console.log(`\n${failed} suite(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${names.length} local SQL suite(s) passed.`);
