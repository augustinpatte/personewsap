import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Refetch when a screen is returned to, and only then.
 *
 * EVERY TEAMS SCREEN IS A PLACE YOU COME BACK TO. Create pushes an invite
 * screen and the reader taps back onto a Teams list that was fetched before the
 * Team existed; Manage renames a Team and the reader lands back on a header
 * still showing the old name; Members removes somebody and the detail screen
 * behind it still counts them. Each of those screens loads once on mount, which
 * is correct exactly until the reader navigates away and changes something —
 * which, in this feature, is the whole point of navigating away.
 *
 * NOT `useFocusEffect(load)` DIRECTLY, for two reasons.
 *
 * First, that fires on the initial focus too, so it would duplicate the mount
 * load that already owns the loading state: two identical round trips on every
 * screen open, on a free tier.
 *
 * Second, `useFocusEffect` re-runs whenever its callback identity changes, even
 * while the screen has never lost focus. Team detail's loader is rebuilt on
 * every range change, so passing it straight through would fire a second fetch
 * each time somebody switched between Current Edition and All Time. Holding the
 * callback in a ref keeps the effect's own dependencies empty, so it runs once
 * per real focus event and always calls the newest loader.
 *
 * The refetch is deliberately silent: no `setStatus("loading")`, because
 * replacing a drawn leaderboard with a spinner every time somebody taps back is
 * a worse answer than a list that updates a moment later.
 */
export function useRefetchOnReturn(refetch: () => void): void {
  const latest = useRef(refetch);
  latest.current = refetch;

  const hasFocusedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }

      latest.current();
    }, [])
  );
}
