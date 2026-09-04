import { StyleSheet } from "react-native";

import { useThemedStyles, type ThemeColors } from "./theme";

/**
 * The pressed tint on its own, for controls that must not move: the Today |
 * Archive switch, a list row, the reader's back button.
 *
 * Same colour as a pressed card, so one press vocabulary covers every surface —
 * only the compression is reserved for large ones. Lives beside the theme
 * rather than next to PressableSurface so a file exporting a component does not
 * also export a hook.
 */
export function usePressedSurfaceStyle() {
  return useThemedStyles(createStyles).pressed;
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    pressed: {
      backgroundColor: c.pressedSurface
    }
  });
