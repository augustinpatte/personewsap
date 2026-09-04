import type { DailyDropSlot, Language } from "../domain.js";

/**
 * The one notification PersoNewsAP sends.
 *
 * Exactly one per published edition, per device: four a week (Monday,
 * Wednesday, Friday, Sunday) and nothing on a quiet day. No separate ping per
 * module, no streak, no daily re-engagement nudge, no second reminder. A reader
 * who opens the app on their own must never be told twice that the same edition
 * exists.
 *
 * Everything in this file is pure: eligibility, wording and error handling are
 * decided here and unit tested, while pushSender.ts does the I/O.
 */

/** The slots an edition must actually carry before anyone is told it is ready. */
export const REQUIRED_EDITION_SLOTS: DailyDropSlot[] = [
  "newsletter",
  "business_story",
  "mini_case"
];

export const EDITION_NOTIFICATION_KIND = "edition_ready";

export type EditionNotificationMessage = {
  title: string;
  body: string;
  data: {
    type: typeof EDITION_NOTIFICATION_KIND;
    drop_date: string;
  };
};

export type NotificationCandidateDrop = {
  dailyDropId: string;
  userId: string;
  language: Language;
  status: string;
  /** Slots actually linked to the drop. */
  slots: DailyDropSlot[];
  /** Slots this user enabled. Missing keeps the legacy all-module rule. */
  requiredSlots?: DailyDropSlot[];
};

export type NotificationCandidateToken = {
  pushTokenId: string;
  userId: string;
  expoPushToken: string;
  enabled: boolean;
};

export type EditionNotificationRecipient = {
  pushTokenId: string;
  userId: string;
  expoPushToken: string;
  dailyDropId: string;
  language: Language;
  message: EditionNotificationMessage;
};

export type RecipientSkipReason =
  | "notifications_disabled"
  | "no_enabled_token"
  | "drop_not_published"
  | "incomplete_edition";

export type ResolvedRecipients = {
  recipients: EditionNotificationRecipient[];
  skipped: Array<{ userId: string; reason: RecipientSkipReason }>;
  /** Stored device rows the Expo Push Service cannot accept; retired by the sender. */
  invalidTokens: NotificationCandidateToken[];
};

/**
 * Wording. Deliberately short and factual: it states that the edition exists
 * and what is in it, and stops there. No urgency, no count, no streak.
 */
export function buildEditionNotificationMessage(
  language: Language,
  dropDate: string
): EditionNotificationMessage {
  const copy =
    language === "fr"
      ? {
          title: "Votre édition du jour est arrivée",
          body: "Venez la découvrir dans PersoNews."
        }
      : {
          title: "Today's edition is here",
          body: "Come discover it in PersoNews."
        };

  return {
    ...copy,
    data: { type: EDITION_NOTIFICATION_KIND, drop_date: dropDate }
  };
}

/**
 * Whether a stored token is something the Expo Push Service can accept.
 *
 * This exists because a raw APNs device token can reach `push_tokens`: on the
 * device, `addPushTokenListener` reports the *native* token (64 hex characters
 * on iOS), which is not an Expo push token. The mobile side no longer stores
 * those, but rows written by earlier builds are still in the table, and sending
 * one to Expo is a guaranteed error. Such a device is retired at send time
 * instead of failing every edition forever.
 */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

/** True when the drop carries every slot the product promises in the message. */
export function isCompleteEdition(drop: NotificationCandidateDrop): boolean {
  const slots = new Set(drop.slots);
  const requiredSlots = drop.requiredSlots ?? REQUIRED_EDITION_SLOTS;

  return requiredSlots.every((slot) => slots.has(slot));
}

/**
 * Who is told about this edition, and in which language.
 *
 * Four independent conditions, all required: the reader asked for
 * notifications, they have at least one live device, their drop is published,
 * and it is complete. A reader with two devices gets one message per device —
 * the idempotency key is the device, not the account.
 *
 * The language is resolved HERE, from the reader's current profile, not from
 * the edition and never from the device row. An edition is published in the
 * language the reader had at 19:00 and is deliberately never rewritten
 * afterwards, so a reader who switches to English at 19:05 would otherwise be
 * told in French. `languagesByUserId` carries `profiles.language` as read at
 * send time; the edition's language is only a fallback for a reader whose
 * profile could not be read.
 */
export function resolveEditionNotificationRecipients(input: {
  dropDate: string;
  drops: NotificationCandidateDrop[];
  tokensByUserId: Map<string, NotificationCandidateToken[]>;
  notificationsEnabledUserIds: Set<string>;
  languagesByUserId?: Map<string, Language>;
}): ResolvedRecipients {
  const recipients: EditionNotificationRecipient[] = [];
  const skipped: ResolvedRecipients["skipped"] = [];
  const invalidTokens: NotificationCandidateToken[] = [];

  for (const drop of input.drops) {
    if (drop.status !== "published") {
      skipped.push({ userId: drop.userId, reason: "drop_not_published" });
      continue;
    }

    if (!isCompleteEdition(drop)) {
      // A half-assembled edition must never be announced: the message names
      // three things the reader would not find.
      skipped.push({ userId: drop.userId, reason: "incomplete_edition" });
      continue;
    }

    if (!input.notificationsEnabledUserIds.has(drop.userId)) {
      skipped.push({ userId: drop.userId, reason: "notifications_disabled" });
      continue;
    }

    const enabledTokens = (input.tokensByUserId.get(drop.userId) ?? []).filter(
      (token) => token.enabled
    );
    const tokens = enabledTokens.filter((token) => {
      if (isExpoPushToken(token.expoPushToken)) {
        return true;
      }

      invalidTokens.push(token);
      return false;
    });

    if (tokens.length === 0) {
      skipped.push({ userId: drop.userId, reason: "no_enabled_token" });
      continue;
    }

    // The reader's language right now. Every device of one reader therefore
    // gets the same wording, whatever language each was registered under.
    const language = input.languagesByUserId?.get(drop.userId) ?? drop.language;
    const message = buildEditionNotificationMessage(language, input.dropDate);

    for (const token of tokens) {
      recipients.push({
        pushTokenId: token.pushTokenId,
        userId: token.userId,
        expoPushToken: token.expoPushToken,
        dailyDropId: drop.dailyDropId,
        language,
        message
      });
    }
  }

  return { recipients, skipped, invalidTokens };
}

export type ExpoPushTicket =
  | { status: "ok"; id?: string }
  | {
      status: "error";
      message?: string;
      details?: { error?: string } | null;
    };

export type DeliveryOutcome =
  | { kind: "ticket_accepted"; expoTicketId: string | null }
  /** The token is gone for good: stop using it. */
  | { kind: "token_invalid"; error: string }
  /** Worth another run: rate limit, Expo outage, network. */
  | { kind: "retryable"; error: string }
  /** Malformed message or credential problem: retrying changes nothing. */
  | { kind: "permanent"; error: string };

export type ExpoPushReceipt =
  | { status: "ok" }
  | {
      status: "error";
      message?: string;
      details?: { error?: string } | null;
    };

export type ReceiptOutcome =
  | { kind: "sent" }
  | { kind: "token_invalid"; error: string }
  | { kind: "retryable"; error: string }
  | { kind: "permanent"; error: string };

/**
 * What one Expo ticket means for us.
 *
 * The distinction that matters is between an error about the *device* and an
 * error about the *attempt*. DeviceNotRegistered means the app was uninstalled
 * or the token rotated — retrying forever would keep failing, so the token is
 * retired. Everything transient stays pending and is retried by the next run.
 */
export function classifyExpoPushTicket(ticket: ExpoPushTicket): DeliveryOutcome {
  if (ticket.status === "ok") {
    return { kind: "ticket_accepted", expoTicketId: ticket.id ?? null };
  }

  const detail = ticket.details?.error ?? "";
  const message = ticket.message ?? detail ?? "Expo push error";

  if (detail === "DeviceNotRegistered") {
    return { kind: "token_invalid", error: message };
  }

  if (detail === "MessageRateExceeded") {
    return { kind: "retryable", error: message };
  }

  // MessageTooBig, MismatchSenderId, InvalidCredentials: sending the same
  // message again produces the same answer.
  if (
    detail === "MessageTooBig" ||
    detail === "MismatchSenderId" ||
    detail === "InvalidCredentials"
  ) {
    return { kind: "permanent", error: message };
  }

  return { kind: "retryable", error: message };
}

export function classifyExpoPushReceipt(receipt: ExpoPushReceipt): ReceiptOutcome {
  if (receipt.status === "ok") {
    return { kind: "sent" };
  }

  const detail = receipt.details?.error ?? "";
  const message = receipt.message ?? detail ?? "Expo push receipt error";

  if (detail === "DeviceNotRegistered") {
    return { kind: "token_invalid", error: message };
  }

  if (detail === "MessageRateExceeded") {
    return { kind: "retryable", error: message };
  }

  if (
    detail === "MessageTooBig" ||
    detail === "MismatchSenderId" ||
    detail === "InvalidCredentials"
  ) {
    return { kind: "permanent", error: message };
  }

  return { kind: "retryable", error: message };
}

/** A whole request failing can be transient or final depending on its status. */
export function classifyExpoRequestFailure(error: unknown): DeliveryOutcome {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Expo push request failed";
  const status =
    error instanceof ExpoPushHttpError
      ? error.status
      : Number(message.match(/status\s+(\d{3})/)?.[1] ?? Number.NaN);

  if (status >= 400 && status < 500 && status !== 429) {
    return { kind: "permanent", error: message };
  }

  return { kind: "retryable", error: message };
}

/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_CHUNK_SIZE = 100;
/** Expo accepts at most 1,000 receipt ids per request. */
export const EXPO_RECEIPT_CHUNK_SIZE = 1000;
/** Expo clears receipts after 24 hours. */
export const EXPO_RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Expo's project limit is 600/sec; PersoNewsAP deliberately stays below it. */
export const EXPO_PUSH_MESSAGES_PER_SECOND = 500;

export class ExpoPushHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ExpoPushHttpError";
  }
}

export function isRetryableExpoRequestFailure(error: unknown): boolean {
  if (error instanceof ExpoPushHttpError) {
    return error.status === 429 || error.status >= 500;
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = Number(message.match(/status\s+(\d{3})/)?.[1] ?? Number.NaN);

  if (Number.isFinite(status)) {
    return status === 429 || status >= 500;
  }

  return true;
}

export function chunkForExpo<T>(items: T[], size = EXPO_PUSH_CHUNK_SIZE): T[][] {
  const chunkSize = Math.max(1, Math.trunc(size));
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

/**
 * Recipients still to be sent to.
 *
 * Idempotency is a database fact, not a flag in memory: a delivery row already
 * marked sent means this device has already been told about this edition, so a
 * re-run of the daily job — a retry, a replayed GitHub Actions run, a manual
 * dispatch — sends nothing more. Only rows that never succeeded are attempted
 * again.
 */
export function selectPendingRecipients(input: {
  recipients: EditionNotificationRecipient[];
  alreadySentTokenIds: Set<string>;
  permanentlyFailedTokenIds?: Set<string>;
  awaitingReceiptTokenIds?: Set<string>;
}): EditionNotificationRecipient[] {
  const blocked = input.permanentlyFailedTokenIds ?? new Set<string>();
  const awaitingReceipt = input.awaitingReceiptTokenIds ?? new Set<string>();

  return input.recipients.filter(
    (recipient) =>
      !input.alreadySentTokenIds.has(recipient.pushTokenId) &&
      !blocked.has(recipient.pushTokenId) &&
      !awaitingReceipt.has(recipient.pushTokenId)
  );
}

export function toExpoPushMessage(recipient: EditionNotificationRecipient) {
  return {
    to: recipient.expoPushToken,
    title: recipient.message.title,
    body: recipient.message.body,
    data: recipient.message.data,
    sound: "default" as const,
    // A published edition is not urgent: it must not wake a device at night.
    priority: "normal" as const,
    channelId: "default"
  };
}
