/**
 * Editorial cadence mirror for the mobile client.
 *
 *   Monday    -> daily
 *   Wednesday -> daily
 *   Friday    -> daily
 *   Sunday    -> weekly_digest
 *
 * Kept in sync with services/content-engine/src/scheduler/editionCadence.ts.
 * The app uses this to frame quiet days (Tue/Thu/Sat) as a deliberate rhythm
 * ("No new edition today") instead of an error or a "missing content" state.
 */

export type EditionType = "daily" | "weekly_digest";

/**
 * The single product timezone. The editorial date is the same for everyone,
 * everywhere — it is never derived from the device clock. A reader in the US who
 * is still on Tuesday night sees Wednesday's Paris edition the moment it is the
 * editorial day in Paris.
 */
export const PRODUCT_TIME_ZONE = "Europe/Paris";

// "en-CA" formats as YYYY-MM-DD, which is exactly the drop_date shape used by the
// content engine, so the client can request the matching edition by string.
const productDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRODUCT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/**
 * Resolve the current editorial date (YYYY-MM-DD) in the product timezone.
 * This is what the client uses to decide which edition exists — never the
 * device-local calendar date.
 */
export function getProductEditionDate(now: Date = new Date()): string {
  return productDateFormat.format(now);
}

const EDITION_WEEKDAYS: Partial<Record<number, EditionType>> = {
  1: "daily", // Monday
  3: "daily", // Wednesday
  5: "daily", // Friday
  0: "weekly_digest" // Sunday
};

const DROP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function weekdayForDropDate(dropDate: string): number | null {
  if (!DROP_DATE_PATTERN.test(dropDate)) {
    return null;
  }

  // Anchor to UTC noon so the weekday never drifts across timezones.
  const parsed = new Date(`${dropDate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay();
}

export function resolveEditionType(dropDate: string): EditionType | null {
  const weekday = weekdayForDropDate(dropDate);
  return weekday === null ? null : EDITION_WEEKDAYS[weekday] ?? null;
}

export function isEditionDay(dropDate: string): boolean {
  return resolveEditionType(dropDate) !== null;
}

/** Next scheduled edition strictly after the given date, or null on bad input. */
export function nextEditionDate(dropDate: string): { date: string; editionType: EditionType } | null {
  const weekday = weekdayForDropDate(dropDate);
  if (weekday === null) {
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
