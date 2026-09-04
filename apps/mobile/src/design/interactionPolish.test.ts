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

const { tokens } = await import("./tokens");
const { darkColors, lightColors } = await import("./theme");

/**
 * The interaction pass, pinned.
 *
 * Touch feedback used to be decided per screen: four different pressed
 * opacities (0.5 / 0.6 / 0.7 / 0.72) that faded the headline along with the
 * paper, so a card being pressed looked like a card being disabled. These tests
 * keep the single answer in place, and keep the motion restrained enough to
 * stay in the product's register.
 */

const srcDir = join(__dirname, "..");

/** Source with comments stripped, so prose about opacity is not a finding. */
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

    if (entry.endsWith(".tsx") && !entry.includes(".test.")) {
      found.push(full);
    }
  }

  return found;
}

describe("one press vocabulary", () => {
  it("dims no surface as its pressed state", () => {
    // The whole point: a press tints the paper, it never fades the ink.
    const offenders: string[] = [];

    for (const file of collectSources(srcDir)) {
      const source = stripComments(readFileSync(file, "utf8"));

      for (const match of source.matchAll(/(\w*[Pp]ressed\w*)\s*:\s*\{([^}]*)\}/g)) {
        if (/opacity\s*:/.test(match[2] ?? "")) {
          offenders.push(`${file.replace(srcDir, "")} → ${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("gives a pressed surface a real colour in both themes", () => {
    expect(lightColors.pressedSurface).toBeTruthy();
    expect(darkColors.pressedSurface).toBeTruthy();
    // Light darkens, dark lifts: neither may simply reuse the resting surface,
    // or the press would be invisible.
    expect(lightColors.pressedSurface).not.toBe(lightColors.surface);
    expect(darkColors.pressedSurface).not.toBe(darkColors.surface);
  });

  it("keeps the compression subtle enough to read as paper", () => {
    // Deep enough to feel, shallow enough that a full-width card does not lurch.
    expect(tokens.press.cardScale).toBeGreaterThanOrEqual(0.985);
    expect(tokens.press.cardScale).toBeLessThan(1);
    // Small controls answer with the tint alone.
    expect(tokens.press.controlScale).toBe(1);
  });
});

describe("motion stays restrained", () => {
  it("settles without a bounce", () => {
    const { damping, mass, stiffness } = tokens.motion.pressSpring;
    // Damping ratio ≥ 1 is critically damped: it reaches rest and stops. Below
    // 1 it would overshoot, which is the bounce this product does not want on
    // a press that carried no momentum.
    const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));

    expect(dampingRatio).toBeGreaterThanOrEqual(0.99);
  });

  it("reveals content in a single perceptible beat", () => {
    expect(tokens.motion.contentRevealMs).toBeGreaterThanOrEqual(160);
    expect(tokens.motion.contentRevealMs).toBeLessThanOrEqual(200);
  });

  it("routes every animation through the native driver", () => {
    const animated: string[] = [];

    for (const file of collectSources(srcDir)) {
      const source = stripComments(readFileSync(file, "utf8"));

      if (/Animated\.(spring|timing)\(/.test(source)) {
        animated.push(file);
        expect(source, file).toContain("useNativeDriver: true");
        expect(source, file).not.toContain("useNativeDriver: false");
      }
    }

    // If this ever finds nothing, the guard above has quietly stopped guarding.
    expect(animated.length).toBeGreaterThan(0);
  });

  it("gives every animated component a reduced-motion path", () => {
    for (const file of collectSources(srcDir)) {
      const source = stripComments(readFileSync(file, "utf8"));

      if (/Animated\.(spring|timing)\(/.test(source)) {
        expect(source, `${file} animates without consulting Reduce Motion`).toContain(
          "useReducedMotion"
        );
      }
    }
  });
});

describe("no native dependency was smuggled in", () => {
  it("keeps the mobile package free of animation, gesture, haptic and blur modules", () => {
    const manifest = JSON.parse(
      readFileSync(join(srcDir, "..", "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    const installed = Object.keys(manifest.dependencies);

    for (const forbidden of [
      "react-native-reanimated",
      "react-native-gesture-handler",
      "expo-haptics",
      "expo-blur"
    ]) {
      expect(installed).not.toContain(forbidden);
    }
  });
});
