#!/usr/bin/env node
/**
 * Local publisher benchmark: per-reader (v1) vs set-based, at several reader
 * counts. LOCAL STACK ONLY (lib/local-db.mjs addresses the database container by
 * name; there is no connection string to point elsewhere), and every run is one
 * transaction that ends in ROLLBACK.
 *
 *   node scripts/publisher-benchmark.mjs            # 100 1000 10000
 *   node scripts/publisher-benchmark.mjs 500 5000
 *
 * Migrations from the unapplied tail up to 20261005160000 are inlined, the
 * per-reader publisher is kept as _v1 (tests/fixtures/keep_publisher_v1.sql),
 * then the set-based one is inlined — exactly as the parity suite does.
 */

import { readFile } from "node:fs/promises";

import { dbContainer, runSql } from "./lib/local-db.mjs";
import { teamsMigrationFiles, versionOf } from "./lib/teams-migrations.mjs";

const FROM = "20260908090000";
const SET_BASED = "supabase/migrations/20261005160000_set_based_publisher.sql";
const KEEP_V1 = "supabase/tests/fixtures/keep_publisher_v1.sql";

const strip = (body) =>
  body
    .replace(/^\s*BEGIN;\s*$/gim, "")
    .replace(/^\s*COMMIT;\s*$/gim, "")
    .replace(/^\s*NOTIFY pgrst.*$/gim, "");

const counts = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const scales = counts.length > 0 ? counts : [100, 1000, 10000];

const bodies = [];
for (const path of await teamsMigrationFiles()) {
  const version = versionOf(path.split("/").pop());
  if (version < FROM || version >= "20261005160000") continue;
  bodies.push(strip(await readFile(path, "utf8")));
}
bodies.push(strip(await readFile(KEEP_V1, "utf8")));
bodies.push(strip(await readFile(SET_BASED, "utf8")));

const template = await readFile("supabase/tests/benchmarks/publisher_benchmark.sql", "utf8");
const sql = template.replace(/^begin;/im, () => `begin;\n\n${bodies.join("\n\n")}\n`);
const container = await dbContainer();

console.log("publisher           readers        ms    drops    items");
for (const readers of scales) {
  const result = await runSql(sql, { container, variables: { readers } });

  if (!result.ok) {
    console.error(result.stderr);
    process.exit(1);
  }

  for (const [publisher, n, ms, drops, items] of result.rows.slice(-2)) {
    console.log(
      `${publisher.padEnd(18)} ${String(n).padStart(8)} ${String(ms).padStart(9)} ${String(drops).padStart(8)} ${String(items).padStart(8)}`,
    );
  }
}
