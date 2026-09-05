import { useContext } from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";

/**
 * How much room the floating tab bar takes at the bottom of this screen.
 *
 * The tab bar is a translucent layer that content scrolls underneath, so it no
 * longer reserves its own space in the layout: every scrollable surface inside
 * the tabs has to end above it, or the last thing on the page — a "load earlier
 * editions" button, the final answer of a Mini Case — sits under the bar and
 * cannot be tapped.
 *
 * `useBottomTabBarHeight` throws outside a tab navigator, and PersoNewsAP
 * renders the same AppScreen inside readers, onboarding and the learning stack
 * where there is no tab bar at all. Reading the context directly gives the one
 * honest answer in both places: the real height inside the tabs, zero outside.
 */
export function useTabBarInset(): number {
  return useContext(BottomTabBarHeightContext) ?? 0;
}
