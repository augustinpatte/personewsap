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
 */

export type EditionType = "daily" | "weekly_digest";

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
