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

import { getDeviceTimeZone, getUserLocalDateKey } from "../../lib/localDate";

export type EditionType = "daily" | "weekly_digest";

/**
 * The PUBLISHER's timezone — not the reader's.
 *
 * PersoNews builds one edition per editorial day, and the job that builds it
 * runs on a Europe/Paris schedule (19:00 Mon/Wed/Fri/Sun). So this zone answers
 * exactly one question: *which edition dates can exist yet*. It must never be
 * used to decide what day it is for the person reading — that is
 * `getUserLocalDateKey()` in src/lib/localDate.ts, and only that.
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
 * The newest edition date the content engine may have built by now.
 *
 * Kept in parity with services/content-engine/src/scheduler/editionCadence.ts:
 * both sides must resolve the same YYYY-MM-DD for the same instant, or the app
 * asks for a drop_date the job has never written.
 */
export function getProductEditionDate(now: Date = new Date()): string {
  return productDateFormat.format(now);
}

/**
 * The edition date the Today view should ask Supabase for.
 *
 * Two facts, both required:
 *
 *   - the reader's own calendar day, from their device timezone. An edition is
 *     theirs for the whole of their local day and moves to the past at their
 *     local midnight, not at Paris's. This is what stopped a reader in New
 *     Orleans from losing Sunday's edition at 21:30 on Sunday.
 *
 *   - the publisher's day, as a ceiling. The reader's day is never allowed to
 *     run ahead of the newest edition that can exist: a reader in Tokyo is on
 *     the 31st while Paris is still building the 30th, and asking for the 31st
 *     would show them an empty app rather than the edition they have.
 *
 * So: the reader's own day, capped at what has been published. West of Paris
 * the reader's day wins (the bug this fixes); east of Paris the ceiling wins
 * and behaviour is unchanged. Nowhere is a geographic zone used to decide what
 * "today" means to the reader.
 */
export function resolveReaderEditionDate(
  now: Date = new Date(),
  timeZone: string = getDeviceTimeZone()
): string {
  const readerToday = getUserLocalDateKey(now, timeZone);
  const latestPublishable = getProductEditionDate(now);

  return readerToday < latestPublishable ? readerToday : latestPublishable;
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
