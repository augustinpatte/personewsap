/**
 * Whether a module tab shows its "you turned this off" state.
 *
 * THE PERSONAL SWITCH GOVERNS PERSONAL CONTENT, NOT A TEAM'S. A reader who
 * turned Mini cases off for themselves has said what they want in their own
 * edition; a Team they belong to has separately chosen to play mini cases, and
 * that game is theirs too. The server already honours both — the personal drop
 * carries no mini case, and the Team assignment is readable under the Team
 * entitlement — so the only thing that could take the Team's content away is
 * this tab covering it with the disabled state. It does so only when there is
 * nothing of a Team's to show.
 *
 * Nothing here reads or writes a preference: the switch stays off, the
 * personal edition stays without the module, and the tab simply shows what the
 * reader's Teams assigned.
 */
export function showModuleDisabledState(input: {
  preference: { status: "idle" | "loading" | "ready" | "error"; enabled: boolean };
  dropStatus: "loading" | "ready";
  items: ReadonlyArray<{ teams?: ReadonlyArray<unknown> | null }>;
}): boolean {
  const personallyOff = input.preference.status === "ready" && !input.preference.enabled;

  if (!personallyOff) {
    return false;
  }

  // Until the edition has loaded we cannot know whether a Team assigned
  // anything, and flashing "turned off" at a Team member would be wrong.
  if (input.dropStatus === "loading") {
    return false;
  }

  return !input.items.some((item) => (item.teams ?? []).length > 0);
}
