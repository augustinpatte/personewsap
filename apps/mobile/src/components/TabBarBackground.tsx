import { BlurView } from "expo-blur";
import { StyleSheet, View } from "react-native";

import { useTheme } from "../design/theme";
import {
  resolveTabBarMaterial,
  TAB_BAR_BLUR_INTENSITY
} from "../design/tabBarMaterial";
import { useReduceTransparency } from "../design/useReduceTransparency";

/**
 * The material behind the tab bar.
 *
 * The one place in PersoNewsAP where a layer genuinely floats above content, so
 * the one place translucency is earned. It is a functional separator, not
 * decoration: no gradient, no glow, no capsule, no glass over glass. Readings,
 * cards, headers and sheets all stay opaque paper, and this is the only
 * BlurView in the app.
 *
 * Which material to wear is decided by `resolveTabBarMaterial`; this only
 * renders it.
 */
export function TabBarBackground() {
  const { colors, isDark } = useTheme();
  const reduceTransparency = useReduceTransparency();
  const material = resolveTabBarMaterial({ reduceTransparency, isDark });

  if (material.kind === "solid") {
    return (
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.edge,
          { backgroundColor: colors.surface, borderTopColor: colors.border }
        ]}
      />
    );
  }

  return (
    <BlurView
      intensity={TAB_BAR_BLUR_INTENSITY}
      style={[
        StyleSheet.absoluteFill,
        styles.edge,
        { backgroundColor: material.wash, borderTopColor: colors.border }
      ]}
      tint={material.tint}
    />
  );
}

const styles = StyleSheet.create({
  edge: {
    borderTopWidth: StyleSheet.hairlineWidth
  }
});
