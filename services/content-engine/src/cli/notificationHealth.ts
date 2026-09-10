import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { getProductEditionDate } from "../scheduler/editionCadence.js";

/**
 * Did the readers actually get told?
 *
 * This replaces `job-health --strict` in the nightly workflow. That check reads
 * `content_job_runs`, a table the daily job used to write when publication ran
 * in CI; publication moved into Supabase and nothing writes it any more, so the
 * one health gate guarding the edition pipeline was reporting on a pipeline that
 * no longer exists — and it knew nothing about notifications at all.
 *
 * It was green every night while `push_notification_deliveries` stayed empty for
 * every edition this product has ever published, because
 * `claim_push_notification_deliveries` failed 42702 on every call. This is the
 * check that would have caught that on the first night:
 *
 *   never_attempted = eligible devices that are DUE − delivery rows
 *
 * Devices whose reader has notifications on, whose edition published, whose
 * reader-local 19:00 passed more than thirty minutes ago, and for which no
 * delivery row exists at all. Not a device that failed — a device nothing was
 * ever tried for. A reader in Chicago who has not been told at 19:10 Paris is
 * not in that number: they are scheduled, and reported as such.
 *
 * The next-morning reminder is reported beside it, per edition and in readers,
 * with every state the product distinguishes: no reminder needed, scheduled for
 * later, due now, sent, retryable, cancelled because the reader finished, and
 * genuinely failed. Only a reminder that came due and was never attempted is
 * critical.
 */

export type NotificationHealthOptions = {
  editionDate: string | null;
  strict: boolean;
};

export type HealthStatus = "ok" | "warning" | "critical" | "unknown";

export type AnswerReminderHealth = {
  editionDate: string;
  status: Exclude<HealthStatus, "unknown">;
  /** The one-word answer to "what is the reminder for this edition doing?" */
  summary: "no_reminder_needed" | "not_released" | "scheduled" | "due" | "sent" | "failed";
  assignedReaders: number;
  completedBeforeReminder: number;
  scheduledNotDue: number;
  dueAwaitingWorker: number;
  sent: number;
  awaitingReceipt: number;
  retryable: number;
  terminal: number;
  cancelled: number;
  notEligible: number;
  notReleased: number;
  editionClosed: number;
  neverAttempted: number;
  nextDueAt: string | null;
  detail: string;
};

export type NotificationHealthOutput = {
  mode: "notification-health";
  editionDate: string | null;
  source: "rpc" | "tables";
  status: HealthStatus;
  eligibleDevices: number;
  deliveryRows: number;
  sent: number;
  awaitingReceipt: number;
  retryable: number;
  terminal: number;
  neverAttempted: number;
  /** Devices whose reader's 19:00 has not come yet: healthy, and not yet sent. */
  scheduledNotDue: number;
  /** Devices due in the last thirty minutes that the worker has not reached yet. */
  dueAwaitingWorker: number;
  outboxStatus: string;
  detail: string;
  /** Next-morning reminders for the most recent editions (or --date). */
  reminders: AnswerReminderHealth[];
};

type HealthRow = {
  edition_date: string | null;
  eligible_devices: number;
  delivery_rows: number;
  sent: number;
  awaiting_receipt: number;
  retryable: number;
  terminal: number;
  never_attempted: number;
  outbox_status: string;
  // Present from 20260910090000 on.
  scheduled_not_due?: number | null;
  due_awaiting_worker?: number | null;
};

export type AnswerReminderHealthRow = {
  edition_date: string | null;
  released: boolean | null;
  assigned_readers: number;
  completed_before_reminder: number;
  scheduled_not_due: number;
  due_awaiting_worker: number;
  sent: number;
  awaiting_receipt: number;
  retryable: number;
  terminal: number;
  cancelled: number;
  not_eligible: number;
  not_released: number;
  edition_closed: number;
  never_attempted: number;
  next_due_at: string | null;
};

const MISSING_FUNCTION_CODES = new Set(["PGRST202", "PGRST203", "42883", "42P01"]);

export function parseNotificationHealthOptions(args: string[]): NotificationHealthOptions {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2)));
  const dateIndex = args.indexOf("--date");

  return {
    editionDate: dateIndex >= 0 ? (args[dateIndex + 1] ?? null) : null,
    strict: flags.has("strict")
  };
}

export async function runNotificationHealth(
  options: NotificationHealthOptions
): Promise<NotificationHealthOutput> {
  const supabase = createServiceRoleSupabaseClient({ requireCredentials: true });
  const { data, error } = await supabase.rpc("get_edition_notification_health", {
    p_edition_date: options.editionDate
  });

  // Before 20260906081000 is applied the function does not exist, and a health
  // check that cannot run is worth nothing on exactly the night it is needed.
  // The fallback answers the same question from the same tables.
  const row: HealthRow | null =
    error && MISSING_FUNCTION_CODES.has(error.code ?? "")
      ? await readHealthFromTables(supabase, options.editionDate)
      : ((data ?? [])[0] as HealthRow | undefined) ?? null;

  if (error && !MISSING_FUNCTION_CODES.has(error.code ?? "")) {
    throw new Error(`Could not read notification health: ${error.message}`);
  }

  const reminders = await readAnswerReminderHealth(supabase, options.editionDate);
  const reminderStatus = worstStatus(reminders.map((reminder) => reminder.status));

  if (!row || row.edition_date === null) {
    return {
      mode: "notification-health",
      editionDate: options.editionDate,
      source: error ? "tables" : "rpc",
      status: reminders.length > 0 ? reminderStatus : "unknown",
      eligibleDevices: 0,
      deliveryRows: 0,
      sent: 0,
      awaitingReceipt: 0,
      retryable: 0,
      terminal: 0,
      neverAttempted: 0,
      scheduledNotDue: 0,
      dueAwaitingWorker: 0,
      outboxStatus: "no_event",
      detail: "No published edition was found, so there is nothing to have announced.",
      reminders
    };
  }

  const neverAttempted = Number(row.never_attempted ?? 0);
  const retryable = Number(row.retryable ?? 0);
  const scheduledNotDue = Number(row.scheduled_not_due ?? 0);
  const dueAwaitingWorker = Number(row.due_awaiting_worker ?? 0);
  const outboxStatus = row.outbox_status ?? "no_event";

  // An edition that published and then failed verification has no deliveries by
  // design, and it is still critical — but it is a publication failure, not a
  // notification one, and saying "nothing was ever attempted" would send an
  // operator to read the sender's logs for a fault that is not there.
  const unverified = outboxStatus === "awaiting_verification";
  const editionStatus: HealthStatus =
    neverAttempted > 0 ? "critical" : retryable > 0 ? "warning" : "ok";
  const scheduledNote =
    scheduledNotDue > 0
      ? ` ${scheduledNotDue} device(s) are scheduled for their reader's own 19:00 and have not come due yet.`
      : "";

  return {
    mode: "notification-health",
    editionDate: row.edition_date,
    source: error ? "tables" : "rpc",
    status: worstStatus([editionStatus, reminderStatus]),
    eligibleDevices: Number(row.eligible_devices ?? 0),
    deliveryRows: Number(row.delivery_rows ?? 0),
    sent: Number(row.sent ?? 0),
    awaitingReceipt: Number(row.awaiting_receipt ?? 0),
    retryable,
    terminal: Number(row.terminal ?? 0),
    neverAttempted,
    scheduledNotDue,
    dueAwaitingWorker,
    outboxStatus,
    detail:
      (neverAttempted > 0 && unverified
        ? `Edition ${row.edition_date} was written to production but never passed verification, so no device was told and none should have been. Look at the publication run, not at the sender.`
        : neverAttempted > 0
          ? `${neverAttempted} eligible device(s) came due for ${row.edition_date} more than 30 minutes ago and have no delivery row: nothing was ever attempted for them.`
          : retryable > 0
            ? `${retryable} device(s) still to retry for ${row.edition_date}.`
            : `Every due device for ${row.edition_date} has a delivery row.`) + scheduledNote,
    reminders
  };
}

/** Exit non-zero on the states an operator has to act on. */
export function shouldFailNotificationHealth(
  output: NotificationHealthOutput,
  options: NotificationHealthOptions
): boolean {
  if (output.status === "critical") {
    return true;
  }

  return options.strict && output.status === "warning";
}

/**
 * One edition's reminder, in words an operator can act on.
 *
 * Precedence is severity first: a missed reminder is reported as missed even
 * if others for the same edition were sent, because it is the only one that
 * needs someone to look.
 */
export function summarizeAnswerReminderHealth(row: AnswerReminderHealthRow): AnswerReminderHealth {
  const count = (value: number | null | undefined) => Number(value ?? 0);
  const editionDate = row.edition_date ?? "unknown";
  const health = {
    editionDate,
    assignedReaders: count(row.assigned_readers),
    completedBeforeReminder: count(row.completed_before_reminder),
    scheduledNotDue: count(row.scheduled_not_due),
    dueAwaitingWorker: count(row.due_awaiting_worker),
    sent: count(row.sent),
    awaitingReceipt: count(row.awaiting_receipt),
    retryable: count(row.retryable),
    terminal: count(row.terminal),
    cancelled: count(row.cancelled),
    notEligible: count(row.not_eligible),
    notReleased: count(row.not_released),
    editionClosed: count(row.edition_closed),
    neverAttempted: count(row.never_attempted),
    nextDueAt: row.next_due_at ?? null
  };
  const terminalNote =
    health.terminal > 0
      ? ` ${health.terminal} reader(s) could not be reached for good (device gone or window elapsed).`
      : "";

  if (health.neverAttempted > 0) {
    return {
      ...health,
      status: "critical",
      summary: "failed",
      detail: `${health.neverAttempted} reader(s) were owed a reminder for ${editionDate}, it came due more than 30 minutes ago and was never attempted.${terminalNote}`
    };
  }

  if (health.retryable > 0) {
    return {
      ...health,
      status: "warning",
      summary: "due",
      detail: `${health.retryable} reminder(s) for ${editionDate} are still to retry inside their morning window.${terminalNote}`
    };
  }

  if (health.terminal > 0) {
    return {
      ...health,
      status: "warning",
      summary: health.sent + health.awaitingReceipt > 0 ? "sent" : "failed",
      detail: `Reminders for ${editionDate}: ${health.sent + health.awaitingReceipt} sent.${terminalNote}`
    };
  }

  if (health.notReleased > 0 && health.assignedReaders === health.notReleased) {
    return {
      ...health,
      status: "ok",
      summary: "not_released",
      detail: `Edition ${editionDate} is not verified yet: no reminder can be due.`
    };
  }

  if (health.dueAwaitingWorker > 0) {
    return {
      ...health,
      status: "ok",
      summary: "due",
      detail: `${health.dueAwaitingWorker} reminder(s) for ${editionDate} came due in the last 30 minutes; the worker has not run yet.`
    };
  }

  if (health.scheduledNotDue > 0) {
    return {
      ...health,
      status: "ok",
      summary: "scheduled",
      detail: `${health.scheduledNotDue} reminder(s) for ${editionDate} are scheduled for 08:30 reader-local; the next at ${health.nextDueAt ?? "an unknown time"}.`
    };
  }

  if (health.sent + health.awaitingReceipt > 0) {
    return {
      ...health,
      status: "ok",
      summary: "sent",
      detail: `Reminders for ${editionDate}: ${health.sent} delivered, ${health.awaitingReceipt} awaiting a receipt, ${health.completedBeforeReminder + health.cancelled} reader(s) finished before theirs was sent.`
    };
  }

  return {
    ...health,
    status: "ok",
    summary: "no_reminder_needed",
    detail:
      health.assignedReaders === 0
        ? `No reader had questions assigned for ${editionDate}: no reminder is needed.`
        : `No reminder is needed for ${editionDate}: ${health.completedBeforeReminder + health.cancelled} reader(s) finished before theirs, ${health.notEligible} cannot be reached by push.`
  };
}

function worstStatus(statuses: HealthStatus[]): Exclude<HealthStatus, "unknown"> {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  return "ok";
}

/**
 * Reminder health for --date, or for the two most recent editions: the one
 * whose readers are reminded this morning and the one they will be reminded
 * about tomorrow. Empty before 20260910090000 is applied.
 */
async function readAnswerReminderHealth(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  editionDate: string | null
): Promise<AnswerReminderHealth[]> {
  let dates: string[] = editionDate ? [editionDate] : [];

  if (!editionDate) {
    const { data, error } = await supabase
      .from("editions")
      .select("edition_date")
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(2);

    if (error) {
      return [];
    }

    dates = ((data ?? []) as Array<{ edition_date: string }>).map((row) => row.edition_date);
  }

  const reminders: AnswerReminderHealth[] = [];

  for (const date of dates) {
    const { data, error } = await supabase.rpc("get_edition_answer_reminder_health", {
      p_edition_date: date
    });

    if (error) {
      if (MISSING_FUNCTION_CODES.has(error.code ?? "")) {
        return [];
      }

      throw new Error(`Could not read answer reminder health for ${date}: ${error.message}`);
    }

    const row = ((data ?? [])[0] as AnswerReminderHealthRow | undefined) ?? null;

    if (row) {
      reminders.push(summarizeAnswerReminderHealth(row));
    }
  }

  return reminders;
}

/**
 * The same question, asked of the tables directly.
 *
 * Deliberately the only duplicate of the health definition, and it exists
 * because the alternative is a health check that reports "unknown" until a
 * migration lands. It is kept side by side with the SQL so a change to one is an
 * obvious prompt to change the other. It predates reader-local timing and
 * treats every eligible device as due, which is what the sender did too until
 * 20260910090000 exists.
 */
async function readHealthFromTables(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  editionDate: string | null
): Promise<HealthRow | null> {
  const day = editionDate ?? (await latestPublishedEditionDate(supabase)) ?? getProductEditionDate();

  const { data: drops, error: dropsError } = await supabase
    .from("daily_drops")
    .select("user_id")
    .eq("drop_date", day)
    .eq("status", "published");

  if (dropsError) {
    throw new Error(`Could not read published drops: ${dropsError.message}`);
  }

  const userIds = [...new Set((drops ?? []).map((drop) => (drop as { user_id: string }).user_id))];

  if (userIds.length === 0) {
    return null;
  }

  const [{ data: preferences }, { data: tokens }, { data: deliveries }] = await Promise.all([
    supabase
      .from("user_preferences")
      .select("user_id")
      .in("user_id", userIds)
      .eq("notifications_enabled", true),
    supabase.from("push_tokens").select("id,user_id").in("user_id", userIds).eq("enabled", true),
    supabase
      .from("push_notification_deliveries")
      .select("status")
      .eq("drop_date", day)
      .eq("notification_kind", "edition_ready")
  ]);

  const enabled = new Set((preferences ?? []).map((row) => (row as { user_id: string }).user_id));
  const eligibleDevices = (tokens ?? []).filter((token) =>
    enabled.has((token as { user_id: string }).user_id)
  ).length;
  const rows = (deliveries ?? []).map((row) => (row as { status: string }).status);
  const count = (statuses: string[]) => rows.filter((status) => statuses.includes(status)).length;

  return {
    edition_date: day,
    eligible_devices: eligibleDevices,
    delivery_rows: rows.length,
    sent: count(["sent"]),
    awaiting_receipt: count(["ticket_accepted", "awaiting_receipt"]),
    retryable: count(["pending", "claimed", "sending", "retryable_failure"]),
    terminal: count(["terminal_failure", "failed"]),
    never_attempted: Math.max(eligibleDevices - rows.length, 0),
    outbox_status: "unknown"
  };
}

async function latestPublishedEditionDate(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>
): Promise<string | null> {
  const { data } = await supabase
    .from("daily_drops")
    .select("drop_date")
    .eq("status", "published")
    .order("drop_date", { ascending: false })
    .limit(1);

  return ((data ?? [])[0] as { drop_date: string } | undefined)?.drop_date ?? null;
}
