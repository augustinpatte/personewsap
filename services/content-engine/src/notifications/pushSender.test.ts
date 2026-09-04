import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Language } from "../domain.js";
import {
  buildEditionNotificationMessage,
  chunkForExpo,
  classifyExpoPushReceipt,
  classifyExpoPushTicket,
  EDITION_NOTIFICATION_KIND,
  EXPO_PUSH_CHUNK_SIZE,
  EXPO_PUSH_MESSAGES_PER_SECOND,
  EXPO_RECEIPT_CHUNK_SIZE,
  ExpoPushHttpError,
  isCompleteEdition,
  resolveEditionNotificationRecipients,
  selectPendingRecipients,
  type ExpoPushReceipt,
  type ExpoPushTicket,
  type NotificationCandidateDrop,
  type NotificationCandidateToken
} from "./editionNotification.js";
import {
  reconcileExpoPushReceipts,
  createPushRateLimiter,
  sendEditionNotifications,
  type DeliveryRecord,
  type ExpoPushClient,
  type ExpoPushReceiptClient,
  type PushNotificationStore
} from "./pushSender.js";

/**
 * One notification per published edition, per device.
 *
 * The property that matters most is exactly-once: the daily job is re-runnable
 * by design (a GitHub Actions replay, a manual dispatch, a retry after an Expo
 * outage), and none of those may tell a reader twice that the same edition is
 * ready.
 */

const FR_USER = "11111111-1111-4111-8111-111111111111";
const EN_USER = "22222222-2222-4222-8222-222222222222";
const DROP_DATE = "2026-08-17";
const ATTEMPTED_AT = "2026-08-17T07:20:00.000Z";

function drop(overrides: Partial<NotificationCandidateDrop> = {}): NotificationCandidateDrop {
  return {
    dailyDropId: "drop-1",
    userId: FR_USER,
    language: "fr",
    status: "published",
    slots: ["newsletter", "business_story", "mini_case"],
    ...overrides
  };
}

function token(overrides: Partial<NotificationCandidateToken> = {}): NotificationCandidateToken {
  return {
    pushTokenId: "token-1",
    userId: FR_USER,
    expoPushToken: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]",
    enabled: true,
    ...overrides
  };
}

/** In-memory stand-in with the same idempotency rule as the unique index. */
function createStore(seed: {
  drops: NotificationCandidateDrop[];
  tokens: NotificationCandidateToken[];
  notificationsEnabled: string[];
  deliveries?: DeliveryRecord[];
  /** `profiles.language` at send time; absent means the profile read found nothing. */
  currentLanguages?: Record<string, Language>;
}) {
  const deliveries = new Map<string, DeliveryRecord>();
  const disabledTokens: string[] = [];
  const claims: string[][] = [];

  for (const delivery of seed.deliveries ?? []) {
    deliveries.set(`${delivery.pushTokenId}|${delivery.dropDate}|${delivery.notificationKind}`, {
      ...delivery
    });
  }

  const store: PushNotificationStore = {
    loadEditionDrops: async () => seed.drops,
    loadNotificationsEnabledUserIds: async () => new Set(seed.notificationsEnabled),
    loadCurrentUserLanguages: async () =>
      new Map(Object.entries(seed.currentLanguages ?? {})),
    loadEnabledPushTokens: async () => seed.tokens.filter((entry) => entry.enabled),
    loadDeliveries: async ({ dropDate, notificationKind }) =>
      [...deliveries.values()].filter(
        (row) => row.dropDate === dropDate && row.notificationKind === notificationKind
      ),
    claimDeliveries: async (rows) => {
      const claimed = new Set<string>();
      claims.push(rows.map((row) => row.pushTokenId));

      for (const row of rows) {
        const key = `${row.pushTokenId}|${row.dropDate}|${row.notificationKind}`;
        const existing = deliveries.get(key);

        if (existing && existing.status !== "pending" && existing.status !== "retryable_failure") {
          continue;
        }

        deliveries.set(key, {
          pushTokenId: row.pushTokenId,
          dropDate: row.dropDate,
          notificationKind: row.notificationKind,
          status: "claimed",
          attemptCount: existing?.attemptCount ?? 0,
          expoTicketId: existing?.expoTicketId ?? null,
          lastAttemptAt: existing?.lastAttemptAt ?? null,
          receiptCheckedAt: existing?.receiptCheckedAt ?? null
        });
        claimed.add(row.pushTokenId);
      }

      return claimed;
    },
    recordDeliveryResult: async ({ pushTokenId, dropDate, notificationKind, outcome }) => {
      const key = `${pushTokenId}|${dropDate}|${notificationKind}`;
      const existing = deliveries.get(key);

      deliveries.set(key, {
        pushTokenId,
        dropDate,
        notificationKind,
        status:
          outcome.kind === "ticket_accepted"
            ? "awaiting_receipt"
            : outcome.kind === "permanent" || outcome.kind === "token_invalid"
              ? "terminal_failure"
              : "retryable_failure",
        attemptCount: (existing?.attemptCount ?? 0) + 1,
        expoTicketId: outcome.kind === "ticket_accepted" ? outcome.expoTicketId : null,
        lastAttemptAt: ATTEMPTED_AT,
        receiptCheckedAt: existing?.receiptCheckedAt ?? null
      });
    },
    loadAwaitingReceipts: async ({ limit, checkedBefore }) =>
      [...deliveries.values()]
        .filter(
          (row) =>
            row.status === "awaiting_receipt" &&
            Boolean(row.expoTicketId) &&
            (!row.receiptCheckedAt || row.receiptCheckedAt < checkedBefore)
        )
        .slice(0, limit),
    recordReceiptResult: async ({ pushTokenId, dropDate, notificationKind, outcome, checkedAt }) => {
      const key = `${pushTokenId}|${dropDate}|${notificationKind}`;
      const existing = deliveries.get(key);

      deliveries.set(key, {
        pushTokenId,
        dropDate,
        notificationKind,
        status:
          outcome.kind === "sent"
            ? "sent"
            : outcome.kind === "retryable"
              ? "awaiting_receipt"
              : "terminal_failure",
        attemptCount: existing?.attemptCount ?? 0,
        expoTicketId: existing?.expoTicketId ?? null,
        lastAttemptAt: existing?.lastAttemptAt ?? null,
        receiptCheckedAt: checkedAt
      });
    },
    disablePushToken: async (pushTokenId) => {
      disabledTokens.push(pushTokenId);
      const target = seed.tokens.find((entry) => entry.pushTokenId === pushTokenId);

      if (target) {
        target.enabled = false;
      }
    }
  };

  return { store, deliveries, disabledTokens, claims };
}

function createClient(tickets: ExpoPushTicket[] | (() => never)): ExpoPushClient & {
  messages: unknown[][];
} {
  const messages: unknown[][] = [];

  return {
    messages,
    send: async (batch) => {
      messages.push(batch);

      if (typeof tickets === "function") {
        tickets();
      }

      return { tickets: tickets.slice(0, batch.length) };
    }
  };
}

function createSequentialClient(): ExpoPushClient & { messages: unknown[][] } {
  const messages: unknown[][] = [];
  let ticketIndex = 0;

  return {
    messages,
    send: async (batch) => {
      messages.push(batch);
      const tickets = batch.map(() => ({
        status: "ok" as const,
        id: `ticket-${ticketIndex++}`
      }));

      return { tickets };
    }
  };
}

function createReceiptClient(
  receipts: Record<string, ExpoPushReceipt>
): ExpoPushReceiptClient & { ticketIds: string[][] } {
  const ticketIds: string[][] = [];

  return {
    ticketIds,
    getReceipts: async (ids) => {
      ticketIds.push(ids);
      return { receipts };
    }
  };
}

const okTickets = (count: number): ExpoPushTicket[] =>
  Array.from({ length: count }, (_, index) => ({ status: "ok", id: `ticket-${index}` }));

describe("message", () => {
  it("is written in the edition's language, and says only what is true", () => {
    const fr = buildEditionNotificationMessage("fr", DROP_DATE);
    const en = buildEditionNotificationMessage("en", DROP_DATE);

    expect(fr.title).toBe("Votre édition du jour est arrivée");
    expect(fr.body).toBe("Venez la découvrir dans PersoNews.");
    expect(en.title).toBe("Today's edition is here");
    expect(en.body).toBe("Come discover it in PersoNews.");
    expect(fr.title).not.toBe(en.title);

    // No streak, no count, no urgency.
    for (const message of [fr, en]) {
      expect(`${message.title} ${message.body}`).not.toMatch(/\d/);
      expect(message.data).toEqual({ type: "edition_ready", drop_date: DROP_DATE });
    }
  });
});

describe("eligibility", () => {
  it("requires every promised slot", () => {
    expect(isCompleteEdition(drop())).toBe(true);
    expect(isCompleteEdition(drop({ slots: ["newsletter", "business_story"] }))).toBe(false);
    expect(
      isCompleteEdition(
        drop({
          slots: ["newsletter", "business_story"],
          requiredSlots: ["newsletter", "business_story"]
        })
      )
    ).toBe(true);
    expect(isCompleteEdition(drop({ slots: [] }))).toBe(false);
  });

  it.each([
    ["an unpublished drop", drop({ status: "generated" }), "drop_not_published"],
    [
      "an incomplete edition",
      drop({ slots: ["newsletter"] }),
      "incomplete_edition"
    ]
  ])("skips %s", (_name, candidate, reason) => {
    const resolved = resolveEditionNotificationRecipients({
      dropDate: DROP_DATE,
      drops: [candidate],
      tokensByUserId: new Map([[FR_USER, [token()]]]),
      notificationsEnabledUserIds: new Set([FR_USER])
    });

    expect(resolved.recipients).toHaveLength(0);
    expect(resolved.skipped[0].reason).toBe(reason);
  });

  it("skips a reader who did not ask for notifications", () => {
    const resolved = resolveEditionNotificationRecipients({
      dropDate: DROP_DATE,
      drops: [drop()],
      tokensByUserId: new Map([[FR_USER, [token()]]]),
      notificationsEnabledUserIds: new Set()
    });

    expect(resolved.recipients).toHaveLength(0);
    expect(resolved.skipped[0].reason).toBe("notifications_disabled");
  });

  it("skips a reader with no live device", () => {
    const resolved = resolveEditionNotificationRecipients({
      dropDate: DROP_DATE,
      drops: [drop()],
      tokensByUserId: new Map([[FR_USER, [token({ enabled: false })]]]),
      notificationsEnabledUserIds: new Set([FR_USER])
    });

    expect(resolved.recipients).toHaveLength(0);
    expect(resolved.skipped[0].reason).toBe("no_enabled_token");
  });

  it("allows a complete edition for the modules this reader enabled", () => {
    const resolved = resolveEditionNotificationRecipients({
      dropDate: DROP_DATE,
      drops: [
        drop({
          slots: ["newsletter", "business_story"],
          requiredSlots: ["newsletter", "business_story"]
        })
      ],
      tokensByUserId: new Map([[FR_USER, [token()]]]),
      notificationsEnabledUserIds: new Set([FR_USER])
    });

    expect(resolved.recipients).toHaveLength(1);
    expect(resolved.recipients[0].message.body).toBe(
      "Venez la découvrir dans PersoNews."
    );
  });

  it("tells each of a reader's devices once", () => {
    const resolved = resolveEditionNotificationRecipients({
      dropDate: DROP_DATE,
      drops: [drop()],
      tokensByUserId: new Map([
        [FR_USER, [token(), token({ pushTokenId: "token-2", expoPushToken: "ExponentPushToken[b]" })]]
      ]),
      notificationsEnabledUserIds: new Set([FR_USER])
    });

    expect(resolved.recipients.map((entry) => entry.pushTokenId)).toEqual([
      "token-1",
      "token-2"
    ]);
  });
});

describe("expo tickets", () => {
  it.each([
    ["DeviceNotRegistered", "token_invalid"],
    ["MessageRateExceeded", "retryable"],
    ["MessageTooBig", "permanent"],
    ["MismatchSenderId", "permanent"],
    ["InvalidCredentials", "permanent"],
    ["SomethingNew", "retryable"]
  ])("classifies %s as %s", (detail, kind) => {
    expect(
      classifyExpoPushTicket({
        status: "error",
        message: detail,
        details: { error: detail }
      }).kind
    ).toBe(kind);
  });

  it("keeps the ticket id of a successful send", () => {
    expect(classifyExpoPushTicket({ status: "ok", id: "ticket-9" })).toEqual({
      kind: "ticket_accepted",
      expoTicketId: "ticket-9"
    });
  });
});

describe("expo receipts", () => {
  it.each([
    ["DeviceNotRegistered", "token_invalid"],
    ["MessageRateExceeded", "retryable"],
    ["MessageTooBig", "permanent"],
    ["MismatchSenderId", "permanent"],
    ["InvalidCredentials", "permanent"],
    ["SomethingNew", "retryable"]
  ])("classifies %s as %s", (detail, kind) => {
    expect(
      classifyExpoPushReceipt({
        status: "error",
        message: detail,
        details: { error: detail }
      }).kind
    ).toBe(kind);
  });
});

describe("sending", () => {
  const seed = () => ({
    drops: [drop(), drop({ dailyDropId: "drop-2", userId: EN_USER, language: "en" as const })],
    tokens: [token(), token({ pushTokenId: "token-2", userId: EN_USER })],
    notificationsEnabled: [FR_USER, EN_USER]
  });

  it("sends one message per device, in the reader's language", async () => {
    const { store } = createStore(seed());
    const client = createClient(okTickets(2));

    const result = await sendEditionNotifications({
      store,
      client,
      dropDate: DROP_DATE
    });

    expect(result.ticketAccepted).toBe(2);
    expect(result.awaitingReceipt).toBe(2);
    const batch = client.messages[0] as Array<{ title: string; data: unknown }>;
    expect(batch.map((message) => message.title)).toEqual([
      "Votre édition du jour est arrivée",
      "Today's edition is here"
    ]);
    expect(batch[0].data).toEqual({ type: "edition_ready", drop_date: DROP_DATE });
  });

  it("TEST 6: one published edition, one enabled reader, one valid token, one push", async () => {
    const { store, deliveries } = createStore({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [FR_USER],
      currentLanguages: { [FR_USER]: "fr" }
    });
    const client = createClient(okTickets(1));

    const result = await sendEditionNotifications({ store, client, dropDate: DROP_DATE });

    expect(result.ticketAccepted).toBe(1);
    expect(client.messages.flat()).toHaveLength(1);
    expect(deliveries.size).toBe(1);
  });

  it("TEST 9 (end to end): a reader who switched to English is sent English", async () => {
    // The drop is still the French edition published at 19:00; only the
    // profile moved. Nothing about the device row changed.
    const { store } = createStore({
      drops: [drop({ language: "fr" })],
      tokens: [token()],
      notificationsEnabled: [FR_USER],
      currentLanguages: { [FR_USER]: "en" }
    });
    const client = createClient(okTickets(1));

    await sendEditionNotifications({ store, client, dropDate: DROP_DATE });

    const batch = client.messages[0] as Array<{ title: string; body: string }>;
    expect(batch[0].title).toBe("Today's edition is here");
    expect(batch[0].body).toBe("Come discover it in PersoNews.");
  });

  it("TEST 13: retires a stored device whose token Expo cannot accept", async () => {
    const { store, disabledTokens } = createStore({
      drops: [drop()],
      tokens: [
        token({ pushTokenId: "expo-row" }),
        // Written by an earlier build from addPushTokenListener: the native
        // APNs token, not an Expo one.
        token({
          pushTokenId: "apns-row",
          expoPushToken: "fe71701d317f4c0a9b2d8e6f10a3c5b7fe71701d317f4c0a9b2d8e6f10a3c5b7"
        })
      ],
      notificationsEnabled: [FR_USER],
      currentLanguages: { [FR_USER]: "fr" }
    });
    const client = createClient(okTickets(1));

    const result = await sendEditionNotifications({ store, client, dropDate: DROP_DATE });

    // The good device is still notified; the unusable row is retired, not retried.
    expect(client.messages.flat()).toHaveLength(1);
    expect(disabledTokens).toEqual(["apns-row"]);
    expect(result.disabledTokens).toBe(1);
  });

  it("restricts the send to one reader when a single-user test asks for it", async () => {
    const { store } = createStore({
      ...seed(),
      currentLanguages: { [FR_USER]: "fr", [EN_USER]: "en" }
    });
    const client = createClient(okTickets(2));

    const result = await sendEditionNotifications({
      store,
      client,
      dropDate: DROP_DATE,
      onlyUserIds: [EN_USER]
    });

    expect(result.ticketAccepted).toBe(1);
    const batch = client.messages[0] as Array<{ title: string }>;
    expect(batch).toHaveLength(1);
    expect(batch[0].title).toBe("Today's edition is here");
  });

  it("sends nothing the second time it runs", async () => {
    const state = createStore(seed());
    const first = await sendEditionNotifications({
      store: state.store,
      client: createClient(okTickets(2)),
      dropDate: DROP_DATE
    });

    const secondClient = createClient(okTickets(2));
    const second = await sendEditionNotifications({
      store: state.store,
      client: secondClient,
      dropDate: DROP_DATE
    });

    expect(first.ticketAccepted).toBe(2);
    expect(second.ticketAccepted).toBe(0);
    expect(second.awaitingReceipt).toBe(2);
    // The decisive assertion: no request left for Expo at all.
    expect(secondClient.messages).toHaveLength(0);
  });

  it("retires a device Expo reports as gone, and stops using it", async () => {
    const state = createStore(seed());
    const client = createClient([
      { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "ticket-1" }
    ]);

    const result = await sendEditionNotifications({
      store: state.store,
      client,
      dropDate: DROP_DATE
    });

    expect(result.disabledTokens).toBe(1);
    expect(state.disabledTokens).toEqual(["token-1"]);
    expect(result.ticketAccepted).toBe(1);
    // Terminal: the next run must not try it again.
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "terminal_failure"
    );
  });

  it("leaves a transient failure pending and delivers it on the retry", async () => {
    const state = createStore(seed());

    const failing = await sendEditionNotifications({
      store: state.store,
      client: createClient([
        { status: "error", message: "slow down", details: { error: "MessageRateExceeded" } },
        { status: "ok", id: "ticket-1" }
      ]),
      dropDate: DROP_DATE
    });

    expect(failing.retryable).toBe(1);
    expect(failing.ticketAccepted).toBe(1);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "retryable_failure"
    );

    const retryClient = createClient(okTickets(1));
    const retried = await sendEditionNotifications({
      store: state.store,
      client: retryClient,
      dropDate: DROP_DATE
    });

    // Only the device that never received it is attempted again.
    expect(retried.ticketAccepted).toBe(1);
    expect(retryClient.messages[0]).toHaveLength(1);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "awaiting_receipt"
    );
  });

  it("survives Expo being unreachable, keeping everything retryable", async () => {
    const state = createStore(seed());

    const result = await sendEditionNotifications({
      store: state.store,
      client: createClient(() => {
        throw new Error("Expo push request failed with status 503");
      }),
      dropDate: DROP_DATE
    });

    expect(result.ticketAccepted).toBe(0);
    expect(result.retryable).toBe(2);
    // The edition stays published; only the announcement is outstanding.
    expect(
      [...state.deliveries.values()].every((delivery) => delivery.status === "retryable_failure")
    ).toBe(true);
  });

  it("does nothing when no edition was published", async () => {
    const { store } = createStore({ drops: [], tokens: [], notificationsEnabled: [] });
    const client = createClient(okTickets(1));

    const result = await sendEditionNotifications({ store, client, dropDate: DROP_DATE });

    expect(result.ticketAccepted).toBe(0);
    expect(client.messages).toHaveLength(0);
  });

  it("announces nothing for an incomplete edition", async () => {
    const { store } = createStore({
      drops: [drop({ slots: ["newsletter"] })],
      tokens: [token()],
      notificationsEnabled: [FR_USER]
    });
    const client = createClient(okTickets(1));

    const result = await sendEditionNotifications({ store, client, dropDate: DROP_DATE });

    expect(result.ticketAccepted).toBe(0);
    expect(result.skipped[0].reason).toBe("incomplete_edition");
    expect(client.messages).toHaveLength(0);
  });
});

describe("batching", () => {
  it("splits into Expo-sized requests", () => {
    expect(chunkForExpo(Array.from({ length: 250 }, (_, index) => index)).map((c) => c.length)).toEqual(
      [100, 100, 50]
    );
    expect(chunkForExpo([])).toEqual([]);
  });

  it("scales to a large readership without losing anyone", async () => {
    const drops = Array.from({ length: 250 }, (_, index) =>
      drop({ dailyDropId: `drop-${index}`, userId: `user-${index}` })
    );
    const tokens = drops.map((entry, index) =>
      token({
        pushTokenId: `token-${index}`,
        userId: entry.userId,
        expoPushToken: `ExponentPushToken[${index}]`
      })
    );
    const { store } = createStore({
      drops,
      tokens,
      notificationsEnabled: drops.map((entry) => entry.userId)
    });
    const client = createClient(okTickets(100));

    const result = await sendEditionNotifications({ store, client, dropDate: DROP_DATE });

    expect(result.ticketAccepted).toBe(250);
    expect(client.messages.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });

  it("sends 10,000 recipients without exceeding 500 messages per second", async () => {
    const recipients = 10_000;
    const drops = Array.from({ length: recipients }, (_, index) =>
      drop({ dailyDropId: `drop-${index}`, userId: `user-${index}` })
    );
    const tokens = drops.map((entry, index) =>
      token({
        pushTokenId: `token-${index}`,
        userId: entry.userId,
        expoPushToken: `ExponentPushToken[${index}]`
      })
    );
    const state = createStore({
      drops,
      tokens,
      notificationsEnabled: drops.map((entry) => entry.userId)
    });
    const client = createSequentialClient();
    let currentMs = 0;
    const messagesBySecond = new Map<number, number>();
    const rateLimiter = createPushRateLimiter({
      messagesPerSecond: EXPO_PUSH_MESSAGES_PER_SECOND,
      nowMs: () => currentMs,
      sleep: async (ms) => {
        currentMs += ms;
      }
    });

    const result = await sendEditionNotifications({
      store: state.store,
      client: {
        send: async (messages) => {
          const second = Math.floor(currentMs / 1000);
          messagesBySecond.set(second, (messagesBySecond.get(second) ?? 0) + messages.length);
          return client.send(messages);
        }
      },
      dropDate: DROP_DATE,
      rateLimiter
    });

    expect(result.ticketAccepted).toBe(recipients);
    expect(client.messages).toHaveLength(recipients / EXPO_PUSH_CHUNK_SIZE);
    expect(Math.max(...messagesBySecond.values())).toBeLessThanOrEqual(
      EXPO_PUSH_MESSAGES_PER_SECOND
    );
  });
});

describe("atomic claiming and receipts", () => {
  it("lets only one worker send a claimed delivery", async () => {
    const state = createStore({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [FR_USER]
    });
    const firstClient = createClient(okTickets(1));
    const secondClient = createClient(okTickets(1));

    const [first, second] = await Promise.all([
      sendEditionNotifications({ store: state.store, client: firstClient, dropDate: DROP_DATE }),
      sendEditionNotifications({ store: state.store, client: secondClient, dropDate: DROP_DATE })
    ]);

    expect(first.ticketAccepted + second.ticketAccepted).toBe(1);
    expect(firstClient.messages.length + secondClient.messages.length).toBe(1);
    expect(state.claims).toHaveLength(2);
  });

  it("marks an ok receipt as final sent", async () => {
    const state = createStore({
      drops: [],
      tokens: [token()],
      notificationsEnabled: [],
      deliveries: [
        {
          pushTokenId: "token-1",
          dropDate: DROP_DATE,
          notificationKind: EDITION_NOTIFICATION_KIND,
          status: "awaiting_receipt",
          attemptCount: 1,
          expoTicketId: "ticket-1",
          lastAttemptAt: ATTEMPTED_AT
        }
      ]
    });

    const result = await reconcileExpoPushReceipts({
      store: state.store,
      client: createReceiptClient({ "ticket-1": { status: "ok" } }),
      now: () => "2026-08-17T07:45:00.000Z"
    });

    expect(result.sent).toBe(1);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "sent"
    );
  });

  it("retires a token when the receipt says DeviceNotRegistered", async () => {
    const state = createStore({
      drops: [],
      tokens: [token()],
      notificationsEnabled: [],
      deliveries: [
        {
          pushTokenId: "token-1",
          dropDate: DROP_DATE,
          notificationKind: EDITION_NOTIFICATION_KIND,
          status: "awaiting_receipt",
          attemptCount: 1,
          expoTicketId: "ticket-1",
          lastAttemptAt: ATTEMPTED_AT
        }
      ]
    });

    const result = await reconcileExpoPushReceipts({
      store: state.store,
      client: createReceiptClient({
        "ticket-1": {
          status: "error",
          message: "Device not registered",
          details: { error: "DeviceNotRegistered" }
        }
      }),
      now: () => "2026-08-17T07:45:00.000Z"
    });

    expect(result.disabledTokens).toBe(1);
    expect(state.disabledTokens).toEqual(["token-1"]);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "terminal_failure"
    );
  });

  it("keeps a missing receipt awaiting and later marks it sent without resending", async () => {
    const state = createStore({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [FR_USER],
      deliveries: [
        {
          pushTokenId: "token-1",
          dropDate: DROP_DATE,
          notificationKind: EDITION_NOTIFICATION_KIND,
          status: "awaiting_receipt",
          attemptCount: 1,
          expoTicketId: "ticket-1",
          lastAttemptAt: ATTEMPTED_AT
        }
      ]
    });

    const missing = await reconcileExpoPushReceipts({
      store: state.store,
      client: createReceiptClient({}),
      now: () => "2026-08-17T07:30:00.000Z"
    });

    expect(missing.retryable).toBe(1);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "awaiting_receipt"
    );

    const sendClient = createClient(okTickets(1));
    const resent = await sendEditionNotifications({
      store: state.store,
      client: sendClient,
      dropDate: DROP_DATE
    });

    expect(resent.ticketAccepted).toBe(0);
    expect(sendClient.messages).toHaveLength(0);

    const later = await reconcileExpoPushReceipts({
      store: state.store,
      client: createReceiptClient({ "ticket-1": { status: "ok" } }),
      now: () => "2026-08-17T07:45:00.000Z"
    });

    expect(later.sent).toBe(1);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "sent"
    );
  });

  it("drains 10,000 awaiting receipts without exceeding Expo receipt request size", async () => {
    const deliveries = Array.from({ length: 10_000 }, (_, index): DeliveryRecord => ({
      pushTokenId: `token-${index}`,
      dropDate: DROP_DATE,
      notificationKind: EDITION_NOTIFICATION_KIND,
      status: "awaiting_receipt",
      attemptCount: 1,
      expoTicketId: `ticket-${index}`,
      lastAttemptAt: ATTEMPTED_AT
    }));
    const state = createStore({
      drops: [],
      tokens: [],
      notificationsEnabled: [],
      deliveries
    });
    const client = createReceiptClient({});
    client.getReceipts = async (ids) => {
      client.ticketIds.push(ids);
      return {
        receipts: Object.fromEntries(ids.map((id) => [id, { status: "ok" as const }]))
      };
    };

    const result = await reconcileExpoPushReceipts({
      store: state.store,
      client,
      limit: 10_000,
      now: () => "2026-08-17T07:45:00.000Z"
    });

    expect(result.checked).toBe(10_000);
    expect(result.sent).toBe(10_000);
    expect(client.ticketIds).toHaveLength(10);
    expect(Math.max(...client.ticketIds.map((ids) => ids.length))).toBeLessThanOrEqual(
      EXPO_RECEIPT_CHUNK_SIZE
    );
  });

  it("expires unresolved receipts after Expo's retention window", async () => {
    const state = createStore({
      drops: [],
      tokens: [token()],
      notificationsEnabled: [],
      deliveries: [
        {
          pushTokenId: "token-1",
          dropDate: DROP_DATE,
          notificationKind: EDITION_NOTIFICATION_KIND,
          status: "awaiting_receipt",
          attemptCount: 1,
          expoTicketId: "ticket-1",
          lastAttemptAt: "2026-08-16T07:20:00.000Z"
        }
      ]
    });
    const client = createReceiptClient({});

    const result = await reconcileExpoPushReceipts({
      store: state.store,
      client,
      now: () => "2026-08-17T07:20:01.000Z"
    });

    expect(result.expired).toBe(1);
    expect(result.permanentFailures).toBe(1);
    expect(client.ticketIds).toHaveLength(0);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "terminal_failure"
    );
  });

  it("does not retry terminal receipt failures", async () => {
    const state = createStore({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [FR_USER],
      deliveries: [
        {
          pushTokenId: "token-1",
          dropDate: DROP_DATE,
          notificationKind: EDITION_NOTIFICATION_KIND,
          status: "terminal_failure",
          attemptCount: 1,
          expoTicketId: "ticket-1"
        }
      ]
    });
    const client = createClient(okTickets(1));

    const result = await sendEditionNotifications({
      store: state.store,
      client,
      dropDate: DROP_DATE
    });

    expect(result.ticketAccepted).toBe(0);
    expect(client.messages).toHaveLength(0);
  });
});

describe("transport retries", () => {
  it.each([429, 503])("retries Expo HTTP %s with exponential backoff", async (status) => {
    const state = createStore({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [FR_USER]
    });
    const delays: number[] = [];
    let attempts = 0;

    const result = await sendEditionNotifications({
      store: state.store,
      client: {
        send: async (messages) => {
          attempts += 1;
          if (attempts < 3) {
            throw new ExpoPushHttpError(status, `Expo push request failed with status ${status}`);
          }
          return { tickets: okTickets(messages.length) };
        }
      },
      dropDate: DROP_DATE,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitterRatio: 0,
        sleep: async (ms) => {
          delays.push(ms);
        }
      }
    });

    expect(result.ticketAccepted).toBe(1);
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it("marks retry exhaustion as retryable and lets the next run recover", async () => {
    const state = createStore({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [FR_USER]
    });
    let attempts = 0;

    const failed = await sendEditionNotifications({
      store: state.store,
      client: {
        send: async () => {
          attempts += 1;
          throw new ExpoPushHttpError(503, "Expo push request failed with status 503");
        }
      },
      dropDate: DROP_DATE,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
        sleep: async () => {}
      }
    });

    expect(attempts).toBe(2);
    expect(failed.retryable).toBe(1);

    const recovered = await sendEditionNotifications({
      store: state.store,
      client: createClient(okTickets(1)),
      dropDate: DROP_DATE
    });

    expect(recovered.ticketAccepted).toBe(1);
  });

  it("does not retry permanent HTTP request failures", async () => {
    const state = createStore({
      drops: [drop()],
      tokens: [token()],
      notificationsEnabled: [FR_USER]
    });
    let attempts = 0;

    const result = await sendEditionNotifications({
      store: state.store,
      client: {
        send: async () => {
          attempts += 1;
          throw new ExpoPushHttpError(400, "Expo push request failed with status 400");
        }
      },
      dropDate: DROP_DATE,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1,
        jitterRatio: 0,
        sleep: async () => {}
      }
    });

    expect(attempts).toBe(1);
    expect(result.permanentFailures).toBe(1);
    expect(state.deliveries.get(`token-1|${DROP_DATE}|${EDITION_NOTIFICATION_KIND}`)?.status).toBe(
      "terminal_failure"
    );
  });
});

describe("workflow schedules", () => {
  it("uses Europe/Paris on edition, send retry and receipt schedules", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      ".github/workflows/content-daily-job.yml",
      ".github/workflows/push-notification-retry.yml",
      ".github/workflows/push-receipts.yml"
    ];
    const workflows = await Promise.all(
      files.map((file) => readFile(file, "utf8"))
    );

    for (const workflow of workflows) {
      expect(workflow).toContain('timezone: "Europe/Paris"');
      expect(workflow).toContain("* * 1,3,5,0");
    }

    // The edition itself is published by Supabase cron at 19:00 Europe/Paris.
    // This workflow only announces an edition that already exists, so it starts
    // ten minutes later — announcing at 19:00 would race the publisher.
    expect(workflows[0]).toContain('cron: "10 19 * * 1,3,5,0"');
    expect(workflows[1]).toContain('cron: "15 19 * * 1,3,5,0"');
    expect(workflows[1]).toContain('cron: "30 19 * * 1,3,5,0"');
    expect(workflows[1]).toContain('cron: "0 20 * * 1,3,5,0"');
    expect(workflows[2]).toContain('cron: "35 19 * * 1,3,5,0"');
    expect(workflows[2]).toContain('cron: "35 20 * * 1,3,5,0"');
    expect(workflows[2]).toContain('cron: "35 21 * * 1,3,5,0"');
  });

  it("does not publish editions from CI", async () => {
    const { readFile } = await import("node:fs/promises");
    const workflow = await readFile(".github/workflows/content-daily-job.yml", "utf8");

    // Publication belongs to the Supabase scheduled publisher and to nothing
    // else. A second publisher writing the same edition through a different
    // dedup key is the duplicate this repository must not be able to produce.
    // Comment lines are excluded on purpose: the file explains at length why the
    // publish step is gone, and naming the removed command is part of that.
    const executable = workflow
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"));

    expect(executable.some((line) => line.includes("staging-publish"))).toBe(false);
    expect(executable.some((line) => line.includes("publish_scheduled_staging_payload"))).toBe(false);
  });
});

describe("pending selection", () => {
  it("skips devices already notified for this edition", () => {
    const recipients = resolveEditionNotificationRecipients({
      dropDate: DROP_DATE,
      drops: [drop()],
      tokensByUserId: new Map([
        [FR_USER, [token(), token({ pushTokenId: "token-2" })]]
      ]),
      notificationsEnabledUserIds: new Set([FR_USER])
    }).recipients;

    expect(
      selectPendingRecipients({
        recipients,
        alreadySentTokenIds: new Set(["token-1"])
      }).map((entry) => entry.pushTokenId)
    ).toEqual(["token-2"]);
  });
});
