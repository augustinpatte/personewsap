import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { landingCopy, TOPIC_IDS } from "../landing/copy";

/**
 * The public home page presents PersoNewsAP as a mobile app that is not out
 * yet. These checks keep it honest: both languages complete, no invented store
 * link or download promise, and the product described as it is actually built.
 */

const srcDir = join(__dirname, "..");
const rootDir = join(srcDir, "..");

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourcesUnder(path) : path.endsWith(".tsx") || path.endsWith(".ts") ? [path] : [];
  });
}

const landingSources = [
  ...sourcesUnder(join(srcDir, "components", "landing")),
  ...sourcesUnder(join(srcDir, "landing")),
  join(srcDir, "pages", "Landing.tsx"),
].map((path) => readFileSync(path, "utf8"));

function shapeOf(value: unknown, path = ""): string[] {
  if (typeof value !== "object" || value === null) return [path];
  if (Array.isArray(value)) return value.flatMap((item, i) => shapeOf(item, `${path}[${i}]`));
  return Object.entries(value).flatMap(([key, child]) => shapeOf(child, path ? `${path}.${key}` : key));
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  // Copy functions take a count, a total or a score; "2" works as each.
  if (typeof value === "function") return [String((value as (...args: unknown[]) => string)("2", 3))];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(stringsOf);
}

describe("routing", () => {
  const appSource = readFileSync(join(srcDir, "App.tsx"), "utf8");

  it("serves the landing page at /", () => {
    expect(appSource).toMatch(/path="\/" element={<Landing \/>}/);
  });

  it("keeps the former sign-up wizard reachable, off the home page", () => {
    expect(appSource).toMatch(/path="\/newsletter" element={<Index \/>}/);
  });
});

describe("bilingual parity", () => {
  it("FR and EN have exactly the same structure, list lengths included", () => {
    expect(shapeOf(landingCopy.fr).sort()).toEqual(shapeOf(landingCopy.en).sort());
  });

  it("has no empty string in either language", () => {
    for (const language of ["en", "fr"] as const) {
      for (const text of stringsOf(landingCopy[language])) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("is actually translated, not copied", () => {
    const en = landingCopy.en;
    const fr = landingCopy.fr;
    for (const [a, b] of [
      [en.hero.titleLead, fr.hero.titleLead],
      [en.hero.lede, fr.hero.lede],
      [en.product.title, fr.product.title],
      [en.howItWorks.lede, fr.howItWorks.lede],
      [en.topics.title, fr.topics.title],
      [en.personalization.title, fr.personalization.title],
      [en.engage.title, fr.engage.title],
      [en.mission.paragraphs[0], fr.mission.paragraphs[0]],
      [en.download.title, fr.download.title],
      [en.footer.tagline, fr.footer.tagline],
    ]) {
      expect(a).not.toBe(b);
    }
  });

  it("names every product topic in both languages", () => {
    for (const language of ["en", "fr"] as const) {
      expect(Object.keys(landingCopy[language].topics.list).sort()).toEqual([...TOPIC_IDS].sort());
    }
  });
});

describe("coming soon, never available", () => {
  it("links to no store and no TestFlight build", () => {
    for (const source of landingSources) {
      expect(source).not.toMatch(/apps\.apple\.com|play\.google\.com|testflight\.apple\.com|itms-apps:|market:\/\//i);
    }
  });

  it("promises no download", () => {
    for (const language of ["en", "fr"] as const) {
      const text = stringsOf(landingCopy[language]).join(" ").toLowerCase();
      for (const phrase of ["download now", "get the app", "available now", "télécharger maintenant", "disponible maintenant", "téléchargez"]) {
        expect(text).not.toContain(phrase);
      }
    }
    expect(landingCopy.en.download.note.toLowerCase()).toContain("not available to download yet");
    expect(landingCopy.fr.download.note.toLowerCase()).toContain("pas encore téléchargeables");
  });

  it("says coming soon for both platforms in both languages", () => {
    expect(landingCopy.en.hero.availability).toMatch(/coming soon on iphone and android/i);
    expect(landingCopy.fr.hero.availability).toMatch(/bientôt sur iphone et android/i);
  });
});

describe("the page describes the product as built", () => {
  it("states the real cadence, not a daily one", () => {
    expect(landingCopy.en.howItWorks.weekTitle).toBe("Four editions a week");
    expect(landingCopy.fr.howItWorks.weekTitle).toBe("Quatre éditions par semaine");
    for (const language of ["en", "fr"] as const) {
      const text = stringsOf(landingCopy[language]).join(" ").toLowerCase();
      for (const stale of ["every day", "daily drop", "chaque jour", "tous les jours", "newsletter quotidienne"]) {
        expect(text).not.toContain(stale);
      }
    }
  });

  it("uses the app's own tab names", () => {
    expect(Object.values(landingCopy.en.app.tabs)).toEqual(["Newsletter", "Mini cases", "Stories", "Path", "Teams"]);
    expect(Object.values(landingCopy.fr.app.tabs)).toEqual(["Newsletter", "Mini cas", "Stories", "Parcours", "Teams"]);
  });

  it("uses the app's real scoring scale", () => {
    expect(landingCopy.en.engage.scoring.tiers.map((tier) => tier.value)).toEqual(["1", "0.6", "0.3", "0"]);
    expect(landingCopy.fr.engage.scoring.tiers.map((tier) => tier.value)).toEqual(["1", "0,6", "0,3", "0"]);
  });

  it("labels every demo value as an example", () => {
    for (const language of ["en", "fr"] as const) {
      const copy = landingCopy[language];
      for (const caption of [copy.illustrative, copy.howItWorks.weekNote, copy.personalization.note, copy.engage.teams.caption, copy.topics.previewHint]) {
        expect(caption.toLowerCase()).toMatch(/example|exemple/);
      }
    }
  });

  it("carries no testimonial, rating or user count", () => {
    for (const language of ["en", "fr"] as const) {
      const text = stringsOf(landingCopy[language]).join(" ").toLowerCase();
      for (const claim of ["users", "utilisateurs", "rated", "★", "testimonial", "trusted by", "as seen in"]) {
        expect(text).not.toContain(claim);
      }
    }
  });
});

describe("metadata", () => {
  const html = readFileSync(join(rootDir, "index.html"), "utf8");

  it("describes the app, not a newsletter", () => {
    expect(html).not.toMatch(/content="PersoNewsAP newsletter"/);
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/personewsap\.com\/og-image\.png"/);
  });

  it("does not hard-code a site-wide canonical", () => {
    // CanonicalLink sets one per route; a static one would point /privacy at /.
    expect(html).not.toMatch(/rel="canonical"/);
  });

  it("ships the assets it references", () => {
    for (const file of ["og-image.png", "favicon.ico", "favicon.png", "apple-touch-icon.png", "site.webmanifest", "app-icon-128.png", "app-icon-256.png"]) {
      expect(statSync(join(rootDir, "public", file)).size).toBeGreaterThan(0);
    }
  });

  it("keeps the logo the newsletter emails load", () => {
    expect(statSync(join(rootDir, "public", "logo-white.png")).size).toBeGreaterThan(0);
  });
});
