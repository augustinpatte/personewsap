#!/usr/bin/env node
/**
 * Two REAL concurrent sessions against the canonical publisher.
 *
 *   node scripts/publication-concurrency-test.mjs            # 1 round
 *   node scripts/publication-concurrency-test.mjs --repeat 10
 *   node scripts/publication-concurrency-test.mjs --keep     # keep the scratch db
 *
 * The SQL suites run in ONE session and roll back, so they can prove the
 * per-edition-date lock is TAKEN but not that it holds a second publisher off.
 * This does: two independent psql connections, one holding a publication open,
 * the other provably waiting on the same advisory lock.
 *
 * WHERE IT RUNS. Only in the local Supabase database container, and only in a
 * throwaway database it builds there: a pg_dump/pg_restore of the local
 * `postgres` database, plus the migrations not yet applied locally (from
 * 20260908090000), plus tests/concurrency/edition_lock_fixture.sql. The local
 * `postgres` database is only READ (pg_dump); no remote project is reachable
 * from here (lib/local-db.mjs addresses the container by name). pg_cron can only
 * live in the `postgres` database, so the scratch copy gets a no-op cron stub.
 * The scratch database is dropped at the end unless --keep.
 *
 * NO SLEEPS. Session B's wait is not assumed from elapsed time: the script
 * polls pg_locks until B's backend is seen waiting (granted = false) on the
 * exact advisory key, and only then lets session A commit or roll back.
 */

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

import { dbContainer } from "./lib/local-db.mjs";

const SCRATCH_DB = "personews_concurrency_test";
const FROM_VERSION = "20260908090000";
const SUPERUSER_ENV = ["-e", "PGPASSWORD=postgres"]; // the local stack's documented default
const args = process.argv.slice(2);
const repeat = Math.max(1, Number(args[args.indexOf("--repeat") + 1]) || (args.includes("--repeat") ? 10 : 1));
const keep = args.includes("--keep");
const container = await dbContainer();

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function run(command, commandArgs, stdin) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

/** One-shot query in the scratch db, as postgres. Returns trimmed stdout. */
async function query(sql) {
  const result = await run("docker", [
    "exec", "-i", container, "psql", "-U", "postgres", "-d", SCRATCH_DB, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"
  ], sql);
  if (result.code !== 0) throw new Error(`query failed: ${result.stderr.trim()}\n${sql}`);
  return result.stdout.trim();
}

async function asSuperuser(commandArgs, stdin) {
  return run("docker", ["exec", "-i", ...SUPERUSER_ENV, container, ...commandArgs], stdin);
}

/**
 * A long-lived psql connection. Each statement is followed by an \echo marker
 * carrying :ERROR, :LAST_ERROR_SQLSTATE and :LAST_ERROR_MESSAGE, so a result
 * (or an error) is read from stdout in order, with no timing assumptions.
 */
class Session {
  constructor(name) {
    this.name = name;
    this.buffer = "";
    this.waiters = [];
    this.child = spawn("docker", [
      "exec", "-i", container, "psql", "-U", "postgres", "-d", SCRATCH_DB,
      "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=0"
    ], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
    this.child.stderr.on("data", () => {});
    this.sequence = 0;
  }

  flush() {
    for (;;) {
      const match = this.buffer.match(/__DONE_(\d+)__ (true|false) ([0-9A-Z]*) ?(.*)\n/);
      if (!match) return;
      const body = this.buffer.slice(0, match.index).trim();
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const waiter = this.waiters.shift();
      waiter?.({
        ok: match[2] === "false",
        sqlstate: match[2] === "true" ? match[3] : null,
        message: match[2] === "true" ? match[4] : null,
        output: body
      });
    }
  }

  /** Send a statement; resolves when it has finished (or failed). */
  send(sql) {
    const id = ++this.sequence;
    const done = new Promise((resolve) => this.waiters.push(resolve));
    this.child.stdin.write(`${sql};\n\\echo __DONE_${id}__ :ERROR :LAST_ERROR_SQLSTATE :LAST_ERROR_MESSAGE\n`);
    return done;
  }

  async close() {
    this.child.stdin.end("\\q\n");
    await new Promise((resolve) => this.child.on("close", resolve));
  }
}

/** Poll (no fixed sleep) until `predicate` is true, or fail after `limitMs`. */
async function until(predicate, label, limitMs = 15000) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > limitMs) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Is `pid` waiting (not granted) on the advisory lock pg_advisory_xact_lock(hashtext(key)) takes? */
async function waitingOnAdvisory(pid, key) {
  const answer = await query(`
    select exists (
      select 1 from pg_locks l
      where l.pid = ${Number(pid)} and l.locktype = 'advisory' and not l.granted
        and l.objid::bigint = (hashtext(${quote(key)})::bigint & 4294967295)
    );`);
  return answer === "t";
}

async function holdsAdvisory(pid, key) {
  const answer = await query(`
    select exists (
      select 1 from pg_locks l
      where l.pid = ${Number(pid)} and l.locktype = 'advisory' and l.granted
        and l.objid::bigint = (hashtext(${quote(key)})::bigint & 4294967295)
    );`);
  return answer === "t";
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const uuid = async (seed) => query(`select md5(${quote(seed)})::uuid;`);

const results = [];
function check(round, scenario, name, pass, detail = "") {
  results.push({ round, scenario, name, pass, detail });
  if (!pass) console.log(`  ✗ [${round}] ${scenario}: ${name} ${detail}`);
}

// ---------------------------------------------------------------------------
// The throwaway database
// ---------------------------------------------------------------------------

async function buildScratchDatabase() {
  const dumpPath = "/tmp/personews_concurrency_source.dump"; // inside the container
  const build = await asSuperuser(["sh", "-c", [
    `dropdb -U supabase_admin --if-exists ${SCRATCH_DB}`,
    // Owned by postgres, as the local postgres database is, so `public` has the same ACL.
    `createdb -U supabase_admin -O postgres ${SCRATCH_DB}`,
    `pg_dump -U supabase_admin -d postgres -Fc -f ${dumpPath}`,
    // pg_cron (and one graphql function) cannot be restored outside the postgres
    // database; those errors are expected and stubbed below.
    `pg_restore -U supabase_admin -d ${SCRATCH_DB} ${dumpPath} || true`,
    `rm -f ${dumpPath}`
  ].join(" && ")]);
  if (build.code !== 0) throw new Error(`scratch build failed: ${build.stderr}`);

  const stub = await asSuperuser(["psql", "-U", "supabase_admin", "-d", SCRATCH_DB, "-q", "-v", "ON_ERROR_STOP=1"], `
    create schema if not exists cron;
    create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
    create or replace function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
      language sql as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
    create or replace function cron.schedule(p_schedule text, p_command text) returns bigint
      language sql as $$ insert into cron.job (schedule, command) values (p_schedule, p_command) returning jobid $$;
    create or replace function cron.unschedule(p_job bigint) returns boolean
      language sql as $$ with d as (delete from cron.job where jobid = p_job returning 1) select exists (select 1 from d) $$;
    create or replace function cron.unschedule(p_name text) returns boolean
      language sql as $$ with d as (delete from cron.job where jobname = p_name returning 1) select exists (select 1 from d) $$;
    grant usage on schema cron to postgres;
    grant all on all tables in schema cron to postgres;
    grant all on all sequences in schema cron to postgres;`);
  if (stub.code !== 0) throw new Error(`cron stub failed: ${stub.stderr}`);

  const files = (await readdir("supabase/migrations")).filter((file) => file.endsWith(".sql") && file >= FROM_VERSION).sort();
  for (const file of files) {
    const sql = await readFile(`supabase/migrations/${file}`, "utf8");
    const applied = await run("docker", [
      "exec", "-i", container, "psql", "-U", "postgres", "-d", SCRATCH_DB, "-X", "-q", "-v", "ON_ERROR_STOP=1"
    ], sql);
    if (applied.code !== 0) throw new Error(`${file} failed in the scratch db:\n${applied.stderr}`);
  }

  await query(await readFile("supabase/tests/concurrency/edition_lock_fixture.sql", "utf8"));
  console.log(`scratch db ${SCRATCH_DB}: local restore + ${files.length} migrations + fixture`);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** B1 publishes and holds; B2 for the same date waits on the date lock; B1 commits; B2 is refused. */
async function differentBatch(round, date) {
  const tagA = `r${round}-A`;
  const tagB = `r${round}-B`;
  const b1 = await uuid(`batch:${tagA}`);
  const b2 = await uuid(`batch:${tagB}`);
  const dateKey = `personews:edition:${date}`;
  const a = new Session("A");
  const b = new Session("B");

  try {
    const pidB = (await b.send("select pg_backend_pid()")).output;
    const pidA = (await a.send("select pg_backend_pid()")).output;

    await a.send("begin");
    const published = await a.send(`select concurrency_test.publish(${quote(tagA)}, ${quote(b1)}, ${quote(date)})`);
    check(round, "different-batch", "A publishes B1 inside its open transaction", published.ok, published.message ?? "");
    check(round, "different-batch", "A holds the per-date lock", await holdsAdvisory(pidA, dateKey));

    const raced = b.send(`select concurrency_test.publish(${quote(tagB)}, ${quote(b2)}, ${quote(date)})`);
    let bFinishedEarly = false;
    raced.then(() => (bFinishedEarly = true));
    await until(() => waitingOnAdvisory(pidB, dateKey), "B waiting on the per-date lock");
    check(round, "different-batch", "B is blocked on the SAME per-date advisory lock, not finished", !bFinishedEarly);

    await a.send("commit");
    const refused = await raced;
    const ownership = JSON.parse(await query(`select concurrency_test.ownership(${quote(date)});`));
    const b1Result = JSON.parse(published.output);

    check(round, "different-batch", "B is refused with 55000", refused.sqlstate === "55000", JSON.stringify(refused));
    check(round, "different-batch", "the refusal names the date and both batches",
      (refused.message ?? "").includes(`already published by batch ${b1}`) && (refused.message ?? "").includes(b2), refused.message ?? "");
    check(round, "different-batch", "no deadlock (40P01) anywhere", refused.sqlstate !== "40P01");
    check(round, "different-batch", "only B1 owns editions.staging_batch_id", ownership.editions_batch === b1, JSON.stringify(ownership));
    check(round, "different-batch", "every item of the date is B1's", JSON.stringify(ownership.item_batches) === JSON.stringify([b1]), JSON.stringify(ownership.item_batches));
    check(round, "different-batch", "drop count is exactly what B1 wrote", ownership.drops === b1Result.daily_drops_written,
      `${ownership.drops} vs ${b1Result.daily_drops_written}`);
    check(round, "different-batch", "item count is exactly what B1 wrote", ownership.items === b1Result.daily_drop_items_written,
      `${ownership.items} vs ${b1Result.daily_drop_items_written}`);
    check(round, "different-batch", "B2 wrote zero content rows", (await query(`select concurrency_test.content_count(${quote(b2)});`)) === "0");
    check(round, "different-batch", "B1's 46 content rows are intact", (await query(`select concurrency_test.content_count(${quote(b1)});`)) === "46");

    return { b2Wrote: Number(await query(`select concurrency_test.content_count(${quote(b2)});`)) };
  } finally {
    await a.close();
    await b.close();
  }
}

/** The same batch, twice at once (a retry racing the original): safe, nothing rewritten. */
async function sameBatch(round, date) {
  const tag = `r${round}-S`;
  const batch = await uuid(`batch:${tag}`);
  const batchKey = batch;
  const a = new Session("A");
  const b = new Session("B");

  try {
    const pidB = (await b.send("select pg_backend_pid()")).output;
    await a.send("begin");
    const first = await a.send(`select concurrency_test.publish(${quote(tag)}, ${quote(batch)}, ${quote(date)})`);
    check(round, "same-batch", "A publishes the batch", first.ok, first.message ?? "");

    const retry = b.send(`select concurrency_test.publish(${quote(tag)}, ${quote(batch)}, ${quote(date)})`);
    // The batch lock is taken first, so that is where the retry waits.
    await until(() => waitingOnAdvisory(pidB, batchKey), "retry waiting on the batch lock");
    await a.send("commit");
    const before = JSON.parse(await query(`select concurrency_test.ownership(${quote(date)});`));
    const second = await retry;
    const after = JSON.parse(await query(`select concurrency_test.ownership(${quote(date)});`));
    const result = second.ok ? JSON.parse(second.output) : {};

    check(round, "same-batch", "the concurrent retry succeeds", second.ok, second.message ?? "");
    check(round, "same-batch", "and knows it is a retry, keeping every drop",
      result.retry_of_published_edition === true && result.daily_drops_written === 0 && result.daily_drop_items_written === 0,
      JSON.stringify(result));
    check(round, "same-batch", "no duplicate content", result.items_written === 0 && Number(await query(`select concurrency_test.content_count(${quote(batch)});`)) === 46);
    check(round, "same-batch", "the edition is byte-for-byte unchanged", before.item_fingerprint === after.item_fingerprint);
  } finally {
    await a.close();
    await b.close();
  }
}

/** A takes the date lock and rolls back; B, waiting, then publishes normally. */
async function rollback(round, date) {
  const tagA = `r${round}-RA`;
  const tagB = `r${round}-RB`;
  const b1 = await uuid(`batch:${tagA}`);
  const b2 = await uuid(`batch:${tagB}`);
  const dateKey = `personews:edition:${date}`;
  const a = new Session("A");
  const b = new Session("B");

  try {
    const pidB = (await b.send("select pg_backend_pid()")).output;
    await a.send("begin");
    await a.send(`select concurrency_test.publish(${quote(tagA)}, ${quote(b1)}, ${quote(date)})`);

    const raced = b.send(`select concurrency_test.publish(${quote(tagB)}, ${quote(b2)}, ${quote(date)})`);
    await until(() => waitingOnAdvisory(pidB, dateKey), "B waiting on the per-date lock");
    await a.send("rollback");
    const published = await raced;
    const ownership = JSON.parse(await query(`select concurrency_test.ownership(${quote(date)});`));

    check(round, "rollback", "after A rolls back, B publishes", published.ok, published.message ?? "");
    check(round, "rollback", "and B2 owns the date", ownership.editions_batch === b2, JSON.stringify(ownership));
    check(round, "rollback", "every item is B2's", JSON.stringify(ownership.item_batches) === JSON.stringify([b2]));
    check(round, "rollback", "nothing of A's survived", (await query(`select concurrency_test.content_count(${quote(b1)});`)) === "0");
  } finally {
    await a.close();
    await b.close();
  }
}

// ---------------------------------------------------------------------------

let b2Writes = 0;

try {
  await buildScratchDatabase();

  for (let round = 1; round <= repeat; round += 1) {
    await query(`select concurrency_test.add_readers(${quote(`round-${round}`)}, 4);`);
    // Three fresh dates per round, far from any real edition.
    const base = new Date(Date.UTC(2033, 0, 3 + (round - 1) * 7));
    const day = (offset) => new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10);

    // A scenario that cannot even reach its assertions (B never waits on the
    // lock, a session dies) is a failed check, not a crash.
    const scenarios = [
      ["different-batch", async () => {
        const { b2Wrote } = await differentBatch(round, day(0));
        b2Writes += b2Wrote;
      }],
      ["same-batch", () => sameBatch(round, day(2))],
      ["rollback", () => rollback(round, day(4))]
    ];

    for (const [name, scenario] of scenarios) {
      try {
        await scenario();
      } catch (error) {
        check(round, name, "scenario completed", false, error instanceof Error ? error.message : String(error));
      }
    }

    const failed = results.filter((result) => result.round === round && !result.pass).length;
    console.log(`round ${round}: ${results.filter((result) => result.round === round).length - failed} passed, ${failed} failed`);
  }
} finally {
  if (!keep) {
    await asSuperuser(["dropdb", "-U", "supabase_admin", "--if-exists", "--force", SCRATCH_DB]);
  }
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed over ${repeat} round(s); B2 content rows written in total: ${b2Writes}`);
process.exit(failed.length === 0 ? 0 : 1);
