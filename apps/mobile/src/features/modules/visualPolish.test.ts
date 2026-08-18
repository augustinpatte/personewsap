import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getModuleCopy } from "./moduleCopy";

/**
 * The release polish pass, pinned.
 *
 * The four module screens were built from the same generic Card and read too
 * alike. Each now carries its own signature — a masthead, a dossier tab, a
 * decision rail, a session trail — and these tests keep those from being
 * flattened back, and keep the things the product refuses (gamification,
 * infinite feeds, emoji chrome) out.
 */

/** Source with comments removed, for assertions about behaviour not prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const modulesDir = __dirname;
const read = (file: string) => readFileSync(join(modulesDir, file), "utf8");

const newsletter = read("NewsletterModuleScreen.tsx");
const stories = read("StoriesModuleScreen.tsx");
const cases = read("MiniCasesModuleScreen.tsx");
const path = read("PathModuleScreen.tsx");
const archiveList = read("ItemArchiveList.tsx");
const chrome = read("ModuleChrome.tsx");
const emptyState = readFileSync(
  join(modulesDir, "..", "..", "components", "EmptyState.tsx"),
  "utf8"
);
const settings = readFileSync(
  join(modulesDir, "..", "settings", "SettingsScreen.tsx"),
  "utf8"
);
const accountCompatibilityRoute = readFileSync(
  join(modulesDir, "..", "..", "..", "app", "account.tsx"),
  "utf8"
);
const tabs = readFileSync(
  join(modulesDir, "..", "..", "..", "app", "(tabs)", "_layout.tsx"),
  "utf8"
);

describe("tab bar", () => {
  it("gives every destination a sober line icon", () => {
    expect(tabs).toMatch(/@expo\/vector-icons/);
    expect(tabs).toMatch(/Feather/);

    for (const icon of ["file-text", "check-square", "briefcase", "compass", "sliders"]) {
      expect(tabs).toContain(icon);
    }
  });

  it("keeps exactly the five launch tabs", () => {
    expect(tabs.match(/<Tabs\.Screen/g)).toHaveLength(5);

    for (const route of ["newsletter", "cases", "stories", "path", "settings"]) {
      expect(tabs).toMatch(new RegExp(`name="${route}"`));
    }

    expect(tabs).not.toMatch(/name="account"/);
    expect(tabs).toMatch(/settings: "Settings"/);
    expect(tabs).toMatch(/settings: "Réglages"/);
  });

  it("keeps the legacy account route as a settings redirect only", () => {
    expect(accountCompatibilityRoute).toMatch(/Redirect/);
    expect(accountCompatibilityRoute).toMatch(/\/\(tabs\)\/settings/);
  });

  it("keeps the label beside the icon", () => {
    // The icon supports the label; it never replaces it.
    expect(tabs).toMatch(/tabBarLabelStyle/);
    expect(tabs).toMatch(/title: copy\.newsletter/);
  });

  it("uses no emoji anywhere in the chrome", () => {
    for (const source of [tabs, newsletter, stories, cases, path, archiveList]) {
      expect(source).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("each module has its own signature", () => {
  it("carries the tab icon concept into each module header", () => {
    expect(newsletter).toMatch(/iconName="file-text"/);
    expect(cases).toMatch(/iconName="check-square"/);
    expect(stories).toMatch(/iconName="briefcase"/);
    expect(path).toMatch(/iconName="compass"/);
    expect(chrome).toMatch(/IconBadge/);
    expect(chrome).not.toMatch(/\/account/);
  });

  it("adds useful header metadata without inventing data", () => {
    expect(newsletter).toMatch(/copy\.newsletter\.articleCount/);
    expect(cases).toMatch(/miniCase\.questions\?\.length/);
    expect(stories).toMatch(/story\.story_date/);
    expect(path).toMatch(/sessionsCompletedCount/);
  });

  it("newsletter reads as a front page", () => {
    expect(newsletter).toMatch(/styles\.masthead/);
    expect(newsletter).toMatch(/EditorialRule/);
    // The lead keeps the display face; the secondaries do not.
    expect(newsletter).toMatch(/style=\{styles\.leadHeadline\} variant="display"/);
    expect(newsletter).toMatch(/styles\.alsoHeadline/);
  });

  it("a business story reads as a dossier", () => {
    expect(stories).toMatch(/dossierTab/);
    expect(stories).toMatch(/dossierRule/);
    // The monogram stays: it is the story's identity.
    expect(stories).toMatch(/<Monogram label=\{story\.company_or_market\}/);
  });

  it("a mini case announces a decision", () => {
    expect(cases).toMatch(/decisionRail/);
    expect(cases).toMatch(/difficultyChip/);
    expect(cases).toMatch(/copy\.cases\.decision/);
    // A solved case shows what it scored, not just that it is done.
    expect(cases).toMatch(/copy\.cases\.score\(/);
  });

  it("the path shows progression without gamifying it", () => {
    expect(path).toMatch(/SessionTrail/);
    expect(path).toMatch(/trailMarkDone/);

    // Checked against the code, not the prose: the comments deliberately name
    // the mechanics the screen refuses.
    const code = stripComments(path);

    for (const forbidden of [/streak/i, /\bxp\b/i, /leaderboard/i, /dailyGoal/i, /rewardBadge/i]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it("the archive keeps date, title and meta in that order", () => {
    expect(archiveList.indexOf("formatDropDate")).toBeLessThan(
      archiveList.indexOf("styles.rowTitle")
    );
    expect(archiveList.indexOf("styles.rowTitle")).toBeLessThan(
      archiveList.indexOf("styles.rowMeta")
    );
  });
});

describe("nothing loads by scrolling", () => {
  it.each([
    ["newsletter", newsletter],
    ["stories", stories],
    ["mini cases", cases],
    ["archive list", archiveList]
  ])("%s has no infinite feed", (_name, source) => {
    expect(source).not.toMatch(/onEndReached/);
    expect(source).not.toMatch(/onScrollEndDrag[\s\S]{0,80}load/i);
  });
});

describe("accessibility", () => {
  it("hides decorative marks from screen readers", () => {
    // Rules, monograms and trail marks carry no information a reader needs.
    expect(chrome).toMatch(/accessibilityElementsHidden/);
    expect(path).toMatch(/accessibilityElementsHidden/);
  });

  it("announces a metadata line as one phrase", () => {
    expect(chrome).toMatch(/accessibilityLabel=\{parts\.join\(", "\)\}/);
  });

  it("keeps tappable rows at a usable size", () => {
    for (const source of [archiveList, newsletter]) {
      expect(source).toMatch(/minHeight: 44/);
    }
  });

  it("gives empty states a non-emoji visual anchor", () => {
    expect(emptyState).toMatch(/iconName/);
    for (const source of [newsletter, path, archiveList]) {
      expect(source).toMatch(/iconName=/);
    }
  });

  it("never fixes the height of a text container", () => {
    for (const source of [newsletter, stories, cases, path, archiveList]) {
      const fixedHeights = source.match(/height: (\d+)/g) ?? [];

      for (const declaration of fixedHeights) {
        const value = Number(declaration.replace(/\D/g, ""));

        // Anything taller than a rule or a dot would clip text at large Dynamic
        // Type sizes; the only exceptions are the fixed-size marks themselves.
        expect(value).toBeLessThanOrEqual(44);
      }
    }
  });

  it("respects Reduce Motion wherever something animates", () => {
    const reader = readFileSync(
      join(modulesDir, "..", "today", "readers", "MiniCaseReader.tsx"),
      "utf8"
    );

    expect(reader).toMatch(/useReducedMotion/);
    expect(reader).toMatch(/if \(reduceMotion\)/);
  });
});

describe("settings presentation", () => {
  it("organizes account settings into product sections", () => {
    for (const key of [
      "contentTitle",
      "appTitle",
      "accountTitle",
      "sessionTitle",
      "dangerTitle"
    ]) {
      expect(settings).toContain(key);
    }

    expect(settings).toMatch(/SettingsSection/);
    expect(settings).toMatch(/IconBadge/);
  });

  it("keeps logout visible on the account screen", () => {
    expect(settings).toMatch(/testID="account-logout-button"/);
    expect(settings).toMatch(/copy\.sessionTitle/);
    expect(settings.indexOf("account-logout-button")).toBeLessThan(
      settings.indexOf("copy.dangerTitle")
    );
  });

  it("does not hide delete account inside the session section", () => {
    expect(settings).toMatch(/copy\.dangerTitle/);
    expect(settings).toMatch(/copy\.deleteAccountDescription/);
  });
});

describe("new copy exists in both languages", () => {
  it("keeps FR and EN in step", () => {
    const shapeOf = (value: unknown, path = ""): string[] =>
      typeof value !== "object" || value === null
        ? [path]
        : Object.entries(value).flatMap(([key, child]) =>
            shapeOf(child, path ? `${path}.${key}` : key)
          );

    expect(shapeOf(getModuleCopy("fr")).sort()).toEqual(shapeOf(getModuleCopy("en")).sort());
  });

  it.each(["noneInLoadedTitle", "noneInLoadedBody", "seeEarlierEditions"] as const)(
    "%s is translated, not duplicated",
    (key) => {
      expect(getModuleCopy("fr").common[key]).not.toBe(getModuleCopy("en").common[key]);
      expect(getModuleCopy("fr").common[key].length).toBeGreaterThan(3);
    }
  );
});
