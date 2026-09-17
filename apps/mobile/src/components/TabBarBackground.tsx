import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../design/theme";
import {
  resolveTabBarGlass,
  TAB_BAR_GLASS,
  tabBarGlassBottom
} from "../design/tabBarMaterial";

/**
 * The glass behind the tab bar.
 *
 * The one layer in PersoNewsAP that genuinely floats above content, so the one
 * place translucency is earned. Readings, cards, headers and sheets all stay
 * opaque paper, and this is still the only BlurView in the app.
 *
 * Four layers, in order, all inside one rounded pill:
 *
 *   1. the blur — what makes the page underneath perceptible but unreadable;
 *   2. the wash — the app's own paper at half opacity, so the bar belongs to
 *      this product and not to whatever happens to be scrolling behind it;
 *   3. the highlight — a hairline of reflected light along the inner top edge;
 *   4. the edge — a one-pixel translucent border that closes the shape.
 *
 * Nothing here is animated and nothing is read from the device: the recipe is
 * in `tabBarMaterial.ts`, the same on every phone and under every accessibility
 * setting. Only the tab bar's own area is blurred, never the screen.
 */
export function TabBarBackground() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const glass = resolveTabBarGlass({ isDark });

  return (
    // The glass is decoration: every touch belongs to the tab items above it,
    // including the margins around the pill.
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.pill,
          {
            borderRadius: TAB_BAR_GLASS.radius,
            bottom: tabBarGlassBottom(insets.bottom),
            shadowColor: colors.ink,
            shadowOpacity: glass.shadowOpacity
          }
        ]}
      >
        <BlurView
          // Android renders no blur at all unless a method is named. This one
          // works on every supported release; the bar is a small region, which
          // is what keeps it cheap where the library warns about cost.
          blurMethod="dimezisBlurView"
          blurReductionFactor={TAB_BAR_GLASS.androidBlurReduction}
          intensity={glass.blurIntensity}
          style={StyleSheet.absoluteFill}
          tint={glass.tint}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.wash }]} />
        <View style={[styles.highlight, { backgroundColor: glass.highlight }]} />
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.edge,
            { borderColor: glass.border, borderRadius: TAB_BAR_GLASS.radius }
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    left: TAB_BAR_GLASS.horizontalInset,
    // `overflow: hidden` is what makes the blur and the wash follow the
    // corners instead of squaring them off.
    overflow: "hidden",
    position: "absolute",
    right: TAB_BAR_GLASS.horizontalInset,
    top: 0,
    // iOS only. An elevation on Android draws a dark rectangle behind a view
    // whose own background is transparent, which is exactly the floating grey
    // slab this material exists not to be; the edge and the highlight carry
    // the separation there.
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 14
      },
      default: {}
    })
  },
  highlight: {
    height: StyleSheet.hairlineWidth * 2,
    left: TAB_BAR_GLASS.radius / 2,
    position: "absolute",
    right: TAB_BAR_GLASS.radius / 2,
    top: 0
  },
  edge: {
    borderWidth: StyleSheet.hairlineWidth * 1.5
  }
});
