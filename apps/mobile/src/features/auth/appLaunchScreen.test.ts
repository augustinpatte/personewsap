import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_NAME, getLaunchCopy } from "./launchCopy";

/**
 * The branded launch state that replaced the "Loading your session" card.
 *
 * Two things are being protected here. The copy contract — a French account
 * never reads an English line and vice versa — and the implementation
 * constraints the launch screen was built under: no image asset for the
 * placeholder logo, no new animation dependency, and no artificial delay to
 * show branding off.
 */

const read = (...segments: string[]) => readFileSync(join(__dirname, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const launchScreenCode = stripComments(read("AppLaunchScreen.tsx"));
const launchCopy = stripComments(read("launchCopy.ts"));
const brandMark = stripComments(read("..", "..", "components", "TemporaryBrandMark.tsx"));
const authRedirect = stripComments(read("AuthRedirect.tsx"));

describe("startup copy", () => {
  it("greets a known French reader in French, and only in French", () => {
    const copy = getLaunchCopy("fr");

    expect(copy).not.toBeNull();
    expect(copy?.tagline).toBe("Application éducative premium");
    expect(copy?.sloganLines).toEqual([
      "Apprenez plus vite.",
      "Lisez plus intelligemment."
    ]);

    const rendered = [copy?.tagline, ...(copy?.sloganLines ?? [])].join(" ");

    for (const englishWord of ["Premium educational", "Learn faster", "Read smarter"]) {
      expect(rendered).not.toContain(englishWord);
    }
  });

  it("greets a known English reader in English, and only in English", () => {
    const copy = getLaunchCopy("en");

    expect(copy?.tagline).toBe("Premium educational app");
    expect(copy?.sloganLines).toEqual(["Learn faster.", "Read smarter."]);

    const rendered = [copy?.tagline, ...(copy?.sloganLines ?? [])].join(" ");

    for (const frenchWord of ["éducative", "Apprenez", "Lisez"]) {
      expect(rendered).not.toContain(frenchWord);
    }
  });

  it("says nothing language-specific while the language is unknown", () => {
    // The bug this whole screen exists to fix: an unresolved profile used to
    // fall through to English. It now renders the brand block alone.
    expect(getLaunchCopy(null)).toBeNull();
    expect(getLaunchCopy(undefined)).toBeNull();
  });

  it("keeps the brand name out of the localized table", () => {
    // "PersoNewsAP" is the same word in both languages, which is what lets the
    // screen show something before it knows who is reading.
    expect(BRAND_NAME).toBe("PersoNewsAP");
    expect(getLaunchCopy("fr")).not.toHaveProperty("brandName");
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

  it("uses the existing reveal rather than a new animation dependency", () => {
    // ContentReveal is opacity-only and already a no-op under Reduce Motion, so
    // the launch screen inherits the motion preference instead of re-deciding it.
    expect(launchScreenCode).toContain("ContentReveal");
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
