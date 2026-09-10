import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * How the banner is wired, pinned by reading the source: the pieces that
 * cannot run under vitest (React Native views, the router, AppState) must still
 * say the things the product depends on.
 */

const mobileRoot = join(__dirname, "..", "..", "..");
const read = (...segments: string[]) => readFileSync(join(mobileRoot, ...segments), "utf8");

const tabsLayout = read("app", "(tabs)", "_layout.tsx");
const rootLayout = read("app", "_layout.tsx");
const banner = read("src", "features", "notifications", "NotificationDisabledBanner.tsx");
const bannerHook = read("src", "features", "notifications", "useNotificationDisabledBanner.ts");
const settings = read("src", "features", "settings", "SettingsScreen.tsx");
const card = read("src", "features", "notifications", "NotificationPreferencesCard.tsx");
const preferences = read("src", "features", "notifications", "pushNotificationPreferences.ts");
const tokenRefresh = read("src", "features", "notifications", "usePushTokenRefresh.ts");

describe("the disabled-notifications banner", () => {
  it("lives in the authenticated tabs, over the screens rather than in their layout", () => {
    expect(tabsLayout).toContain("<NotificationDisabledBanner />");
    expect(banner).toMatch(/position: "absolute"/);
    expect(banner).toContain('pointerEvents="box-none"');
  });

  it("respects the safe area", () => {
    expect(banner).toContain("useSafeAreaInsets");
    expect(banner).toMatch(/top: insets\.top/);
  });

  it("is a tappable banner and never a modal", () => {
    expect(banner).not.toMatch(/\bModal\b/);
    expect(banner).toContain("<Pressable");
    expect(banner).toContain("onPress={open}");
    expect(banner).toContain('accessibilityRole="button"');
  });

  it("says it in both languages", () => {
    expect(banner).toContain("Notifications are off — don't miss today's session with your friends.");
    expect(banner).toContain(
      "Notifications désactivées — ne manquez pas la session du jour avec vos amis."
    );
    expect(banner).toContain("Activez-les pour profiter pleinement de PersoNews.");
  });

  it("routes to the existing Settings screen and changes no setting on the way", () => {
    expect(bannerHook).toContain("router.push(NOTIFICATION_SETTINGS_TARGET");
    for (const write of ["saveNotificationPreferences", "upsert", ".update(", "requestPermissionsAsync"]) {
      expect(bannerHook, write).not.toContain(write);
      expect(banner, write).not.toContain(write);
    }
  });

  it("waits for the launch registration before judging", () => {
    expect(bannerHook).toContain("await waitForStartupRegistration()");
    expect(tokenRefresh).toContain("trackStartupRegistration(registration)");
  });
});

describe("the Notifications section it opens", () => {
  it("is part of the one Settings screen, reached by a section parameter", () => {
    expect(settings).toContain("useLocalSearchParams<{ section?: string }>()");
    expect(settings).toContain("requestedSection !== NOTIFICATION_SETTINGS_SECTION");
    expect(settings).toContain("scrollRef.current?.scrollTo(");
    expect(settings).toContain('testID="settings-notifications-section"');
    expect(settings).toContain("<NotificationPreferencesCard");
  });

  it("offers this app's iOS Settings page when the system refused", () => {
    expect(card).toContain("decideNotificationSettingsAction");
    expect(card).toContain('action === "open_system_settings"');
    expect(card).toContain("Linking.openSettings()");
  });

  it("only ever asks iOS through the guard", () => {
    const guard = preferences.indexOf("shouldRequestSystemPermission({");
    const request = preferences.indexOf("Notifications.requestPermissionsAsync()");

    expect(guard).toBeGreaterThan(-1);
    expect(request).toBeGreaterThan(guard);
    expect(preferences.match(/requestPermissionsAsync/g)).toHaveLength(1);
  });
});

describe("the timezone the server notifies in", () => {
  const timezoneSync = read("src", "features", "notifications", "useProfileTimezoneSync.ts");
  const deviceTimeZone = read("src", "features", "notifications", "deviceTimeZone.ts");
  const packageJson = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };

  it("is kept on the device's zone from the root of the app", () => {
    expect(rootLayout).toContain("useProfileTimezoneSync();");
  });

  it("is re-read from the OS on every return to the foreground", () => {
    expect(timezoneSync).toContain("readCurrentDeviceTimeZone()");
    expect(timezoneSync).toMatch(/if \(next === "active"\) \{\s*sync\(\);/);
    expect(timezoneSync).not.toContain("getDeviceTimeZone");
    expect(deviceTimeZone).toContain('from "expo-localization"');
    expect(deviceTimeZone).toContain("getCalendars()[0]?.timeZone");
    expect(packageJson.dependencies["expo-localization"]).toMatch(/^~55\./);
  });
});
