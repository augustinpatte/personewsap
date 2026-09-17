import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getModuleCopy } from "./moduleCopy";

/**
 * The Newsletter masthead and the day with no edition.
 *
 * Two things were wrong on a real device, and both were the same mistake —
 * showing a number, and a shape, that only made sense on an edition day:
 *
 *   * the header metadata read "4 editions/week · 0 articles · Finite archive"
 *     on an off-day. The count was TODAY's articles, so it described a broken
 *     edition rather than a rhythm, and it pushed the line to two rows with
 *     "archive" orphaned on the second;
 *
 *   * the quiet state was five loosely spaced paragraphs at nearly equal
 *     weight, pinned to the top, with a hand's width of dead paper between the
 *     button and the bottom bar.
 *
 * These pin the fix without pinning the prose: the copy stays editorial, the
 * composition stays composed.
 */

const modulesDir = __dirname;
const read = (file: string) => readFileSync(join(modulesDir, file), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const newsletter = stripComments(read("NewsletterModuleScreen.tsx"));
const quietState = stripComments(read("TodayQuietState.tsx"));
const chrome = stripComments(read("ModuleChrome.tsx"));

describe("the masthead metadata", () => {
  it("carries only facts that hold on every day of the week", () => {
    const metaItems = /metaItems=\{\[([^\]]*)\]\}/.exec(newsletter)?.[1] ?? "";

    expect(metaItems).toContain("copy.common.editionRhythm");
    expect(metaItems).toContain("copy.common.archiveAccess");
    // The one that broke: today's article count, in a header that is shown on
    // days with no edition at all.
    expect(metaItems).not.toContain("articleCount");
    expect(metaItems.split(",").filter((part) => part.trim()).length).toBe(2);
  });

  it("reads from the real source of truth, never a hardcoded count", () => {
    // Nothing in this screen states a number of articles per edition. The
    // count that does exist counts the articles actually in hand.
    expect(newsletter).not.toMatch(/16 articles|articles\/edition/);
    expect(newsletter).toMatch(/copy\.newsletter\.progress\(readCount, articles\.length\)/);
  });

  it("is short enough to sit on one line in both languages", () => {
    for (const language of ["en", "fr"] as const) {
      const copy = getModuleCopy(language).common;
      const line = `${copy.editionRhythm}  ·  ${copy.archiveAccess}`;

      // Two short facts and a middot. The old three-item line ran past 40
      // characters and wrapped on an iPhone at 10.5pt.
      expect(line.length, language).toBeLessThanOrEqual(40);
    }
  });

  it("breaks between facts rather than inside one, if it ever has to break", () => {
    // Non-breaking spaces inside each item: a narrow screen moves "Finite
    // archive" down whole instead of leaving "archive" alone on a line.
    expect(chrome).toContain('replace(/ /g, "\\u00A0")');
    // The spoken line keeps ordinary spaces and commas.
    expect(chrome).toContain('accessibilityLabel={parts.join(", ")}');
  });
});

describe("the day with no edition", () => {
  it("descends in weight: title, explanation, aside, then the next date", () => {
    // The explanation used to be set in the reading face, as heavy as the
    // title. It is body text now, and the one fact a reader wants — when the
    // next edition lands — carries the accent.
    expect(quietState).toMatch(/variant="subtitle"/);
    expect(quietState).toMatch(/color="inkSoft" style=\{styles\.prose\} variant="body"/);
    expect(quietState).toMatch(/color="muted" style=\{styles\.prose\} variant="caption"/);
    expect(quietState).toMatch(/color="accentInk" style=\{styles\.next\} variant="label"/);
    expect(quietState).not.toMatch(/variant="read"/);
  });

  it("holds the prose to a readable measure", () => {
    expect(quietState).toContain("PROSE_MAX_WIDTH");
    const width = Number(/const PROSE_MAX_WIDTH = (\d+)/.exec(quietState)?.[1]);

    // Roughly 45–65 characters at this size; a width, never a device height.
    expect(width).toBeGreaterThanOrEqual(320);
    expect(width).toBeLessThanOrEqual(520);
  });

  it("keeps the message and its action together", () => {
    // One gap inside the message, one larger gap before the button: the
    // action answers the sentence above it rather than floating away.
    expect(quietState).toMatch(/message: \{\s*gap: tokens\.space\.sm/);
    expect(quietState).toMatch(/container: \{\s*gap: tokens\.space\.xl/);
  });

  it("centres in whatever height is left instead of leaving dead paper", () => {
    expect(newsletter).toContain("contentStyle={styles.quietContent}");
    expect(newsletter).toMatch(/quietContent: \{\s*justifyContent: "center"/);
    // The scroll's container already grows; nothing measures the screen.
    expect(chrome).toMatch(/scrollContent: \{\s*flexGrow: 1/);
  });

  it("ends above the floating bar, through the one inset helper", () => {
    expect(chrome).toContain("useTabBarInset");
    expect(chrome).toContain("paddingBottom: tokens.space.xxl + tabBarInset");
    expect(chrome).toContain("scrollIndicatorInsets={{ bottom: tabBarInset }}");
    // No second bottom-padding rule of its own.
    expect(quietState).not.toMatch(/paddingBottom|tabBarInset/);
  });

  it("assumes no device: no screen height anywhere in either file", () => {
    for (const [name, source] of [
      ["NewsletterModuleScreen.tsx", newsletter],
      ["TodayQuietState.tsx", quietState]
    ] as const) {
      expect(source, name).not.toMatch(/Dimensions|useWindowDimensions|height: \d{3}/);
    }
  });

  it("paints from the theme in both schemes, never a literal", () => {
    for (const [name, source] of [
      ["TodayQuietState.tsx", quietState],
      ["NewsletterModuleScreen.tsx", newsletter]
    ] as const) {
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
    }
  });

  it("says the same things it always said, in both languages", () => {
    for (const language of ["en", "fr"] as const) {
      const copy = getModuleCopy(language).common;

      expect(copy.quietDayTitle.length, language).toBeGreaterThan(0);
      expect(copy.quietDayBody, language).toMatch(language === "fr" ? /lundi/ : /Monday/);
      expect(copy.exploreArchive.length, language).toBeGreaterThan(0);
      expect(copy.nextEdition("Friday"), language).toContain("Friday");
    }
  });
});
