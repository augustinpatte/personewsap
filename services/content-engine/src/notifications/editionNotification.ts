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
          title: "Votre édition est prête",
          body: "Newsletter, Business Story et Mini Case vous attendent."
        }
      : {
          title: "Your edition is ready",
          body: "Newsletter, Business Story and Mini Case are ready."
        };

  return {
    ...copy,
    data: { type: EDITION_NOTIFICATION_KIND, drop_date: dropDate }
  };
}

/** True when the drop carries every slot the product promises in the message. */
export function isCompleteEdition(drop: NotificationCandidateDrop): boolean {
  const slots = new Set(drop.slots);

  return REQUIRED_EDITION_SLOTS.every((slot) => slots.has(slot));
}

/**
 * Who is told about this edition.
 *
 * Four independent conditions, all required: the reader asked for
 * notifications, they have at least one live device, their drop is published,
 * and it is complete. A reader with two devices gets one message per device —
 * the idempotency key is the device, not the account.
 */
export function resolveEditionNotificationRecipients(input: {
  dropDate: string;
  drops: NotificationCandidateDrop[];
  tokensByUserId: Map<string, NotificationCandidateToken[]>;
  notificationsEnabledUserIds: Set<string>;
}): ResolvedRecipients {
  const recipients: EditionNotificationRecipient[] = [];
  const skipped: ResolvedRecipients["skipped"] = [];

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

    const tokens = (input.tokensByUserId.get(drop.userId) ?? []).filter(
      (token) => token.enabled
    );

    if (tokens.length === 0) {
      skipped.push({ userId: drop.userId, reason: "no_enabled_token" });
      continue;
    }

    // The edition's own language, so a reader who reads in French is told in
    // French even if their device is set to something else.
    const message = buildEditionNotificationMessage(drop.language, input.dropDate);

    for (const token of tokens) {
      recipients.push({
        pushTokenId: token.pushTokenId,
        userId: token.userId,
        expoPushToken: token.expoPushToken,
        dailyDropId: drop.dailyDropId,
        language: drop.language,
        message
      });
    }
  }

  return { recipients, skipped };
}

export type ExpoPushTicket =
  | { status: "ok"; id?: string }
  | {
      status: "error";
      message?: string;
      details?: { error?: string } | null;
    };

export type DeliveryOutcome =
  | { kind: "sent"; expoTicketId: string | null }
  /** The token is gone for good: stop using it. */
  | { kind: "token_invalid"; error: string }
  /** Worth another run: rate limit, Expo outage, network. */
  | { kind: "retryable"; error: string }
  /** Malformed message or credential problem: retrying changes nothing. */
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
    return { kind: "sent", expoTicketId: ticket.id ?? null };
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

/** A whole request failing (network, 5xx) is always worth another run. */
export function classifyExpoRequestFailure(error: unknown): DeliveryOutcome {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Expo push request failed";

  return { kind: "retryable", error: message };
}

/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_CHUNK_SIZE = 100;

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
}): EditionNotificationRecipient[] {
  const blocked = input.permanentlyFailedTokenIds ?? new Set<string>();

  return input.recipients.filter(
    (recipient) =>
      !input.alreadySentTokenIds.has(recipient.pushTokenId) &&
      !blocked.has(recipient.pushTokenId)
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
