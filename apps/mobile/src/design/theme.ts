import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type PropsWithChildren
} from "react";
import { useColorScheme } from "react-native";

import { tokens, type ColorToken } from "./tokens";

// Every palette exposes the same set of semantic color slots. Light mode reuses
// the base tokens verbatim; dark mode supplies its own warm, premium values for
// the same slots so that every screen re-themes from a single source of truth.
export type ThemeColorToken = ColorToken | "onAccent" | "scrim";

export type ThemeColors = Record<ThemeColorToken, string>;

export type ColorScheme = "light" | "dark";

// Warm paper-and-ink daytime palette (the existing brand). `onAccent` is the
// text/icon color that sits on top of a filled accent surface (primary button).
export const lightColors: ThemeColors = {
  ...tokens.color,
  onAccent: "#FFFFFF",
  scrim: "rgba(17, 16, 13, 0.44)"
};

// Calm night-reading palette: warm espresso backgrounds instead of pure black,
// paper-white ink, a brightened teal accent that survives on dark surfaces, and
// muted status colors that stay legible without going neon.
export const darkColors: ThemeColors = {
  background: "#16140F",
  backgroundRaised: "#1C1A14",
  surface: "#221F17",
  surfaceMuted: "#2B281F",
  ink: "#F2ECDD",
  inkSoft: "#C9C2B0",
  muted: "#978F7D",
  mutedSoft: "#6C6554",
  border: "#332F25",
  borderStrong: "#453F32",
  accent: "#5CB0A9",
  accentPressed: "#4A968F",
  accentSoft: "#16302E",
  accentInk: "#86D0C9",
  gold: "#C8A463",
  goldSoft: "#2A2417",
  success: "#76BA8E",
  successSoft: "#18271D",
  warning: "#CAA05F",
  warningSoft: "#2A2316",
  danger: "#DB8E80",
  dangerSoft: "#2F1F1B",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  onAccent: "#0B201E",
  scrim: "rgba(0, 0, 0, 0.58)"
};

const palettes: Record<ColorScheme, ThemeColors> = {
  light: lightColors,
  dark: darkColors
};

export type Theme = {
  scheme: ColorScheme;
  isDark: boolean;
  colors: ThemeColors;
};

const lightTheme: Theme = {
  scheme: "light",
  isDark: false,
  colors: lightColors
};

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = systemScheme === "dark" ? "dark" : "light";

  const value = useMemo<Theme>(
    () => ({
      scheme,
      isDark: scheme === "dark",
      colors: palettes[scheme]
    }),
    [scheme]
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

// Build a StyleSheet from a factory that receives the active palette. The result
// is memoized per scheme, so styles are only recomputed when light/dark flips.
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors, factory]);
}
