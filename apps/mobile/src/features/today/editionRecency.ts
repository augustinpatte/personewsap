import { getUserLocalDateKey, isDateKey, isTodayEditionDate, type DateKey } from "../../lib/localDate";

/**
 * Is the edition on screen TODAY's edition? One answer, for every module.
 *
 * Two facts used to be conflated here, and the conflation is the bug:
 *
 *   A. the reader's actual calendar day, and
 *   B. the most recent edition the backend has.
 *
 * `current_edition_date()` answers B — the open edition, the newest one
 * published — and Today rendered whatever it returned under the word "Today".
 * So an edition from September 18, still the newest in the database in
 * October, was presented as if it were today's. It is not, and nothing the
 * backend returns can make it so.
 *
 * "Today" now means exactly one thing:
 *
 *     edition_date === the reader's local calendar date
 *
 * read from the device's own zone (lib/localDate) at the moment of asking.
 * Never Europe/Paris, never "the latest edition", never a cached flag: an
 * edition opened at 23:59 is no longer today's at 00:00, and the next render
 * says so.
 *
 * The backend still decides which edition is AVAILABLE — that is B, and it is
 * the right authority for it. This file only decides what may be CALLED today.
 */

export type EditionRecency =
  /** The edition dated the reader's own calendar day. */
  | "today"
  /** The newest edition available, from an earlier day. */
  | "latest"
  /** An older edition the reader explicitly opened (a notification, a link). */
  | "past";

/** The canonical predicate. The reader's today is read now unless injected. */
export function isTodayEdition(
  editionDate: string | null | undefined,
  readerToday: DateKey = getUserLocalDateKey()
): boolean {
  return typeof editionDate === "string" && isDateKey(editionDate) && isTodayEditionDate(editionDate, readerToday);
}

export function resolveEditionRecency(input: {
  editionDate: string | null | undefined;
  /** Set when the reader opened a specific edition rather than the open one. */
  pinnedEditionDate: string | null;
  readerToday?: DateKey;
}): EditionRecency {
  const readerToday = input.readerToday ?? getUserLocalDateKey();

  // Checked first: an edition the reader was sent to from today's own
  // notification is still today's edition. Pinning says how they got here,
  // not what day it is.
  if (isTodayEdition(input.editionDate, readerToday)) {
    return "today";
  }

  return input.pinnedEditionDate ? "past" : "latest";
}
