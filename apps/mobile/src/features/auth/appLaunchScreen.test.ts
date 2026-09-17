import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getLaunchCopy } from "./launchCopy";

/**
 * The launch state that replaced the "Loading your session" card.
 *
 * Two things are being protected here. The copy contract — a French account
 * never hears an English line and vice versa — and the implementation
 * constraints the screen was built under: no image asset for the placeholder
 * mark, no new animation dependency, and no artificial delay to show branding
 * off.
 *
 * Since the branding pass the screen is the "PN" monogram alone. The word mark,
 * the tagline and the slogan are gone on purpose: the name is already on the
 * icon the reader just tapped, and the only text left is the spinner's
 * accessibility label, which is announced rather than drawn.
 */

const read = (...segments: string[]) => readFileSync(join(__dirname, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const launchScreenCode = stripComments(read("AppLaunchScreen.tsx"));
const launchCopy = stripComments(read("launchCopy.ts"));
const brandMark = stripComments(read("..", "..", "components", "TemporaryBrandMark.tsx"));
const authRedirect = stripComments(read("AuthRedirect.tsx"));

describe("startup copy", () => {
  it("speaks to a known French reader in French, and only in French", () => {
    const copy = getLaunchCopy("fr");

    expect(copy).not.toBeNull();
    expect(copy?.loadingAccessibilityLabel).toBe("Chargement de PersoNewsAP");
    expect(copy?.loadingAccessibilityLabel).not.toContain("Loading");
  });

  it("speaks to a known English reader in English, and only in English", () => {
    const copy = getLaunchCopy("en");

    expect(copy?.loadingAccessibilityLabel).toBe("Loading PersoNewsAP");
    expect(copy?.loadingAccessibilityLabel).not.toContain("Chargement");
  });

  it("says nothing language-specific while the language is unknown", () => {
    // The bug this whole screen exists to fix: an unresolved profile used to
    // fall through to English. An unlabelled spinner is better than one
    // labelled in the wrong language.
    expect(getLaunchCopy(null)).toBeNull();
    expect(getLaunchCopy(undefined)).toBeNull();
  });

  it("carries nothing the screen would have to draw", () => {
    // The screen renders the mark alone, so the copy table holds one spoken
    // label and no headline, tagline or slogan to put under it.
    for (const language of ["en", "fr"] as const) {
      expect(Object.keys(getLaunchCopy(language) ?? {})).toEqual(["loadingAccessibilityLabel"]);
    }
  });

  it("makes no absolute claim about the content", () => {
    for (const language of ["en", "fr"] as const) {
      const rendered = JSON.stringify(getLaunchCopy(language));

      for (const claim of ["fake news", "fausses nouvelles", "verified", "vérifié"]) {
        expect(rendered.toLowerCase()).not.toContain(claim.toLowerCase());
      }
    }
  });
});

describe("the launch screen implementation", () => {
  it("resolves the language through the boot-language chain, not a default", () => {
    expect(launchScreenCode).toContain("useBootLanguage");
    expect(launchCopy).toContain("localizedOrNull");
    // `localized` would resolve an unknown language to English again.
    expect(launchCopy).not.toMatch(/\blocalized\(/);
  });

  it("never inlines a language ternary for startup copy", () => {
    for (const source of [launchScreenCode, launchCopy, authRedirect]) {
      expect(source).not.toMatch(/language\s*===\s*["']fr["']\s*\?/);
    }
  });

  it("draws the placeholder mark from type and views, with no image", () => {
    for (const [name, source] of [
      ["launch screen", launchScreenCode],
      ["brand mark", brandMark]
    ] as const) {
      expect(source, name).not.toMatch(/\bImage\b/);
      expect(source, name).not.toMatch(/require\(/);
      expect(source, name).not.toMatch(/\.(png|jpe?g|webp|svg)/i);
    }

    expect(brandMark).toContain("PN");
  });

  it("keeps the placeholder branding in one replaceable file", () => {
    // Swapping in the real logo has to be one local change, so nothing else may
    // draw the mark itself.
    expect(launchScreenCode).toContain("TemporaryBrandMark");
    expect(launchScreenCode).not.toMatch(/["'>]PN["'<]/);
  });

  it("shows the mark and nothing else: no word mark, no tagline, no slogan", () => {
    // The screen renders no text of its own at all — the only <AppText> it used
    // to hold was the word mark under the monogram.
    expect(launchScreenCode).not.toContain("AppText");
    expect(launchScreenCode).not.toContain("BRAND_NAME");
    expect(launchScreenCode).not.toMatch(/tagline|slogan/i);
    // And no brand word is written into the screen itself.
    expect(launchScreenCode).not.toMatch(/PersoNews/);
  });

  it("adds no animation dependency for a screen that is unmounted at once", () => {
    expect(launchScreenCode).not.toMatch(/Animated\./);
    expect(launchScreenCode).not.toMatch(/reanimated|lottie|moti/i);
  });

  it("never holds the app back to show branding", () => {
    // No timer of any kind: the screen is unmounted the frame auth resolves.
    expect(launchScreenCode).not.toMatch(/setTimeout|setInterval|delay/i);
  });
});

describe("every startup surface", () => {
  it("routes through the one launch screen", () => {
    const layouts = [
      join("..", "..", "..", "app", "_layout.tsx"),
      join("..", "..", "..", "app", "(tabs)", "_layout.tsx"),
      join("..", "..", "..", "app", "(auth)", "_layout.tsx"),
      join("..", "..", "..", "app", "(onboarding)", "_layout.tsx"),
      join("..", "..", "..", "app", "(learning)", "_layout.tsx")
    ];

    for (const layout of layouts) {
      const source = stripComments(read(layout));

      // Either it renders the shared launch screen or it has no loading branch
      // of its own — never a second, differently-worded one.
      if (source.includes('status === "loading"')) {
        expect(source, layout).toContain("<AppLaunchScreen");
      }

      expect(source, layout).not.toMatch(/Loading your session/);
      expect(source, layout).not.toMatch(/Chargement de ta session/);
    }
  });

  it("has removed the English-only loading card entirely", () => {
    // The strings themselves, not the prose explaining why they went.
    expect(launchScreenCode).not.toContain("Loading your session");
    expect(launchCopy).not.toContain("Loading your session");
    expect(authRedirect).not.toContain("Loading your session");
  });
});
