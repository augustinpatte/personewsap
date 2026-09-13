import { useCallback, useEffect, useState } from "react";

import { shouldShowTeamsIntro } from "./teamsIntroRules";
import {
  fetchTeamsIntroServerState,
  markTeamsIntroCompleted,
  readTeamsIntroCompletedOnDevice,
  rememberTeamsIntroCompletedOnDevice
} from "./teamsIntroData";

export type TeamsIntroGateStatus = "checking" | "show" | "hidden";

/**
 * Does the Teams tab open on the introduction?
 *
 * "checking" is rendered as the skeleton the landing already shows while it
 * loads, so neither the introduction nor the landing flashes up and is then
 * replaced. Keyed on the user id: another reader signing in on the same phone
 * is asked about separately.
 *
 * Only `complete` writes, and only the landing's first-open introduction calls
 * it. "How scoring works" opens the same pages without this hook.
 */
export function useTeamsIntroGate(userId: string | null | undefined) {
  const [status, setStatus] = useState<TeamsIntroGateStatus>(userId ? "checking" : "hidden");

  useEffect(() => {
    if (!userId) {
      setStatus("hidden");
      return;
    }

    let cancelled = false;
    setStatus("checking");

    void (async () => {
      const [completedOnDevice, server] = await Promise.all([
        readTeamsIntroCompletedOnDevice(userId),
        fetchTeamsIntroServerState(userId)
      ]);

      if (cancelled) {
        return;
      }

      if (completedOnDevice && server === "pending") {
        // Finished on this phone, but the server never heard: tell it now, so
        // the next device does not ask again.
        void markTeamsIntroCompleted();
      }

      if (!completedOnDevice && server === "completed") {
        void rememberTeamsIntroCompletedOnDevice(userId);
      }

      setStatus(shouldShowTeamsIntro({ server, completedOnDevice }) ? "show" : "hidden");
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const complete = useCallback(async () => {
    setStatus("hidden");

    if (!userId) {
      return;
    }

    await rememberTeamsIntroCompletedOnDevice(userId);
    await markTeamsIntroCompleted();
  }, [userId]);

  return { status, complete };
}
