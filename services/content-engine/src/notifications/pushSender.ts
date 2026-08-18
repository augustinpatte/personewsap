import type { DailyDropSlot, Language } from "../domain.js";
import { redactIdentifier } from "../utils/redactIdentifier.js";
import {
  chunkForExpo,
  classifyExpoPushTicket,
  classifyExpoRequestFailure,
  EDITION_NOTIFICATION_KIND,
  resolveEditionNotificationRecipients,
  selectPendingRecipients,
  toExpoPushMessage,
  type DeliveryOutcome,
  type EditionNotificationRecipient,
  type ExpoPushTicket,
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

export type DeliveryRecord = {
  pushTokenId: string;
  dropDate: string;
  notificationKind: string;
  status: "pending" | "sent" | "failed";
  attemptCount: number;
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
  /** Idempotent: an existing (token, date, kind) row is left as it is. */
  reserveDeliveries: (
    rows: Array<{
      pushTokenId: string;
      userId: string;
      dropDate: string;
      notificationKind: string;
    }>
  ) => Promise<void>;
  recordDeliveryResult: (input: {
    pushTokenId: string;
    dropDate: string;
    notificationKind: string;
    outcome: DeliveryOutcome;
    attemptedAt: string;
  }) => Promise<void>;
  /** Retires a device whose token Expo reports as gone. */
  disablePushToken: (pushTokenId: string, reason: string) => Promise<void>;
};

export type ExpoPushClient = {
  send: (
    messages: ReturnType<typeof toExpoPushMessage>[]
  ) => Promise<{ tickets: ExpoPushTicket[] }>;
};

export type SendEditionNotificationsResult = {
  dropDate: string;
  /** Devices that received the notification in this run. */
  sent: number;
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
    sent: 0,
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

  const pending = selectPendingRecipients({
    recipients: resolved.recipients,
    alreadySentTokenIds
  });

  result.alreadySent = resolved.recipients.length - pending.length;

  if (pending.length === 0) {
    console.info("[content-engine] edition notification already delivered", {
      drop_date: input.dropDate,
      already_sent: result.alreadySent,
      skipped: resolved.skipped.length
    });
    return result;
  }

  // Reserve first: a row exists for every device we are about to attempt, so a
  // crash mid-run leaves a retryable trace rather than a silent gap.
  await input.store.reserveDeliveries(
    pending.map((recipient) => ({
      pushTokenId: recipient.pushTokenId,
      userId: recipient.userId,
      dropDate: input.dropDate,
      notificationKind: EDITION_NOTIFICATION_KIND
    }))
  );

  for (const chunk of chunkForExpo(pending)) {
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

      if (outcome.kind === "sent") {
        result.sent += 1;
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
    sent: result.sent,
    already_sent: result.alreadySent,
    retryable: result.retryable,
    permanent_failures: result.permanentFailures,
    disabled_tokens: result.disabledTokens,
    skipped: result.skipped.length
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

export type { DailyDropSlot };
