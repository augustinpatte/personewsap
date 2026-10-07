import { getDeviceTimeZone, getUserLocalDateKey, isDateKey, type DateKey } from "../../lib/localDate";
import type { ContentLanguage } from "../today/contentTypes";

/**
 * Points, in one place.
 *
 * STORAGE STAYS IN MILLI-POINTS. The server grades every answer 0, 300, 600 or
 * 1000 "milli" and sums those in the Team ledger; nothing about that changes.
 * What readers see is POINTS on a 100-point scale:
 *
 *     milli    0    300    600   1000
 *     points   0     30     60    100      points = milli / 10
 *
 * Exactly the old scale (0 / 0.3 / 0.6 / 1) times 100, so every historical
 * score keeps its relative value and leaderboard order cannot move. A total is
 * a sum of multiples of 10 milli, so it is always a whole number of points.
 * Nothing outside this file multiplies or divides by 10: a second conversion
 * somewhere else is exactly how a score ends up shown ten times too big.
 *
 * LATE ANSWERS EARN HALF. Full credit runs through the end of the reader's
 * FULL-CREDIT DAY — the edition's date, or the local date the edition was
 * published if that is later (a reader east of Paris gets it after their own
 * midnight and keeps full credit for that whole day). An answer settled after
 * that day earns 50%:
 *
 *     on time   0 / 30 / 60 / 100
 *     late      0 / 15 / 30 /  50
 *
 * The server decides this when the answer is settled
 * (supabase/migrations/20261006120000_late_answer_credit.sql) and returns what
 * was earned; these functions mirror the same rule for immediate feedback and
 * for rows written before a client knew to ask.
 */

/** Milli-points per displayed point. The one conversion factor. */
export const MILLI_PER_POINT = 10;

/** A late answer earns this share of its grade: 1/2, in integer arithmetic. */
export const LATE_ANSWER_CREDIT_PERCENT = 50;

/** The four grades, in milli-points, as the server stores them. */
export const GRADE_MILLI = [0, 300, 600, 1000] as const;

/** The best grade: what one question is worth on time (100 points). */
export const FULL_GRADE_MILLI = 1000;

/** Milli-points → whole points. */
export function pointsFromMilli(milli: number): number {
  if (!Number.isFinite(milli) || milli <= 0) {
    return 0;
  }

  return Math.round(milli / MILLI_PER_POINT);
}

/**
 * What a grade earns, in milli-points. Mirrors `public.answer_credit_milli`:
 * every grade is even, so half of it is exact.
 */
export function earnedMilli(gradeMilli: number, late: boolean): number {
  if (!Number.isFinite(gradeMilli) || gradeMilli <= 0) {
    return 0;
  }

  return late ? Math.floor((gradeMilli * LATE_ANSWER_CREDIT_PERCENT) / 100) : gradeMilli;
}

/** What a grade earns, in points. */
export function earnedPoints(gradeMilli: number, late: boolean): number {
  return pointsFromMilli(earnedMilli(gradeMilli, late));
}

/**
 * The last local day of full credit: max(edition date, the local date of the
 * edition's publication). Mirrors `public.full_credit_date`. Without a
 * publication instant it is the edition date.
 *
 * Not "Today": an Oct 6 edition can be in its full-credit day on Oct 7 for a
 * reader in Tokyo while the app still, truthfully, does not call it today's
 * (today/editionRecency.ts).
 */
export function fullCreditDate(input: {
  editionDate: DateKey;
  publishedAt?: Date | string | null;
  timeZone?: string;
}): DateKey {
  if (!input.publishedAt) {
    return input.editionDate;
  }

  const published = getUserLocalDateKey(
    new Date(input.publishedAt),
    input.timeZone ?? getDeviceTimeZone()
  );

  return published > input.editionDate ? published : input.editionDate;
}

/**
 * Would an answer settled at `answeredAt` (now, by default) be late? Mirrors
 * `public.is_late_answer`. Its only inputs are the edition, its publication
 * instant, the zone and the answer instant — never when the reader opened it,
 * a notification, or a cached flag.
 */
export function isLateAnswer(input: {
  editionDate: string | null | undefined;
  publishedAt?: Date | string | null;
  answeredAt?: Date;
  timeZone?: string;
}): boolean {
  if (typeof input.editionDate !== "string" || !isDateKey(input.editionDate)) {
    return false;
  }

  const timeZone = input.timeZone ?? getDeviceTimeZone();
  const answered = getUserLocalDateKey(input.answeredAt ?? new Date(), timeZone);

  return (
    answered >
    fullCreditDate({ editionDate: input.editionDate, publishedAt: input.publishedAt, timeZone })
  );
}

/**
 * "1,430" in English, "1 430" in French. Grouped by hand rather than through
 * Intl so the output is identical on Hermes, on JSC and in tests.
 */
export function formatPointsNumber(points: number, language: ContentLanguage): string {
  const whole = Math.max(0, Math.round(Number.isFinite(points) ? points : 0));
  const separator = language === "fr" ? "\u202F" : ",";

  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** The compact form for standings and summaries: "1,430 pts" / "1 430 pts". */
export function formatPointsShort(points: number, language: ContentLanguage): string {
  return `${formatPointsNumber(points, language)} pts`;
}

/**
 * The full form for a single answer: "100 points", "0 points"; in French the
 * singular below two — "0 point", "1 point", "30 points".
 */
export function formatPointsLong(points: number, language: ContentLanguage): string {
  const value = formatPointsNumber(points, language);
  const whole = Math.round(points);

  if (language === "fr") {
    return `${value} point${whole >= 2 ? "s" : ""}`;
  }

  return `${value} point${whole === 1 ? "" : "s"}`;
}
