import { describe, expect, it } from "vitest";

import {
  summarizeAnswerReminderHealth,
  type AnswerReminderHealthRow
} from "./notificationHealth.js";

/**
 * Reminder health says, per edition, which of the product's states it is in.
 * A reminder scheduled for tomorrow morning, or not needed because the reader
 * finished, is healthy; only one that came due and was never tried is not.
 */

function row(overrides: Partial<AnswerReminderHealthRow> = {}): AnswerReminderHealthRow {
  return {
    edition_date: "2026-09-14",
    released: true,
    assigned_readers: 0,
    completed_before_reminder: 0,
    scheduled_not_due: 0,
    due_awaiting_worker: 0,
    sent: 0,
    awaiting_receipt: 0,
    retryable: 0,
    terminal: 0,
    cancelled: 0,
    not_eligible: 0,
    not_released: 0,
    edition_closed: 0,
    never_attempted: 0,
    next_due_at: null,
    ...overrides
  };
}

describe("answer reminder health", () => {
  it("no reminder needed: nobody had questions", () => {
    expect(summarizeAnswerReminderHealth(row())).toMatchObject({
      status: "ok",
      summary: "no_reminder_needed"
    });
  });

  it("no reminder needed: everyone finished before theirs, including between fan-out and send", () => {
    const health = summarizeAnswerReminderHealth(
      row({ assigned_readers: 3, completed_before_reminder: 2, cancelled: 1 })
    );

    expect(health).toMatchObject({ status: "ok", summary: "no_reminder_needed" });
    expect(health.detail).toContain("3 reader(s) finished before theirs");
  });

  it("scheduled for the future is healthy, and says when", () => {
    const health = summarizeAnswerReminderHealth(
      row({ assigned_readers: 4, scheduled_not_due: 4, next_due_at: "2026-09-15T06:30:00+00:00" })
    );

    expect(health).toMatchObject({ status: "ok", summary: "scheduled" });
    expect(health.detail).toContain("2026-09-15T06:30:00+00:00");
  });

  it("due in the last half hour is healthy: the worker has not run yet", () => {
    expect(summarizeAnswerReminderHealth(row({ assigned_readers: 1, due_awaiting_worker: 1 }))).toMatchObject({
      status: "ok",
      summary: "due"
    });
  });

  it("sent", () => {
    expect(
      summarizeAnswerReminderHealth(row({ assigned_readers: 3, sent: 2, awaiting_receipt: 1 }))
    ).toMatchObject({ status: "ok", summary: "sent" });
  });

  it("genuinely failed: due, past the grace period, never attempted", () => {
    const health = summarizeAnswerReminderHealth(
      row({ assigned_readers: 3, sent: 2, never_attempted: 1 })
    );

    expect(health).toMatchObject({ status: "critical", summary: "failed", neverAttempted: 1 });
  });

  it("still retrying is a warning, not a failure", () => {
    expect(summarizeAnswerReminderHealth(row({ assigned_readers: 1, retryable: 1 }))).toMatchObject({
      status: "warning"
    });
  });

  it("an unverified edition cannot owe a reminder yet", () => {
    expect(
      summarizeAnswerReminderHealth(row({ released: false, assigned_readers: 2, not_released: 2 }))
    ).toMatchObject({ status: "ok", summary: "not_released" });
  });
});
