#!/usr/bin/env node
/**
 * Run the SQL contract suites against a LOCAL Supabase stack.
 *
 *   npm run teams:test:sql:local          # Teams & scored questions
 *   npm run avatars:test:sql:local        # optional player and Team avatars
 *   npm run db:test:sql:local             # every production suite
 *   npm run staging:test:sql:local        # the staging publication gate
 *   node scripts/local-sql-tests.mjs teams language
 *   node scripts/local-sql-tests.mjs avatars --with-migrations
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
 *
 * --with-migrations prepends a suite's own unapplied migrations to that same
 * transaction. It is how a migration is checked WITHOUT applying it: nothing is
 * committed, so the local database is unchanged, and there is no need to
 * `supabase db reset` (and lose local data) just to try a new file. Only suites
 * that declare `migrationsFrom` have anything to prepend.
 */

import { readFile } from "node:fs/promises";

import { dbContainer, runSql, runSqlFile } from "./lib/local-db.mjs";
import { teamsMigrationFiles, versionOf } from "./lib/teams-migrations.mjs";

/**
 * The first migration that has not been applied anywhere yet.
 *
 * `--with-migrations` replays every file from here upward into the suite's own
 * rolled-back transaction. Move it forward when these land — leaving it behind
 * only costs a replay of something already present, until one of those files is
 * later re-shaped in a way Postgres refuses to replay.
 */
const UNAPPLIED_TAIL_VERSION = "20260908090000";

const SUITES = {
  teams: {
    label: "Teams & scored questions",
    file: "supabase/tests/teams_and_scored_questions.test.sql",
    stack: "production",
    // THE UNAPPLIED TAIL, not the whole feature. `--with-migrations` here
    // proves the Teams contract still holds once the files that have not
    // reached this database yet are applied on top of it.
    //
    // Deliberately not FIRST_TEAMS_VERSION, which is what the REMOTE runner
    // uses: that one targets a project where none of the set is applied. On a
    // local database built by `supabase db reset` they all already are, and
    // replaying them raises "cannot change return type of existing function"
    // for the ones a later migration re-shaped — a property of replaying a set
    // on top of itself, and nothing to do with the suite.
    migrationsFrom: UNAPPLIED_TAIL_VERSION,
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
    migrationsFrom: UNAPPLIED_TAIL_VERSION,
  },
  "local-time": {
    label: "Reader-local edition notifications",
    file: "supabase/tests/reader_local_notifications.test.sql",
    stack: "production",
    migrationsFrom: UNAPPLIED_TAIL_VERSION,
  },
  avatars: {
    label: "Optional player avatars & Team avatars",
    file: "supabase/tests/optional_and_team_avatars.test.sql",
    stack: "production",
    // The two migrations this suite is the contract for; see the constant.
    migrationsFrom: UNAPPLIED_TAIL_VERSION,
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

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const withMigrations = flags.has("--with-migrations");
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

  let sql = parts.join("\n");

  if (withMigrations && suite.migrationsFrom) {
    const bodies = [];

    for (const path of await teamsMigrationFiles()) {
      if (versionOf(path.split("/").pop()) < suite.migrationsFrom) continue;

      const body = await readFile(path, "utf8");

      // Each migration wraps itself in BEGIN/COMMIT. Inside this suite they have
      // to share the ONE transaction the suite rolls back at the end, so their
      // own transaction control is stripped — a COMMIT here would apply the
      // migration for real, which is the one thing this mode exists to avoid.
      // NOTIFY goes for the same reason: it would fire a schema reload for a
      // schema that is about to disappear.
      bodies.push(
        body
          .replace(/^\s*BEGIN;\s*$/gim, "")
          .replace(/^\s*COMMIT;\s*$/gim, "")
          .replace(/^\s*NOTIFY pgrst.*$/gim, ""),
      );
    }

    // A replacer FUNCTION, never a replacement string. `String.replace` treats
    // `$$`, `$&` and `$1` as substitution patterns, so a migration that
    // dollar-quotes a function body would reach Postgres mangled and fail on a
    // syntax error in SQL nobody wrote.
    const inlined = `begin;\n\n${bodies.join("\n\n")}\n`;
    sql = sql.replace(/^begin;/im, () => inlined);
  }

  const result = await runSql(sql, { container });

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
  const inlined = withMigrations && suite.migrationsFrom ? ", migrations inlined" : "";
  console.log(
    `${mark} ${suite.label} (local ${suite.stack}${inlined}): ${passed}/${checks} checks passed`,
  );

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
