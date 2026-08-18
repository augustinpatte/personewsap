import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEditionNotificationMessage,
  chunkForExpo,
  classifyExpoPushReceipt,
  classifyExpoPushTicket,
  EDITION_NOTIFICATION_KIND,
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
          expoTicketId: existing?.expoTicketId ?? null
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
        expoTicketId: outcome.kind === "ticket_accepted" ? outcome.expoTicketId : null
      });
    },
    loadAwaitingReceipts: async (limit) =>
      [...deliveries.values()]
        .filter((row) => row.status === "awaiting_receipt" && Boolean(row.expoTicketId))
        .slice(0, limit),
    recordReceiptResult: async ({ pushTokenId, dropDate, notificationKind, outcome }) => {
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
              ? "retryable_failure"
              : "terminal_failure",
        attemptCount: existing?.attemptCount ?? 0,
        expoTicketId: existing?.expoTicketId ?? null
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

    expect(fr.title).toBe("Votre édition est prête");
    expect(fr.body).toBe("Votre nouvelle édition PersoNewsAP est disponible.");
    expect(en.title).toBe("Your edition is ready");
    expect(en.body).toBe("Your new PersoNewsAP edition is ready.");
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
      "Votre nouvelle édition PersoNewsAP est disponible."
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
      "Votre édition est prête",
      "Your edition is ready"
    ]);
    expect(batch[0].data).toEqual({ type: "edition_ready", drop_date: DROP_DATE });
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
          expoTicketId: "ticket-1"
        }
      ]
    });

    const result = await reconcileExpoPushReceipts({
      store: state.store,
      client: createReceiptClient({ "ticket-1": { status: "ok" } })
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
          expoTicketId: "ticket-1"
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
      })
    });

    expect(result.disabledTokens).toBe(1);
    expect(state.disabledTokens).toEqual(["token-1"]);
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
