import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const preferenceSource = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "notifications", "pushNotificationPreferences.ts"),
  "utf8"
);
const authProviderSource = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "auth", "AuthProvider.tsx"),
  "utf8"
);
const rootLayoutSource = readFileSync(
  join(repoRoot, "apps", "mobile", "app", "_layout.tsx"),
  "utf8"
);
const accountSource = readFileSync(join(repoRoot, "apps", "mobile", "app", "account.tsx"), "utf8");
const supportSource = readFileSync(join(repoRoot, "apps", "mobile", "app", "support.tsx"), "utf8");
const tokenRefreshSource = readFileSync(
  join(repoRoot, "apps", "mobile", "src", "features", "notifications", "usePushTokenRefresh.ts"),
  "utf8"
);

describe("production notification registration", () => {
  it("creates the Android channel before requesting an Expo push token", () => {
    const channelIndex = preferenceSource.indexOf("await ensureAndroidNotificationChannel()");
    const tokenIndex = preferenceSource.indexOf("getExpoPushTokenAsync");

    expect(channelIndex).toBeGreaterThan(-1);
    expect(tokenIndex).toBeGreaterThan(-1);
    expect(channelIndex).toBeLessThan(tokenIndex);
    expect(preferenceSource).toMatch(/AndroidImportance\.LOW/);
  });

  it("persists notification preference and token state without logging secrets", () => {
    expect(preferenceSource).toMatch(/from\("user_preferences"\)\.upsert/);
    expect(preferenceSource).toMatch(/notifications_enabled/);
    expect(preferenceSource).toMatch(/from\("push_tokens"\)\.upsert/);
    expect(preferenceSource).not.toMatch(/console\.(info|log)\([^)]*expoPushToken/);
  });

  it("re-registers an enabled account on login and listens for token refreshes", () => {
    expect(tokenRefreshSource).toMatch(/registerCurrentDeviceForEnabledNotifications/);
    expect(tokenRefreshSource).toMatch(/addPushTokenListener/);
    expect(preferenceSource).toMatch(/notificationsEnabled/);
  });
});

describe("logout and account switching hygiene", () => {
  it("disables stored push tokens before Supabase sign out", () => {
    const cleanupIndex = authProviderSource.indexOf("disablePushNotificationsForUser");
    const signOutIndex = authProviderSource.indexOf("signOutFromSupabase()");

    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(signOutIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(signOutIndex);
  });

  it("keys user-scoped providers by the authenticated account", () => {
    expect(rootLayoutSource).toMatch(/accountScopeKey = user\?\.id \?\? "signed-out"/);
    expect(rootLayoutSource).toMatch(/key=\{`learning-\$\{accountScopeKey\}`\}/);
    expect(rootLayoutSource).toMatch(/key=\{`daily-drop-\$\{accountScopeKey\}`\}/);
  });
});

describe("Apple-ready account copy", () => {
  it("keeps clear FR/EN entries for support, deletion and logout", () => {
    for (const source of [accountSource, supportSource]) {
      expect(source).toMatch(/Support/);
    }

    expect(accountSource).toMatch(/Delete account/);
    expect(accountSource).toMatch(/Supprimer le compte/);
    expect(accountSource).toMatch(/Log out/);
    expect(accountSource).toMatch(/Se déconnecter/);
    expect(supportSource).toMatch(/Email support/);
    expect(supportSource).toMatch(/Contacter le support/);
  });
});
