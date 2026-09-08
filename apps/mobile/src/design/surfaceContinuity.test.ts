import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// `react-native` cannot be parsed by the SSR transform, which is why every
// mobile test in this repo stubs it. Only `Platform.select` (for the serif
// family) and `useColorScheme` are reached from the modules under test.
vi.mock("react-native", () => ({
  Platform: { select: (options: Record<string, unknown>) => options.ios ?? options.default },
  useColorScheme: () => "light"
}));

const { darkColors, lightColors } = await import("./theme");
const { navigationPaletteFor } = await import("./navigationTheme");
const { resolveTabBarMaterial } = await import("./tabBarMaterial");

/**
 * ONE CONTINUOUS SURFACE.
 *
 * The rule this file exists to keep: at no point during a navigation, a load, a
 * modal, a data fetch or a back gesture may the reader see a colour that is not
 * in the active PersoNewsAP palette. Light mode is paper throughout; dark mode
 * is espresso throughout; nothing in between is grey, white or black by
 * accident.
 *
 * It was broken in four independent ways at once, and each of the four is
 * pinned below, because each is the kind of thing that is invisible in a
 * screenshot, obvious on a device, and one careless edit away from coming back:
 *
 *   1. React Navigation's own theme was never replaced, so every navigator
 *      painted its scenes with the library's stock light grey — in dark mode
 *      too, which is what flashed white between two dark screens.
 *   2. Four of the five nested stacks declared no `contentStyle`, so a screen
 *      mid-push had no background of its own.
 *   3. The Teams tab rendered no background at all: no safe area, no surface,
 *      just a transparent scroll over whatever the navigator left behind.
 *   4. Nothing stood in front of React Native's root view, whose colour is a
 *      single value baked into app.json and cannot follow the scheme.
 *
 * Source assertions, in the idiom this repository already uses for React Native
 * components: the mobile tree cannot be rendered under jsdom, so the wiring is
 * pinned by reading it.
 */

const designDir = __dirname;
const srcDir = join(designDir, "..");
const appDir = join(designDir, "..", "..", "app");

const read = (...segments: string[]) => readFileSync(join(...segments), "utf8");

/** Source with comments removed, so prose about white flashes is not a finding. */
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

function layoutFiles(): string[] {
  return collectSources(appDir).filter((file) => file.endsWith("_layout.tsx"));
}

const rootLayout = stripComments(read(appDir, "_layout.tsx"));

// ---------------------------------------------------------------------------
// 10. Every navigation root has an explicit, palette-derived background
// ---------------------------------------------------------------------------

describe("every navigation root paints the palette", () => {
  it("replaces React Navigation's stock theme at the root", () => {
    // DefaultTheme is `background: 'rgb(242, 242, 242)'`, `card: white`, and
    // Expo Router mounts its NavigationContainer with it. Nothing below can
    // undo that; only a ThemeProvider above the navigators can.
    expect(rootLayout).toContain("ThemeProvider as NavigationThemeProvider");
    expect(rootLayout).toContain("navigationPaletteFor(colors)");
    expect(rootLayout).toMatch(/<NavigationThemeProvider value=\{navigationTheme\}>/);
    // And it flips with the scheme rather than being pinned to one of them.
    expect(rootLayout).toContain("isDark ? DarkTheme : DefaultTheme");
    expect(rootLayout).toContain("dark: isDark");
  });

  it("stands a themed view in front of the platform root view", () => {
    // app.json's `backgroundColor` is one colour for both schemes and cannot
    // follow the system. Whatever a navigator detaches or freezes reveals what
    // is behind it, so what is behind it is the app's own paper.
    expect(rootLayout).toMatch(
      /<View style=\{\[styles\.root, \{ backgroundColor: colors\.background \}\]\}>/
    );
  });

  it("gives every stack an explicit contentStyle background", () => {
    const offenders: string[] = [];

    for (const file of layoutFiles()) {
      const source = stripComments(readFileSync(file, "utf8"));

      if (!source.includes("<Stack")) {
        continue;
      }

      if (!/contentStyle: \{ backgroundColor: colors\.background \}/.test(source)) {
        offenders.push(file.replace(appDir, "app"));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("gives the tab navigator an explicit sceneStyle background", () => {
    // A tab scene is rendered inside @react-navigation/elements' `Background`,
    // which is the theme's colour. Stating it here as well means the switch
    // between two tabs cannot reveal anything else even for a frame.
    const tabs = stripComments(read(appDir, "(tabs)", "_layout.tsx"));

    expect(tabs).toContain("sceneStyle: { backgroundColor: colors.background }");
  });

  it("finds the layouts it claims to be checking", () => {
    // A guard on the guard: a rename that emptied the list would make every
    // assertion above pass by iterating nothing.
    const names = layoutFiles().map((file) => file.replace(appDir + "/", ""));

    expect(names).toContain("_layout.tsx");
    expect(names).toContain("(tabs)/_layout.tsx");
    expect(names).toContain("(teams)/_layout.tsx");
    expect(names.length).toBeGreaterThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// 8. Structural colour comes from the theme, and only from the theme
// ---------------------------------------------------------------------------

describe("structural colours come from the palette", () => {
  /**
   * The three files allowed to hold a colour literal, and why.
   *
   * `tokens.ts` and `theme.ts` ARE the palette — they are where a colour is
   * defined, so a literal there is the point rather than a leak.
   * `tabBarMaterial.ts` holds two washes that are the palette's own surfaces at
   * 55% over a system blur; they cannot be expressed as a token because the
   * token has no alpha, and `nativePolish.test.ts` already pins them.
   */
  const PALETTE_FILES = ["/design/tokens.ts", "/design/theme.ts", "/design/tabBarMaterial.ts"];

  it("uses no arbitrary hex, white, black or rgba anywhere else", () => {
    const offenders: string[] = [];

    for (const file of [...collectSources(srcDir), ...collectSources(appDir)]) {
      if (PALETTE_FILES.some((allowed) => file.endsWith(allowed))) {
        continue;
      }

      const source = stripComments(readFileSync(file, "utf8"));

      for (const match of source.matchAll(
        /#[0-9a-fA-F]{3,8}\b|\brgba?\(|["'](white|black)["']/g
      )) {
        offenders.push(`${file.replace(srcDir, "src")} → ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the tab bar's washes equal to the palette's own surfaces", () => {
    // The one place an alpha colour is written by hand. It must be the paper
    // and the espresso, never a neutral grey borrowed from another product.
    const light = resolveTabBarMaterial({ reduceTransparency: false, isDark: false });
    const dark = resolveTabBarMaterial({ reduceTransparency: false, isDark: true });

    if (light.kind !== "blur" || dark.kind !== "blur") {
      throw new Error("expected both to be blur materials");
    }

    expect(light.wash).toBe(`rgba(${hexToRgb(lightColors.surface)}, 0.55)`);
    expect(dark.wash).toBe(`rgba(${hexToRgb(darkColors.surface)}, 0.55)`);
  });

  it("resolves every waiting, empty and error surface from the theme", () => {
    // The states a reader meets before content arrives are exactly the ones a
    // screen is most likely to leave uncoloured.
    for (const [file, needle] of [
      [join(srcDir, "components", "Skeleton.tsx"), "c.surfaceMuted"],
      [join(srcDir, "components", "EmptyState.tsx"), "c.backgroundRaised"],
      [join(srcDir, "components", "AppErrorBoundary.tsx"), "c.background"],
      [join(srcDir, "components", "AppScreen.tsx"), "colors.background"],
      [join(srcDir, "features", "modules", "ModuleChrome.tsx"), "backgroundColor: c.background"],
      [join(srcDir, "features", "today", "readers", "ReaderScaffold.tsx"), "c.background"],
      [join(srcDir, "features", "onboarding", "OnboardingScaffold.tsx"), "c.background"]
    ] as const) {
      expect(stripComments(readFileSync(file, "utf8")), file).toContain(needle);
    }
  });

  it("never leaves a whole screen to the navigator's background", () => {
    // The Teams tab did exactly that: its loading, error, gate and content
    // states were all a bare ScrollView. Both of the surfaces a module screen
    // can be built from now paint, so a screen cannot forget.
    const chrome = stripComments(read(srcDir, "features", "modules", "ModuleChrome.tsx"));

    expect(chrome).toMatch(/export function ModuleSurface\(/);
    expect(chrome).toMatch(/<SafeAreaView style=\{\[styles\.surface, style\]\}>/);
    // ModuleScroll is sometimes the entire screen while data is in flight.
    expect(chrome).toMatch(/scrollIndicatorInsets=\{\{ bottom: tabBarInset \}\}\s*\n\s*style=\{styles\.surface\}/);
    expect(chrome).toMatch(/surface: \{\s*\n\s*backgroundColor: c\.background,\s*\n\s*flex: 1\s*\n\s*\}/);
  });

  it("is used by every module tab, Teams included", () => {
    for (const screen of [
      "NewsletterModuleScreen.tsx",
      "StoriesModuleScreen.tsx",
      "MiniCasesModuleScreen.tsx",
      "PathModuleScreen.tsx"
    ]) {
      const source = stripComments(read(srcDir, "features", "modules", screen));

      expect(source, screen).toContain("<ModuleSurface>");
      // The four identical `safeArea` copies this replaced are gone, so there
      // is one place for the module background to be wrong rather than five.
      expect(source, screen).not.toContain("styles.safeArea");
    }

    const teams = stripComments(read(srcDir, "features", "teams", "TeamsLandingScreen.tsx"));

    expect(teams).toContain("<ModuleSurface>");
  });
});

// ---------------------------------------------------------------------------
// 9. Dark mode cannot produce light text on a light fallback
// ---------------------------------------------------------------------------

/** "#RRGGBB" → "r, g, b". */
function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)).join(", ");
}

/** Perceived lightness, 0 (black) to 1 (white). Rec. 601 luma, which is enough
 *  to answer "is this a light surface or a dark one". */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).split(", ").map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

describe("dark mode stays dark, all the way down", () => {
  it("defines every slot in both palettes", () => {
    // A slot missing from one palette resolves to undefined, and an undefined
    // backgroundColor is transparent — which is the white flash again, this
    // time from inside the design system.
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());

    for (const [name, value] of Object.entries(darkColors)) {
      expect(value, name).toBeTruthy();
    }
  });

  it("never hands a navigator a light surface at night", () => {
    // THE ORIGINAL BUG, as an assertion. React Navigation's DefaultTheme
    // background is rgb(242, 242, 242) — luminance ≈ 0.95 — and it was what
    // every dark-mode scene was painted with.
    const night = navigationPaletteFor(darkColors);

    expect(luminance(night.background)).toBeLessThan(0.2);
    expect(luminance(night.card)).toBeLessThan(0.2);
    expect(night.background).toBe(darkColors.background);
    expect(night.card).toBe(darkColors.backgroundRaised);
  });

  it("keeps ink readable on every surface it can land on, in both schemes", () => {
    // The failure this rules out has a name and a direction: pale text on a
    // pale fallback in dark mode, dark text on a dark fallback in light mode.
    // Checked against every surface a navigator or a screen can paint.
    for (const [scheme, palette] of [
      ["light", lightColors],
      ["dark", darkColors]
    ] as const) {
      const nav = navigationPaletteFor(palette);
      const surfaces = [
        palette.background,
        palette.backgroundRaised,
        palette.surface,
        palette.surfaceMuted,
        palette.pressedSurface,
        nav.background,
        nav.card
      ];

      const inks = [palette.ink, palette.inkSoft, palette.muted];

      for (const surface of surfaces) {
        for (const ink of inks) {
          const gap = Math.abs(luminance(surface) - luminance(ink));

          expect(gap, `${scheme}: ${ink} on ${surface}`).toBeGreaterThan(0.25);
        }

        // And the surface is on the right side of the line for its scheme, so
        // no fallback can be a light patch at night or a dark one in daylight.
        if (scheme === "dark") {
          expect(luminance(surface), `dark surface ${surface}`).toBeLessThan(0.35);
        } else {
          expect(luminance(surface), `light surface ${surface}`).toBeGreaterThan(0.65);
        }
      }
    }
  });

  it("maps the navigation palette from tokens and never from literals", () => {
    // 11. No new colour system. Every slot React Navigation owns is one of
    // ours, so there is nothing here to keep in step with the palette.
    for (const palette of [lightColors, darkColors]) {
      const nav = navigationPaletteFor(palette);
      const known = new Set(Object.values(palette));

      for (const [slot, value] of Object.entries(nav)) {
        expect(known.has(value), `${slot} = ${value} is not a palette token`).toBe(true);
      }
    }

    const source = stripComments(read(designDir, "navigationTheme.ts"));

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });

  it("tells the status bar which scheme it is in", () => {
    expect(rootLayout).toContain('barStyle={isDark ? "light-content" : "dark-content"}');
  });
});

// ---------------------------------------------------------------------------
// The launch transition
// ---------------------------------------------------------------------------

describe("the launch screen hands over without a flash", () => {
  const config = JSON.parse(read(appDir, "..", "app.json")) as {
    expo: {
      backgroundColor: string;
      userInterfaceStyle: string;
      splash: { backgroundColor: string; image?: string };
      ios: { splash: { backgroundColor: string; dark: { backgroundColor: string } } };
      android: { splash: { backgroundColor: string; dark: { backgroundColor: string } } };
    };
  };

  it("follows the system scheme rather than forcing one", () => {
    expect(config.expo.userInterfaceStyle).toBe("automatic");
  });

  it("launches on the palette, in both schemes, on both platforms", () => {
    for (const platform of ["ios", "android"] as const) {
      const splash = config.expo[platform].splash;

      expect(splash.backgroundColor, platform).toBe(lightColors.background);
      expect(splash.dark.backgroundColor, platform).toBe(darkColors.background);
    }

    expect(config.expo.splash.backgroundColor).toBe(lightColors.background);
    expect(config.expo.backgroundColor).toBe(lightColors.background);
  });

  it("shows no artwork that is not the app's own paper", () => {
    // The stock splash was a cold blue-grey full-bleed image with a blue mark
    // on it — a colour that appears nowhere in either palette, shown full
    // screen, immediately before a warm paper (or espresso) app. Removing it
    // makes the launch a single field of the same colour the first screen is.
    expect(config.expo.splash.image).toBeUndefined();
  });

  it("puts the same palette behind the first screen the app draws", () => {
    // AppLaunchScreen is what replaces the splash, and it paints nothing of its
    // own: it is an AppScreen, which is the palette's background.
    const launch = stripComments(read(srcDir, "features", "auth", "AppLaunchScreen.tsx"));

    expect(launch).toContain("<AppScreen centered scroll={false}>");
    expect(launch).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });
});
