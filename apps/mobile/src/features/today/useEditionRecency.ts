import { useDailyDrop } from "./DailyDropContext";
import { resolveEditionRecency, type EditionRecency } from "./editionRecency";

/**
 * The recency of the edition on screen, recomputed on every render.
 *
 * Deliberately not memoised and not stored in DailyDropContext: the answer
 * depends on the reader's clock, and a value captured when the edition loaded
 * would keep saying "Today" after midnight. Reading the date is a cached
 * formatter call, so asking on each render costs nothing.
 */
export function useEditionRecency(): EditionRecency {
  const { drop, pinnedEditionDate } = useDailyDrop();

  return resolveEditionRecency({ editionDate: drop.drop_date, pinnedEditionDate });
}
