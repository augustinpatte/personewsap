import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the reader has asked the system to reduce motion.
 *
 * PersoNewsAP only ever uses micro-motion — a pressed state, a short reveal —
 * but "short" is not the same as "wanted": for someone with vestibular
 * sensitivity an animated reveal is exactly what the OS setting exists to stop.
 * Components use this to jump straight to the final state rather than to remove
 * the state change altogether.
 *
 * Defaults to false and never throws: the setting is unavailable on some
 * platforms, and motion preferences must not be able to break a screen.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {
        if (active) {
          setReduceMotion(false);
        }
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        if (active) {
          setReduceMotion(enabled);
        }
      }
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
