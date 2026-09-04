/**
 * How much of today's finite session is done.
 *
 * PersoNewsAP promises an edition that ends. `DailyDropContext` has always
 * known how far through it the reader is — `completedItemCount`,
 * `totalItemCount`, `isComplete` — and no screen has ever shown it, so the one
 * thing that distinguishes this product from a feed was invisible.
 *
 * Semantics, taken from DailyDropContext and not re-derived here:
 *
 *  - the counts are over VISIBLE items, which excludes `concept`/`key_concept`.
 *    A key concept is reference material attached to an edition, not a reading
 *    the session asks for, so counting it would promise the reader work that
 *    the interface never offers them.
 *  - the counts span the WHOLE edition, not the module currently on screen.
 *    That is the point: the three daily tabs are three views of one session.
 *
 * Everything below is pure so the states can be tested without a drop.
 */

export type EditionProgressState =
  /** No edition to be part-way through: a quiet day, an error, a first load. */
  | { kind: "hidden" }
  | { kind: "inProgress"; completed: number; total: number; ratio: number }
  | { kind: "complete"; total: number };

export function resolveEditionProgress(input: {
  completedItemCount: number;
  totalItemCount: number;
  /** Live data only. A sample/offline fallback carries no real interactions. */
  isLiveEdition: boolean;
  status: "loading" | "ready";
}): EditionProgressState {
  if (input.status !== "ready" || !input.isLiveEdition) {
    return { kind: "hidden" };
  }

  // An empty edition is not an edition at 0%: showing "0 of 0" would be a
  // progress bar over nothing.
  if (input.totalItemCount <= 0) {
    return { kind: "hidden" };
  }

  const completed = clamp(input.completedItemCount, 0, input.totalItemCount);

  if (completed >= input.totalItemCount) {
    return { kind: "complete", total: input.totalItemCount };
  }

  return {
    kind: "inProgress",
    completed,
    total: input.totalItemCount,
    ratio: completed / input.totalItemCount
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
