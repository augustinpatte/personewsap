import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MODULE_NAMES, PRODUCT_MODULE_IDS } from "../constants/moduleNames";
import {
  estimateTabLabelWidth,
  SMALLEST_CURRENT_WIDTH,
  SMALLEST_SUPPORTED_WIDTH,
  TAB_LABEL_FONT_SIZE,
  TAB_LABEL_MIN_FONT_SCALE,
  tabLabelFits,
  tabLabelWidthBudget,
  tabSlotWidth
} from "./tabBarLabels";
import { TAB_BAR_GLASS } from "./tabBarMaterial";

/**
 * Every bottom-bar label fits inside its own piece of glass.
 *
 * The bug this pins: the glass pill stops `horizontalInset` short of each
 * screen edge, but the row of tabs used to span the full width — so the first
 * tab, "Newsletter", started outside the glass and its label visibly escaped
 * it. The geometry is now computed against the pill, and every canonical label
 * in both languages is measured against it.
 */

const srcDir = join(__dirname, "..");
const appDir = join(srcDir, "..", "app");
const read = (...segments: string[]) => readFileSync(join(...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const bar = stripComments(read(srcDir, "components", "GlassTabBar.tsx"));
const tabsLayout = stripComments(read(appDir, "(tabs)", "_layout.tsx"));

const TAB_COUNT = 5;
const LANGUAGES = ["en", "fr"] as const;
const BAR_MODULES = ["newsletter", "mini_case", "business_story", "learning_path", "teams"] as const;

describe("the row lives inside the glass", () => {
  it("is inset by exactly the pill's own inset", () => {
    expect(bar).toContain("marginHorizontal: TAB_BAR_GLASS.horizontalInset");
  });

  it("measures a tab's slot against the pill, not the screen", () => {
    expect(tabSlotWidth(375, TAB_COUNT)).toBeCloseTo((375 - TAB_BAR_GLASS.horizontalInset * 2) / 5);
    // The first slot starts where the glass starts.
    expect(tabSlotWidth(375, TAB_COUNT) * TAB_COUNT + TAB_BAR_GLASS.horizontalInset * 2).toBeCloseTo(375);
  });

  it("keeps the capsule inside its slot, and the label inside the capsule", () => {
    expect(TAB_BAR_GLASS.capsuleInset).toBeGreaterThan(0);
    expect(bar).toContain("paddingHorizontal: TAB_BAR_GLASS.capsuleInset + TAB_LABEL_GUTTER");
    expect(tabLabelWidthBudget(375, TAB_COUNT)).toBeLessThan(
      tabSlotWidth(375, TAB_COUNT) - TAB_BAR_GLASS.capsuleInset * 2
    );
  });

  it("never wraps and shrinks only within a readable floor", () => {
    expect(bar).toContain("numberOfLines={1}");
    expect(bar).toContain("adjustsFontSizeToFit");
    expect(bar).toContain("minimumFontScale={TAB_LABEL_MIN_FONT_SCALE}");
    expect(bar).toContain("maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_MULTIPLIER}");
    // Not unreadably small: the floor stays above 8.5pt.
    expect(TAB_LABEL_FONT_SIZE * TAB_LABEL_MIN_FONT_SCALE).toBeGreaterThanOrEqual(8.5);
  });
});

describe("every label fits, in both languages", () => {
  for (const language of LANGUAGES) {
    for (const id of BAR_MODULES) {
      const label = MODULE_NAMES[language][id].tab;

      it(`${language} "${label}" fits at full size on a ${SMALLEST_CURRENT_WIDTH}pt iPhone`, () => {
        expect(
          tabLabelFits({ label, screenWidth: SMALLEST_CURRENT_WIDTH, tabCount: TAB_COUNT })
        ).toBe(true);
      });

      it(`${language} "${label}" fits on a ${SMALLEST_SUPPORTED_WIDTH}pt iPhone within the shrink floor`, () => {
        expect(
          tabLabelFits({
            label,
            screenWidth: SMALLEST_SUPPORTED_WIDTH,
            tabCount: TAB_COUNT,
            allowShrink: true
          })
        ).toBe(true);
      });
    }
  }

  it("is a measurement that can fail: the full names would not fit", () => {
    // The reason the bar carries short forms for two modules.
    expect(
      tabLabelFits({ label: "Business Stories", screenWidth: 375, tabCount: TAB_COUNT })
    ).toBe(false);
    expect(
      tabLabelFits({ label: "Learning Path", screenWidth: 375, tabCount: TAB_COUNT })
    ).toBe(false);
    // And the old geometry (full-width row, 8pt capsule inset) is what let
    // "Newsletter" start 5pt to the left of the glass on a 375pt phone.
    const oldSlot = 375 / TAB_COUNT;
    const labelLeft = oldSlot / 2 - estimateTabLabelWidth("Newsletter") / 2;
    expect(labelLeft).toBeLessThan(TAB_BAR_GLASS.horizontalInset);
  });
});

describe("one canonical name per module", () => {
  it("covers every module in both languages", () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(MODULE_NAMES[language]).sort()).toEqual([...PRODUCT_MODULE_IDS].sort());
    }
  });

  it("names the modules the way the product does", () => {
    expect(MODULE_NAMES.en.newsletter.name).toBe("Newsletter");
    expect(MODULE_NAMES.en.business_story.name).toBe("Business Stories");
    expect(MODULE_NAMES.en.mini_case.name).toBe("Mini Cases");
    expect(MODULE_NAMES.en.learning_path.name).toBe("Learning Path");
    expect(MODULE_NAMES.fr.business_story.name).toBe("Business Stories");
    expect(MODULE_NAMES.fr.mini_case.name).toBe("Mini-cas");
    expect(MODULE_NAMES.fr.learning_path.name).toBe("Parcours");
  });

  it("only shortens a name, never renames it, on the bar", () => {
    for (const language of LANGUAGES) {
      for (const id of PRODUCT_MODULE_IDS) {
        const { name, tab } = MODULE_NAMES[language][id];
        expect(name.split(/\s+/)).toContain(tab.split(/\s+/).slice(-1)[0]);
      }
    }
  });

  it("feeds the bar from the canonical names only", () => {
    expect(tabsLayout).toContain("moduleNames(profileLanguage)");
    expect(tabsLayout).not.toMatch(/"(Mini cases|Mini cas|Stories|Path|Parcours)"/);
  });

  it("leaves no retired variant in user-facing copy", () => {
    const retired = [
      /"Mini cases"/,
      /"Mini cas"/,
      /"Business stories"/,
      /"Business story"/,
      /"Histoires business"/,
      /"Learning path"/,
      /"Newsletters"/
    ];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          files.push(path);
        }
      }
    };
    walk(join(srcDir, "features"));
    walk(appDir);

    const offenders = files.flatMap((file) => {
      const source = stripComments(readFileSync(file, "utf8"));
      return retired.filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });
});
