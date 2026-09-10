import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reader-local notifications, pinned statically.
 *
 * The behaviour is proven against a real PostgreSQL by
 * reader_local_notifications.test.sql (node scripts/local-sql-tests.mjs
 * local-time --with-migrations). What is pinned here are the properties that
 * must survive any future edit of the migration or the workflows: no offsets,
 * the current zone, one job, the eligibility re-read where the row is leased,
 * and the Team kinds left alone.
 */

const repoRoot = join(__dirname, "..", "..");
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), "utf8");
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, "");
const stripYamlComments = (yaml: string) => yaml.replace(/^\s*#.*$/gm, "");

const migration = stripSqlComments(read("supabase", "migrations", "20260910090000_reader_local_notifications.sql"));
const deliveryWorkflow = stripYamlComments(read(".github", "workflows", "push-notification-retry.yml"));
const receiptWorkflow = stripYamlComments(read(".github", "workflows", "push-receipts.yml"));
const sender = read("services", "content-engine", "src", "notifications", "pushSender.ts");

function functionBody(name: string): string {
  const start = migration.indexOf(`FUNCTION public.${name}(`);
  const bodyStart = migration.indexOf("AS $", start);
  const tag = migration.slice(bodyStart + 3, migration.indexOf("$", bodyStart + 4) + 1);
  const end = migration.indexOf(tag, bodyStart + 3 + tag.length);
  return migration.slice(bodyStart, end);
}

describe("the new kind", () => {
  it("widens the kind check and keeps every existing kind", () => {
    for (const kind of [
      "edition_ready",
      "edition_answer_reminder",
      "team_invite_received",
      "team_member_joined",
      "team_edition_result"
    ]) {
      expect(migration).toContain(`'${kind}'`);
    }
  });

  it("keeps the identity key untouched, and uses it for the fan-out", () => {
    expect(migration).not.toMatch(/DROP CONSTRAINT[^;]*identity_unique/);
    expect(migration).not.toMatch(/ADD CONSTRAINT[^;]*identity_unique/);
    expect(functionBody("claim_edition_answer_reminders")).toContain(
      "ON CONFLICT ON CONSTRAINT push_notification_deliveries_identity_unique DO NOTHING"
    );
  });

  it("schedules only the two edition kinds; Team kinds appear only in the CHECK", () => {
    expect(migration.match(/team_invite_received/g)).toHaveLength(1);
    expect(migration.match(/team_member_joined/g)).toHaveLength(1);
    expect(migration.match(/team_edition_result/g)).toHaveLength(1);
  });
});

describe("the reader's clock", () => {
  it("never writes an offset: every local time goes through the reader's IANA zone", () => {
    expect(migration).not.toMatch(/AT TIME ZONE\s+'/);
    expect(migration).not.toMatch(/INTERVAL\s+'-?\d+\s*hours?'\s*[-+]\s*INTERVAL/);
    expect(functionBody("reader_local_instant")).toContain(
      "AT TIME ZONE public.reader_notification_timezone(p_timezone)"
    );
  });

  it("reads profiles.timezone when asked, and stores no zone beside a notification", () => {
    expect(functionBody("edition_answer_reminder_reader")).toContain("profile.timezone");
    expect(functionBody("get_edition_ready_schedule")).toContain("profile.timezone");
    expect(migration).not.toMatch(/ADD COLUMN[^;]*timezone/i);
  });

  it("is greatest(19:00 local, verification) for the edition, never another day", () => {
    const ready = functionBody("edition_ready_due_at");

    expect(ready).toContain("reader_local_instant(p_edition_date, TIME '19:00'");
    expect(ready).toContain("greatest(");
    // No roll-over to a later evening: the edition date is never shifted.
    expect(ready).not.toMatch(/p_edition_date\s*\+/);
  });

  it("is 08:30 local on the day after the edition date for the reminder", () => {
    expect(functionBody("edition_answer_reminder_due_at")).toContain(
      "reader_local_instant(p_edition_date + 1, TIME '08:30'"
    );
  });
});

describe("eligibility is re-read where the row is leased", () => {
  const claim = functionBody("claim_edition_answer_reminders");
  const lease = claim.slice(claim.indexOf("WITH owed AS"));

  it("evaluates the reader inside the leasing statement and leases only what is still owed", () => {
    expect(lease).toContain("public.edition_answer_reminder_reader(");
    expect(lease).toContain("reader.still_owed");
    expect(lease).toContain("FOR UPDATE OF delivery SKIP LOCKED");
  });

  it("fans a reader out only while they are due and not yet reminded", () => {
    expect(claim).toContain("WHERE reader.reader_state = 'due'");
    expect(functionBody("edition_answer_reminder_reader")).toContain(
      "WHEN facts.fact_reminded > 0 THEN 'reminded'"
    );
  });

  it("stands down a reminder that is no longer owed, and never nags after the window", () => {
    expect(claim).toContain("'completed_before_send'");
    expect(claim).toContain("'reminder send window elapsed'");
    expect(functionBody("edition_answer_reminder_reader")).toContain("INTERVAL '3 hours'");
  });

  it("requires unanswered questions, notifications on, a device and an open edition", () => {
    const reader = functionBody("edition_answer_reminder_reader");

    for (const fact of [
      "facts.assigned_count > facts.answered_count",
      "facts.fact_enabled",
      "facts.fact_devices > 0",
      "facts.fact_open",
      "WHEN facts.assigned_count = 0 THEN 'no_assignments'"
    ]) {
      expect(reader, fact).toContain(fact);
    }
  });
});

describe("one worker for every reader and every zone", () => {
  it("keeps one dispatcher job, all day, never per reader or zone", () => {
    expect(migration.match(/cron\.schedule\(/g)).toHaveLength(1);
    expect(migration).toContain("'*/2 * * * *'");
  });

  it("still never sends anything from the database", () => {
    expect(functionBody("dispatch_notification_events").toLowerCase()).not.toContain("expo");
  });

  it("is woken by the reader-local event and recovered by one half-hourly schedule", () => {
    expect(deliveryWorkflow).toContain("types: [edition_published, edition_notifications_due]");
    expect(deliveryWorkflow).toContain('cron: "*/30 * * * *"');
    expect(receiptWorkflow).toContain('cron: "50 */3 * * *"');
  });

  it("holds back only edition_ready; nothing else waits for a local time", () => {
    const gate = sender.slice(sender.indexOf("// WHEN, per reader."), sender.indexOf("const deliveries = await input.store.loadDeliveries"));

    expect(gate).toContain("loadEditionReadySchedule");
    expect(sender.match(/loadEditionReadySchedule\(/g)).toHaveLength(1);
  });
});

describe("health", () => {
  it("keeps the old columns in order and appends the two new ones", () => {
    const health = migration.slice(migration.indexOf("CREATE FUNCTION public.get_edition_notification_health"));
    const columns = health.slice(health.indexOf("RETURNS TABLE("), health.indexOf(")\nLANGUAGE"));

    expect(columns.replace(/\s+/g, " ")).toContain(
      "edition_date DATE, eligible_devices BIGINT, delivery_rows BIGINT, sent BIGINT, awaiting_receipt BIGINT, retryable BIGINT, terminal BIGINT, never_attempted BIGINT, outbox_status TEXT, scheduled_not_due BIGINT, due_awaiting_worker BIGINT"
    );
  });
});
