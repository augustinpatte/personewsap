/**
 * Which material the tab bar wears.
 *
 * Kept pure and apart from the component so the whole matrix — light, dark,
 * and Reduce Transparency in both — is unit tested rather than eyeballed on a
 * device. `TabBarBackground` only renders what this decides.
 */

export type TabBarMaterial =
  /** Near-solid themed surface: the answer to Reduce Transparency. */
  | { kind: "solid" }
  /** System blur, tinted with the app's own paper so it stays warm. */
  | { kind: "blur"; tint: "systemThickMaterialLight" | "systemThickMaterialDark"; wash: string };

/**
 * The app's surface at low alpha, laid over the system blur. Not white and not
 * black: a bar that borrowed a neutral grey would read as a different product's
 * chrome bolted onto a warm one.
 */
const LIGHT_WASH = "rgba(252, 250, 244, 0.55)";
const DARK_WASH = "rgba(34, 31, 23, 0.55)";

export function resolveTabBarMaterial(input: {
  reduceTransparency: boolean;
  isDark: boolean;
}): TabBarMaterial {
  if (input.reduceTransparency) {
    // Not "less blur": none. The setting exists for people who cannot read
    // over a busy background, and nothing in this bar is legible only because
    // of the material.
    return { kind: "solid" };
  }

  return input.isDark
    ? { kind: "blur", tint: "systemThickMaterialDark", wash: DARK_WASH }
    : { kind: "blur", tint: "systemThickMaterialLight", wash: LIGHT_WASH };
}

/**
 * Thick rather than regular: five labels at 10.5pt have to stay readable over
 * whatever headline happens to be scrolling underneath them.
 */
export const TAB_BAR_BLUR_INTENSITY = 72;
