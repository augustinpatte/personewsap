import type { Language } from "../domain.js";
import {
  createSupabaseNotificationOutbox,
  resolveEditionDatesToAnnounce,
  type NotificationEvent
} from "../notifications/notificationOutbox.js";
import {
  createExpoPushClient,
  sendEditionNotifications,
  type SendEditionNotificationsResult
} from "../notifications/pushSender.js";
import { createSupabasePushNotificationStore } from "../notifications/supabasePushStore.js";
import { getProductEditionDate, resolveEditionType } from "../scheduler/editionCadence.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";

/**
 * Announce a published edition to the readers who asked to be told.
 *
 * Runs after the daily job, as its own step, on purpose: a failure here must
 * never roll back or block an edition that is already published. Re-running it
 * is always safe — deliveries are recorded per device and per edition — so the
 * natural recovery from an Expo outage is simply to run it again.
 *
 * WHAT DECIDES WHICH EDITION IS ANNOUNCED
 *
 * The outbox first. `public.notification_outbox` carries one event per edition
 * that actually published, written in the publishing transaction, so an event
 * is proof rather than an assumption. Whatever the events name is announced.
 *
 * Then today's cadence date as well — unless the operator named a date with
 * `--date`, which is an explicit instruction and is obeyed on its own. The
 * outbox being empty never proves nothing published: the migration may not be
 * applied, the trigger may have been rolled back, the row may have been drained
 * by an earlier run that then failed. Sending for today's date costs nothing
 * when there is nothing to send — the delivery rows make it a no-op — and it is
 * what keeps this command working as a fallback while the event path is being
 * rolled out.
 *
 * The one thing that withholds the cadence date is a verification boundary this
 * run can actually see: an outbox row for that date still sitting at
 * `awaiting_verification` means production holds an edition that has not been
 * read back and found complete, and an unverified edition is not announced by
 * any path. Not knowing is not the same as knowing it failed, so an absent row
 * withholds nothing.
 */

export type PushNotificationsOptions = {
  dropDate: string;
  languages: Language[];
  /** Send even on a day the cadence has no edition (manual dispatch only). */
  force: boolean;
  dryRun: boolean;
  /** True when `--date` named the edition, which suppresses outbox draining. */
  explicitDate: boolean;
  /**
   * Single-reader test send. Requires CONFIRM_SINGLE_USER_PUSH=true, and is the
   * only way to reach a real device from a laptop: without it this command has
   * no way to address one account, and with it it can address no other.
   */
  onlyUserId: string | null;
};

export class SingleUserPushConfirmationError extends Error {
  constructor() {
    super(
      "--user targets one real device. Re-run with CONFIRM_SINGLE_USER_PUSH=true to confirm this single-reader send."
    );
    this.name = "SingleUserPushConfirmationError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PushNotificationsOutput = {
  mode: "push-notifications";
  dropDate: string;
  editionDay: boolean;
  dryRun: boolean;
  /** True when the send was restricted to a single reader by --user. */
  singleUser?: boolean;
  /** What caused this run to announce what it announced. */
  trigger: "event" | "schedule" | "explicit";
  /** Outbox events this run leased. */
  events: Array<{ eventType: string; eventDate: string; attemptCount: number }>;
  /** The primary edition's result, kept as the headline number. */
  result: SendEditionNotificationsResult | null;
  /** Every edition this run announced, including the primary one. */
  editions: Array<{ dropDate: string; result: SendEditionNotificationsResult }>;
  /**
   * True when this run could not finish its own bookkeeping. The CLI exits
   * non-zero on it: a run that does not know what it sent must not be green.
   */
  incomplete: boolean;
  note: string;
};

export function parsePushNotificationsOptions(args: string[]): PushNotificationsOptions {
  const flags = readFlags(args);
  const languages = (flags.get("languages") ?? flags.get("language") ?? process.env.LANGUAGES ?? "fr,en")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is Language => value === "fr" || value === "en");

  const onlyUserId = flags.get("user")?.trim() ?? null;

  if (onlyUserId !== null) {
    if (!UUID_PATTERN.test(onlyUserId)) {
      throw new Error("--user expects one reader's account id (a UUID).");
    }

    if (process.env.CONFIRM_SINGLE_USER_PUSH !== "true") {
      throw new SingleUserPushConfirmationError();
    }
  }

  const explicitDate = flags.get("date")?.trim() ?? null;

  return {
    dropDate: explicitDate ?? getProductEditionDate(),
    languages: languages.length > 0 ? languages : ["fr", "en"],
    force: flags.has("force") || process.env.FORCE_PUSH_NOTIFICATIONS === "true",
    dryRun: flags.has("dry-run") || process.env.DRY_RUN === "true",
    explicitDate: explicitDate !== null,
    onlyUserId
  };
}

export async function runPushNotifications(
  options: PushNotificationsOptions
): Promise<PushNotificationsOutput> {
  const editionDay = resolveEditionType(options.dropDate) !== null;
  const empty = {
    mode: "push-notifications" as const,
    dropDate: options.dropDate,
    editionDay,
    dryRun: options.dryRun,
    trigger: options.explicitDate ? ("explicit" as const) : ("schedule" as const),
    events: [],
    result: null,
    editions: [],
    incomplete: false
  };

  if (options.dryRun) {
    return {
      ...empty,
      dryRun: true,
      note: "Dry run: recipients were not resolved and nothing was sent."
    };
  }

  const supabase = createServiceRoleSupabaseClient({ requireCredentials: true });
  const store = createSupabasePushNotificationStore(supabase);
  const client = createExpoPushClient();

  // An explicit --date is an instruction, not a hint: it is obeyed on its own,
  // so an operator recovering one edition cannot accidentally drain and consume
  // the event for another one at the same time.
  const outbox = createSupabaseNotificationOutbox(supabase);
  const events: NotificationEvent[] = options.explicitDate
    ? []
    : await outbox.claimEvents({ limit: 10 });

  // A quiet day publishes nothing under the cadence, so there is nothing to
  // announce — unless an event says otherwise, and an event is a fact about an
  // edition that exists. The cadence check guards the guess, never the fact.
  let fallbackDate = editionDay || options.force ? options.dropDate : null;

  // The verification boundary applies to this path too. An edition can be
  // written to production and then fail `verify_scheduled_edition`, and while
  // the event path physically cannot announce it — the event is still
  // `awaiting_verification`, which `claim_notification_events` does not see —
  // the cadence-derived fallback would find the published drops and announce it
  // anyway. Only a date this run KNOWS is unverified is withheld; an edition
  // with no outbox row behaves exactly as it did before, and an operator naming
  // a date or forcing a send is giving an instruction, not a hint.
  let withheld: string | null = null;
  if (fallbackDate && !options.explicitDate && !options.force) {
    if (await outbox.isAwaitingVerification({ eventDate: fallbackDate })) {
      withheld = fallbackDate;
      fallbackDate = null;
    }
  }

  const dates = resolveEditionDatesToAnnounce({ events, fallbackDate });

  if (dates.length === 0) {
    return {
      ...empty,
      note: withheld
        ? `Edition ${withheld} is published but not yet verified: nothing is announced until verification succeeds.`
        : "Quiet day in the 4x/week cadence: no edition, no notification."
    };
  }

  const editions: PushNotificationsOutput["editions"] = [];

  for (const dropDate of dates) {
    const result = await sendEditionNotifications({
      store,
      client,
      dropDate,
      languages: options.languages,
      onlyUserIds: options.onlyUserId ? [options.onlyUserId] : undefined
    });

    editions.push({ dropDate, result });
  }

  const resultsByDate = new Map(editions.map((edition) => [edition.dropDate, edition.result]));

  // An event is only released when its edition has nothing left to do. A single
  // retryable device leaves it pending, so the next dispatch picks it up rather
  // than the edition waiting for the next fallback schedule.
  for (const event of events) {
    const result = resultsByDate.get(event.eventDate);
    const outstanding =
      result === undefined || result.retryable > 0 || result.bookkeepingFailures > 0;

    await outbox.completeEvent({
      eventId: event.eventId,
      succeeded: !outstanding,
      error: outstanding ? "delivery incomplete: devices still to retry" : undefined
    });
  }

  const primary = resultsByDate.get(options.dropDate) ?? editions[0]?.result ?? null;
  const totals = editions.reduce(
    (accumulator, edition) => ({
      retryable: accumulator.retryable + edition.result.retryable,
      awaitingReceipt: accumulator.awaitingReceipt + edition.result.awaitingReceipt,
      bookkeepingFailures:
        accumulator.bookkeepingFailures + edition.result.bookkeepingFailures
    }),
    { retryable: 0, awaitingReceipt: 0, bookkeepingFailures: 0 }
  );

  return {
    ...empty,
    trigger: options.explicitDate ? "explicit" : events.length > 0 ? "event" : "schedule",
    events: events.map((event) => ({
      eventType: event.eventType,
      eventDate: event.eventDate,
      attemptCount: event.attemptCount
    })),
    singleUser: options.onlyUserId !== null,
    result: primary,
    editions,
    incomplete: totals.bookkeepingFailures > 0,
    note:
      totals.bookkeepingFailures > 0
        ? "Some deliveries could not be recorded. This run does not know what it sent: check push_notification_deliveries before re-running."
        : totals.retryable > 0
          ? "Some devices could not be reached. Re-run this command to retry them; already-notified devices are skipped."
          : totals.awaitingReceipt > 0
            ? "Expo accepted push tickets. Run content:push-receipts later to confirm final delivery."
            : "No push delivery work remains."
  };
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
      continue;
    }

    values.set(key, "true");
  }

  return values;
}
