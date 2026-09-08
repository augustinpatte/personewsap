import { type ThemeColors } from "./theme";

/**
 * The palette React Navigation itself paints with.
 *
 * ── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 * Expo Router mounts its NavigationContainer with `theme = DefaultTheme` and
 * nothing in this app ever replaced it. DefaultTheme is React Navigation's
 * stock LIGHT palette:
 *
 *     background: 'rgb(242, 242, 242)'   card: 'rgb(255, 255, 255)'
 *
 * and those two values are not decoration. They are what every navigator paints
 * when nothing else is on top:
 *
 *   * `native-stack` sets `contentStyle: { backgroundColor: colors.background }`
 *     on every screen that does not override it — so a pushed screen whose own
 *     content has not laid out yet shows light grey;
 *   * `bottom-tabs` renders each scene inside `@react-navigation/elements`'
 *     `Background`, which is `colors.background` — so an unpainted tab, and the
 *     moment between detaching one scene and attaching the next, is light grey;
 *   * a screen that is being frozen or detached (`detachInactiveScreens`) shows
 *     whatever is behind it, which is that same grey.
 *
 * In daylight the grey is close enough to the paper that nobody notices. At
 * night it is a white flash between two espresso-dark screens, which is exactly
 * the "flash blanc" this pass exists to remove.
 *
 * ── WHY A MAPPING AND NOT A SECOND PALETTE ─────────────────────────────────
 * Every value below is a token from the active PersoNewsAP palette. There is no
 * colour defined here, and there must never be one: this file is a translation
 * between two vocabularies, not a source of colour. `primary` and
 * `notification` are the only slots React Navigation owns that the app has no
 * exact word for, and they map to `accent` and `danger` rather than to
 * something new.
 *
 * Kept free of any `@react-navigation/*` import on purpose, so the mapping is
 * unit-testable without pulling a navigator (and its react-native imports) into
 * the test environment. The root layout supplies the `fonts` half of the theme
 * from the library's own base theme, which is the only part of it this app has
 * no opinion about.
 */

export type NavigationPalette = {
  primary: string;
  background: string;
  card: string;
  text: string;
  border: string;
  notification: string;
};

export function navigationPaletteFor(colors: ThemeColors): NavigationPalette {
  return {
    primary: colors.accent,
    // THE ONE THAT MATTERS. Every scene container, every unpainted stack screen
    // and every gap between two screens is this colour.
    background: colors.background,
    // Headers and any library-drawn sheet. Headers are hidden app-wide, but a
    // card left at stock white would still show through a modal presentation.
    card: colors.backgroundRaised,
    text: colors.ink,
    border: colors.border,
    notification: colors.danger
  };
}
