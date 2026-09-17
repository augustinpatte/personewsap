/**
 * The glass the bottom bar is made of.
 *
 * ONE MATERIAL, DECIDED BY THE APP.
 *
 * The bar is a floating pill of frosted glass: a moderate blur, the app's own
 * paper laid over it at half opacity, a light inner edge, and a soft shadow.
 * Roughly half the strength of the platform's own glass — enough that a
 * headline scrolling underneath is clearly perceptible through it, never so
 * much that five 10.5pt labels stop being readable.
 *
 * WHY EVERY NUMBER IS FIXED HERE
 *
 * This file is the whole configuration, and none of it is read from the
 * device. The bar used to swap its blur for a solid surface under iOS Reduce
 * Transparency; it no longer asks. The tint is `light`/`dark` rather than one
 * of the `system*Material*` tints for the same reason: a system material is
 * the OS's opinion of translucency (and follows its accessibility and
 * appearance settings), while these two are a fixed recipe the app controls.
 * Reduce MOTION is untouched and still respected wherever the app animates.
 *
 * Kept free of any react-native import so the whole matrix is unit tested
 * without a device. `TabBarBackground` and `GlassTabBar` only render it.
 */

export type TabBarGlassTint = "light" | "dark";

export type TabBarGlass = {
  /** A fixed recipe, never a system material that follows device settings. */
  tint: TabBarGlassTint;
  blurIntensity: number;
  /** The app's paper over the blur. Not white, not black, not a neutral grey. */
  wash: string;
  /** The glass edge: an edge, not an outline. */
  border: string;
  /** Reflected light along the inner top edge. */
  highlight: string;
  /** The selected tab, lifted out of the same glass rather than sat on top. */
  activeSurface: string;
  activeBorder: string;
  shadowOpacity: number;
};

/**
 * The washes are `lightColors.surface` and `darkColors.surface` at 0.5 — the
 * one place in the app an alpha colour is written by hand, because the palette
 * tokens carry no alpha. `surfaceContinuity.test.ts` pins them to the palette.
 */
const LIGHT: Omit<TabBarGlass, "blurIntensity"> = {
  tint: "light",
  wash: "rgba(252, 250, 244, 0.5)",
  // Ink at a whisper, not white: over pale content a white edge disappears and
  // the pill loses its shape.
  border: "rgba(28, 26, 22, 0.1)",
  highlight: "rgba(255, 255, 255, 0.75)",
  activeSurface: "rgba(255, 255, 255, 0.55)",
  activeBorder: "rgba(255, 255, 255, 0.85)",
  shadowOpacity: 0.1
};

const DARK: Omit<TabBarGlass, "blurIntensity"> = {
  tint: "dark",
  wash: "rgba(34, 31, 23, 0.5)",
  border: "rgba(255, 255, 255, 0.14)",
  highlight: "rgba(255, 255, 255, 0.2)",
  activeSurface: "rgba(255, 255, 255, 0.12)",
  activeBorder: "rgba(255, 255, 255, 0.18)",
  // A little more separation at night, where the pill and the page are close
  // in value.
  shadowOpacity: 0.22
};

export const TAB_BAR_GLASS = {
  /**
   * Moderate on purpose. Below ~35 the glass reads as a flat tint; above ~55 it
   * turns into a frosted slab and the content underneath stops being content.
   */
  blurIntensity: 45,
  /**
   * expo-blur divides the intensity by this on Android before handing it to
   * the native blur. The default (4) makes the same number look markedly
   * weaker than on iOS; 2.5 brings the two within sight of each other.
   */
  androidBlurReduction: 2.5,
  /** Continuous, generous, still a bar rather than a floating tablet. */
  radius: 28,
  /** The selected tab's capsule. */
  itemRadius: 18,
  /**
   * How far the moving capsule sits inside its tab's share of the row, so the
   * glass reads as a highlight travelling under the labels rather than as five
   * touching blocks.
   */
  capsuleInset: 8,
  /** Detached from the screen edges on all three sides. */
  horizontalInset: 16,
  /** The least space left between the pill and the bottom of the screen. */
  bottomGap: 8,
  /** The least bottom padding the bar reserves where there is no home indicator. */
  minimumBottomInset: 16
} as const;

/** Kept as a named export: it is the number most likely to be argued about. */
export const TAB_BAR_BLUR_INTENSITY = TAB_BAR_GLASS.blurIntensity;

export function resolveTabBarGlass(input: { isDark: boolean }): TabBarGlass {
  return {
    ...(input.isDark ? DARK : LIGHT),
    blurIntensity: TAB_BAR_GLASS.blurIntensity
  };
}

/**
 * The bar's own bottom padding: the home indicator, or a floor where there is
 * none (Android three-button navigation reports 0 here).
 */
export function tabBarBottomInset(safeAreaBottom: number): number {
  return Math.max(safeAreaBottom, TAB_BAR_GLASS.minimumBottomInset);
}

/**
 * How far the glass stops short of the bottom of the screen.
 *
 * The bar's items sit above this, so the pill covers exactly the row of tabs
 * and floats clear of the home indicator instead of running into it. Shared by
 * the layout and the background so the two cannot drift apart.
 */
export function tabBarGlassBottom(safeAreaBottom: number): number {
  return Math.max(tabBarBottomInset(safeAreaBottom) - TAB_BAR_GLASS.bottomGap, TAB_BAR_GLASS.bottomGap);
}
