import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  crossesIntoNewTab,
  isHiddenTabStyle,
  isHorizontalDrag,
  nearestTabIndex,
  TAB_DRAG,
  tabOffset
} from "./tabBarGesture";

/**
 * Sliding across the bottom bar.
 *
 * The bar is one continuous control now: touch the glass, slide, and the
 * selection follows the finger to the tab it is released over. The rules that
 * make that safe are pure functions, tested here as data; the wiring that
 * cannot be rendered under jsdom is pinned by reading the component, in the
 * idiom this repository already uses.
 *
 * What these protect, in order of how easily each could be lost:
 *
 *   * a tap must stay a tap, with no delay in front of it;
 *   * a vertical drag must never change tab, or scrolling a page that ends
 *     near the bar would navigate by accident;
 *   * the gesture must exist only inside the bar — the app has no global
 *     horizontal swipe and must not grow one;
 *   * every tab must remain an ordinary accessible button.
 */

const srcDir = join(__dirname, "..");
const read = (...segments: string[]) => readFileSync(join(srcDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const bar = stripComments(read("components", "GlassTabBar.tsx"));
const layout = stripComments(
  readFileSync(join(srcDir, "..", "app", "(tabs)", "_layout.tsx"), "utf8")
);

/** Five tabs across a 360pt row, the shape of the real bar. */
const ROW = { tabWidth: 72, count: 5 };

describe("what the row claims, and what it leaves alone", () => {
  it("ignores a press: a tap belongs to the button under the finger", () => {
    // Nothing has moved yet, so there is no drag to claim.
    expect(isHorizontalDrag({ dx: 0, dy: 0 })).toBe(false);
    expect(isHorizontalDrag({ dx: 3, dy: 1 })).toBe(false);
    // And the component says so outright rather than relying on a threshold.
    expect(bar).toContain("onStartShouldSetPanResponder: () => false");
  });

  it("claims a horizontal slide once the finger has actually travelled", () => {
    expect(isHorizontalDrag({ dx: TAB_DRAG.claimDistance, dy: 0 })).toBe(true);
    expect(isHorizontalDrag({ dx: -40, dy: 4 })).toBe(true);
    expect(TAB_DRAG.claimDistance).toBeGreaterThanOrEqual(6);
  });

  it("never claims a vertical drag, so scrolling near the bar cannot navigate", () => {
    expect(isHorizontalDrag({ dx: 0, dy: 40 })).toBe(false);
    expect(isHorizontalDrag({ dx: 10, dy: 40 })).toBe(false);
    // Diagonal, but heading up the page: that is a scroll.
    expect(isHorizontalDrag({ dx: 20, dy: 25 })).toBe(false);
  });

  it("exists only inside the bar: no global swipe anywhere else", () => {
    const users = ["components", "features", "design", "lib"].flatMap((dir) =>
      walk(join(srcDir, dir))
    );
    const responders = users.filter((file) =>
      /PanResponder|onMoveShouldSetPanResponder/.test(stripComments(readFileSync(file, "utf8")))
    );

    expect(responders.map((file) => file.split("/").pop())).toEqual(["GlassTabBar.tsx"]);
  });
});

describe("which tab the finger is over", () => {
  it("picks the tab under the touch", () => {
    expect(nearestTabIndex({ x: 10, ...ROW })).toBe(0);
    expect(nearestTabIndex({ x: 80, ...ROW })).toBe(1);
    expect(nearestTabIndex({ x: 200, ...ROW })).toBe(2);
    expect(nearestTabIndex({ x: 300, ...ROW })).toBe(4);
  });

  it("crosses tab by tab as the finger travels, in order", () => {
    const crossed: number[] = [];

    for (let x = 0; x <= ROW.tabWidth * ROW.count; x += 8) {
      const index = nearestTabIndex({ x, ...ROW });

      if (crossed[crossed.length - 1] !== index) {
        crossed.push(index);
      }
    }

    expect(crossed).toEqual([0, 1, 2, 3, 4]);
  });

  it("holds the end tabs when the thumb runs off the glass", () => {
    expect(nearestTabIndex({ x: -120, ...ROW })).toBe(0);
    expect(nearestTabIndex({ x: 9999, ...ROW })).toBe(ROW.count - 1);
  });

  it("answers before the row has been measured rather than dividing by zero", () => {
    expect(nearestTabIndex({ x: 40, tabWidth: 0, count: 5 })).toBe(0);
    expect(nearestTabIndex({ x: 40, tabWidth: 72, count: 0 })).toBe(0);
  });
});

describe("the indicator follows the selection", () => {
  it("sits over the tab it belongs to", () => {
    expect(tabOffset(0, ROW.tabWidth)).toBe(0);
    expect(tabOffset(3, ROW.tabWidth)).toBe(216);
  });

  it("moves for a selection that changed anywhere else, not only for a drag", () => {
    // A tap, a deep link, a notification opening Newsletter, a remount: the
    // effect below follows `selected`, so the capsule is never left behind.
    expect(bar).toMatch(/useEffect\([\s\S]{0,600}tabOffset\(selected, tabWidth\)/);
    expect(bar).toContain("[indicator, reduceMotion, selected, tabWidth]");
  });

  it("is one capsule for the whole row, moved on the native driver", () => {
    expect(bar.match(/<Animated\.View/g) ?? []).toHaveLength(1);
    expect(bar).toContain("transform: [{ translateX: indicator }]");
    expect(bar).toContain("useNativeDriver: true");
    // No per-frame React state, no timers, no polling.
    expect(bar).not.toMatch(/setInterval|requestAnimationFrame|setTimeout/);
  });

  it("snaps instead of gliding when the reader asked for less motion", () => {
    expect(bar).toContain("useReducedMotion");
    expect(bar.match(/indicator\.setValue/g) ?? []).not.toHaveLength(0);
    // The gesture itself is never disabled by that preference.
    expect(bar).not.toMatch(/reduceMotion[\s\S]{0,80}PanResponder/);
  });
});

describe("what a release does", () => {
  it("navigates to the tab the finger ended on, through the navigator", () => {
    expect(bar).toContain("onPanResponderRelease");
    expect(bar).toMatch(/onPanResponderRelease[\s\S]{0,400}openTab\(target\)/);
    expect(bar).toMatch(/navigation\.emit\(\{\s*type: "tabPress"/);
    expect(bar).toContain("navigation.navigate(tab.route.name, tab.route.params)");
  });

  it("respects a screen that prevents the tab press, and re-tapping the current tab", () => {
    expect(bar).toContain("canPreventDefault: true");
    expect(bar).toContain("tab.index !== state.index && !event.defaultPrevented");
  });

  it("puts the capsule back where it was if the system takes the gesture away", () => {
    expect(bar).toContain("onPanResponderTerminate");
    expect(bar).toMatch(/onPanResponderTerminate[\s\S]{0,300}tabOffset\(selected/);
  });
});

describe("a tab is still a button", () => {
  it("keeps the role, the selected state, the label and the test id", () => {
    expect(bar).toContain('accessibilityRole="button"');
    expect(bar).toContain("accessibilityState={{ selected: tabIndex === selected }}");
    expect(bar).toContain("tab.options.tabBarAccessibilityLabel ?? tab.options.title");
    expect(bar).toContain("testID={tab.options.tabBarButtonTestID}");
  });

  it("presses and long-presses exactly as the navigator expects", () => {
    expect(bar).toContain("onPress={() => openTab(tabIndex)}");
    expect(bar).toContain('type: "tabLongPress"');
  });

  it("reads the accessible state from the route, never from the drag", () => {
    // `highlighted` is what the drag moves; `selected` is what the reader is
    // actually on, and that is what is announced.
    expect(bar).toContain("const highlighted = dragTarget ?? selected;");
  });
});

describe("the bar renders what the navigator holds", () => {
  it("is wired as the one tab bar of the one navigator", () => {
    expect(layout).toContain("tabBar={(props) => <GlassTabBar {...props} />}");
    expect(layout.match(/<Tabs[\s>]/g) ?? []).toHaveLength(1);
    expect(layout).not.toContain("tabBarButton");
  });

  it("keeps Settings out of the bar the way Expo Router hides it", () => {
    // `href: null` leaves the route in the navigator with
    // `tabBarItemStyle: { display: "none" }`; a bar that ignored that would
    // render a sixth tab.
    expect(isHiddenTabStyle({ display: "none" })).toBe(true);
    expect(isHiddenTabStyle([{ minHeight: 44 }, { display: "none" }])).toBe(true);
    expect(isHiddenTabStyle({ minHeight: 44 })).toBe(false);
    expect(isHiddenTabStyle(undefined)).toBe(false);
    expect(bar).toContain("isHiddenTabStyle(options.tabBarItemStyle)");
  });

  it("tells the navigator how tall it is, so content still ends above the glass", () => {
    // The default bar reports its own height through this context. A custom bar
    // that stayed silent would leave every screen on the navigator's estimate,
    // and useTabBarInset — which every scrollable surface inside the tabs reads
    // — would inset by the wrong amount.
    expect(bar).toContain("BottomTabBarHeightCallbackContext");
    expect(bar).toMatch(/onLayout=\{\(event\) => reportHeight\?\.\(event\.nativeEvent\.layout\.height\)\}/);
  });

  it("measures the row when it lays out, and never during a drag", () => {
    expect(bar).toContain("onLayout={onRowLayout}");
    expect(bar).toContain("measureInWindow");
    expect(bar.match(/measureInWindow/g) ?? []).toHaveLength(1);
  });

  it("ticks once per newly targeted tab, never per frame", () => {
    expect(bar).toContain("selectionChanged()");
    // The target is written once per change, and a repeat of the same index
    // returns before anything else happens.
    expect(bar).toMatch(/if \(tabIndex === previous\) \{\s*return;/);
  });
});

describe("the selection tick", () => {
  it("says nothing when a drag first lands on the glass", () => {
    // −1 is "no target yet"; seeding with the current tab is what the bar
    // actually does, and neither is a crossing.
    expect(crossesIntoNewTab(-1, 0)).toBe(false);
    expect(crossesIntoNewTab(-1, 3)).toBe(false);
  });

  it("fires when the finger crosses into another tab", () => {
    expect(crossesIntoNewTab(0, 1)).toBe(true);
    expect(crossesIntoNewTab(3, 2)).toBe(true);
  });

  it("fires once per tab, not once per frame over the same tab", () => {
    expect(crossesIntoNewTab(2, 2)).toBe(false);
  });

  it("is seeded with the current selection, so the touch-down is silent", () => {
    expect(bar).toMatch(/onPanResponderGrant[\s\S]{0,320}target: selected/);
    expect(bar).not.toMatch(/active: true, target: -1/);
  });

  it("guards the tick with that rule and nothing else", () => {
    expect(bar).toMatch(/if \(crossesIntoNewTab\(previous, tabIndex\)\) \{\s*selectionChanged\(\);/);
    // Exactly one call site: no second buzz hidden in the release or the tap.
    expect(bar.match(/selectionChanged\(\)/g) ?? []).toHaveLength(1);
  });

  it("never reaches a tap at all", () => {
    // A press is not claimed by the row, so a tap cannot enter the drag path
    // where the tick lives.
    expect(bar).toContain("onStartShouldSetPanResponder: () => false");
    expect(bar).not.toMatch(/onPress[\s\S]{0,120}selectionChanged/);
  });
});

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      walk(full, found);
      continue;
    }

    if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      found.push(full);
    }
  }

  return found;
}
