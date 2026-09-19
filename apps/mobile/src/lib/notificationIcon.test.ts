import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Android notification small icon.
 *
 * Until build 16 the file the config named was a placeholder: a plain white
 * "+" from the launch-readiness pass, never replaced when the PN identity
 * arrived. Every push on Android showed it in the status bar and the shade.
 *
 * Android draws this icon from its alpha channel alone and paints it in the
 * system colour (or the accent from the config), so it has to be a white
 * silhouette on transparency — the blue launcher tile here would render as a
 * solid white square. It is derived from adaptive-icon.png, the same PN mark
 * the launcher uses, not redrawn.
 *
 * iOS has no small-icon concept: a notification shows the installed app icon,
 * and the expo-notifications plugin ignores `icon` on iOS.
 */

type DecodedPng = { width: number; height: number; data: Buffer };

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as { PNG: { sync: { read: (file: Buffer) => DecodedPng } } };

const mobileDir = join(__dirname, "..", "..");
const repoRoot = join(mobileDir, "..", "..");
const assets = join(mobileDir, "assets");
const rawConfig = readFileSync(join(mobileDir, "app.json"), "utf8");
const expo = (
  JSON.parse(rawConfig) as {
    expo: {
      icon: string;
      ios: { bundleIdentifier: string; icon?: string };
      android: { package: string; adaptiveIcon: Record<string, string> };
      plugins: Array<string | [string, Record<string, unknown>]>;
    };
  }
).expo;

const sha256 = (file: string) => createHash("sha256").update(readFileSync(join(assets, file))).digest("hex");
const notificationsPlugin = expo.plugins.find(
  (plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === "expo-notifications"
);
const NOTIFICATION_ICON = "./assets/notification-icon.png";
const icon = PNG.sync.read(readFileSync(join(assets, "notification-icon.png")));
const alphaAt = (x: number, y: number) => icon.data[(y * icon.width + x) * 4 + 3];

/** The placeholder "+" that shipped through build 15. */
const OLD_PLACEHOLDER_SHA256 = "6d89234900e22313f78e349f2851f87bd8f3bdba07916a2441864a1b0394d4ed";

describe("the launcher icon is not part of this change", () => {
  it("keeps every launcher asset byte for byte", () => {
    expect(sha256("icon.png")).toBe("0fa01485c599265578aa3d6630b9d5666d3118f18cd359a43bc4e0e393ebf031");
    expect(sha256("adaptive-icon.png")).toBe("83489b71639b9806fd4d106487c7da3c6ab4e5f491482f1945b56d71d84b15d9");
    expect(sha256("adaptive-icon-background.png")).toBe(
      "cc6d0a0e05c58b81d7620d0b490127c654b8dbf1fdd632cc56ac3aa60af9b7bf"
    );
  });

  it("keeps the launcher wired where it was", () => {
    expect(expo.icon).toBe("./assets/icon.png");
    expect(expo.android.adaptiveIcon).toEqual({
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundImage: "./assets/adaptive-icon-background.png",
      monochromeImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0A6BE8"
    });
  });

  it("keeps the store identifiers", () => {
    expect(expo.ios.bundleIdentifier).toBe("com.personewsap.mobile");
    expect(expo.android.package).toBe("com.personewsap.mobile");
  });
});

describe("the notification icon file", () => {
  it("exists at the path the config names", () => {
    expect(existsSync(join(assets, "notification-icon.png"))).toBe(true);
  });

  it("is 96×96, the xxxhdpi size the plugin scales every density from", () => {
    expect([icon.width, icon.height]).toEqual([96, 96]);
  });

  it("is no longer the placeholder", () => {
    expect(sha256("notification-icon.png")).not.toBe(OLD_PLACEHOLDER_SHA256);
  });

  it("is white and nothing else: the shape lives in the alpha channel", () => {
    let offenders = 0;

    for (let i = 0; i < icon.data.length; i += 4) {
      const [r, g, b, a] = icon.data.subarray(i, i + 4);
      if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) offenders++;
    }

    expect(offenders).toBe(0);
  });

  it("has a transparent background, not an opaque tile", () => {
    let transparent = 0;

    for (let i = 3; i < icon.data.length; i += 4) {
      if (icon.data[i] === 0) transparent++;
    }

    // A tile would leave nothing transparent; the PN mark leaves over half.
    expect(transparent / (icon.width * icon.height)).toBeGreaterThan(0.4);

    // The outer 2 px ring is empty: Android's 1 dp padding, and no baked square.
    for (let y = 0; y < icon.height; y++) {
      for (let x = 0; x < icon.width; x++) {
        const ring = x < 2 || y < 2 || x >= icon.width - 2 || y >= icon.height - 2;
        if (ring) expect(alphaAt(x, y), `ring ${x},${y}`).toBe(0);
      }
    }
  });

  it("has no fully opaque row or column, which is what any background would leave", () => {
    for (let y = 0; y < icon.height; y++) {
      let row = 0;
      for (let x = 0; x < icon.width; x++) if (alphaAt(x, y) === 255) row++;
      expect(row, `row ${y}`).toBeLessThan(icon.width);
    }

    for (let x = 0; x < icon.width; x++) {
      let column = 0;
      for (let y = 0; y < icon.height; y++) if (alphaAt(x, y) === 255) column++;
      expect(column, `column ${x}`).toBeLessThan(icon.height);
    }
  });

  it("is a solid mark that fills the live area, not a faint or tiny glyph", () => {
    let solid = 0;
    let x0 = icon.width;
    let y0 = icon.height;
    let x1 = -1;
    let y1 = -1;

    for (let y = 0; y < icon.height; y++) {
      for (let x = 0; x < icon.width; x++) {
        const a = alphaAt(x, y);
        if (a === 255) solid++;
        if (a > 0) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }

    // Opaque white body, so the system tint reads at full strength.
    expect(solid / (icon.width * icon.height)).toBeGreaterThan(0.2);
    // Spans the 88 px live area (96 minus 4 px padding each side).
    expect(x1 - x0 + 1).toBeGreaterThanOrEqual(84);
    expect(y1 - y0 + 1).toBeGreaterThanOrEqual(84);
  });
});

describe("the expo-notifications config", () => {
  it("points Android at the notification icon, never at the launcher artwork", () => {
    expect(notificationsPlugin?.[1].icon).toBe(NOTIFICATION_ICON);
    expect(notificationsPlugin?.[1].icon).not.toBe(expo.icon);
    expect(notificationsPlugin?.[1].icon).not.toBe(expo.android.adaptiveIcon.foregroundImage);
  });

  it("keeps the accent colour: the app's own accent token", () => {
    expect(notificationsPlugin?.[1].color).toBe("#0F5B5F");
    expect(readFileSync(join(mobileDir, "src", "design", "tokens.ts"), "utf8")).toContain('accent: "#0F5B5F"');
  });

  it("uses only keys the installed plugin reads", () => {
    for (const key of Object.keys(notificationsPlugin?.[1] ?? {})) {
      expect(["icon", "color", "defaultChannel", "sounds", "enableBackgroundRemoteNotifications"]).toContain(key);
    }
  });

  it("names no absolute or machine-local path", () => {
    expect(rawConfig).not.toMatch(/\/Users\/|Downloads|file:\/\/|[A-Z]:\\\\/);
    expect(String(notificationsPlugin?.[1].icon)).toMatch(/^\.\/assets\//);
  });

  it("gives iOS no icon override: notifications show the installed app icon", () => {
    expect(expo.ios.icon).toBeUndefined();
    expect(JSON.stringify(expo.ios)).not.toContain("notification");
  });
});

describe("push delivery is untouched", () => {
  const channelSource = readFileSync(
    join(mobileDir, "src", "features", "notifications", "pushNotificationPreferences.ts"),
    "utf8"
  );
  const payloadBuilders = [
    join(repoRoot, "supabase", "functions", "personews-push-notifications", "core.ts"),
    join(repoRoot, "services", "content-engine", "src", "notifications", "editionNotification.ts")
  ];

  it("keeps the Android channel as it was", () => {
    expect(channelSource).toContain('export const EDITION_NOTIFICATION_CHANNEL_ID = "default";');
    expect(channelSource).toContain("importance: Notifications.AndroidImportance.LOW");
    expect(channelSource).toContain('name: "PersoNewsAP editions"');
  });

  it("sends every payload to that same channel", () => {
    for (const file of payloadBuilders) {
      expect(readFileSync(file, "utf8"), file).toMatch(/channelId: "default"/);
    }
  });

  it("names no icon in any payload: Android takes it from the app build", () => {
    // The Expo push API has no per-message small icon; an icon field here
    // would either be ignored or point at a stale resource.
    const notificationSources = [
      ...payloadBuilders,
      ...readdirSync(join(repoRoot, "services", "content-engine", "src", "notifications"))
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
        .map((file) => join(repoRoot, "services", "content-engine", "src", "notifications", file))
    ];

    for (const file of notificationSources) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\b(smallIcon|largeIcon|icon)\s*:|notification-icon|notification_icon/);
    }
  });
});
