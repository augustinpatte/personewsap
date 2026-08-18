import type { Language } from "../domain.js";
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
 */

export type PushNotificationsOptions = {
  dropDate: string;
  languages: Language[];
  /** Send even on a day the cadence has no edition (manual dispatch only). */
  force: boolean;
  dryRun: boolean;
};

export type PushNotificationsOutput = {
  mode: "push-notifications";
  dropDate: string;
  editionDay: boolean;
  dryRun: boolean;
  result: SendEditionNotificationsResult | null;
  note: string;
};

export function parsePushNotificationsOptions(args: string[]): PushNotificationsOptions {
  const flags = readFlags(args);
  const languages = (flags.get("languages") ?? flags.get("language") ?? process.env.LANGUAGES ?? "fr,en")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is Language => value === "fr" || value === "en");

  return {
    dropDate: flags.get("date") ?? getProductEditionDate(),
    languages: languages.length > 0 ? languages : ["fr", "en"],
    force: flags.has("force") || process.env.FORCE_PUSH_NOTIFICATIONS === "true",
    dryRun: flags.has("dry-run") || process.env.DRY_RUN === "true"
  };
}

export async function runPushNotifications(
  options: PushNotificationsOptions
): Promise<PushNotificationsOutput> {
  const editionDay = resolveEditionType(options.dropDate) !== null;

  // Quiet days (Tue/Thu/Sat) publish nothing, so there is nothing to announce.
  // The check is on the cadence, not on the data, so a stray drop cannot turn a
  // quiet day into a notification day.
  if (!editionDay && !options.force) {
    return {
      mode: "push-notifications",
      dropDate: options.dropDate,
      editionDay,
      dryRun: options.dryRun,
      result: null,
      note: "Quiet day in the 4x/week cadence: no edition, no notification."
    };
  }

  if (options.dryRun) {
    return {
      mode: "push-notifications",
      dropDate: options.dropDate,
      editionDay,
      dryRun: true,
      result: null,
      note: "Dry run: recipients were not resolved and nothing was sent."
    };
  }

  const supabase = createServiceRoleSupabaseClient({ requireCredentials: true });
  const store = createSupabasePushNotificationStore(supabase);
  const client = createExpoPushClient();

  const result = await sendEditionNotifications({
    store,
    client,
    dropDate: options.dropDate,
    languages: options.languages
  });

  return {
    mode: "push-notifications",
    dropDate: options.dropDate,
    editionDay,
    dryRun: false,
    result,
    note:
      result.retryable > 0
        ? "Some devices could not be reached. Re-run this command to retry them; already-notified devices are skipped."
        : "Delivery complete."
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
