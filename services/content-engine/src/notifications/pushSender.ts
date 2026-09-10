import type { DailyDropSlot, Language } from "../domain.js";
import { redactIdentifier } from "../utils/redactIdentifier.js";
import {
  chunkForExpo,
  classifyExpoPushReceipt,
  classifyExpoPushTicket,
  classifyExpoRequestFailure,
  EDITION_NOTIFICATION_KIND,
  EXPO_PUSH_MESSAGES_PER_SECOND,
  EXPO_RECEIPT_CHUNK_SIZE,
  EXPO_RECEIPT_RETENTION_MS,
  ExpoPushHttpError,
  isRetryableExpoRequestFailure,
  resolveEditionNotificationRecipients,
  selectPendingRecipients,
  isExpoPushToken,
  toExpoPushMessage,
  type DeliveryOutcome,
  type ExpoPushReceipt,
  type ExpoPushTicket,
  type PushMessageContent,
  type ReceiptOutcome,
  type NotificationCandidateDrop,
  type NotificationCandidateToken,
  type RecipientSkipReason
} from "./editionNotification.js";
import {
  ANSWER_REMINDER_NOTIFICATION_KIND,
  buildAnswerReminderMessage,
  type ClaimedAnswerReminder
} from "./answerReminder.js";

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
    | "failed"
    | "cancelled";
  attemptCount: number;
  expoTicketId?: string | null;
  lastAttemptAt?: string | null;
  receiptCheckedAt?: string | null;
};

export type PushNotificationStore = {
  /** Published drops for the date, with the slots they actually carry. */
  loadEditionDrops: (input: {
    dropDate: string;
    languages?: Language[];
  }) => Promise<NotificationCandidateDrop[]>;
  loadNotificationsEnabledUserIds: (userIds: string[]) => Promise<Set<string>>;
  /**
   * `profiles.language` as it is right now. Read on every send so a reader who
   * changed language after the edition was published is told in the language
   * they actually read in.
   */
  loadCurrentUserLanguages: (userIds: string[]) => Promise<Map<string, Language>>;
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
  loadAwaitingReceipts: (input: {
    limit: number;
    checkedBefore: string;
  }) => Promise<DeliveryRecord[]>;
  recordReceiptResult: (input: {
    pushTokenId: string;
    dropDate: string;
    notificationKind: string;
    outcome: ReceiptOutcome;
    checkedAt: string;
  }) => Promise<void>;
  /** Retires a device whose token Expo reports as gone. */
  disablePushToken: (pushTokenId: string, reason: string) => Promise<void>;
  /**
   * WHEN each reader's edition_ready is due: 19:00 in their CURRENT
   * `profiles.timezone`, and never before the edition was verified. `null`
   * means the schedule is not deployed on this project, which keeps the
   * behaviour it had before (every eligible reader is due at once). Optional,
   * so a store without it behaves exactly as before.
   */
  loadEditionReadySchedule?: (input: {
    dropDate: string;
    userIds: string[];
    now: string;
  }) => Promise<Map<string, EditionReadySchedule> | null>;
  /**
   * Leases the next-morning reminders owed RIGHT NOW, with eligibility re-read
   * by the database in the leasing statement. Only returned rows may be sent.
   * `null` means the claim is not deployed on this project.
   */
  claimAnswerReminders?: (input: { limit: number }) => Promise<ClaimedAnswerReminder[] | null>;
};

export type EditionReadySchedule = {
  /** ISO instant, or null while the edition awaits verification. */
  dueAt: string | null;
  isDue: boolean;
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
  /**
   * Devices whose row could not be claimed or recorded because the database
   * refused. Non-zero means the run is incomplete and the caller should exit
   * non-zero — the notification may still have been sent, but this process no
   * longer knows what it did.
   */
  bookkeepingFailures: number;
  /**
   * Eligible readers whose 19:00 has not come yet in their own timezone. Not
   * skipped for good: nothing is written for them, and a later run sends.
   */
  notDue: number;
  /** The earliest of those readers' due instants, for the operator. */
  nextDueAt: string | null;
  /**
   * applied: reader-local timing decided who was sent to. unavailable: the
   * schedule is not deployed here, so every eligible reader was due (the old
   * behaviour). bypassed: a single-reader test send, which is an instruction.
   */
  localTimeGate: "applied" | "unavailable" | "bypassed";
  skipped: Array<{ userId: string; reason: RecipientSkipReason }>;
};

export type SendAnswerRemindersResult = {
  /** False when the claim RPC does not exist on this project yet. */
  deployed: boolean;
  /** Device rows leased and attempted by this run. */
  claimed: number;
  ticketAccepted: number;
  retryable: number;
  permanentFailures: number;
  disabledTokens: number;
  bookkeepingFailures: number;
  /** Rows handed back again in the same run after a retryable failure; left to the next run. */
  deferred: number;
  /** The editions the attempted reminders belonged to. */
  editionDates: string[];
};

export type ReconcilePushReceiptsResult = {
  checked: number;
  sent: number;
  retryable: number;
  permanentFailures: number;
  disabledTokens: number;
  expired: number;
};

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export type PushRateLimiter = {
  waitForCapacity: (messageCount: number) => Promise<void>;
};

export async function sendEditionNotifications(input: {
  store: PushNotificationStore;
  client: ExpoPushClient;
  dropDate: string;
  languages?: Language[];
  /**
   * Restrict the send to these readers. Used only by the single-user test
   * command; omitted, every eligible reader of the edition is announced to.
   */
  onlyUserIds?: string[];
  now?: () => string;
  rateLimiter?: PushRateLimiter;
  retry?: RetryOptions;
}): Promise<SendEditionNotificationsResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const rateLimiter =
    input.rateLimiter ??
    createPushRateLimiter({ messagesPerSecond: EXPO_PUSH_MESSAGES_PER_SECOND });
  const loadedDrops = await input.store.loadEditionDrops({
    dropDate: input.dropDate,
    languages: input.languages
  });
  const onlyUserIds = input.onlyUserIds ? new Set(input.onlyUserIds) : null;
  const drops = onlyUserIds
    ? loadedDrops.filter((drop) => onlyUserIds.has(drop.userId))
    : loadedDrops;

  const result: SendEditionNotificationsResult = {
    dropDate: input.dropDate,
    ticketAccepted: 0,
    awaitingReceipt: 0,
    alreadySent: 0,
    retryable: 0,
    permanentFailures: 0,
    disabledTokens: 0,
    bookkeepingFailures: 0,
    notDue: 0,
    nextDueAt: null,
    localTimeGate: onlyUserIds ? "bypassed" : input.store.loadEditionReadySchedule ? "applied" : "unavailable",
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
  const [notificationsEnabledUserIds, languagesByUserId, tokens] = await Promise.all([
    input.store.loadNotificationsEnabledUserIds(userIds),
    input.store.loadCurrentUserLanguages(userIds),
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
    notificationsEnabledUserIds,
    languagesByUserId
  });

  result.skipped = resolved.skipped;

  // A device row Expo cannot accept (a raw APNs token written by an earlier
  // build) is retired here rather than retried on every edition. Nothing is
  // sent to it, so this cannot cost the reader a notification they would
  // otherwise have received on that device.
  //
  // ONE BAD DEVICE MUST NOT COST EVERY OTHER READER THEIR NOTIFICATION. Retiring
  // it is housekeeping; failing to retire it is not a reason to stop announcing
  // an edition to the readers whose devices are fine.
  for (const invalidToken of resolved.invalidTokens) {
    try {
      await input.store.disablePushToken(invalidToken.pushTokenId, "not_an_expo_push_token");
      result.disabledTokens += 1;
    } catch (error) {
      result.bookkeepingFailures += 1;
      console.warn("[content-engine] could not retire a non-Expo push token", {
        drop_date: input.dropDate,
        push_token_id: redactIdentifier(invalidToken.pushTokenId),
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    console.warn("[content-engine] retired a device with a non-Expo push token", {
      drop_date: input.dropDate,
      push_token_id: redactIdentifier(invalidToken.pushTokenId)
    });
  }

  // WHEN, per reader. Everything above decided WHO, exactly as before; this
  // only holds back a reader whose 19:00 has not come yet in their own
  // timezone — read from profiles.timezone now, so a reader who travelled is on
  // their new clock. Nothing is written for them: they are not skipped for
  // good, a later run finds them due, and health counts them as scheduled
  // rather than failed. A single-reader test send is an instruction, not held.
  let dueRecipients = resolved.recipients;

  if (result.localTimeGate === "applied" && input.store.loadEditionReadySchedule && resolved.recipients.length > 0) {
    const schedule = await input.store.loadEditionReadySchedule({
      dropDate: input.dropDate,
      userIds: [...new Set(resolved.recipients.map((recipient) => recipient.userId))],
      now: now()
    });

    if (schedule === null) {
      result.localTimeGate = "unavailable";
    } else {
      const notDueUserIds = new Set<string>();

      dueRecipients = resolved.recipients.filter((recipient) => {
        const entry = schedule.get(recipient.userId);

        if (entry?.isDue) {
          return true;
        }

        notDueUserIds.add(recipient.userId);

        if (
          entry?.dueAt &&
          (result.nextDueAt === null || Date.parse(entry.dueAt) < Date.parse(result.nextDueAt))
        ) {
          result.nextDueAt = entry.dueAt;
        }

        return false;
      });

      result.notDue = notDueUserIds.size;

      for (const userId of notDueUserIds) {
        result.skipped.push({ userId, reason: "not_due_yet" });
      }
    }
  }

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
    recipients: dueRecipients,
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
      not_due: result.notDue,
      next_due_at: result.nextDueAt,
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
    await rateLimiter.waitForCapacity(chunk.length);
    const outcomes = await sendChunk(input.client, chunk, input.retry);

    for (const [index, outcome] of outcomes.entries()) {
      const recipient = chunk[index];

      try {
        await input.store.recordDeliveryResult({
          pushTokenId: recipient.pushTokenId,
          dropDate: input.dropDate,
          notificationKind: EDITION_NOTIFICATION_KIND,
          outcome,
          attemptedAt: now()
        });
      } catch (error) {
        // The message may well have gone out; what failed is writing down that
        // it did. Stopping here would abandon every remaining device without
        // undoing anything, so the run continues and the count makes the gap
        // visible: a non-zero bookkeepingFailures fails the job.
        result.bookkeepingFailures += 1;
        console.error("[content-engine] could not record a delivery result", {
          drop_date: input.dropDate,
          push_token_id: redactIdentifier(recipient.pushTokenId),
          outcome: outcome.kind,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

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
    bookkeeping_failures: result.bookkeepingFailures,
    not_due: result.notDue,
    next_due_at: result.nextDueAt,
    skipped: result.skipped.length
  });

  return result;
}

export async function reconcileExpoPushReceipts(input: {
  store: PushNotificationStore;
  client: ExpoPushReceiptClient;
  limit?: number;
  now?: () => string;
  retry?: RetryOptions;
  receiptBatchSize?: number;
}): Promise<ReconcilePushReceiptsResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const checkedBefore = now();
  const limit = Math.max(0, input.limit ?? 100);
  const receiptBatchSize = Math.min(
    Math.max(1, input.receiptBatchSize ?? EXPO_RECEIPT_CHUNK_SIZE),
    EXPO_RECEIPT_CHUNK_SIZE
  );
  const result: ReconcilePushReceiptsResult = {
    checked: 0,
    sent: 0,
    retryable: 0,
    permanentFailures: 0,
    disabledTokens: 0,
    expired: 0
  };

  while (result.checked < limit) {
    const awaiting = (await input.store.loadAwaitingReceipts({
      limit: Math.min(receiptBatchSize, limit - result.checked),
      checkedBefore
    })).filter((row) => row.expoTicketId);

    if (awaiting.length === 0) {
      break;
    }

    const checkedAt = now();
    const active = awaiting.filter((delivery) => !isReceiptExpired(delivery, checkedAt));
    const expired = awaiting.filter((delivery) => isReceiptExpired(delivery, checkedAt));
    const ticketIds = active
      .map((row) => row.expoTicketId)
      .filter((id): id is string => Boolean(id));
    const receipts =
      ticketIds.length > 0
        ? await withRetry(() => input.client.getReceipts(ticketIds), input.retry)
        : { receipts: {} };

    for (const delivery of expired) {
      await input.store.recordReceiptResult({
        pushTokenId: delivery.pushTokenId,
        dropDate: delivery.dropDate,
        notificationKind: delivery.notificationKind,
        outcome: {
          kind: "permanent",
          error: "Expo receipt expired after 24 hours without a final receipt"
        },
        checkedAt
      });

      result.checked += 1;
      result.expired += 1;
      result.permanentFailures += 1;
    }

    for (const delivery of active) {
      const receipt = delivery.expoTicketId ? receipts.receipts[delivery.expoTicketId] : null;
      const outcome = receipt
        ? classifyExpoPushReceipt(receipt)
        : ({ kind: "retryable", error: "Expo receipt was not available yet" } as const);

      await input.store.recordReceiptResult({
        pushTokenId: delivery.pushTokenId,
        dropDate: delivery.dropDate,
        notificationKind: delivery.notificationKind,
        outcome,
        checkedAt
      });

      result.checked += 1;

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
  }

  console.info("[content-engine] expo push receipt reconciliation", {
    checked: result.checked,
    sent: result.sent,
    retryable: result.retryable,
    permanent_failures: result.permanentFailures,
    disabled_tokens: result.disabledTokens,
    expired: result.expired
  });

  return result;
}

/**
 * The next-morning reminder, for every reader owed it right now.
 *
 * The database decides who: `claim_edition_answer_reminders` re-reads each
 * reader's assignments, answers, notification preference, devices, timezone
 * and the edition's state in the very statement that leases the row, and
 * returns only what may be sent. This sends exactly that, records every
 * outcome against (device, edition, edition_answer_reminder), and never sends a
 * row it was not handed.
 *
 * Bounded on purpose: a row that failed retryably is not hammered within the
 * same run. If a later claim in this run hands it back, it is left to its lease
 * and the next run — and the claim itself refuses it once the three-hour
 * morning window has closed.
 */
export async function sendAnswerReminders(input: {
  store: PushNotificationStore;
  client: ExpoPushClient;
  now?: () => string;
  rateLimiter?: PushRateLimiter;
  retry?: RetryOptions;
  batchSize?: number;
  maxRounds?: number;
}): Promise<SendAnswerRemindersResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const rateLimiter =
    input.rateLimiter ??
    createPushRateLimiter({ messagesPerSecond: EXPO_PUSH_MESSAGES_PER_SECOND });
  const batchSize = Math.min(Math.max(1, Math.trunc(input.batchSize ?? 500)), 1000);
  const maxRounds = Math.max(1, Math.trunc(input.maxRounds ?? 20));
  const result: SendAnswerRemindersResult = {
    deployed: true,
    claimed: 0,
    ticketAccepted: 0,
    retryable: 0,
    permanentFailures: 0,
    disabledTokens: 0,
    bookkeepingFailures: 0,
    deferred: 0,
    editionDates: []
  };

  if (!input.store.claimAnswerReminders) {
    result.deployed = false;
    return result;
  }

  const attempted = new Set<string>();
  const editionDates = new Set<string>();

  for (let round = 0; round < maxRounds; round += 1) {
    const claimed = await input.store.claimAnswerReminders({ limit: batchSize });

    if (claimed === null) {
      result.deployed = false;
      break;
    }

    const fresh = claimed.filter(
      (row) => !attempted.has(`${row.pushTokenId}|${row.editionDate}`)
    );
    result.deferred += claimed.length - fresh.length;

    if (fresh.length === 0) {
      break;
    }

    const sendable: Array<ClaimedAnswerReminder & { message: PushMessageContent }> = [];

    for (const row of fresh) {
      attempted.add(`${row.pushTokenId}|${row.editionDate}`);
      editionDates.add(row.editionDate);
      result.claimed += 1;

      if (isExpoPushToken(row.expoPushToken)) {
        sendable.push({ ...row, message: buildAnswerReminderMessage(row.language, row.editionDate) });
        continue;
      }

      // The claim only fans out to well-formed tokens; this covers a row that
      // reached the table some other way.
      await recordAnswerReminderOutcome(
        input.store,
        row,
        { kind: "token_invalid", error: "not_an_expo_push_token" },
        now(),
        result
      );
    }

    for (const chunk of chunkForExpo(sendable)) {
      await rateLimiter.waitForCapacity(chunk.length);
      const outcomes = await sendChunk(input.client, chunk, input.retry);

      for (const [index, outcome] of outcomes.entries()) {
        await recordAnswerReminderOutcome(input.store, chunk[index], outcome, now(), result);
      }
    }

    if (claimed.length < batchSize) {
      break;
    }
  }

  result.editionDates = [...editionDates].sort();

  console.info("[content-engine] edition answer reminder delivery", {
    deployed: result.deployed,
    claimed: result.claimed,
    ticket_accepted: result.ticketAccepted,
    retryable: result.retryable,
    permanent_failures: result.permanentFailures,
    disabled_tokens: result.disabledTokens,
    bookkeeping_failures: result.bookkeepingFailures,
    deferred: result.deferred,
    edition_dates: result.editionDates
  });

  return result;
}

async function recordAnswerReminderOutcome(
  store: PushNotificationStore,
  row: ClaimedAnswerReminder,
  outcome: DeliveryOutcome,
  attemptedAt: string,
  result: SendAnswerRemindersResult
): Promise<void> {
  try {
    await store.recordDeliveryResult({
      pushTokenId: row.pushTokenId,
      dropDate: row.editionDate,
      notificationKind: ANSWER_REMINDER_NOTIFICATION_KIND,
      outcome,
      attemptedAt
    });
  } catch (error) {
    // Same rule as the edition: the message may have gone out, what failed is
    // writing it down. The run continues and the count fails the job.
    result.bookkeepingFailures += 1;
    console.error("[content-engine] could not record an answer reminder result", {
      edition_date: row.editionDate,
      push_token_id: redactIdentifier(row.pushTokenId),
      outcome: outcome.kind,
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  if (outcome.kind === "ticket_accepted") {
    result.ticketAccepted += 1;
    return;
  }

  if (outcome.kind === "token_invalid") {
    try {
      await store.disablePushToken(row.pushTokenId, outcome.error);
      result.disabledTokens += 1;
    } catch (error) {
      result.bookkeepingFailures += 1;
      console.warn("[content-engine] could not retire a push token after a reminder", {
        push_token_id: redactIdentifier(row.pushTokenId),
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (outcome.kind === "permanent") {
    result.permanentFailures += 1;
    return;
  }

  result.retryable += 1;
}

async function sendChunk(
  client: ExpoPushClient,
  chunk: Array<{ expoPushToken: string; message: PushMessageContent }>,
  retry?: RetryOptions
): Promise<DeliveryOutcome[]> {
  try {
    const response = await withRetry(() => client.send(chunk.map(toExpoPushMessage)), retry);

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

export function createPushRateLimiter(input: {
  messagesPerSecond?: number;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}): PushRateLimiter {
  const messagesPerSecond = Math.max(
    1,
    Math.trunc(input.messagesPerSecond ?? EXPO_PUSH_MESSAGES_PER_SECOND)
  );
  const nowMs = input.nowMs ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let windowStart = nowMs();
  let usedInWindow = 0;

  return {
    async waitForCapacity(messageCount) {
      let remaining = Math.max(0, Math.trunc(messageCount));

      while (remaining > 0) {
        const current = nowMs();

        if (current - windowStart >= 1000) {
          windowStart = current;
          usedInWindow = 0;
        }

        const capacity = messagesPerSecond - usedInWindow;

        if (capacity <= 0) {
          await sleep(Math.max(1, 1000 - (current - windowStart)));
          continue;
        }

        const accepted = Math.min(capacity, remaining);
        usedInWindow += accepted;
        remaining -= accepted;
      }
    }
  };
}

async function withRetry<T>(operation: () => Promise<T>, retry?: RetryOptions): Promise<T> {
  const options = resolveRetryOptions(retry);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= options.maxAttempts || !isRetryableExpoRequestFailure(error)) {
        throw error;
      }

      await options.sleep(retryDelayMs(attempt, options));
    }
  }

  throw lastError;
}

function resolveRetryOptions(retry: RetryOptions | undefined): Required<RetryOptions> {
  return {
    maxAttempts: Math.max(1, Math.trunc(retry?.maxAttempts ?? 3)),
    baseDelayMs: Math.max(1, Math.trunc(retry?.baseDelayMs ?? 500)),
    maxDelayMs: Math.max(1, Math.trunc(retry?.maxDelayMs ?? 5000)),
    jitterRatio: Math.max(0, retry?.jitterRatio ?? 0.2),
    sleep: retry?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    random: retry?.random ?? (() => Math.random())
  };
}

function retryDelayMs(attempt: number, options: Required<RetryOptions>): number {
  const base = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(base * (1 + options.random() * options.jitterRatio));
}

function isReceiptExpired(delivery: DeliveryRecord, checkedAt: string): boolean {
  if (!delivery.lastAttemptAt) {
    return false;
  }

  return Date.parse(checkedAt) - Date.parse(delivery.lastAttemptAt) >= EXPO_RECEIPT_RETENTION_MS;
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
        throw new ExpoPushHttpError(
          response.status,
          `Expo push request failed with status ${response.status}`
        );
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
        throw new ExpoPushHttpError(
          response.status,
          `Expo receipt request failed with status ${response.status}`
        );
      }

      const payload = (await response.json()) as {
        data?: Record<string, ExpoPushReceipt>;
      };

      return { receipts: payload.data ?? {} };
    }
  };
}

export type { DailyDropSlot };
