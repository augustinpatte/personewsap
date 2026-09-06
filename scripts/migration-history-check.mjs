#!/usr/bin/env node
/**
 * Would `supabase db push` replay anything?
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:migration-check
 *
 * Compares the local migration files of both projects against the remote
 * `supabase_migrations.schema_migrations` history and reports the two things that
 * matter:
 *
 *   pending — a local file with no remote row. `db push` WOULD run it.
 *   orphan  — a remote row with no local file. `db push` refuses to run at all
 *             until this is resolved, because it will not touch a database
 *             holding migrations it cannot see.
 *
 * This exists because `supabase db push --dry-run` needs a direct database
 * connection, and the staging project will not let the CLI mint its temporary
 * login role (`cli_login_postgres`), so it falls back to demanding
 * `SUPABASE_DB_PASSWORD`. This check answers the same question over the
 * Management API, needs no database password, and covers both projects at once.
 *
 * Strictly read-only. It runs one SELECT per project.
 */

import { readdir } from "node:fs/promises";

const PROJECTS = [
  { name: "production", ref: "wkbviidrbmehmjbhvpeh", dir: "supabase/migrations" },
  { name: "staging", ref: "kukyotcgbnchsoeriqoz", dir: "supabase-staging/supabase/migrations" },
];

const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is required.\n" +
      "Create one at https://supabase.com/dashboard/account/tokens and export it for this command only.",
  );
  process.exit(2);
}

async function remoteVersions(ref) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query:
        "select version, coalesce(name,'') as name from supabase_migrations.schema_migrations order by version;",
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`${ref}: ${body?.message ?? JSON.stringify(body)}`);
  }

  return new Map(body.map((row) => [row.version, row.name]));
}

async function localVersions(dir) {
  const files = await readdir(dir);
  return new Map(
    files
      .filter((file) => file.endsWith(".sql"))
      .map((file) => [file.slice(0, file.indexOf("_")), file]),
  );
}

/**
 * Why a version string is not just a sort key.
 *
 * Supabase migration filenames are `YYYYMMDDHHmmss_description.sql`, and the CLI
 * parses that timestamp — `supabase migration list` prints it as a date. A
 * version like `20260906099000` sorts correctly and is not a time: minute 90.
 * Six local versions were written that way, as a sequence rather than a clock,
 * and every one of them was renamed before deployment because none had been
 * applied anywhere. A seventh must not appear unnoticed.
 *
 * Returns null when the version is a real UTC timestamp, and why not otherwise.
 */
function invalidTimestamp(version) {
  if (!/^\d{14}$/.test(version)) return "not 14 digits";

  const [year, month, day, hour, minute, second] = [
    version.slice(0, 4), version.slice(4, 6), version.slice(6, 8),
    version.slice(8, 10), version.slice(10, 12), version.slice(12, 14),
  ].map(Number);

  if (month < 1 || month > 12) return `month ${month}`;
  if (day < 1 || day > 31) return `day ${day}`;
  if (hour > 23) return `hour ${hour}`;
  if (minute > 59) return `minute ${minute}`;
  if (second > 59) return `second ${second}`;

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const round = parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;

  return round ? null : "not a real date";
}

let replayRisk = 0;
let malformed = 0;

for (const project of PROJECTS) {
  const [remote, local] = await Promise.all([remoteVersions(project.ref), localVersions(project.dir)]);

  const pending = [...local.keys()].filter((version) => !remote.has(version)).sort();
  const orphans = [...remote.keys()].filter((version) => !local.has(version)).sort();

  console.log(
    `${pending.length === 0 ? "\u2713" : "\u2717"} ${project.name} (${project.ref}) \u2014 ` +
      `${local.size} local, ${remote.size} remote, ` +
      `${pending.length} pending, ${orphans.length} orphaned`,
  );

  // The question that matters: would anything already applied be run again?
  for (const version of pending) {
    console.log(`    PENDING: ${local.get(version)} \u2014 db push WOULD run this`);
  }

  // A separate condition with a separate severity. An orphan is never replayed —
  // it is already applied — but `db push` refuses to run at all while one exists,
  // because it will not touch a database holding migrations it cannot see.
  if (orphans.length > 0) {
    console.log(
      `    ${orphans.length} applied migration(s) have no local file, so db push is blocked here.`,
    );
    console.log(`    They are already applied and cannot be replayed. To adopt them into the repo,`);
    console.log(`    write each one's recorded statements to ${project.dir}/<version>_<name>.sql.`);
    for (const version of orphans.slice(0, 5)) {
      console.log(`      \u2022 ${version} ${remote.get(version)}`);
    }
    if (orphans.length > 5) console.log(`      \u2026 and ${orphans.length - 5} more`);
  }

  // Filename audit. A version already in the remote history is reported and NOT
  // renamed: the history records that exact string, and changing it locally
  // would orphan the remote row — which is the same lie as a migration repair,
  // told with a `git mv` instead.
  for (const [version, file] of [...local.entries()].sort()) {
    const problem = invalidTimestamp(version);
    if (!problem) continue;

    malformed += 1;

    if (remote.has(version)) {
      console.log(`    MALFORMED: ${file} (${problem}) \u2014 already applied, so LEAVE IT ALONE`);
    } else {
      console.log(`    MALFORMED: ${file} (${problem}) \u2014 unapplied, rename before deploying`);
    }
  }

  if (pending.length > 0) replayRisk += 1;
}

console.log(
  replayRisk === 0
    ? "\nNo migration already applied would be replayed on either project."
    : "\nA local migration is missing from a remote history: db push would run it.",
);

if (malformed > 0) {
  console.log(`${malformed} migration filename(s) are not valid UTC timestamps.`);
}

process.exit(replayRisk === 0 && malformed === 0 ? 0 : 1);
