import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Push timing and retries, pinned statically.
 *
 * The behaviour is proven against a real PostgreSQL by
 * push_timing_and_retries.test.sql (node scripts/local-sql-tests.mjs
 * push-timing --with-migrations). What is pinned here are the properties that
 * must survive any later edit: 20:00 and 08:30 on the reader's clock, three
 * attempts 15 minutes apart, the database as the clock, and no token anywhere
 * it could leak.
 */

const repoRoot = join(__dirname, "..", "..");
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), "utf8");
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, "");
const stripYamlComments = (yaml: string) => yaml.replace(/^\s*#.*$/gm, "");

const migration = stripSqlComments(read("supabase", "migrations", "20260912090000_push_timing_and_retries.sql"));
const workflow = stripYamlComments(read(".github", "workflows", "push-notification-retry.yml"));
const edgeIndex = read("supabase", "functions", "personews-push-notifications", "index.ts");
const edgeCore = read("supabase", "functions", "personews-push-notifications", "core.ts");
const nodeStore = read("services", "content-engine", "src", "notifications", "supabasePushStore.ts");

function functionBody(name: string): string {
  const start = migration.indexOf(`FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const bodyStart = migration.indexOf("AS $", start);
  const tag = migration.slice(bodyStart + 3, migration.indexOf("$", bodyStart + 4) + 1);
  const end = migration.indexOf(tag, bodyStart + 3 + tag.length);
  return migration.slice(bodyStart, end);
}

describe("the two targets", () => {
  it("announces the edition at greatest(20:00 reader-local, ready), never another day", () => {
    expect(functionBody("edition_ready_target_at")).toContain("reader_local_instant(p_edition_date, TIME '20:00', p_timezone)");
    const due = functionBody("edition_ready_due_at");
    expect(due).toContain("greatest(public.edition_ready_target_at(p_edition_date, p_timezone), p_released_at)");
    expect(due).toContain("p_released_at IS NULL THEN NULL");
    expect(migration).not.toContain("TIME '19:00'");
  });

  it("keeps the reminder at 08:30 reader-local the next morning", () => {
    expect(functionBody("edition_answer_reminder_target_at")).toContain("p_edition_date + 1, TIME '08:30'");
  });

  it("never writes a UTC offset", () => {
    expect(migration).not.toMatch(/AT TIME ZONE\s+'(?!UTC)/);
  });
});

describe("three attempts, fifteen minutes apart", () => {
  it("caps attempts at three and spaces them by fifteen minutes from the scheduled time", () => {
    expect(functionBody("push_max_attempts")).toContain("SELECT 3");
    expect(functionBody("push_retry_step")).toContain("INTERVAL '15 minutes'");
    const retry = functionBody("schedule_push_delivery_retry");
    expect(retry).toContain("NEW.attempt_count, 0) >= public.push_max_attempts()");
    expect(retry).toContain("NEW.status := 'terminal_failure'");
    expect(retry).toContain("+ public.push_retry_step() * greatest(coalesce(NEW.attempt_count, 0), 1)");
  });

  it("counts the attempt when the row is leased, in every claim", () => {
    for (const claim of [
      "claim_due_push_notifications",
      "claim_push_notification_deliveries",
      "claim_edition_answer_reminders"
    ]) {
      const body = functionBody(claim);
      expect(body, claim).toContain("attempt_count = delivery.attempt_count + 1");
      expect(body, claim).toContain("public.push_delivery_attempt_due(");
    }
  });

  it("never re-leases an accepted ticket, a pending receipt or a delivered push", () => {
    const due = functionBody("push_delivery_attempt_due");
    expect(due).toContain("p_status IN ('pending', 'retryable_failure')");
    for (const final of ["awaiting_receipt", "ticket_accepted", "'sent'"]) {
      expect(due, final).not.toContain(final);
    }
    expect(due).toContain("< public.push_max_attempts()");
  });

  it("does not let the sender on main count an attempt twice", () => {
    expect(functionBody("schedule_push_delivery_retry")).toContain("NEW.attempt_count := OLD.attempt_count");
    expect(nodeStore).not.toMatch(/attempt_count:\s*attemptCount/);
  });
});

describe("the database is the clock", () => {
  it("wakes the Edge worker every minute, only when something is due, before touching a secret", () => {
    expect(migration).toContain("'personews-push-worker',\n  '* * * * *'");
    const invoke = functionBody("invoke_push_worker");
    expect(invoke.indexOf("'no_due_work'")).toBeLessThan(invoke.indexOf("vault.decrypted_secrets"));
    expect(invoke.toLowerCase()).not.toContain("expo");
  });

  it("keeps GitHub as a five-minute fallback, never an hourly clock", () => {
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).not.toMatch(/cron: "\d+ \* \* \* \*"/);
    expect(workflow).not.toContain('cron: "*/30 * * * *"');
  });

  it("has the Edge worker send only what SQL leased and record only through SQL", () => {
    expect(edgeIndex).toContain('rpc("claim_due_push_notifications"');
    expect(edgeIndex).toContain('rpc("record_push_delivery_attempt"');
    expect(edgeIndex).not.toContain('.from("push_notification_deliveries")');
    expect(edgeIndex).toContain("PERSONEWS_PUSH_WORKER_TOKEN");
  });
});

describe("no token where it could leak", () => {
  it("returns hashed ids and never the token from the timeline", () => {
    const timeline = functionBody("get_push_delivery_timeline");
    expect(timeline).not.toContain("expo_push_token");
    expect(timeline).toContain("left(md5(delivery.user_id::TEXT), 8)");
  });

  it("builds its log line without the token", () => {
    const logLine = edgeCore.slice(edgeCore.indexOf("export function attemptLogLine"), edgeCore.indexOf("export async function runPushWorker"));
    expect(logLine).not.toContain("expoPushToken");
    expect(logLine).not.toContain("userId");
  });
});
