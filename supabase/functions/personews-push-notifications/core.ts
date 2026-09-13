/**
 * personews-push-notifications — the send loop, free of any Deno or Supabase
 * import so it runs under vitest exactly as it runs in the Edge runtime.
 *
 * It decides nothing about WHO or WHEN. `claim_due_push_notifications` (SQL)
 * returns exactly the rows that may be sent right now — the evening
 * notification at 20:00 reader-local or when the edition became ready, the
 * morning reminder at 08:30 reader-local, each retry at +15 and +30 minutes —
 * and has already counted the attempt. This sends those rows to Expo, records
 * what Expo said through `record_push_delivery_attempt`, and logs one line per
 * attempt. A row it was not handed is never sent; an accepted ticket is never
 * sent again.
 */

export const PUSH_WORKER_VERSION = "2026-09-12";
export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const EXPO_CHUNK_SIZE = 100;

export type PushKind = "edition_ready" | "edition_answer_reminder";

export type ClaimedPush = {
  deliveryId: string;
  pushTokenId: string;
  userId: string;
  dropDate: string;
  kind: PushKind;
  expoPushToken: string;
  language: "fr" | "en";
  attemptNumber: number;
  targetAt: string | null;
  scheduledFor: string | null;
  timezone: string | null;
  editionReadyAt: string | null;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: { type: PushKind; drop_date: string };
  sound: "default";
  priority: "high";
  channelId: "default";
};

export type ExpoTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } | null };

export type Outcome =
  | { kind: "ticket_accepted"; ticketId: string | null }
  | { kind: "token_invalid"; error: string }
  | { kind: "retryable"; error: string }
  | { kind: "permanent"; error: string };

export type RecordResult = { status: string; nextAttemptAt: string | null };

export type WorkerDeps = {
  /** Leases what is due now. Throws if the claim itself failed. */
  claim: (limit: number) => Promise<ClaimedPush[]>;
  /** Sends one chunk. Throws on an HTTP failure (with `status` when known). */
  send: (messages: ExpoMessage[]) => Promise<ExpoTicket[]>;
  record: (row: ClaimedPush, outcome: Outcome) => Promise<RecordResult>;
  now: () => Date;
  log: (line: Record<string, unknown>) => void;
};

export type WorkerSummary = {
  version: string;
  claimed: number;
  accepted: number;
  retryable: number;
  permanent: number;
  tokenInvalid: number;
  recordFailures: number;
};

/**
 * The words, identical to the Node sender's (pinned by a test): the evening
 * notification states that the edition exists, the morning one that answers
 * are still owed. No count, no streak, no urgency.
 */
const COPY: Record<PushKind, Record<"fr" | "en", { title: string; body: string }>> = {
  edition_ready: {
    fr: { title: "Votre édition du jour est arrivée", body: "Venez la découvrir dans PersoNews." },
    en: { title: "Today's edition is here", body: "Come discover it in PersoNews." }
  },
  edition_answer_reminder: {
    fr: {
      title: "Votre session n'est pas terminée",
      body: "Il vous reste des réponses à donner pour rester dans la compétition."
    },
    en: {
      title: "Your session isn't finished",
      body: "You still have answers to submit to stay in the competition."
    }
  }
};

export function buildPushMessage(row: ClaimedPush): ExpoMessage {
  const copy = COPY[row.kind][row.language === "fr" ? "fr" : "en"];

  return {
    to: row.expoPushToken,
    title: copy.title,
    body: copy.body,
    data: { type: row.kind, drop_date: row.dropDate },
    sound: "default",
    // Sent at 20:00 or 08:30 in the reader's own zone, never at night — so it
    // is delivered now. APNs priority 5 ("normal") lets iOS hold a push for
    // power reasons, which is how a 20:27 ticket reached a phone at 20:39.
    priority: "high",
    channelId: "default"
  };
}

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

/** Same classification as the Node sender's classifyExpoPushTicket. */
export function classifyTicket(ticket: ExpoTicket | undefined): Outcome {
  if (!ticket) {
    return { kind: "retryable", error: "Expo returned no ticket for this message" };
  }

  if (ticket.status === "ok") {
    return { kind: "ticket_accepted", ticketId: ticket.id ?? null };
  }

  const detail = ticket.details?.error ?? "";
  const message = ticket.message || detail || "Expo push error";

  if (detail === "DeviceNotRegistered") {
    return { kind: "token_invalid", error: message };
  }

  if (detail === "MessageTooBig" || detail === "MismatchSenderId" || detail === "InvalidCredentials") {
    return { kind: "permanent", error: message };
  }

  return { kind: "retryable", error: message };
}

export class ExpoHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ExpoHttpError";
  }
}

/** A whole request failing: a 4xx other than 429 will fail again; anything else may not. */
export function classifyRequestFailure(error: unknown): Outcome {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ExpoHttpError ? error.status : Number.NaN;

  if (status >= 400 && status < 500 && status !== 429) {
    return { kind: "permanent", error: message };
  }

  return { kind: "retryable", error: message };
}

/** The real Expo call. `fetchImpl` is injected so it is testable. */
export function createExpoSender(fetchImpl: typeof fetch) {
  return async (messages: ExpoMessage[]): Promise<ExpoTicket[]> => {
    const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(messages)
    });

    if (!response.ok) {
      throw new ExpoHttpError(response.status, `Expo push request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { data?: ExpoTicket[] };
    return payload.data ?? [];
  };
}

/** The SQL row, typed. Unknown kinds are dropped rather than sent with the wrong words. */
export function mapClaimedRow(row: Record<string, unknown>): ClaimedPush | null {
  const kind = row.claimed_kind;

  if (kind !== "edition_ready" && kind !== "edition_answer_reminder") {
    return null;
  }

  const text = (value: unknown) => (typeof value === "string" ? value : null);

  return {
    deliveryId: String(row.claimed_delivery_id ?? ""),
    pushTokenId: String(row.claimed_push_token_id ?? ""),
    userId: String(row.claimed_user_id ?? ""),
    dropDate: String(row.claimed_drop_date ?? ""),
    kind,
    expoPushToken: String(row.claimed_expo_push_token ?? ""),
    language: row.claimed_language === "fr" ? "fr" : "en",
    attemptNumber: Number(row.claimed_attempt_number ?? 1),
    targetAt: text(row.claimed_target_at),
    scheduledFor: text(row.claimed_scheduled_for),
    timezone: text(row.claimed_timezone),
    editionReadyAt: text(row.claimed_edition_ready_at)
  };
}

/** 20:00 or 08:30 as the reader reads it, from the instant and their zone. */
export function formatLocalTime(instant: string | null, timeZone: string | null): string | null {
  if (!instant || !timeZone) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(instant));
  } catch {
    return null;
  }
}

/**
 * One observability line per attempt. Never a token: the device is the first
 * eight characters of its row id, which identifies nothing outside the table.
 */
export function attemptLogLine(
  row: ClaimedPush,
  outcome: Outcome,
  recorded: RecordResult | null,
  dispatchedAt: Date
): Record<string, unknown> {
  return {
    event: "push_attempt",
    version: PUSH_WORKER_VERSION,
    kind: row.kind,
    drop_date: row.dropDate,
    device: row.pushTokenId.slice(0, 8),
    timezone: row.timezone,
    target_local_time: formatLocalTime(row.targetAt, row.timezone),
    target_utc: row.targetAt,
    edition_ready_at: row.editionReadyAt,
    blocked_until_ready: Boolean(
      row.editionReadyAt && row.targetAt && Date.parse(row.editionReadyAt) > Date.parse(row.targetAt)
    ),
    scheduled_for: row.scheduledFor,
    actual_dispatch_at: dispatchedAt.toISOString(),
    attempt_number: row.attemptNumber,
    result: outcome.kind,
    recorded_status: recorded?.status ?? "record_failed",
    retry_due_at: recorded?.nextAttemptAt ?? null,
    error: outcome.kind === "ticket_accepted" ? null : outcome.error.slice(0, 160)
  };
}

export async function runPushWorker(
  deps: WorkerDeps,
  options: { batchSize?: number; maxBatches?: number } = {}
): Promise<WorkerSummary> {
  const batchSize = Math.min(Math.max(1, Math.trunc(options.batchSize ?? 200)), 1000);
  const maxBatches = Math.max(1, Math.trunc(options.maxBatches ?? 10));
  const summary: WorkerSummary = {
    version: PUSH_WORKER_VERSION,
    claimed: 0,
    accepted: 0,
    retryable: 0,
    permanent: 0,
    tokenInvalid: 0,
    recordFailures: 0
  };

  const settle = async (row: ClaimedPush, outcome: Outcome) => {
    let recorded: RecordResult | null = null;

    try {
      recorded = await deps.record(row, outcome);
    } catch (error) {
      // The push may have gone out; what failed is writing it down. The lease
      // expires on its own and the attempt was already counted, so this can
      // never become a fourth attempt.
      summary.recordFailures += 1;
      deps.log({ event: "push_record_failed", device: row.pushTokenId.slice(0, 8), error: String(error).slice(0, 160) });
    }

    if (outcome.kind === "ticket_accepted") summary.accepted += 1;
    else if (outcome.kind === "retryable") summary.retryable += 1;
    else if (outcome.kind === "permanent") summary.permanent += 1;
    else summary.tokenInvalid += 1;

    deps.log(attemptLogLine(row, outcome, recorded, deps.now()));
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await deps.claim(batchSize);

    if (rows.length === 0) {
      break;
    }

    summary.claimed += rows.length;
    const sendable: ClaimedPush[] = [];

    for (const row of rows) {
      if (isExpoPushToken(row.expoPushToken)) {
        sendable.push(row);
      } else {
        await settle(row, { kind: "token_invalid", error: "not_an_expo_push_token" });
      }
    }

    for (let start = 0; start < sendable.length; start += EXPO_CHUNK_SIZE) {
      const chunk = sendable.slice(start, start + EXPO_CHUNK_SIZE);
      let outcomes: Outcome[];

      try {
        const tickets = await deps.send(chunk.map(buildPushMessage));
        outcomes = chunk.map((_row, index) => classifyTicket(tickets[index]));
      } catch (error) {
        const failure = classifyRequestFailure(error);
        outcomes = chunk.map(() => failure);
      }

      for (const [index, row] of chunk.entries()) {
        await settle(row, outcomes[index]);
      }
    }

    if (rows.length < batchSize) {
      break;
    }
  }

  deps.log({ event: "push_worker_run", ...summary });
  return summary;
}
