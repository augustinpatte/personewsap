import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveTabBarMaterial, TAB_BAR_BLUR_INTENSITY } from "./tabBarMaterial";

/**
 * The native pass, pinned.
 *
 * Two native modules were added on purpose and both are load-bearing in exactly
 * one place each: haptics at the moments something is decided, blur behind the
 * one layer that floats. These tests keep both from spreading — a buzz on every
 * tap and glass on every card are the two ways this pass could quietly turn the
 * product into something it is not.
 */

const srcDir = __dirname.replace(/\/design$/, "");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function collectSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      collectSources(full, found);
      continue;
    }

    if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      found.push(full);
    }
  }

  return found;
}

describe("tab bar material", () => {
  it("wears the system blur when transparency is not reduced", () => {
    const light = resolveTabBarMaterial({ reduceTransparency: false, isDark: false });
    const dark = resolveTabBarMaterial({ reduceTransparency: false, isDark: true });

    expect(light.kind).toBe("blur");
    expect(dark.kind).toBe("blur");
  });

  it("picks the light material in daylight and the dark one at night", () => {
    const light = resolveTabBarMaterial({ reduceTransparency: false, isDark: false });
    const dark = resolveTabBarMaterial({ reduceTransparency: false, isDark: true });

    if (light.kind !== "blur" || dark.kind !== "blur") {
      throw new Error("expected both to be blur materials");
    }

    expect(light.tint).toBe("systemThickMaterialLight");
    expect(dark.tint).toBe("systemThickMaterialDark");
    // The wash is the app's own paper, never a neutral grey borrowed from
    // somewhere else.
    expect(light.wash).not.toBe(dark.wash);
    expect(light.wash).toMatch(/^rgba\(/);
    expect(dark.wash).toMatch(/^rgba\(/);
  });

  it("goes solid in both themes when Reduce Transparency is on", () => {
    for (const isDark of [false, true]) {
      expect(resolveTabBarMaterial({ reduceTransparency: true, isDark })).toEqual({
        kind: "solid"
      });
    }
  });

  it("stays thick enough for 10.5pt labels over moving content", () => {
    // Not asserting an exact look, only that it is not a token gesture: a wisp
    // of blur under five small labels is worse than none.
    expect(TAB_BAR_BLUR_INTENSITY).toBeGreaterThanOrEqual(50);
    expect(TAB_BAR_BLUR_INTENSITY).toBeLessThanOrEqual(100);
  });
});

describe("blur stays where it was justified", () => {
  it("is used in exactly one component", () => {
    const users = collectSources(srcDir)
      .concat(collectSources(join(srcDir, "..", "app")))
      .filter((file) => /from "expo-blur"/.test(stripComments(readFileSync(file, "utf8"))));

    expect(users.map((file) => file.split("/").pop())).toEqual(["TabBarBackground.tsx"]);
  });

  it("never nests a blur inside another", () => {
    const source = readFileSync(join(srcDir, "components", "TabBarBackground.tsx"), "utf8");

    expect(source.match(/<BlurView/g) ?? []).toHaveLength(1);
  });
});

describe("haptics stay rare", () => {
  const hapticUsers = collectSources(srcDir)
    .filter((file) => /from "(\.\.\/)+lib\/haptics"/.test(stripComments(readFileSync(file, "utf8"))))
    .map((file) => file.split("/").pop());

  it("is called from the answer surface and the completion surface only", () => {
    expect(hapticUsers.sort()).toEqual([
      "LearningFeedbackScreen.tsx",
      "MiniCaseReader.tsx"
    ]);
  });

  it("never touches ordinary navigation or card presses", () => {
    // The shared press primitive is the one component every card and row goes
    // through: a haptic there would fire on every tap in the app.
    for (const file of ["components/PressableSurface.tsx", "design/usePressedSurfaceStyle.ts"]) {
      expect(readFileSync(join(srcDir, file), "utf8")).not.toContain("haptics");
    }

    for (const file of collectSources(join(srcDir, "features", "modules"))) {
      expect(stripComments(readFileSync(file, "utf8")), file).not.toContain("lib/haptics");
    }
  });

  it("fires the Mini Case haptic on the answer commit, not on a timer", () => {
    const source = stripComments(
      readFileSync(join(srcDir, "features", "today", "readers", "MiniCaseReader.tsx"), "utf8")
    );

    // Both flows: the call sits in onSelect, beside the state update.
    expect(source.match(/notifyAnswerOutcome\(option\);/g) ?? []).toHaveLength(2);
    expect(source).not.toMatch(/setTimeout[\s\S]{0,80}notifyAnswerOutcome/);
  });
});

describe("the floating bar leaves room for content", () => {
  it("insets every scrollable surface that lives inside the tabs", () => {
    for (const file of [
      "components/AppScreen.tsx",
      "features/modules/ModuleChrome.tsx",
      "features/modules/ItemArchiveList.tsx",
      "features/modules/NewsletterModuleScreen.tsx"
    ]) {
      expect(readFileSync(join(srcDir, file), "utf8"), file).toContain("useTabBarInset");
    }
  });

  it("reads zero outside a tab navigator rather than throwing", () => {
    // Comments stripped: the file documents why the throwing hook is avoided,
    // and that prose must not read as a use of it.
    const source = stripComments(
      readFileSync(join(srcDir, "design", "useTabBarInset.ts"), "utf8")
    );

    // useBottomTabBarHeight() throws outside the tabs, and AppScreen also
    // renders in readers, onboarding and the learning stack.
    expect(source).toContain("BottomTabBarHeightContext");
    expect(source).toContain("?? 0");
    expect(source).not.toContain("useBottomTabBarHeight");
  });
});
