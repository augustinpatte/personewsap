import { describe, expect, it } from "vitest";

import {
  ANSWER_REMINDER_NOTIFICATION_KIND,
  buildAnswerReminderMessage,
  type ClaimedAnswerReminder
} from "./answerReminder.js";
import type {
  ExpoPushTicket,
  NotificationCandidateDrop,
  NotificationCandidateToken
} from "./editionNotification.js";
import {
  sendAnswerReminders,
  sendEditionNotifications,
  type EditionReadySchedule,
  type ExpoPushClient,
  type PushNotificationStore
} from "./pushSender.js";

/**
 * The two reader-local notifications, from the sender's side.
 *
 * WHO is owed the morning reminder is decided in SQL at claim time and proven
 * by supabase/tests/reader_local_notifications.test.sql. What is pinned here is
 * that the sender sends exactly what it was handed, under the right kind, in
 * the reader's language — and that edition_ready waits for each reader's own
 * 19:00.
 */

const PARIS = "11111111-1111-4111-8111-111111111111";
const CHICAGO = "33333333-3333-4333-8333-333333333333";
const EDITION = "2026-09-14";
const noWait = { waitForCapacity: async () => undefined };
const noRetry = { maxAttempts: 1 };

type Recorded = Parameters<PushNotificationStore["recordDeliveryResult"]>[0];

function createStore(overrides: Partial<PushNotificationStore> = {}) {
  const recorded: Recorded[] = [];
  const disabled: string[] = [];
  const claimed: string[][] = [];

  const store: PushNotificationStore = {
    loadEditionDrops: async () => [],
    loadNotificationsEnabledUserIds: async () => new Set(),
    loadCurrentUserLanguages: async () => new Map(),
    loadEnabledPushTokens: async () => [],
    loadDeliveries: async () => [],
    claimDeliveries: async (rows) => {
      claimed.push(rows.map((row) => row.pushTokenId));
      return new Set(rows.map((row) => row.pushTokenId));
    },
    recordDeliveryResult: async (input) => {
      recorded.push(input);
    },
    loadAwaitingReceipts: async () => [],
    recordReceiptResult: async () => undefined,
    disablePushToken: async (pushTokenId) => {
      disabled.push(pushTokenId);
    },
    ...overrides
  };

  return { store, recorded, disabled, claimed };
}

function createClient(ticketFor: (index: number) => ExpoPushTicket = (index) => ({ status: "ok", id: `t-${index}` })) {
  const messages: Array<{ to: string; title: string; body: string; data: unknown }> = [];
  let sent = 0;

  const client: ExpoPushClient = {
    send: async (batch) => {
      messages.push(...batch);
      return { tickets: batch.map(() => ticketFor(sent++)) };
    }
  };

  return { client, messages };
}

function reminder(overrides: Partial<ClaimedAnswerReminder> = {}): ClaimedAnswerReminder {
  return {
    pushTokenId: "token-paris-1",
    userId: PARIS,
    editionDate: EDITION,
    expoPushToken: "ExponentPushToken[paris-1]",
    language: "fr",
    ...overrides
  };
}

/** A claim that hands out the given batches in order, then nothing. */
function claimsOf(...batches: ClaimedAnswerReminder[][]) {
  const queue = [...batches];
  return async () => queue.shift() ?? [];
}

describe("the reminder's words", () => {
  it("is the product copy, in the reader's language, and routes to the edition", () => {
    const fr = buildAnswerReminderMessage("fr", EDITION);
    const en = buildAnswerReminderMessage("en", EDITION);

    expect(fr.title).toBe("Votre session n'est pas terminée");
    expect(fr.body).toBe("Il vous reste des réponses à donner pour rester dans la compétition.");
    expect(en.title).toBe("Your session isn't finished");
    expect(en.body).toBe("You still have answers to submit to stay in the competition.");

    for (const message of [fr, en]) {
      expect(message.data).toEqual({ type: "edition_answer_reminder", drop_date: EDITION });
      // No count, no streak, no urgency.
      expect(`${message.title} ${message.body}`).not.toMatch(/\d|!/);
    }
  });
});

describe("sending reminders", () => {
  it("sends exactly the rows the claim leased, each in its reader's language", async () => {
    const { store, recorded } = createStore({
      claimAnswerReminders: claimsOf([
        reminder(),
        reminder({ pushTokenId: "token-paris-2", expoPushToken: "ExponentPushToken[paris-2]" }),
        reminder({
          pushTokenId: "token-chicago",
          userId: CHICAGO,
          expoPushToken: "ExponentPushToken[chicago]",
          language: "en"
        })
      ])
    });
    const { client, messages } = createClient();

    const result = await sendAnswerReminders({ store, client, rateLimiter: noWait, retry: noRetry });

    expect(messages.map((message) => [message.to, message.title])).toEqual([
      ["ExponentPushToken[paris-1]", "Votre session n'est pas terminée"],
      ["ExponentPushToken[paris-2]", "Votre session n'est pas terminée"],
      ["ExponentPushToken[chicago]", "Your session isn't finished"]
    ]);
    expect(recorded.map((row) => row.notificationKind)).toEqual([
      ANSWER_REMINDER_NOTIFICATION_KIND,
      ANSWER_REMINDER_NOTIFICATION_KIND,
      ANSWER_REMINDER_NOTIFICATION_KIND
    ]);
    expect(recorded.every((row) => row.dropDate === EDITION)).toBe(true);
    expect(result).toMatchObject({ deployed: true, claimed: 3, ticketAccepted: 3, editionDates: [EDITION] });
  });

  it("sends nothing when nobody is owed one", async () => {
    const { store } = createStore({ claimAnswerReminders: claimsOf([]) });
    const { client, messages } = createClient();

    const result = await sendAnswerReminders({ store, client, rateLimiter: noWait });

    expect(messages).toEqual([]);
    expect(result.claimed).toBe(0);
  });

  it("is inert before the claim is deployed", async () => {
    const { client, messages } = createClient();

    const absent = await sendAnswerReminders({ store: createStore().store, client, rateLimiter: noWait });
    const notDeployed = await sendAnswerReminders({
      store: createStore({ claimAnswerReminders: async () => null }).store,
      client,
      rateLimiter: noWait
    });

    expect(absent.deployed).toBe(false);
    expect(notDeployed.deployed).toBe(false);
    expect(messages).toEqual([]);
  });

  it("retires a gone device, and never hammers a failed row within the same run", async () => {
    const gone = reminder({ pushTokenId: "token-gone", expoPushToken: "ExponentPushToken[gone]" });
    const flaky = reminder({ pushTokenId: "token-flaky", expoPushToken: "ExponentPushToken[flaky]" });
    const { store, disabled } = createStore({
      // A full batch, so the run asks again — and is handed the retryable row back.
      claimAnswerReminders: claimsOf([gone, flaky], [flaky])
    });
    const { client, messages } = createClient((index) =>
      index === 0
        ? { status: "error", details: { error: "DeviceNotRegistered" } }
        : { status: "error", details: { error: "MessageRateExceeded" } }
    );

    const result = await sendAnswerReminders({ store, client, rateLimiter: noWait, retry: noRetry, batchSize: 2 });

    expect(messages).toHaveLength(2);
    expect(disabled).toEqual(["token-gone"]);
    expect(result).toMatchObject({ claimed: 2, retryable: 1, disabledTokens: 1, deferred: 1 });
  });

  it("never sends a malformed token to Expo", async () => {
    const { store, disabled } = createStore({
      claimAnswerReminders: claimsOf([reminder({ pushTokenId: "token-apns", expoPushToken: "ab".repeat(32) })])
    });
    const { client, messages } = createClient();

    await sendAnswerReminders({ store, client, rateLimiter: noWait });

    expect(messages).toEqual([]);
    expect(disabled).toEqual(["token-apns"]);
  });

  it("counts a result it could not write, so the run exits non-zero", async () => {
    const { store } = createStore({
      claimAnswerReminders: claimsOf([reminder()]),
      recordDeliveryResult: async () => {
        throw new Error("database refused");
      }
    });
    const { client } = createClient();

    const result = await sendAnswerReminders({ store, client, rateLimiter: noWait });

    expect(result.bookkeepingFailures).toBe(1);
  });
});

describe("edition_ready on each reader's clock", () => {
  const drops: NotificationCandidateDrop[] = [
    { dailyDropId: "drop-paris", userId: PARIS, language: "fr", status: "published", slots: ["newsletter", "business_story", "mini_case"] },
    { dailyDropId: "drop-chicago", userId: CHICAGO, language: "en", status: "published", slots: ["newsletter", "business_story", "mini_case"] }
  ];
  const tokens: NotificationCandidateToken[] = [
    { pushTokenId: "token-paris", userId: PARIS, expoPushToken: "ExponentPushToken[paris]", enabled: true },
    { pushTokenId: "token-chicago", userId: CHICAGO, expoPushToken: "ExponentPushToken[chicago]", enabled: true }
  ];
  const editionStore = (
    schedule: Map<string, EditionReadySchedule> | null | undefined,
    overrides: Partial<PushNotificationStore> = {}
  ) =>
    createStore({
      loadEditionDrops: async () => drops,
      loadNotificationsEnabledUserIds: async () => new Set([PARIS, CHICAGO]),
      loadEnabledPushTokens: async () => tokens,
      ...(schedule === undefined ? {} : { loadEditionReadySchedule: async () => schedule }),
      ...overrides
    });

  it("tells Paris at 19:00 Paris while Chicago waits for 19:00 Chicago, writing nothing for Chicago", async () => {
    const { store, claimed } = editionStore(
      new Map([
        [PARIS, { dueAt: "2026-09-14T17:05:00+00:00", isDue: true }],
        [CHICAGO, { dueAt: "2026-09-15T00:00:00+00:00", isDue: false }]
      ])
    );
    const { client, messages } = createClient();

    const result = await sendEditionNotifications({ store, client, dropDate: EDITION, rateLimiter: noWait });

    expect(messages.map((message) => message.to)).toEqual(["ExponentPushToken[paris]"]);
    expect(claimed).toEqual([["token-paris"]]);
    expect(result).toMatchObject({
      localTimeGate: "applied",
      notDue: 1,
      nextDueAt: "2026-09-15T00:00:00+00:00",
      ticketAccepted: 1
    });
    expect(result.skipped).toContainEqual({ userId: CHICAGO, reason: "not_due_yet" });
  });

  it("tells Chicago on a later run, and never tells Paris twice", async () => {
    const { store, claimed } = editionStore(
      new Map([
        [PARIS, { dueAt: "2026-09-14T17:05:00+00:00", isDue: true }],
        [CHICAGO, { dueAt: "2026-09-15T00:00:00+00:00", isDue: true }]
      ]),
      {
        loadDeliveries: async () => [
          { pushTokenId: "token-paris", dropDate: EDITION, notificationKind: "edition_ready", status: "sent", attemptCount: 1 }
        ]
      }
    );
    const { client, messages } = createClient();

    await sendEditionNotifications({ store, client, dropDate: EDITION, rateLimiter: noWait });

    expect(messages.map((message) => message.to)).toEqual(["ExponentPushToken[chicago]"]);
    expect(claimed).toEqual([["token-chicago"]]);
  });

  it("makes nobody due while the edition awaits verification", async () => {
    const { store } = editionStore(
      new Map([
        [PARIS, { dueAt: null, isDue: false }],
        [CHICAGO, { dueAt: null, isDue: false }]
      ])
    );
    const { client, messages } = createClient();

    const result = await sendEditionNotifications({ store, client, dropDate: EDITION, rateLimiter: noWait });

    expect(messages).toEqual([]);
    expect(result).toMatchObject({ notDue: 2, nextDueAt: null });
  });

  it("before the schedule is deployed, every eligible reader is due at once, as before", async () => {
    const { store } = editionStore(null);
    const { client, messages } = createClient();

    const result = await sendEditionNotifications({ store, client, dropDate: EDITION, rateLimiter: noWait });

    expect(messages).toHaveLength(2);
    expect(result.localTimeGate).toBe("unavailable");
  });

  it("does not hold back a single-reader test send, which is an instruction", async () => {
    let asked = false;
    const { store } = editionStore(undefined, {
      loadEditionReadySchedule: async () => {
        asked = true;
        return new Map([[CHICAGO, { dueAt: "2026-09-15T00:00:00+00:00", isDue: false }]]);
      }
    });
    const { client, messages } = createClient();

    const result = await sendEditionNotifications({
      store,
      client,
      dropDate: EDITION,
      onlyUserIds: [CHICAGO],
      rateLimiter: noWait
    });

    expect(asked).toBe(false);
    expect(messages.map((message) => message.to)).toEqual(["ExponentPushToken[chicago]"]);
    expect(result.localTimeGate).toBe("bypassed");
  });
});
