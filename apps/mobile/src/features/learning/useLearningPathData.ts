import { useEffect } from "react";

import { useLearningPath } from "./LearningPathContext";

/**
 * The learning state for a screen that SHOWS it (the Path tab, the setup and
 * history screens, the Settings section). Mounting one is what triggers the
 * lazy bootstrap for a reader who has the path switched off.
 */
export function useLearningPathData() {
  const value = useLearningPath();
  const { ensureLoaded } = value;

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  return value;
}
