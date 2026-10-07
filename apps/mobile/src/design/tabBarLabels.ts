import { TAB_BAR_GLASS } from "./tabBarMaterial";

/**
 * How much room a tab label actually has, and how much it needs.
 *
 * WHY THIS EXISTS. The glass pill is inset from both screen edges
 * (`TAB_BAR_GLASS.horizontalInset`), but the row of tabs used to span the whole
 * screen. Each tab's share was therefore measured against a width the glass
 * does not cover: the first and last tabs started outside the pill, and
 * "Newsletter" — the widest label, in the first slot — visibly spilled past the
 * glass on its left edge, with the moving capsule hanging out beside it.
 *
 * The row now sits inside the pill, and the numbers below are the one place
 * the geometry is written down, so the bar and its tests read the same widths.
 *
 * Kept free of any react-native import so it can be unit tested without a
 * device, like tabBarMaterial.ts.
 */

/** The label's nominal size. Pinned by tabBarGlass.test.ts. */
export const TAB_LABEL_FONT_SIZE = 10.5;

/**
 * The floor `adjustsFontSizeToFit` may shrink a label to. Only reached on the
 * 320pt iPhones iOS 15 still supports, or under a larger Dynamic Type setting:
 * 0.85 × 10.5 ≈ 8.9pt, still above what the platform's own compact bars use.
 */
export const TAB_LABEL_MIN_FONT_SCALE = 0.85;

/**
 * The bar is a fixed-height control, so its labels follow Dynamic Type only a
 * little — the same choice the system tab bar makes. Larger sizes are served
 * by the screen reader label, which every tab carries.
 */
export const TAB_LABEL_MAX_FONT_MULTIPLIER = 1.15;

/** Breathing room between a label and the edge of its capsule, per side. */
export const TAB_LABEL_GUTTER = 2;

/**
 * The narrowest iPhone the app supports (iPhone SE 1st generation, iPod touch,
 * iOS 15.1) and the narrowest current one (iPhone SE 2nd/3rd gen, 13 mini).
 */
export const SMALLEST_SUPPORTED_WIDTH = 320;
export const SMALLEST_CURRENT_WIDTH = 375;

/** The width one tab gets, inside the glass. */
export function tabSlotWidth(screenWidth: number, tabCount: number): number {
  if (tabCount <= 0) {
    return 0;
  }

  return Math.max(screenWidth - TAB_BAR_GLASS.horizontalInset * 2, 0) / tabCount;
}

/**
 * The width a label may occupy without leaving its own capsule: the slot, less
 * the capsule's inset, less a gutter on each side.
 */
export function tabLabelWidthBudget(screenWidth: number, tabCount: number): number {
  return Math.max(
    tabSlotWidth(screenWidth, tabCount) - TAB_BAR_GLASS.capsuleInset * 2 - TAB_LABEL_GUTTER * 2,
    0
  );
}

/**
 * Advance widths of the label face (SF Pro Text, bold), in em. Rounded UP from
 * the font's metrics so an estimate errs wide: a label that passes here fits on
 * the device. Unknown glyphs fall back to the widest lowercase advance.
 */
const ADVANCE_EM: Record<string, number> = {
  " ": 0.25,
  "-": 0.39,
  "&": 0.72,
  a: 0.57,
  b: 0.61,
  c: 0.54,
  d: 0.61,
  e: 0.58,
  f: 0.37,
  g: 0.61,
  h: 0.6,
  i: 0.27,
  j: 0.27,
  k: 0.56,
  l: 0.27,
  m: 0.9,
  n: 0.6,
  o: 0.6,
  p: 0.61,
  q: 0.61,
  r: 0.39,
  s: 0.53,
  t: 0.37,
  u: 0.6,
  v: 0.56,
  w: 0.82,
  x: 0.56,
  y: 0.56,
  z: 0.52,
  é: 0.58,
  è: 0.58,
  A: 0.69,
  B: 0.67,
  C: 0.68,
  D: 0.72,
  E: 0.6,
  F: 0.58,
  G: 0.73,
  H: 0.73,
  I: 0.29,
  L: 0.56,
  M: 0.87,
  N: 0.73,
  O: 0.75,
  P: 0.64,
  R: 0.66,
  S: 0.63,
  T: 0.61
};

const FALLBACK_ADVANCE_EM = 0.9;

/** A conservative estimate of a label's rendered width, in points. */
export function estimateTabLabelWidth(
  label: string,
  fontSize: number = TAB_LABEL_FONT_SIZE
): number {
  let em = 0;

  for (const glyph of label) {
    em += ADVANCE_EM[glyph] ?? FALLBACK_ADVANCE_EM;
  }

  return em * fontSize;
}

/**
 * Whether a label fits its capsule on a screen this wide: at its nominal size,
 * or — when `allowShrink` — at the smallest size the bar lets it shrink to.
 */
export function tabLabelFits(input: {
  label: string;
  screenWidth: number;
  tabCount: number;
  allowShrink?: boolean;
}): boolean {
  const scale = input.allowShrink ? TAB_LABEL_MIN_FONT_SCALE : 1;

  return (
    estimateTabLabelWidth(input.label, TAB_LABEL_FONT_SIZE * scale) <=
    tabLabelWidthBudget(input.screenWidth, input.tabCount)
  );
}
