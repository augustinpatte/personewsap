import { getProductEditionDate, resolveEditionType } from "../scheduler/editionCadence.js";

/**
 * Did the edition that was due actually publish?
 *
 * Monitoring used to look at the latest PUBLISHED edition, so a night with no
 * edition at all looked like the previous edition and stayed green. This asks
 * about the edition the calendar was owed instead: today's on a publication
 * day, otherwise the most recent publication day before it.
 *
 * The scheduled publisher tries from 19:00 to 21:00 Europe/Paris (catch-up
 * every 15 minutes). Before 21:15 Paris an unpublished edition is `pending`;
 * after it, `missed`.
 */

export const PUBLICATION_DEADLINE_PARIS = "21:15";

export type EditionPublicationStatus = "published" | "pending" | "missed";

export type EditionPublicationCheck = {
  editionDate: string;
  editionType: string;
  status: EditionPublicationStatus;
  deadlineParis: string;
};

const parisTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function addDays(date: string, days: number): string {
  const anchored = new Date(`${date}T12:00:00Z`);
  anchored.setUTCDate(anchored.getUTCDate() + days);
  return anchored.toISOString().slice(0, 10);
}

/** Today on a publication day, else the most recent publication day before it (Paris calendar). */
export function resolveDueEditionDate(now: Date = new Date()): string {
  const today = getProductEditionDate(now);

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addDays(today, -offset);
    if (resolveEditionType(candidate)) {
      return candidate;
    }
  }

  return today;
}

export function evaluateEditionPublication(input: {
  editionDate: string;
  published: boolean;
  now?: Date;
}): EditionPublicationCheck {
  const now = input.now ?? new Date();
  const editionType = resolveEditionType(input.editionDate) ?? "unscheduled";
  const today = getProductEditionDate(now);
  const deadlinePassed =
    input.editionDate < today ||
    (input.editionDate === today && parisTime.format(now) >= PUBLICATION_DEADLINE_PARIS);

  return {
    editionDate: input.editionDate,
    editionType,
    status: input.published ? "published" : deadlinePassed ? "missed" : "pending",
    deadlineParis: `${input.editionDate} ${PUBLICATION_DEADLINE_PARIS}`
  };
}

function deadlineHasPassed(editionDate: string, now: Date): boolean {
  const today = getProductEditionDate(now);
  return editionDate < today || (editionDate === today && parisTime.format(now) >= PUBLICATION_DEADLINE_PARIS);
}

// ---------------------------------------------------------------------------
// The whole answer for one edition date: production AND staging AND readers
// ---------------------------------------------------------------------------
//
// A production editions row says content was written. It does not say the
// edition was verified (questions, assignments, notification release), and a
// row alone used to be enough to turn this check green. The staging receipt is
// the statement that verification passed: the scheduled publisher writes it
// only after production was read back and found complete. So health needs both.

/** What staging knows about one edition date (scheduled_edition_publication_health). */
export type StagingPublicationSnapshot =
  | {
      available: true;
      /** not_publication_day | published | pending | missed, as staging computes it. */
      status: string;
      receipted: boolean;
      lastAttemptReason: string | null;
      staleOpenRuns: number;
      source: "rpc" | "tables";
    }
  | { available: false; reason: "not_configured" | "unreadable"; error?: string };

export type EditionHealthState =
  | "pending"
  | "missed"
  | "published_unverified"
  | "verification_failed"
  | "verified_notification_pending"
  | "notification_failed"
  | "healthy"
  | "failed";

export type EditionHealth = {
  editionDate: string;
  state: EditionHealthState;
  severity: "ok" | "warning" | "critical";
  deadlinePassed: boolean;
  detail: string;
};

/** Run reasons that mean production was written but did not verify. */
export const VERIFICATION_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "production_verification_failed",
  "production_verification_timeout",
  "production_verification_unavailable"
]);

/** Outbox states that, after a receipt, mean readers were never released. */
const RELEASE_FAILED_OUTBOX: ReadonlySet<string> = new Set(["awaiting_verification", "failed"]);

export function evaluateEditionHealth(input: {
  editionDate: string;
  now?: Date;
  productionPublished: boolean;
  staging: StagingPublicationSnapshot;
  /** Production notification health for the date, when it published. */
  notification: { status: "ok" | "warning" | "critical" | "unknown"; outboxStatus: string } | null;
  /** When staging cannot be read: fail (the CI health gate) or warn (other callers). */
  requireStaging?: boolean;
}): EditionHealth {
  const now = input.now ?? new Date();
  const deadlinePassed = deadlineHasPassed(input.editionDate, now);
  const date = input.editionDate;
  const staging = input.staging;
  const receipted = staging.available && staging.receipted;
  const recovery =
    ` Timeline: select public.edition_publication_timeline('${date}'); ` +
    "recovery: select public.run_scheduled_publication_tick(true); (staging).";
  const result = (state: EditionHealthState, severity: EditionHealth["severity"], detail: string): EditionHealth => ({
    editionDate: date,
    state,
    severity,
    deadlinePassed,
    detail
  });

  if (!input.productionPublished) {
    if (receipted) {
      return result(
        "failed",
        "critical",
        `Staging holds a publication receipt for ${date}, but production has no edition for that date.` + recovery
      );
    }

    return deadlinePassed
      ? result("missed", "critical", `Edition ${date} did not publish by ${date} ${PUBLICATION_DEADLINE_PARIS} Europe/Paris.` + recovery)
      : result("pending", "ok", `Edition ${date} has not published yet; the publisher keeps trying until 21:00 Europe/Paris.`);
  }

  if (!staging.available) {
    const why =
      staging.reason === "not_configured"
        ? "STAGING_SUPABASE_URL / STAGING_SUPABASE_SERVICE_ROLE_KEY are not set"
        : `staging could not be read (${staging.error ?? "unknown error"})`;

    return result(
      "published_unverified",
      deadlinePassed && input.requireStaging ? "critical" : "warning",
      `Edition ${date} exists in production, but its verification cannot be confirmed: ${why}. ` +
        "A production row alone is not a verified edition."
    );
  }

  if (!receipted) {
    if (staging.lastAttemptReason && VERIFICATION_FAILURE_REASONS.has(staging.lastAttemptReason)) {
      return result(
        "verification_failed",
        deadlinePassed ? "critical" : "warning",
        `Edition ${date} was written to production but its verification failed (${staging.lastAttemptReason}); ` +
          "no receipt, so readers were not released." + recovery
      );
    }

    return result(
      "published_unverified",
      deadlinePassed ? "critical" : "ok",
      deadlinePassed
        ? `Edition ${date} exists in production but staging never recorded a verified publication (no receipt` +
            `${staging.lastAttemptReason ? `; last attempt: ${staging.lastAttemptReason}` : ""}).` + recovery
        : `Edition ${date} is in production; verification and receipt are still in progress.`
    );
  }

  // Verified and receipted. Now: were readers released and told?
  const notification = input.notification;
  const stale = staging.staleOpenRuns > 0 ? ` (${staging.staleOpenRuns} stale open run(s) left after the receipt; not authoritative)` : "";

  if (notification && RELEASE_FAILED_OUTBOX.has(notification.outboxStatus)) {
    return result(
      "notification_failed",
      "critical",
      `Edition ${date} is verified, but its notification release did not happen (outbox: ${notification.outboxStatus}).`
    );
  }

  if (!notification || notification.status === "unknown") {
    return result("verified_notification_pending", "warning", `Edition ${date} is verified; no notification health row yet.${stale}`);
  }

  if (notification.status === "critical") {
    return result("notification_failed", "critical", `Edition ${date} is verified, but due devices were never attempted.${stale}`);
  }

  if (notification.status === "warning") {
    return result(
      "verified_notification_pending",
      "warning",
      `Edition ${date} is verified; some deliveries are still within their retries.${stale}`
    );
  }

  return result("healthy", "ok", `Edition ${date} is published, verified and released.${stale}`);
}
