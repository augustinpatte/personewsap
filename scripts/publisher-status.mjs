#!/usr/bin/env node
/**
 * Will the next PersoNews edition publish itself?
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run publisher:status
 *
 * Reads `public.next_scheduled_publication_status()` in the staging project and
 * prints the answer in the shape an operator actually wants at 18:45: is the
 * cron armed, what does the calendar expect tonight, how many jobs are approved,
 * and — when the answer is no — which jobs are holding it up.
 *
 * Read-only. It publishes nothing, changes nothing, and cannot.
 *
 * SUPABASE_ACCESS_TOKEN is a Supabase personal access token (Account → Access
 * Tokens). It is never read from a file in this repository.
 */

const STAGING_REF = "kukyotcgbnchsoeriqoz";

async function query(ref, sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  if (!token) {
    console.error(
      "SUPABASE_ACCESS_TOKEN is required.\n" +
        "Create one at https://supabase.com/dashboard/account/tokens and export it for this command only.",
    );
    process.exit(2);
  }

  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error(`Supabase API error ${response.status}: ${body?.message ?? JSON.stringify(body)}`);
    process.exit(1);
  }

  return body;
}

function bullet(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

// `--date YYYY-MM-DD`: what happened to one edition date, in one call
// (staging edition_publication_timeline, 20261005140000). Exit 1 when that
// edition is missed or has a stale open run.
const dateIndex = process.argv.indexOf("--date");

if (dateIndex >= 0) {
  const date = process.argv[dateIndex + 1] ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("--date needs a YYYY-MM-DD edition date.");
    process.exit(2);
  }

  const timelineRows = await query(
    STAGING_REF,
    `select public.edition_publication_timeline('${date}'::date) as t;`,
  );
  const timeline = timelineRows?.[0]?.t;

  if (!timeline) {
    console.error("Could not read the edition timeline (is 20261005140000 applied to staging?).");
    process.exit(1);
  }

  const health = timeline.health ?? {};
  console.log(`\nPersoNews edition ${date}\n`);
  bullet("status", `${health.status} (${health.ok ? "ok" : "NOT OK"})`);
  bullet("kind", health.edition_kind ?? "not a publication day");
  bullet("deadline (Paris)", health.deadline_paris);
  bullet("receipt", health.receipt ? `${health.receipt.batch_id} at ${health.receipt.published_at}` : "none");
  bullet("stale open runs", (health.stale_open_runs ?? []).length);
  console.log("\n  attempts");

  for (const attempt of timeline.attempts ?? []) {
    console.log(
      `    ${attempt.started_at}  ${attempt.trigger.padEnd(7)} ${String(attempt.reason ?? (attempt.open ? "OPEN" : "?")).padEnd(34)}` +
        ` gate=${attempt.gate_passed} published=${attempt.publication_succeeded} verified=${attempt.production_verified}` +
        ` receipt=${attempt.receipt_recorded} blockers=${attempt.blocker_count}` +
        (attempt.error ? `\n      error: ${String(attempt.error).slice(0, 200)}` : ""),
    );
  }

  console.log("\n  recovery: select public.run_scheduled_publication_tick(true);  (staging SQL editor)\n");
  process.exit(health.ok ? 0 : 1);
}

const rows = await query(STAGING_REF, "select public.next_scheduled_publication_status() as s;");
const status = rows?.[0]?.s;

if (!status || status.error) {
  console.error(`Could not read publication status: ${status?.error ?? "no result"}`);
  process.exit(1);
}

console.log("\nPersoNews scheduled publication\n");
bullet("now (Paris)", status.now_paris);
bullet("next edition", `${status.next_edition_date} (${status.next_edition_kind})`);
bullet("fires at", `${status.fires_at_paris} Europe/Paris  =  ${status.fires_at_utc} UTC`);
bullet("cron armed", status.cron_armed ? "yes" : "NO — the schedule is not active");
bullet("approved jobs", status.approved_jobs);

if (status.already_published) {
  bullet("verdict", "already published — a run now would be a no-op");
} else if (status.will_publish_now) {
  bullet("verdict", "READY — this edition would publish right now");
} else {
  bullet("verdict", `blocked: ${status.reason}`);
}

if (status.job_status_counts && Object.keys(status.job_status_counts).length > 0) {
  console.log("\n  job statuses");
  for (const [name, count] of Object.entries(status.job_status_counts)) {
    console.log(`    ${String(count).padStart(3)}  ${name}`);
  }
}

const blockers = Array.isArray(status.blockers) ? status.blockers : [];

if (blockers.length > 0) {
  console.log(`\n  blockers (${blockers.length})`);
  for (const blocker of blockers.slice(0, 12)) {
    console.log(`    • ${blocker.code}: ${blocker.detail ?? ""}`);
  }
  if (blockers.length > 12) console.log(`    … and ${blockers.length - 12} more`);
}

const runs = Array.isArray(status.recent_runs) ? status.recent_runs : [];

if (runs.length > 0) {
  console.log("\n  recent attempts");
  for (const run of runs) {
    const outcome = run.receipt_recorded
      ? "published"
      : run.publication_succeeded
        ? "published but unverified"
        : `no publication (${run.reason})`;
    console.log(`    ${run.started_at} · ${run.edition_date} · ${outcome}`);
  }
}

console.log("");
process.exit(status.will_publish_now || status.already_published ? 0 : 1);
