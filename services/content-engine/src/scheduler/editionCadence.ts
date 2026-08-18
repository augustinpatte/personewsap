/**
 * Editorial cadence: PersoNews publishes 4 editions per week.
 *
 *   Monday    -> daily
 *   Wednesday -> daily
 *   Friday    -> daily
 *   Sunday    -> weekly_digest
 *
 * Every other weekday has no edition. On those days the content engine must not
 * generate master content and must not create empty daily drops. The same
 * weekday map is mirrored on the mobile client so the app can frame quiet days
 * as a deliberate rhythm rather than a bug.
 *
 * Mirrored by apps/mobile/src/features/today/editionCadence.ts, including the
 * product timezone below: both sides must resolve the same YYYY-MM-DD for the
 * same instant, or the app asks for an edition the job has not built.
 */

export type EditionType = "daily" | "weekly_digest";

/**
 * The single editorial timezone. PersoNewsAP publishes one edition per
 * editorial day for everyone, everywhere: the date is never derived from a
 * reader's device clock, nor from the server's own locale or UTC offset.
 *
 * This used to be Europe/Paris on the client and UTC here (a plain
 * `toISOString().slice(0, 10)`), which left a window every night — 00:00-02:00
 * Paris in summer, 00:00-01:00 in winter — where the app already asked for
 * tomorrow's edition while the job was still building yesterday's date.
 */
export const PRODUCT_TIME_ZONE = "Europe/Paris";

// "en-CA" formats as YYYY-MM-DD, which is exactly the drop_date shape stored in
// public.daily_drops, so the value can be used as a date string directly.
const productDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRODUCT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/**
 * The current editorial date (YYYY-MM-DD) in the product timezone.
 *
 * This is the only thing a job, CLI or script may use to decide "today's
 * edition" when no explicit --date is given. An explicit --date always wins and
 * is passed through untouched.
 */
export function getProductEditionDate(now: Date = new Date()): string {
  return productDateFormat.format(now);
}

/** ISO weekday (0 = Sunday … 6 = Saturday) -> edition type. */
const EDITION_WEEKDAYS: Partial<Record<number, EditionType>> = {
  1: "daily", // Monday
  3: "daily", // Wednesday
  5: "daily", // Friday
  0: "weekly_digest" // Sunday
};

const DROP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDropDate(dropDate: string): boolean {
  if (!DROP_DATE_PATTERN.test(dropDate)) {
    return false;
  }

  const parsed = Date.parse(`${dropDate}T12:00:00Z`);
  return Number.isFinite(parsed);
}

/**
 * Resolve the weekday for a `YYYY-MM-DD` drop date. We anchor to UTC noon so the
 * weekday never drifts across timezones or DST boundaries.
 */
export function weekdayForDropDate(dropDate: string): number {
  return new Date(`${dropDate}T12:00:00Z`).getUTCDay();
}

/** Returns the scheduled edition type for a drop date, or null on quiet days. */
export function resolveEditionType(dropDate: string): EditionType | null {
  if (!isValidDropDate(dropDate)) {
    return null;
  }

  return EDITION_WEEKDAYS[weekdayForDropDate(dropDate)] ?? null;
}

export function isEditionDay(dropDate: string): boolean {
  return resolveEditionType(dropDate) !== null;
}

/**
 * Allow operators to force an edition on a quiet day for dry-runs and tests via
 * FORCE_EDITION=daily|weekly_digest (FORCE_EDITION=true defaults to daily).
 * Never affects which weekdays the production scheduler treats as edition days.
 */
export function parseForcedEditionType(value: string | undefined | null): EditionType | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "daily") {
    return "daily";
  }
  if (normalized === "weekly_digest" || normalized === "weekly") {
    return "weekly_digest";
  }
  if (normalized === "true" || normalized === "1") {
    return "daily";
  }

  return null;
}

/** Find the next scheduled edition date strictly after the given drop date. */
export function nextEditionDate(dropDate: string): { date: string; editionType: EditionType } | null {
  if (!isValidDropDate(dropDate)) {
    return null;
  }

  const base = new Date(`${dropDate}T12:00:00Z`);
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(base.getTime() + offset * 86_400_000);
    const editionType = EDITION_WEEKDAYS[candidate.getUTCDay()];
    if (editionType) {
      return { date: candidate.toISOString().slice(0, 10), editionType };
    }
  }

  return null;
}
