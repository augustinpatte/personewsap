/**
 * The reader's own calendar day.
 *
 * PersoNews deals with two different kinds of date, and conflating them is what
 * put a reader in New Orleans into "tomorrow" at 21:30 their time:
 *
 *   1. The READER'S day — what "today", "past" and "future" mean to the person
 *      holding the phone. That is their device timezone and nothing else.
 *      This module owns it.
 *
 *   2. The PUBLISHER'S day — which editions exist yet. PersoNews publishes one
 *      edition per editorial day on a Europe/Paris schedule, so `drop_date` is
 *      a property of the publisher, not of the reader. That lives in
 *      features/today/editionCadence.ts.
 *
 * Everything here works on `YYYY-MM-DD` *calendar date keys*, never timestamps.
 * A drop_date is a SQL `date`: a calendar day with no time and no zone. Turning
 * `2026-08-30` into a Date and formatting it somewhere else is exactly how a
 * stored edition slides to `2026-08-29`, so this module never does it —
 * comparison is lexicographic, which is exact for zero-padded ISO dates.
 */

/** A calendar day in `YYYY-MM-DD` form. Never a timestamp. */
export type DateKey = string;

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Used only when the platform cannot name its own zone (an Intl-less runtime,
 * or a device reporting an empty string). UTC is the neutral choice: it is not
 * a guess about where the reader is.
 */
const FALLBACK_TIME_ZONE = "UTC";

/**
 * The IANA zone the device is currently in, e.g. `America/Chicago`.
 *
 * Read on every call rather than captured once, so a reader who flies from
 * Paris to New Orleans — or simply crosses a DST boundary — starts getting
 * their new local day without reinstalling or signing in again. The zone is an
 * IANA id, so DST is resolved by the platform's tz database; no offset is ever
 * computed or stored by hand.
 */
export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * Building an Intl.DateTimeFormat is the expensive part, and the date key is
 * read on every render pass that asks "is this edition today?". One formatter
 * per zone is enough: a formatter is immutable and stays correct across DST,
 * because the zone — not an offset — is what it holds.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);

  if (cached) {
    return cached;
  }

  // "en-CA" is Gregorian and pads to 2 digits, and the parts are read by name
  // below, so the result cannot depend on the device's locale pattern.
  const created = createFormatter(timeZone) ?? createFormatter(FALLBACK_TIME_ZONE);

  if (!created) {
    throw new Error("Intl.DateTimeFormat is unavailable: cannot resolve the local date.");
  }

  formatterCache.set(timeZone, created);
  return created;
}

function createFormatter(timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  } catch {
    // An unknown or malformed zone id throws RangeError; fall back rather than
    // crash the screen that asked what day it is.
    return null;
  }
}

/**
 * The reader's current calendar day as `YYYY-MM-DD`.
 *
 * This is the single source of truth for "today" everywhere in the app. It is
 * deliberately NOT `new Date().toISOString().slice(0, 10)`: that is the UTC
 * day, which is already tomorrow for most of the Americas every evening.
 *
 *   2026-08-30 21:30 America/Chicago -> "2026-08-30"   (UTC says 2026-08-31)
 *   the same instant in Europe/Paris -> "2026-08-31"
 *
 * Two readers in two zones legitimately disagree about what day it is; that is
 * the point.
 *
 * @param now      Instant to resolve. Injectable so tests can pin it.
 * @param timeZone IANA zone. Defaults to the device's current zone.
 */
export function getUserLocalDateKey(
  now: Date = new Date(),
  timeZone: string = getDeviceTimeZone()
): DateKey {
  const parts = dateKeyFormatter(timeZone).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The reader's current year, for resolving a search like "mai" to a year. */
export function getUserLocalYear(
  now: Date = new Date(),
  timeZone: string = getDeviceTimeZone()
): number {
  return Number(getUserLocalDateKey(now, timeZone).slice(0, 4));
}

export function isDateKey(value: string): boolean {
  return DATE_KEY_PATTERN.test(value);
}

/**
 * Order two calendar days. Zero-padded ISO dates sort lexicographically, so
 * this needs no Date parsing and therefore cannot shift a day across a zone.
 */
export function compareDateKeys(left: DateKey, right: DateKey): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Where an edition's `drop_date` falls relative to the reader's own day. */
export type EditionDateRelation = "past" | "today" | "future";

/**
 * Classify an edition's calendar date against the reader's calendar date.
 *
 * The edition date is compared as-is. An edition stored as `2026-08-30` is the
 * edition of `2026-08-30` for every reader on earth; only the boundary at which
 * it stops being *their* today moves, and that boundary is their local midnight.
 */
export function classifyEditionDate(
  editionDate: DateKey,
  todayKey: DateKey = getUserLocalDateKey()
): EditionDateRelation {
  const order = compareDateKeys(editionDate, todayKey);

  return order === 0 ? "today" : order < 0 ? "past" : "future";
}

export function isTodayEditionDate(
  editionDate: DateKey,
  todayKey: DateKey = getUserLocalDateKey()
): boolean {
  return classifyEditionDate(editionDate, todayKey) === "today";
}

export function isPastEditionDate(
  editionDate: DateKey,
  todayKey: DateKey = getUserLocalDateKey()
): boolean {
  return classifyEditionDate(editionDate, todayKey) === "past";
}

export function isFutureEditionDate(
  editionDate: DateKey,
  todayKey: DateKey = getUserLocalDateKey()
): boolean {
  return classifyEditionDate(editionDate, todayKey) === "future";
}
