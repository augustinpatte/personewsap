import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const tabs = readFileSync(join(repoRoot, "apps", "mobile", "app", "(tabs)", "_layout.tsx"), "utf8");
const settingsRoute = readFileSync(join(repoRoot, "apps", "mobile", "app", "(tabs)", "settings.tsx"), "utf8");
const accountRoute = readFileSync(join(repoRoot, "apps", "mobile", "app", "account.tsx"), "utf8");
const settingsScreen = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "settings", "SettingsScreen.tsx"),
  "utf8"
);
const preferencesEditor = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "preferences", "PreferencesEditor.tsx"),
  "utf8"
);
const preferencesPersistence = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "preferences", "preferencesPersistence.ts"),
  "utf8"
);
const moduleChrome = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "modules", "ModuleChrome.tsx"),
  "utf8"
);
const newsletter = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "modules", "NewsletterModuleScreen.tsx"),
  "utf8"
);
const stories = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "modules", "StoriesModuleScreen.tsx"),
  "utf8"
);
const cases = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "modules", "MiniCasesModuleScreen.tsx"),
  "utf8"
);
const rootLayout = readFileSync(join(repoRoot, "apps", "mobile", "app", "_layout.tsx"), "utf8");

describe("bottom navigation", () => {
  // Settings was the fifth tab until Teams arrived. Five is the most a bottom
  // bar carries at 10.5pt without the labels becoming unreadable, so one had to
  // go — and between "the private league you check every edition" and "where the
  // language switch lives", the league is the one that belongs one tap away.
  // Settings stayed a route inside the tab group (href: null) so it keeps the
  // bar and its inset, and every module masthead now carries the way to it.
  it("has exactly five stable bottom tabs, ending with Teams", () => {
    // Counted by icon, not by <Tabs.Screen>: the settings route is declared in
    // the same group but has href: null and no icon, so it is a route rather
    // than a sixth destination.
    const visibleTabs = tabs.match(/tabBarIcon:/g) ?? [];

    expect(visibleTabs).toHaveLength(5);
    expect((tabs.match(/<Tabs\.Screen/g) ?? []).length).toBe(6);

    for (const route of ["newsletter", "cases", "stories", "path", "teams"]) {
      expect(tabs).toContain(`name="${route}"`);
    }

    expect(tabs).not.toMatch(/enabledModules|newsletter_enabled|mini_cases_enabled/);
  });

  it("keeps Settings reachable but out of the bar", () => {
    // href: null is what makes it a route rather than a destination.
    expect(tabs).toMatch(/<Tabs\.Screen name="settings" options=\{\{ href: null \}\} \/>/);
    expect(tabs).not.toMatch(/title=\{copy\.settings\}/);
  });

  it("uses the required FR and EN Teams labels", () => {
    // The product's own word in both languages: a French reader says "ma team",
    // and "Équipes" would name something this is not.
    expect(tabs).toMatch(/teams: "Teams"/);
    expect((tabs.match(/teams: "Teams"/g) ?? []).length).toBe(2);
  });

  it("keeps five-tab touch targets readable", () => {
    expect(tabs).toMatch(/minHeight: 44/);
    expect(tabs).toMatch(/fontSize: 10\.5/);
    expect(tabs).toMatch(/letterSpacing: 0/);
  });

  it("uses no emoji in the bar", () => {
    expect(tabs).toMatch(/Feather/);
    expect(tabs).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("keeps the warm translucent material and its opaque fallback", () => {
    // The Apple pass's tab bar, unchanged by the Teams addition.
    expect(tabs).toContain("<TabBarBackground />");
    expect(tabs).toMatch(/backgroundColor: "transparent"/);
  });

  it("gives every module masthead a way back to Settings", () => {
    // It had none while Settings was a tab; it needs one now.
    expect(moduleChrome).toContain("AccountButton");
    expect(moduleChrome).toMatch(/\/\(tabs\)\/settings/);

    for (const source of [newsletter, stories, cases]) {
      expect(source).toContain("accountLabel={copy.common.accountLabel}");
    }
  });

  it("keeps legacy /account safe without duplicating the screen", () => {
    expect(settingsRoute).toMatch(/SettingsScreen/);
    expect(accountRoute).toMatch(/Redirect/);
    expect(accountRoute).toMatch(/\/\(tabs\)\/settings/);
  });
});

describe("Settings information architecture", () => {
  it("exposes content, app, account, session and danger sections", () => {
    for (const key of [
      "contentTitle",
      "appTitle",
      "accountTitle",
      "sessionTitle",
      "dangerTitle"
    ]) {
      expect(settingsScreen).toContain(key);
    }
  });

  it("makes the required account controls discoverable", () => {
    for (const marker of [
      "NotificationPreferencesCard",
      "LearningAccountSection",
      "resetPassword",
      "privacyPolicy",
      "support",
      "exportData",
      "account-logout-button",
      "deleteAccount"
    ]) {
      expect(settingsScreen).toContain(marker);
    }

    expect(settingsScreen.indexOf("account-logout-button")).toBeLessThan(
      settingsScreen.indexOf("copy.dangerTitle")
    );
  });

  it("keeps language in App while content preferences use the canonical editor", () => {
    expect(settingsScreen).toMatch(/languageTitle/);
    expect(settingsScreen).toMatch(/<PreferencesEditor/);
    expect(settingsScreen).toMatch(/showLanguage=\{false\}/);
    expect(settingsScreen).toMatch(/updateProfileLanguage/);
  });
});

describe("editable preference persistence", () => {
  it("uses one canonical preference persistence path", () => {
    expect(settingsScreen).not.toMatch(/from\("user_preferences"\)/);
    expect(settingsScreen).not.toMatch(/from\("user_topic_preferences"\)/);
    expect(settingsScreen).not.toMatch(/from\("user_mini_case_topic_preferences"\)/);
    expect(preferencesEditor).toMatch(/loadEditablePreferences/);
    expect(preferencesEditor).toMatch(/saveEditablePreferences/);

    const preferenceFiles = readdirSync(
      join(repoRoot, "apps", "mobile", "src", "features", "preferences")
    );
    expect(preferenceFiles).not.toContain("settingsPreferences.ts");
  });

  it("loads saved values instead of onboarding defaults", () => {
    expect(preferencesPersistence).toMatch(/from\("user_preferences"\)/);
    expect(preferencesPersistence).toMatch(/from\("user_topic_preferences"\)/);
    expect(preferencesPersistence).toMatch(/from\("user_mini_case_topic_preferences"\)/);
    expect(preferencesPersistence).toMatch(/articles_count/);
  });

  it("blocks invalid Newsletter, Mini Case and zero-module states before save", () => {
    expect(preferencesEditor).toMatch(/draft\.enabledModules\.length === 0/);
    expect(preferencesEditor).toMatch(/draft\.enabledModules\.includes\("newsletter"\) && draft\.selectedTopics\.length === 0/);
    expect(preferencesEditor).toMatch(/draft\.enabledModules\.includes\("mini_case"\) && draft\.miniCaseTopics\.length === 0/);
    expect(preferencesPersistence).toMatch(/missing_modules/);
    expect(preferencesPersistence).toMatch(/missing_topics/);
    expect(preferencesPersistence).toMatch(/missing_mini_case_topics/);
  });

  it("saves future preferences without mutating historical drops", () => {
    expect(preferencesPersistence).toMatch(/from\("user_preferences"\)\.upsert/);
    expect(preferencesPersistence).toMatch(/from\("user_topic_preferences"\)/);
    expect(preferencesPersistence).toMatch(/from\("user_mini_case_topic_preferences"\)/);
    expect(preferencesPersistence).not.toMatch(/from\("daily_drops"\)/);
    expect(preferencesPersistence).not.toMatch(/from\("daily_drop_items"\)/);
    expect(preferencesPersistence).not.toMatch(/from\("content_items"\)/);
  });

  it("keeps account-specific state isolated across logout and account switching", () => {
    expect(rootLayout).toMatch(/accountScopeKey = user\?\.id \?\? "signed-out"/);
    expect(rootLayout).toMatch(/key=\{`learning-\$\{accountScopeKey\}`\}/);
    expect(rootLayout).toMatch(/key=\{`daily-drop-\$\{accountScopeKey\}`\}/);
  });
});

describe("disabled module UX", () => {
  it("keeps tabs stable and shows a Settings action when a module is disabled", () => {
    for (const source of [newsletter, stories, cases]) {
      expect(source).toMatch(/useModulePreferenceState/);
      expect(source).toMatch(/ModuleDisabledState/);
    }

    expect(moduleChrome).toMatch(/ModuleDisabledState/);
    expect(moduleChrome).toMatch(/\/\(tabs\)\/settings/);
    expect(moduleChrome).toMatch(/actionLabel=\{copy\.action\}/);
  });

  it("has FR/EN disabled-module copy", () => {
    expect(moduleChrome).toMatch(/iconName="sliders"/);
    expect(readFileSync(join(repoRoot, "apps", "mobile", "src", "features", "modules", "moduleCopy.ts"), "utf8")).toMatch(/Enable in Settings/);
    expect(readFileSync(join(repoRoot, "apps", "mobile", "src", "features", "modules", "moduleCopy.ts"), "utf8")).toMatch(/Activer dans Réglages/);
  });
});
