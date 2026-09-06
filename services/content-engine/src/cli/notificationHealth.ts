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
 *   never_attempted = eligible devices − delivery rows
 *
 * Devices whose reader has notifications on, whose edition published, and for
 * which no delivery row exists at all. Not a device that failed — a device
 * nothing was ever tried for. It is the number that was silently equal to the
 * whole audience.
 */

export type NotificationHealthOptions = {
  editionDate: string | null;
  strict: boolean;
};

export type NotificationHealthOutput = {
  mode: "notification-health";
  editionDate: string | null;
  source: "rpc" | "tables";
  status: "ok" | "warning" | "critical" | "unknown";
  eligibleDevices: number;
  deliveryRows: number;
  sent: number;
  awaitingReceipt: number;
  retryable: number;
  terminal: number;
  neverAttempted: number;
  outboxStatus: string;
  detail: string;
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

  if (!row || row.edition_date === null) {
    return {
      mode: "notification-health",
      editionDate: options.editionDate,
      source: error ? "tables" : "rpc",
      status: "unknown",
      eligibleDevices: 0,
      deliveryRows: 0,
      sent: 0,
      awaitingReceipt: 0,
      retryable: 0,
      terminal: 0,
      neverAttempted: 0,
      outboxStatus: "no_event",
      detail: "No published edition was found, so there is nothing to have announced."
    };
  }

  const neverAttempted = Number(row.never_attempted ?? 0);
  const retryable = Number(row.retryable ?? 0);
  const outboxStatus = row.outbox_status ?? "no_event";

  // An edition that published and then failed verification has no deliveries by
  // design, and it is still critical — but it is a publication failure, not a
  // notification one, and saying "nothing was ever attempted" would send an
  // operator to read the sender's logs for a fault that is not there.
  const unverified = outboxStatus === "awaiting_verification";
  const status: NotificationHealthOutput["status"] =
    neverAttempted > 0 ? "critical" : retryable > 0 ? "warning" : "ok";

  return {
    mode: "notification-health",
    editionDate: row.edition_date,
    source: error ? "tables" : "rpc",
    status,
    eligibleDevices: Number(row.eligible_devices ?? 0),
    deliveryRows: Number(row.delivery_rows ?? 0),
    sent: Number(row.sent ?? 0),
    awaitingReceipt: Number(row.awaiting_receipt ?? 0),
    retryable,
    terminal: Number(row.terminal ?? 0),
    neverAttempted,
    outboxStatus,
    detail:
      neverAttempted > 0 && unverified
        ? `Edition ${row.edition_date} was written to production but never passed verification, so no device was told and none should have been. Look at the publication run, not at the sender.`
        : neverAttempted > 0
          ? `${neverAttempted} eligible device(s) have no delivery row for ${row.edition_date}: nothing was ever attempted for them.`
          : retryable > 0
            ? `${retryable} device(s) still to retry for ${row.edition_date}.`
            : `Every eligible device for ${row.edition_date} has a delivery row.`
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
 * The same question, asked of the tables directly.
 *
 * Deliberately the only duplicate of the health definition, and it exists
 * because the alternative is a health check that reports "unknown" until a
 * migration lands. It is kept side by side with the SQL so a change to one is an
 * obvious prompt to change the other.
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
