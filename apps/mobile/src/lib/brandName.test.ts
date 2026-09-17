import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The product is called PersoNewsAP, and says so everywhere a reader can see.
 *
 * The app shipped as "PersoNews" in a handful of sentences — a settings row, the
 * Teams introduction, the notification copy — while calling itself PersoNewsAP
 * everywhere else. This pins the result of that pass, and the two halves of it
 * that are easy to get wrong later:
 *
 *   * a new sentence written as "PersoNews" (the scan below fails);
 *   * a search-and-replace that also renamed the things a rename would break —
 *     the bundle identifier, the Android package, the Expo slug, the deep-link
 *     scheme, the persisted storage keys.
 *
 * Comments are stripped before scanning: internal prose about "PersoNews the
 * product" is a developer reading a file, not a reader reading a screen. The
 * loading screen's "PN" monogram is deliberate and is pinned as such.
 */

const srcDir = join(__dirname, "..");
const mobileDir = join(srcDir, "..");
const appDir = join(mobileDir, "app");

const config = JSON.parse(readFileSync(join(mobileDir, "app.json"), "utf8")) as {
  expo: {
    name: string;
    slug: string;
    scheme: string;
    ios: { bundleIdentifier: string };
    android: { package: string };
  };
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every shipped source file: tests describe the app, they are not the app. */
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

const shipped = [...collectSources(srcDir), ...collectSources(appDir)];

describe("the product calls itself PersoNewsAP", () => {
  it("finds the files it claims to be checking", () => {
    // A guard on the guard: a broken path would make every scan below pass by
    // reading nothing.
    expect(shipped.length).toBeGreaterThan(100);
  });

  it("never presents itself to a reader as PersoNews", () => {
    const offenders: string[] = [];

    for (const file of shipped) {
      for (const match of stripComments(readFileSync(file, "utf8")).matchAll(/PersoNews(?!AP)/g)) {
        offenders.push(`${file.replace(mobileDir, "")} → ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("spells it one way, never a near miss", () => {
    const offenders: string[] = [];

    for (const file of shipped) {
      const source = stripComments(readFileSync(file, "utf8"));

      // Every near miss that has actually been written somewhere, and none of
      // them may match "PersoNewsAP" itself: lower-case n, all caps, a space in
      // the middle, a trailing "App", or a lower-case p at the end.
      for (const match of source.matchAll(
        /Personews|PERSONEWS|Perso\s+News|PersoNews\s+A[Pp]\b|PersoNews\s*App\b|PersoNewsAp\b/g
      )) {
        offenders.push(`${file.replace(mobileDir, "")} → ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("the launcher name is the product's, the identifiers are not touched", () => {
  it("shows PersoNewsAP under the icon on both platforms", () => {
    // Expo derives the iOS display name and the Android label from this.
    expect(config.expo.name).toBe("PersoNewsAP");
  });

  it("keeps every identifier a rename would break", () => {
    // Lowercase on purpose, and none of it is user-facing: changing any of
    // these orphans an installed app, a deep link or a stored preference.
    expect(config.expo.slug).toBe("personewsap-mobile");
    expect(config.expo.scheme).toBe("personewsap");
    expect(config.expo.ios.bundleIdentifier).toBe("com.personewsap.mobile");
    expect(config.expo.android.package).toBe("com.personewsap.mobile");
  });

  it("leaves persisted storage keys where the reader's data already is", () => {
    // The mini-case key predates the "personewsap:" prefix. Renaming it would
    // silently drop answers a reader already gave.
    expect(readFileSync(join(srcDir, "features", "today", "miniCaseResponses.ts"), "utf8")).toContain(
      '"personews:mini-case-responses:v1"'
    );
    expect(
      readFileSync(join(srcDir, "features", "preferences", "languageChangeNotice.ts"), "utf8")
    ).toContain('"personewsap:language-change-notice:v1"');
  });
});

describe("the surfaces that name the product", () => {
  it("keeps the loading screen on its PN monogram, and on nothing else", () => {
    // The wanted loading state is the monogram alone. The word mark that used
    // to sit under it is gone: the name is on the icon the reader just tapped.
    const mark = readFileSync(join(srcDir, "components", "TemporaryBrandMark.tsx"), "utf8");
    const launch = stripComments(
      readFileSync(join(srcDir, "features", "auth", "AppLaunchScreen.tsx"), "utf8")
    );

    expect(mark).toMatch(/>\s*PN\s*</);
    expect(launch).toContain("<TemporaryBrandMark />");
    expect(launch).not.toMatch(/>\s*PN\s*</);
    // Neither the corrected brand nor the old one is written on that screen.
    expect(launch).not.toMatch(/PersoNewsAP/);
    expect(launch).not.toMatch(/PersoNews/);
    expect(launch).not.toContain("BRAND_NAME");
  });

  it("names the Android notification channel after the product", () => {
    // Visible in the system's own notification settings, so it is a brand
    // surface even though no screen in the app renders it.
    expect(
      readFileSync(join(srcDir, "features", "notifications", "pushNotificationPreferences.ts"), "utf8")
    ).toContain('name: "PersoNewsAP editions"');
  });

  it("says PersoNewsAP in the copy the pass corrected", () => {
    const strings: Array<[string, string]> = [
      [join(srcDir, "features", "settings", "SettingsScreen.tsx"), "How PersoNewsAP scoring works"],
      [
        join(srcDir, "features", "notifications", "NotificationPreferencesCard.tsx"),
        "Notifications are off for PersoNewsAP on this phone"
      ],
      [
        join(srcDir, "features", "notifications", "NotificationDisabledBanner.tsx"),
        "the most out of PersoNewsAP."
      ],
      [join(srcDir, "features", "teams", "teamsIntroCopy.ts"), "Read PersoNewsAP as you always do."]
    ];

    for (const [file, sentence] of strings) {
      expect(readFileSync(file, "utf8"), file).toContain(sentence);
    }
  });
});
