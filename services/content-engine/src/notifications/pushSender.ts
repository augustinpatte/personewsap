import type { DailyDropSlot, Language } from "../domain.js";
import { redactIdentifier } from "../utils/redactIdentifier.js";
import {
  chunkForExpo,
  classifyExpoPushReceipt,
  classifyExpoPushTicket,
  classifyExpoRequestFailure,
  EDITION_NOTIFICATION_KIND,
  resolveEditionNotificationRecipients,
  selectPendingRecipients,
  toExpoPushMessage,
  type DeliveryOutcome,
  type EditionNotificationRecipient,
  type ExpoPushReceipt,
  type ExpoPushTicket,
  type ReceiptOutcome,
  type NotificationCandidateDrop,
  type NotificationCandidateToken,
  type RecipientSkipReason
} from "./editionNotification.js";

/**
 * Delivering the "your edition is ready" notification.
 *
 * Deliberately a separate step from content generation, and deliberately unable
 * to affect it: an Expo outage must never stop an edition from being published.
 * The daily job publishes; this runs afterwards and can be re-run at any time
 * because every delivery is recorded against
 * (push_token_id, drop_date, notification_kind).
 *
 * All persistence goes through the injected store, so the whole flow — chunking,
 * idempotency, ticket handling, token retirement — is tested against an
 * in-memory double rather than a live project.
 */

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_RECEIPTS_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";

export type DeliveryRecord = {
  pushTokenId: string;
  dropDate: string;
  notificationKind: string;
  status:
    | "pending"
    | "claimed"
    | "sending"
    | "ticket_accepted"
    | "awaiting_receipt"
    | "sent"
    | "retryable_failure"
    | "terminal_failure"
    | "failed";
  attemptCount: number;
  expoTicketId?: string | null;
};

export type PushNotificationStore = {
  /** Published drops for the date, with the slots they actually carry. */
  loadEditionDrops: (input: {
    dropDate: string;
    languages?: Language[];
  }) => Promise<NotificationCandidateDrop[]>;
  loadNotificationsEnabledUserIds: (userIds: string[]) => Promise<Set<string>>;
  loadEnabledPushTokens: (userIds: string[]) => Promise<NotificationCandidateToken[]>;
  loadDeliveries: (input: {
    dropDate: string;
    notificationKind: string;
  }) => Promise<DeliveryRecord[]>;
  /** Atomic lease: only returned token ids may continue to Expo send. */
  claimDeliveries: (
    rows: Array<{
      pushTokenId: string;
      userId: string;
      dropDate: string;
      notificationKind: string;
    }>
  ) => Promise<Set<string>>;
  recordDeliveryResult: (input: {
    pushTokenId: string;
    dropDate: string;
    notificationKind: string;
    outcome: DeliveryOutcome;
    attemptedAt: string;
  }) => Promise<void>;
  loadAwaitingReceipts: (limit: number) => Promise<DeliveryRecord[]>;
  recordReceiptResult: (input: {
    pushTokenId: string;
    dropDate: string;
    notificationKind: string;
    outcome: ReceiptOutcome;
    checkedAt: string;
  }) => Promise<void>;
  /** Retires a device whose token Expo reports as gone. */
  disablePushToken: (pushTokenId: string, reason: string) => Promise<void>;
};

export type ExpoPushClient = {
  send: (
    messages: ReturnType<typeof toExpoPushMessage>[]
  ) => Promise<{ tickets: ExpoPushTicket[] }>;
};

export type ExpoPushReceiptClient = {
  getReceipts: (ticketIds: string[]) => Promise<{ receipts: Record<string, ExpoPushReceipt> }>;
};

export type SendEditionNotificationsResult = {
  dropDate: string;
  /** Expo accepted the ticket; final device delivery is checked by receipts. */
  ticketAccepted: number;
  /** Waiting for receipt reconciliation. */
  awaitingReceipt: number;
  /** Already notified in an earlier run: the idempotency guarantee at work. */
  alreadySent: number;
  /** Failed but worth another run. */
  retryable: number;
  /** Failed for good (bad message/credentials). */
  permanentFailures: number;
  /** Tokens retired because the device is gone. */
  disabledTokens: number;
  skipped: Array<{ userId: string; reason: RecipientSkipReason }>;
};

export type ReconcilePushReceiptsResult = {
  checked: number;
  sent: number;
  retryable: number;
  permanentFailures: number;
  disabledTokens: number;
};

export async function sendEditionNotifications(input: {
  store: PushNotificationStore;
  client: ExpoPushClient;
  dropDate: string;
  languages?: Language[];
  now?: () => string;
}): Promise<SendEditionNotificationsResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const drops = await input.store.loadEditionDrops({
    dropDate: input.dropDate,
    languages: input.languages
  });

  const result: SendEditionNotificationsResult = {
    dropDate: input.dropDate,
    ticketAccepted: 0,
    awaitingReceipt: 0,
    alreadySent: 0,
    retryable: 0,
    permanentFailures: 0,
    disabledTokens: 0,
    skipped: []
  };

  if (drops.length === 0) {
    // A quiet day, or an edition that was never published: nothing to announce.
    console.info("[content-engine] no published edition to announce", {
      drop_date: input.dropDate
    });
    return result;
  }

  const userIds = [...new Set(drops.map((drop) => drop.userId))];
  const [notificationsEnabledUserIds, tokens] = await Promise.all([
    input.store.loadNotificationsEnabledUserIds(userIds),
    input.store.loadEnabledPushTokens(userIds)
  ]);

  const tokensByUserId = new Map<string, NotificationCandidateToken[]>();

  for (const token of tokens) {
    tokensByUserId.set(token.userId, [...(tokensByUserId.get(token.userId) ?? []), token]);
  }

  const resolved = resolveEditionNotificationRecipients({
    dropDate: input.dropDate,
    drops,
    tokensByUserId,
    notificationsEnabledUserIds
  });

  result.skipped = resolved.skipped;

  const deliveries = await input.store.loadDeliveries({
    dropDate: input.dropDate,
    notificationKind: EDITION_NOTIFICATION_KIND
  });
  const alreadySentTokenIds = new Set(
    deliveries.filter((row) => row.status === "sent").map((row) => row.pushTokenId)
  );
  const awaitingReceiptTokenIds = new Set(
    deliveries
      .filter((row) => row.status === "ticket_accepted" || row.status === "awaiting_receipt")
      .map((row) => row.pushTokenId)
  );
  const permanentlyFailedTokenIds = new Set(
    deliveries
      .filter((row) => row.status === "terminal_failure" || row.status === "failed")
      .map((row) => row.pushTokenId)
  );

  const pending = selectPendingRecipients({
    recipients: resolved.recipients,
    alreadySentTokenIds,
    awaitingReceiptTokenIds,
    permanentlyFailedTokenIds
  });

  result.alreadySent = alreadySentTokenIds.size;
  result.awaitingReceipt = awaitingReceiptTokenIds.size;

  if (pending.length === 0) {
    console.info("[content-engine] edition notification has no sendable recipients", {
      drop_date: input.dropDate,
      already_sent: result.alreadySent,
      awaiting_receipt: result.awaitingReceipt,
      skipped: resolved.skipped.length
    });
    return result;
  }

  const claimedTokenIds = await input.store.claimDeliveries(
    pending.map((recipient) => ({
      pushTokenId: recipient.pushTokenId,
      userId: recipient.userId,
      dropDate: input.dropDate,
      notificationKind: EDITION_NOTIFICATION_KIND
    }))
  );
  const claimed = pending.filter((recipient) => claimedTokenIds.has(recipient.pushTokenId));

  if (claimed.length === 0) {
    console.info("[content-engine] edition notification already claimed", {
      drop_date: input.dropDate,
      pending: pending.length
    });
    return result;
  }

  for (const chunk of chunkForExpo(claimed)) {
    const outcomes = await sendChunk(input.client, chunk);

    for (const [index, outcome] of outcomes.entries()) {
      const recipient = chunk[index];

      await input.store.recordDeliveryResult({
        pushTokenId: recipient.pushTokenId,
        dropDate: input.dropDate,
        notificationKind: EDITION_NOTIFICATION_KIND,
        outcome,
        attemptedAt: now()
      });

      if (outcome.kind === "ticket_accepted") {
        result.ticketAccepted += 1;
        result.awaitingReceipt += 1;
        continue;
      }

      if (outcome.kind === "token_invalid") {
        // Confirmed by Expo, not guessed: the device is gone.
        await input.store.disablePushToken(recipient.pushTokenId, outcome.error);
        result.disabledTokens += 1;
        console.info("[content-engine] retired push token", {
          push_token_id: redactIdentifier(recipient.pushTokenId),
          reason: outcome.error
        });
        continue;
      }

      if (outcome.kind === "permanent") {
        result.permanentFailures += 1;
        continue;
      }

      result.retryable += 1;
    }
  }

  console.info("[content-engine] edition notification delivery", {
    drop_date: input.dropDate,
    ticket_accepted: result.ticketAccepted,
    awaiting_receipt: result.awaitingReceipt,
    already_sent: result.alreadySent,
    retryable: result.retryable,
    permanent_failures: result.permanentFailures,
    disabled_tokens: result.disabledTokens,
    skipped: result.skipped.length
  });

  return result;
}

export async function reconcileExpoPushReceipts(input: {
  store: PushNotificationStore;
  client: ExpoPushReceiptClient;
  limit?: number;
  now?: () => string;
}): Promise<ReconcilePushReceiptsResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const awaiting = (await input.store.loadAwaitingReceipts(input.limit ?? 100)).filter(
    (row) => row.expoTicketId
  );
  const result: ReconcilePushReceiptsResult = {
    checked: awaiting.length,
    sent: 0,
    retryable: 0,
    permanentFailures: 0,
    disabledTokens: 0
  };

  if (awaiting.length === 0) {
    return result;
  }

  const ticketIds = awaiting
    .map((row) => row.expoTicketId)
    .filter((id): id is string => Boolean(id));
  const receipts = await input.client.getReceipts(ticketIds);

  for (const delivery of awaiting) {
    const receipt = delivery.expoTicketId ? receipts.receipts[delivery.expoTicketId] : null;
    const outcome = receipt
      ? classifyExpoPushReceipt(receipt)
      : ({ kind: "retryable", error: "Expo receipt was not available yet" } as const);

    await input.store.recordReceiptResult({
      pushTokenId: delivery.pushTokenId,
      dropDate: delivery.dropDate,
      notificationKind: delivery.notificationKind,
      outcome,
      checkedAt: now()
    });

    if (outcome.kind === "sent") {
      result.sent += 1;
      continue;
    }

    if (outcome.kind === "token_invalid") {
      await input.store.disablePushToken(delivery.pushTokenId, outcome.error);
      result.disabledTokens += 1;
      result.permanentFailures += 1;
      continue;
    }

    if (outcome.kind === "permanent") {
      result.permanentFailures += 1;
      continue;
    }

    result.retryable += 1;
  }

  console.info("[content-engine] expo push receipt reconciliation", {
    checked: result.checked,
    sent: result.sent,
    retryable: result.retryable,
    permanent_failures: result.permanentFailures,
    disabled_tokens: result.disabledTokens
  });

  return result;
}

async function sendChunk(
  client: ExpoPushClient,
  chunk: EditionNotificationRecipient[]
): Promise<DeliveryOutcome[]> {
  try {
    const response = await client.send(chunk.map(toExpoPushMessage));

    return chunk.map((_recipient, index) => {
      const ticket = response.tickets[index];

      // Expo answered, but not about this message: treat the gap as retryable
      // rather than assuming success.
      if (!ticket) {
        return {
          kind: "retryable" as const,
          error: "Expo returned no ticket for this message"
        };
      }

      return classifyExpoPushTicket(ticket);
    });
  } catch (error) {
    // One failed request must not lose the whole run: every message in the
    // chunk stays pending and the next run picks it up.
    const outcome = classifyExpoRequestFailure(error);

    return chunk.map(() => outcome);
  }
}

/** The real Expo Push client. No credential is needed for Expo push tokens. */
export function createExpoPushClient(
  fetchImpl: typeof fetch = fetch
): ExpoPushClient {
  return {
    async send(messages) {
      const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(messages)
      });

      if (!response.ok) {
        throw new Error(`Expo push request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { data?: ExpoPushTicket[] };

      return { tickets: payload.data ?? [] };
    }
  };
}

export function createExpoPushReceiptClient(
  fetchImpl: typeof fetch = fetch
): ExpoPushReceiptClient {
  return {
    async getReceipts(ticketIds) {
      if (ticketIds.length === 0) {
        return { receipts: {} };
      }

      const response = await fetchImpl(EXPO_PUSH_RECEIPTS_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ ids: ticketIds })
      });

      if (!response.ok) {
        throw new Error(`Expo receipt request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: Record<string, ExpoPushReceipt>;
      };

      return { receipts: payload.data ?? {} };
    }
  };
}

export type { DailyDropSlot };
