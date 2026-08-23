import { resolveLanguage } from "../../lib/i18n";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import type { Language } from "../../types/domain";
import { isEditionDay, nextEditionDate } from "./editionCadence";

/**
 * What the Today view of a content module shows, decided in one place.
 *
 * Two facts are deliberately kept apart:
 *
 *   - is today a scheduled edition day?  (the 4x/week cadence, editionCadence)
 *   - did an edition actually arrive?    (the daily_drops query)
 *
 * "No new edition today" is a claim about the *schedule*, so it may only be
 * made once the query has succeeded and said there is nothing. A failed query
 * keeps the app's ordinary error treatment — we do not know whether an edition
 * exists, so we must not pretend there is none — and an unresolved first load
 * stays on the loader instead of flashing an empty state that a moment later
 * turns out to be wrong.
 *
 * The three content modules (Newsletter, Mini cases, Stories) all route through
 * this, so a fix here cannot land on one tab and miss the other two.
 */
export type TodayEditionState =
  /** The first load has not resolved. Show the module loader. */
  | "loading"
  /** The fetch failed. Show the existing connection-error treatment. */
  | "error"
  /** An edition exists. Render it. */
  | "edition"
  /** A scheduled day whose edition has not landed yet. */
  | "upcoming"
  /** An intentional off-day in the cadence. */
  | "quiet";

export type TodayEditionStateInput = {
  /** The editorial date the drop was requested for (YYYY-MM-DD, product tz). */
  dropDate: string;
  /** Last fetch error, or null when the query succeeded. */
  error: NormalizedSupabaseError | null;
  /** True when the resolved drop carries no items at all. */
  isEmptyDrop: boolean;
  status: "loading" | "ready";
};

export function resolveTodayEditionState({
  dropDate,
  error,
  isEmptyDrop,
  status
}: TodayEditionStateInput): TodayEditionState {
  if (status === "loading") {
    return "loading";
  }

  // Content wins over schedule metadata. If an edition exists it is rendered,
  // including on a day the cadence calls quiet — a published edition is a
  // stronger fact than the weekday map.
  if (!isEmptyDrop) {
    return "edition";
  }

  if (error) {
    return "error";
  }

  return isEditionDay(dropDate) ? "upcoming" : "quiet";
}

/** True for the two states that stand in for a missing edition. */
export function isQuietEditionState(
  state: TodayEditionState
): state is "upcoming" | "quiet" {
  return state === "upcoming" || state === "quiet";
}

/**
 * "mercredi" / "Wednesday" for the next scheduled edition after `dropDate`,
 * derived from the canonical cadence and nothing else. Null on an unparseable
 * date, so a caller can simply drop the line.
 *
 * The date is anchored to UTC noon *and* formatted in UTC: formatting in the
 * device timezone shifts the day for readers at UTC+13 and would print the
 * wrong weekday for them.
 */
export function nextEditionWeekday(
  dropDate: string,
  language: Language | null | undefined
): string | null {
  const upcoming = nextEditionDate(dropDate);

  if (!upcoming) {
    return null;
  }

  return new Intl.DateTimeFormat(resolveLanguage(language) === "fr" ? "fr-FR" : "en-GB", {
    timeZone: "UTC",
    weekday: "long"
  }).format(new Date(`${upcoming.date}T12:00:00Z`));
}
