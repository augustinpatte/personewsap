import { useDailyDrop } from "../today";
import { resolveEditionProgress, type EditionProgressState } from "./editionProgress";

/**
 * Today's session progress, ready to render.
 *
 * Reads the counts DailyDropContext already maintains rather than recounting
 * anything: one source of truth for "how much of today is done", shared by the
 * three daily tabs so they describe one session instead of three.
 *
 * `source` is what keeps the line honest. A mock or offline fallback drop has
 * items but no real interaction history behind it, so showing "0 of 5" over it
 * would be inventing a number; only a drop that genuinely came from Supabase
 * (live or its cache) is reported on.
 */
export function useEditionProgress(): EditionProgressState {
  const { completedItemCount, source, status, totalItemCount } = useDailyDrop();

  return resolveEditionProgress({
    completedItemCount,
    totalItemCount,
    isLiveEdition: source === "supabase" || source === "cache",
    status
  });
}
