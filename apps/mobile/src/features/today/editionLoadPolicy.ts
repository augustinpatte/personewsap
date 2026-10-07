/**
 * When Today may show a loader, and when it must keep what is on screen.
 *
 * THE PHANTOM LOADER. Three paths put a loading indicator over an edition the
 * app had already loaded:
 *
 *   1. Every non-quiet load — a notification opening an edition, "Back to the
 *      current edition", a retry, a language change re-creating the loader —
 *      set `status: "loading"` unconditionally. The three module screens turn
 *      that into their skeleton, so readable content was blanked for the
 *      length of a request that was only going to confirm or swap it.
 *
 *   2. A background re-check (returning to the app) set the same `refreshing`
 *      flag pull-to-refresh uses. RefreshControl draws its spinner whenever
 *      that flag is true, so a spinner appeared in the empty space above the
 *      edition although the reader had pulled nothing.
 *
 *   3. A re-check whose `current_edition_date()` lookup failed fell back to the
 *      reader's calendar date, found nothing there, and replaced a perfectly
 *      good edition with the "on the way" / quiet state.
 *
 * The rules, in one place:
 *
 *   INITIAL LOAD        nothing usable on screen → full loader.
 *   BACKGROUND REFRESH  content on screen → it stays; no loader, no spinner.
 *   PULL TO REFRESH     the reader asked → the pull spinner, content stays.
 *   FAILED RE-CHECK     content on screen and the re-check could not do
 *                       better → the content stays usable.
 *
 * Pure, so each rule is tested without rendering anything.
 */

export type LoadOrigin =
  /** The reader pulled to refresh: the only load that shows the pull spinner. */
  | "pull"
  /** Anything else: first load, foreground re-check, notification, retry. */
  | "system";

export type VisibleEditionFacts = {
  status: "loading" | "ready";
  /** Items in the drop on screen. */
  itemCount: number;
  /** The account the drop on screen was loaded for. */
  ownerId: string | null;
};

/**
 * Is there an edition on screen the reader can use right now?
 *
 * Bound to the account: an edition loaded for someone else is never "usable"
 * for the person now signed in, so a new session always starts from the
 * loader rather than from the previous reader's content.
 */
export function hasVisibleEdition(facts: VisibleEditionFacts, userId: string | null): boolean {
  return (
    facts.status === "ready" &&
    facts.itemCount > 0 &&
    facts.ownerId !== null &&
    facts.ownerId === userId
  );
}

/** The status a load starts in. Only an empty screen gets the loader. */
export function statusAtLoadStart(input: {
  quiet: boolean;
  visible: boolean;
  current: "loading" | "ready";
}): "loading" | "ready" {
  if (input.visible) {
    return "ready";
  }

  // A quiet load never changes what the screen is doing; anything else with
  // nothing to show is a first load.
  return input.quiet ? input.current : "loading";
}

/** Whether this load drives the pull-to-refresh spinner. */
export function showsPullSpinner(origin: LoadOrigin | undefined): boolean {
  return origin === "pull";
}

/**
 * Keep the edition on screen instead of the load's result?
 *
 * Only when the result is EMPTY and the load had a reason not to be trusted
 * over what is already there — the current-edition lookup failed (so the date
 * asked for was a guess), or the drop fetch itself failed — and the reader did
 * not explicitly ask for a different edition. An empty answer to an explicit
 * request (a notification for an edition that is gone) is handled by the
 * caller's own fallback, not hidden here.
 */
export function shouldKeepVisibleEdition(input: {
  visible: boolean;
  resultItemCount: number;
  currentEditionLookupFailed: boolean;
  fetchFailed: boolean;
  explicitEditionRequest: boolean;
}): boolean {
  return (
    input.visible &&
    input.resultItemCount === 0 &&
    !input.explicitEditionRequest &&
    (input.currentEditionLookupFailed || input.fetchFailed)
  );
}
