import { describe, expect, it } from "vitest";

import {
  buildPushMessage,
  classifyRequestFailure,
  classifyTicket,
  createExpoSender,
  EXPO_PUSH_ENDPOINT,
  ExpoHttpError,
  formatLocalTime,
  mapClaimedRow,
  runPushWorker,
  type ClaimedPush,
  type ExpoMessage,
  type ExpoTicket,
  type Outcome,
  type RecordResult,
  type WorkerDeps
} from "./core.ts";
import { buildAnswerReminderMessage } from "../../../services/content-engine/src/notifications/answerReminder";
import {
  buildEditionNotificationMessage,
  toExpoPushMessage
} from "../../../services/content-engine/src/notifications/editionNotification";

/**
 * The Edge worker's loop. WHO and WHEN are decided by SQL
 * (push_timing_and_retries.test.sql proves 20:00/20:15/20:30 and
 * 08:30/08:45/09:00 against PostgreSQL). What is pinned here: it sends exactly
 * what it was handed, records every outcome once, never sends a row twice,
 * does nothing when nothing is due, and never logs a token.
 */

const TOKEN = "ExponentPushToken[secret-device-token-123]";

function row(overrides: Partial<ClaimedPush> = {}): ClaimedPush {
  return {
    deliveryId: "d0000000-0000-4000-8000-000000000001",
    pushTokenId: "a1b2c3d4-0000-4000-8000-000000000001",
    userId: "u0000000-0000-4000-8000-000000000001",
    dropDate: "2026-09-14",
    kind: "edition_ready",
    expoPushToken: TOKEN,
    language: "en",
    attemptNumber: 1,
    targetAt: "2026-09-15T01:00:00+00:00",
    scheduledFor: "2026-09-15T01:00:00+00:00",
    timezone: "America/Chicago",
    editionReadyAt: "2026-09-14T17:05:00+00:00",
    ...overrides
  };
}

/**
 * A stand-in for the SQL claim with its one property that matters here: a row
 * is handed out once per lease, and only while it has not been accepted.
 */
function harness(
  rows: ClaimedPush[],
  send: (messages: ExpoMessage[]) => Promise<ExpoTicket[]>,
  options: { recordFails?: boolean } = {}
) {
  const accepted = new Set<string>();
  const leased = new Set<string>();
  const recorded: Array<{ deliveryId: string; outcome: Outcome }> = [];
  const sent: ExpoMessage[][] = [];
  const logs: Array<Record<string, unknown>> = [];

  const deps: WorkerDeps = {
    claim: async (limit) => {
      const due = rows.filter((candidate) => !accepted.has(candidate.deliveryId) && !leased.has(candidate.deliveryId));
      const batch = due.slice(0, limit);
      batch.forEach((candidate) => leased.add(candidate.deliveryId));
      return batch;
    },
    send: async (messages) => {
      sent.push(messages);
      return send(messages);
    },
    record: async (claimed, outcome): Promise<RecordResult> => {
      if (options.recordFails) {
        throw new Error("record_push_delivery_attempt failed: connection reset");
      }
      recorded.push({ deliveryId: claimed.deliveryId, outcome });
      if (outcome.kind === "ticket_accepted") {
        accepted.add(claimed.deliveryId);
        return { status: "awaiting_receipt", nextAttemptAt: null };
      }
      return outcome.kind === "retryable"
        ? { status: "retryable_failure", nextAttemptAt: "2026-09-15T01:15:00+00:00" }
        : { status: "terminal_failure", nextAttemptAt: null };
    },
    now: () => new Date("2026-09-15T01:00:04Z"),
    log: (line) => logs.push(line)
  };

  return { deps, recorded, sent, logs, releaseLeases: () => leased.clear() };
}

const ok = async (messages: ExpoMessage[]): Promise<ExpoTicket[]> =>
  messages.map((_message, index) => ({ status: "ok", id: `ticket-${index}` }));

describe("the words", () => {
  it("are exactly the Node sender's, for both kinds and both languages", () => {
    for (const language of ["fr", "en"] as const) {
      const ready = buildPushMessage(row({ language }));
      const node = buildEditionNotificationMessage(language, "2026-09-14");
      expect({ title: ready.title, body: ready.body, data: ready.data }).toEqual(node);

      const reminder = buildPushMessage(row({ language, kind: "edition_answer_reminder" }));
      const nodeReminder = buildAnswerReminderMessage(language, "2026-09-14");
      expect({ title: reminder.title, body: reminder.body, data: reminder.data }).toEqual(nodeReminder);
    }
  });

  it("is sent with the same Expo envelope as the Node sender: high priority, default channel", () => {
    const message = buildPushMessage(row());
    const node = toExpoPushMessage({ expoPushToken: TOKEN, message: buildEditionNotificationMessage("en", "2026-09-14") });

    expect(message).toEqual(node);
    expect(message.priority).toBe("high");
  });
});

describe("a minute with nothing due", () => {
  it("is a clean no-op: no request to Expo, nothing recorded", async () => {
    const run = harness([], ok);
    const summary = await runPushWorker(run.deps);

    expect(summary).toMatchObject({ claimed: 0, accepted: 0, retryable: 0, permanent: 0, tokenInvalid: 0 });
    expect(run.sent).toHaveLength(0);
    expect(run.recorded).toHaveLength(0);
    expect(run.logs).toEqual([expect.objectContaining({ event: "push_worker_run", claimed: 0 })]);
  });
});

describe("one attempt", () => {
  it("records an accepted ticket once, and a second run sends nothing more", async () => {
    const run = harness([row()], ok);

    await runPushWorker(run.deps);
    run.releaseLeases();
    await runPushWorker(run.deps);

    expect(run.sent).toHaveLength(1);
    expect(run.recorded).toEqual([
      { deliveryId: row().deliveryId, outcome: { kind: "ticket_accepted", ticketId: "ticket-0" } }
    ]);
  });

  it("marks every row of a failed request retryable on a 5xx or a network error, never accepted", async () => {
    const run = harness([row(), row({ deliveryId: "d2", pushTokenId: "b2" })], async () => {
      throw new ExpoHttpError(503, "Expo push request failed with status 503");
    });
    const summary = await runPushWorker(run.deps);

    expect(summary.retryable).toBe(2);
    expect(run.recorded.every((entry) => entry.outcome.kind === "retryable")).toBe(true);
  });

  it("classifies whole-request failures: 429 and network errors retry, other 4xx do not", () => {
    expect(classifyRequestFailure(new ExpoHttpError(429, "slow down")).kind).toBe("retryable");
    expect(classifyRequestFailure(new TypeError("fetch failed")).kind).toBe("retryable");
    expect(classifyRequestFailure(new ExpoHttpError(400, "bad request")).kind).toBe("permanent");
  });

  it("classifies tickets like the Node sender", () => {
    expect(classifyTicket({ status: "ok", id: "t" })).toEqual({ kind: "ticket_accepted", ticketId: "t" });
    expect(classifyTicket({ status: "error", details: { error: "DeviceNotRegistered" } }).kind).toBe("token_invalid");
    expect(classifyTicket({ status: "error", details: { error: "MessageRateExceeded" } }).kind).toBe("retryable");
    expect(classifyTicket({ status: "error", details: { error: "InvalidCredentials" } }).kind).toBe("permanent");
    expect(classifyTicket(undefined).kind).toBe("retryable");
  });

  it("never sends a malformed token; it is recorded as invalid", async () => {
    const run = harness([row({ expoPushToken: "ab".repeat(32) })], ok);
    const summary = await runPushWorker(run.deps);

    expect(run.sent).toHaveLength(0);
    expect(summary.tokenInvalid).toBe(1);
  });

  it("does not resend when writing the outcome fails; the SQL lease already counted the attempt", async () => {
    const run = harness([row()], ok, { recordFails: true });
    const summary = await runPushWorker(run.deps);

    expect(run.sent).toHaveLength(1);
    expect(summary.recordFailures).toBe(1);
    expect(run.logs).toContainEqual(expect.objectContaining({ event: "push_record_failed" }));
  });

  it("sends in chunks of 100 and keeps claiming while batches come back full", async () => {
    const rows = Array.from({ length: 250 }, (_unused, index) =>
      row({ deliveryId: `d-${index}`, pushTokenId: `p-${index}`, expoPushToken: `ExponentPushToken[t-${index}]` })
    );
    const run = harness(rows, ok);
    const summary = await runPushWorker(run.deps, { batchSize: 200 });

    expect(summary.claimed).toBe(250);
    expect(summary.accepted).toBe(250);
    expect(run.sent.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
  });
});

describe("observability", () => {
  it("logs target local time, UTC target, zone, ready time, dispatch time, attempt, retry slot and result", async () => {
    const run = harness([row({ attemptNumber: 2 })], async () => {
      throw new ExpoHttpError(502, "Expo push request failed with status 502");
    });
    await runPushWorker(run.deps);

    const line = run.logs.find((entry) => entry.event === "push_attempt");
    expect(line).toMatchObject({
      kind: "edition_ready",
      timezone: "America/Chicago",
      target_utc: "2026-09-15T01:00:00+00:00",
      edition_ready_at: "2026-09-14T17:05:00+00:00",
      blocked_until_ready: false,
      actual_dispatch_at: "2026-09-15T01:00:04.000Z",
      attempt_number: 2,
      result: "retryable",
      recorded_status: "retryable_failure",
      retry_due_at: "2026-09-15T01:15:00+00:00",
      device: "a1b2c3d4"
    });
    expect(String(line?.target_local_time)).toContain("20:00");
  });

  it("says blocked_until_ready when the edition was ready after the 20:00 target", async () => {
    const run = harness(
      [row({ targetAt: "2026-09-17T01:00:00Z", scheduledFor: "2026-09-17T01:27:00Z", editionReadyAt: "2026-09-17T01:27:00Z" })],
      ok
    );
    await runPushWorker(run.deps);

    expect(run.logs.find((entry) => entry.event === "push_attempt")).toMatchObject({ blocked_until_ready: true });
  });

  it("never logs a push token, whatever happens", async () => {
    const run = harness(
      [row(), row({ deliveryId: "d2", expoPushToken: "not-a-token-secret" })],
      async () => [{ status: "error", message: `failed for ${TOKEN}`.replace(TOKEN, "device"), details: null }]
    );
    await runPushWorker(run.deps);

    const everything = JSON.stringify(run.logs);
    expect(everything).not.toContain("secret-device-token-123");
    expect(everything).not.toContain("ExponentPushToken");
    expect(everything).not.toContain("not-a-token-secret");
    expect(everything).not.toContain(row().userId);
  });

  it("shows the reader's local time in every zone, DST included", () => {
    expect(formatLocalTime("2026-09-15T01:00:00Z", "America/Chicago")).toContain("20:00");
    expect(formatLocalTime("2026-11-02T02:00:00Z", "America/Chicago")).toContain("20:00");
    expect(formatLocalTime("2026-09-14T18:00:00Z", "Europe/Paris")).toContain("20:00");
    expect(formatLocalTime("2026-09-14T19:00:00Z", "Europe/London")).toContain("20:00");
    expect(formatLocalTime("2026-09-14T11:00:00Z", "Asia/Tokyo")).toContain("20:00");
    expect(formatLocalTime("2026-10-04T09:00:00Z", "Australia/Sydney")).toContain("20:00");
    expect(formatLocalTime("2026-09-15T13:30:00Z", "America/Chicago")).toContain("08:30");
    expect(formatLocalTime(null, "Europe/Paris")).toBeNull();
    expect(formatLocalTime("2026-09-15T13:30:00Z", "Mars/Olympus")).toBeNull();
  });
});

describe("the SQL row and the Expo call", () => {
  it("maps the claim's columns and drops a kind it does not know", () => {
    const mapped = mapClaimedRow({
      claimed_delivery_id: "d1",
      claimed_push_token_id: "p1",
      claimed_user_id: "u1",
      claimed_drop_date: "2026-09-14",
      claimed_kind: "edition_answer_reminder",
      claimed_expo_push_token: TOKEN,
      claimed_language: "fr",
      claimed_attempt_number: 3,
      claimed_target_at: "2026-09-15T13:30:00+00:00",
      claimed_scheduled_for: "2026-09-15T13:30:00+00:00",
      claimed_timezone: "America/Chicago",
      claimed_edition_ready_at: "2026-09-14T17:05:00+00:00"
    });

    expect(mapped).toMatchObject({ kind: "edition_answer_reminder", language: "fr", attemptNumber: 3 });
    expect(mapClaimedRow({ claimed_kind: "team_invite_received" })).toBeNull();
  });

  it("posts to Expo and throws a typed error on a non-2xx", async () => {
    const calls: string[] = [];
    const sender = createExpoSender((async (url: string) => {
      calls.push(url);
      return new Response("unavailable", { status: 503 });
    }) as unknown as typeof fetch);

    await expect(sender([buildPushMessage(row())])).rejects.toBeInstanceOf(ExpoHttpError);
    expect(calls).toEqual([EXPO_PUSH_ENDPOINT]);
  });
});
