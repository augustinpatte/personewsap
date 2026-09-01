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

let replayRisk = 0;

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

  if (pending.length > 0) replayRisk += 1;
}

console.log(
  replayRisk === 0
    ? "\nNo migration already applied would be replayed on either project."
    : "\nA local migration is missing from a remote history: db push would run it.",
);

process.exit(replayRisk === 0 ? 0 : 1);
