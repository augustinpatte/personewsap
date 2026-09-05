import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the reader has asked the system to reduce transparency.
 *
 * The sibling of useReducedMotion, and deliberately a separate signal: someone
 * who cannot read text over a blurred background is not the same person as
 * someone who gets motion sick. iOS exposes them independently, so PersoNewsAP
 * answers them independently — this one swaps the tab bar's material for a
 * near-solid surface and leaves every animation alone.
 *
 * Defaults to false and never throws: the setting is iOS-only, and a
 * preference lookup must not be able to break the navigation chrome.
 */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (active) {
          setReduceTransparency(enabled);
        }
      })
      .catch(() => {
        if (active) {
          setReduceTransparency(false);
        }
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      (enabled) => {
        if (active) {
          setReduceTransparency(enabled);
        }
      }
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceTransparency;
}
