import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveTabBarGlass,
  TAB_BAR_GLASS,
  tabBarBottomInset,
  tabBarGlassBottom
} from "./tabBarMaterial";

/**
 * The bottom bar's glass, pinned.
 *
 * Two properties this file exists to protect, both of which are one careless
 * edit away from being lost:
 *
 *   1. THE MATERIAL IS THE APP'S, NOT THE DEVICE'S. The bar used to swap its
 *      blur for a solid surface under iOS Reduce Transparency. It no longer
 *      asks the device anything: one recipe, the same on every phone, under
 *      every accessibility and appearance setting. Reduce MOTION stays
 *      respected everywhere the app animates — that is a different signal and
 *      a different answer.
 *
 *   2. IT IS MODERATE. Half the strength of the platform's own glass: blurred
 *      enough that the page underneath is perceptible, restrained enough that
 *      five 10.5pt labels stay readable over anything scrolling past.
 *
 * The gesture that moves the selection across this glass is pinned next door in
 * tabBarGesture.test.ts.
 *
 * Source assertions where the wiring is what matters: the mobile tree cannot be
 * rendered under jsdom, so React Native components are pinned by reading them,
 * in the idiom this repository already uses.
 */

const designDir = __dirname;
const srcDir = join(designDir, "..");
const appDir = join(srcDir, "..", "app");

const read = (...segments: string[]) => readFileSync(join(...segments), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The alpha of an "rgba(r, g, b, a)" string. */
function alphaOf(color: string): number {
  const match = /rgba\([^)]*,\s*([0-9.]+)\)$/.exec(color);

  if (!match) {
    throw new Error(`not an rgba colour: ${color}`);
  }

  return Number(match[1]);
}

const background = stripComments(read(srcDir, "components", "TabBarBackground.tsx"));
const bar = stripComments(read(srcDir, "components", "GlassTabBar.tsx"));
const material = stripComments(read(designDir, "tabBarMaterial.ts"));
const tabs = stripComments(read(appDir, "(tabs)", "_layout.tsx"));

describe("the glass is the app's own, not the device's", () => {
  it("resolves from the colour scheme and nothing else", () => {
    // One argument, and it is the scheme. No accessibility flag, no platform
    // probe, no system material intensity.
    expect(resolveTabBarGlass.length).toBe(1);
    expect(resolveTabBarGlass({ isDark: false })).toBeTruthy();
    expect(resolveTabBarGlass({ isDark: true })).toBeTruthy();
  });

  it("asks the device no transparency question anywhere in the bar", () => {
    for (const [name, source] of [
      ["tabBarMaterial.ts", material],
      ["TabBarBackground.tsx", background],
      ["GlassTabBar.tsx", bar]
    ] as const) {
      expect(source, name).not.toMatch(/AccessibilityInfo|[Rr]educeTransparency/);
    }

    // The hook existed for this one consumer; with the bar decoupled it has
    // none, and a dead accessibility hook is worse than no hook.
    expect(existsSync(join(designDir, "useReduceTransparency.ts"))).toBe(false);
    // Reduce Motion is a different signal and is still answered.
    expect(existsSync(join(designDir, "useReducedMotion.ts"))).toBe(true);
  });

  it("uses a fixed tint rather than a system material", () => {
    // `systemThickMaterialLight` and friends are the OS's opinion of
    // translucency and follow its settings; these two are a recipe.
    for (const isDark of [false, true]) {
      expect(resolveTabBarGlass({ isDark }).tint).toMatch(/^(light|dark)$/);
    }

    expect(material).not.toContain("systemThickMaterial");
  });
});

describe("moderate glass: about half strength", () => {
  it("blurs in the 35–55 window, starting at 45", () => {
    expect(TAB_BAR_GLASS.blurIntensity).toBe(45);
    expect(TAB_BAR_GLASS.blurIntensity).toBeGreaterThanOrEqual(35);
    expect(TAB_BAR_GLASS.blurIntensity).toBeLessThanOrEqual(55);
  });

  it("lays the app's paper over it at roughly half opacity", () => {
    for (const isDark of [false, true]) {
      const alpha = alphaOf(resolveTabBarGlass({ isDark }).wash);

      // Translucent, never a sheet: opaque here would make the blur pointless.
      expect(alpha).toBeGreaterThanOrEqual(0.42);
      expect(alpha).toBeLessThanOrEqual(0.58);
    }
  });

  it("keeps the edge an edge and the highlight a hairline of light", () => {
    for (const isDark of [false, true]) {
      const glass = resolveTabBarGlass({ isDark });

      expect(alphaOf(glass.border)).toBeLessThanOrEqual(0.2);
      expect(alphaOf(glass.highlight)).toBeGreaterThan(0.1);
      expect(glass.shadowOpacity).toBeGreaterThan(0);
      expect(glass.shadowOpacity).toBeLessThanOrEqual(0.25);
    }
  });

  it("dresses the two schemes differently, slot for slot", () => {
    const light = resolveTabBarGlass({ isDark: false });
    const dark = resolveTabBarGlass({ isDark: true });

    for (const slot of ["tint", "wash", "border", "highlight", "activeSurface", "activeBorder"] as const) {
      expect(light[slot], slot).not.toBe(dark[slot]);
    }
  });

  it("floats: a continuous radius, inset from every edge", () => {
    expect(TAB_BAR_GLASS.radius).toBeGreaterThanOrEqual(24);
    expect(TAB_BAR_GLASS.radius).toBeLessThanOrEqual(30);
    expect(TAB_BAR_GLASS.horizontalInset).toBeGreaterThanOrEqual(12);
    expect(TAB_BAR_GLASS.bottomGap).toBeGreaterThanOrEqual(6);
  });
});

describe("safe areas decide where the glass stops", () => {
  it("reserves the home indicator, and a floor where there is none", () => {
    // Android three-button navigation reports no bottom inset at all.
    expect(tabBarBottomInset(0)).toBe(TAB_BAR_GLASS.minimumBottomInset);
    expect(tabBarBottomInset(34)).toBe(34);
  });

  it("stops the pill short of the bottom edge in both cases", () => {
    expect(tabBarGlassBottom(34)).toBe(34 - TAB_BAR_GLASS.bottomGap);
    expect(tabBarGlassBottom(0)).toBeGreaterThanOrEqual(TAB_BAR_GLASS.bottomGap);
  });

  it("is the same floor the row of tabs pads with", () => {
    // One helper, two callers: the pill and the row cannot drift apart.
    expect(bar).toContain("tabBarBottomInset(insets.bottom)");
    expect(bar).toContain("minHeight: 68 + bottomInset");
    expect(background).toContain("tabBarGlassBottom(insets.bottom)");
    expect(background).toContain("useSafeAreaInsets");
  });
});

describe("what the background actually renders", () => {
  it("is one blur, one wash, one highlight and one edge", () => {
    expect(background.match(/<BlurView/g) ?? []).toHaveLength(1);
    expect(background).toContain("intensity={glass.blurIntensity}");
    expect(background).toContain("tint={glass.tint}");
    expect(background).toContain("backgroundColor: glass.wash");
    expect(background).toContain("backgroundColor: glass.highlight");
    expect(background).toContain("borderColor: glass.border");
    // Rounded corners have to clip the blur, or the pill is a rectangle.
    expect(background).toContain('overflow: "hidden"');
  });

  it("blurs on Android too, and never as a dark floating slab", () => {
    expect(background).toContain('blurMethod="dimezisBlurView"');
    expect(background).toContain("blurReductionFactor={TAB_BAR_GLASS.androidBlurReduction}");
    // expo-blur divides the intensity by this on Android; the default of 4
    // makes the same number look far weaker than on iOS.
    expect(TAB_BAR_GLASS.androidBlurReduction).toBeLessThan(4);
    // An elevation on a transparent-backed view is the grey rectangle this
    // material exists not to be.
    expect(background).not.toContain("elevation");
  });

  it("costs nothing per frame: the material itself never animates", () => {
    expect(background).not.toMatch(/Animated|setInterval|requestAnimationFrame/);
    expect(bar).not.toContain("expo-blur");
    // The bar animates one thing, the capsule, and only on the native driver.
    expect(bar.match(/<Animated\.View/g) ?? []).toHaveLength(1);
    expect(bar).toContain("useNativeDriver: true");
  });

  it("lets every touch through to the tabs above it", () => {
    expect(background).toContain('pointerEvents="none"');
  });
});

describe("the selected tab is lifted out of the same glass", () => {
  it("is one capsule of the same material, not a button of its own", () => {
    expect(bar).toContain("backgroundColor: glass.activeSurface");
    expect(bar).toContain("borderColor: glass.activeBorder");
    expect(bar).toContain("borderRadius: TAB_BAR_GLASS.itemRadius");
    // Inset inside its tab's share of the row, so it reads as a highlight
    // travelling under the labels rather than as five touching blocks.
    expect(bar).toContain("TAB_BAR_GLASS.capsuleInset");
    expect(TAB_BAR_GLASS.capsuleInset).toBeGreaterThan(0);
  });

  it("never paints over the glass it belongs to", () => {
    expect(bar).toContain('pointerEvents="none"');
    expect(bar).toContain('backgroundColor: "transparent"');
  });
});

describe("the bar itself is unchanged where it counts", () => {
  it("keeps the five destinations, their order and the hidden settings route", () => {
    const screens = [...tabs.matchAll(/<Tabs\.Screen\s+name="([a-z]+)"/g)].map((match) => match[1]);

    expect(screens).toEqual(["newsletter", "cases", "stories", "path", "teams", "settings"]);
    expect(tabs).toContain('<Tabs.Screen name="settings" options={{ href: null }} />');
  });

  it("wires one custom bar into the one navigator", () => {
    expect(tabs).toContain("tabBar={(props) => <GlassTabBar {...props} />}");
    // The navigator itself, not its six `<Tabs.Screen` children: one bar, not
    // a second navigation system beside it.
    expect(tabs.match(/<Tabs[\s>]/g) ?? []).toHaveLength(1);
  });

  it("leaves no opaque sheet over the material, and no navigator colour under it", () => {
    // The bar paints nothing itself: the glass is the background, and the
    // scene behind it is the palette rather than React Navigation's stock grey
    // — which is what used to flash white between two dark screens.
    expect(bar).toContain('backgroundColor: "transparent"');
    expect(tabs).toContain("sceneStyle: { backgroundColor: colors.background }");
  });

  it("keeps every touch target at 44pt and the labels at their size", () => {
    expect(bar).toContain("minHeight: 44");
    expect(bar).toContain("fontSize: 10.5");
  });
});
