import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The launcher icon, pinned to what it has to be on a real phone.
 *
 * The artwork arrived as a presentation image: a rounded blue tile with the
 * corners already cut out of it. Shipping that as the app icon is the classic
 * double-rounded result — the OS rounds its own mask over corners that are
 * already rounded, and the gap between the two shows as white. So the master
 * here is FULL-BLEED: blue to all four edges, opaque, and the mask is left to
 * the OS.
 *
 * Android gets the two halves it actually wants: a transparent foreground whose
 * artwork sits inside the 66/108 safe zone, over a background that carries the
 * same blue. A square tile used as an adaptive foreground is what produces an
 * icon floating inside another icon, and that is what these assertions exist to
 * prevent coming back.
 *
 * The identifiers (bundle id, package, slug, scheme) are pinned next door in
 * brandName.test.ts, which is where the branding pass put them.
 */

/** pngjs ships no type declarations, and one decoder shape is all this needs. */
type DecodedPng = { width: number; height: number; data: Buffer };

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as { PNG: { sync: { read: (file: Buffer) => DecodedPng } } };

const mobileDir = join(__dirname, "..", "..");
const assets = join(mobileDir, "assets");
const config = JSON.parse(readFileSync(join(mobileDir, "app.json"), "utf8")) as {
  expo: {
    name: string;
    icon: string;
    android: {
      adaptiveIcon: {
        foregroundImage: string;
        backgroundImage?: string;
        monochromeImage?: string;
        backgroundColor: string;
      };
    };
    plugins: Array<string | [string, Record<string, unknown>]>;
  };
};

const expo = config.expo;
const load = (file: string) => PNG.sync.read(readFileSync(join(assets, file)));
const pixel = (png: DecodedPng, x: number, y: number) => {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] as const;
};
/** The deep brand blue, never the pale halo the source artwork had around it. */
const isBrandBlue = ([r, , b]: readonly number[]) => r <= 120 && b >= 180 && b - r >= 100;

const master = load("icon.png");
const foreground = load("adaptive-icon.png");
const background = load("adaptive-icon-background.png");

describe("the master app icon", () => {
  it("is the file the config ships, and it exists", () => {
    expect(expo.icon).toBe("./assets/icon.png");
    expect(existsSync(join(assets, "icon.png"))).toBe(true);
  });

  it("is a 1024×1024 square", () => {
    expect(master.width).toBe(1024);
    expect(master.height).toBe(1024);
  });

  it("is fully opaque: no transparency for a mask to reveal", () => {
    let transparent = 0;

    for (let i = 3; i < master.data.length; i += 4) {
      if (master.data[i] !== 255) transparent++;
    }

    expect(transparent).toBe(0);
  });

  it("bleeds blue to all four corners, so the OS mask cannot expose a white edge", () => {
    // This is the double-rounding guard. The source artwork's own rounded
    // corners were filled with the blue of their row before scaling.
    for (const [x, y] of [
      [0, 0],
      [master.width - 1, 0],
      [0, master.height - 1],
      [master.width - 1, master.height - 1]
    ]) {
      expect(isBrandBlue(pixel(master, x, y)), `corner ${x},${y}`).toBe(true);
    }
  });

  it("has no pale pixel anywhere in its outer border", () => {
    let offenders = 0;

    for (let y = 0; y < master.height; y++) {
      for (let x = 0; x < master.width; x++) {
        const edge = x < 20 || y < 20 || x >= master.width - 20 || y >= master.height - 20;

        if (edge && !isBrandBlue(pixel(master, x, y))) offenders++;
      }
    }

    expect(offenders).toBe(0);
  });

  it("keeps the artwork's vertical gradient rather than one flat blue", () => {
    const top = pixel(master, master.width >> 1, 2);
    const bottom = pixel(master, master.width >> 1, master.height - 3);

    expect(isBrandBlue(top)).toBe(true);
    expect(isBrandBlue(bottom)).toBe(true);
    expect(top[2]).toBeGreaterThan(bottom[2]);
  });
});

describe("the Android adaptive icon", () => {
  it("no longer hands the square tile to the foreground", () => {
    // A rounded square as an adaptive foreground is the "icon inside an icon".
    expect(expo.android.adaptiveIcon.foregroundImage).toBe("./assets/adaptive-icon.png");
    expect(expo.android.adaptiveIcon.foregroundImage).not.toBe(expo.icon);
  });

  it("carries the blue on the background half, as an image and as a colour", () => {
    expect(expo.android.adaptiveIcon.backgroundImage).toBe("./assets/adaptive-icon-background.png");
    expect(expo.android.adaptiveIcon.backgroundColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(isBrandBlue(pixel(background, 512, 512))).toBe(true);
    expect(background.width).toBe(1024);
    expect(background.height).toBe(1024);
  });

  it("gives Android 13 a themed icon from the same mark", () => {
    expect(expo.android.adaptiveIcon.monochromeImage).toBe("./assets/adaptive-icon.png");
  });

  it("is a transparent foreground, blank at the corners", () => {
    expect(foreground.width).toBe(1024);
    expect(foreground.height).toBe(1024);

    for (const [x, y] of [
      [0, 0],
      [foreground.width - 1, 0],
      [0, foreground.height - 1],
      [foreground.width - 1, foreground.height - 1]
    ]) {
      expect(pixel(foreground, x, y)[3], `corner ${x},${y}`).toBe(0);
    }
  });

  it("keeps the whole mark inside the 66/108 safe zone", () => {
    // Every launcher mask — circle, squircle, rounded square — keeps the
    // central 61.1%. The cap's tassel and the book's corners live in here.
    let x0 = foreground.width;
    let y0 = foreground.height;
    let x1 = -1;
    let y1 = -1;

    for (let y = 0; y < foreground.height; y++) {
      for (let x = 0; x < foreground.width; x++) {
        if (pixel(foreground, x, y)[3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }

    const safeStart = (foreground.width * (1 - 0.611)) / 2;
    const safeEnd = foreground.width - safeStart;

    expect(x0).toBeGreaterThanOrEqual(safeStart);
    expect(y0).toBeGreaterThanOrEqual(safeStart);
    expect(x1).toBeLessThanOrEqual(safeEnd);
    expect(y1).toBeLessThanOrEqual(safeEnd);
    // And not a speck floating in the middle of an empty canvas.
    expect((x1 - x0 + 1) / foreground.width).toBeGreaterThan(0.5);
  });
});

describe("what the icon change must not disturb", () => {
  it("leaves the notification icon alone", () => {
    const notifications = expo.plugins.find(
      (plugin): plugin is [string, Record<string, unknown>] =>
        Array.isArray(plugin) && plugin[0] === "expo-notifications"
    );

    expect(notifications?.[1].icon).toBe("./assets/notification-icon.png");

    const small = load("notification-icon.png");
    expect([small.width, small.height]).toEqual([96, 96]);
  });

  it("ships no path outside the repository, and no leftover temporary icon", () => {
    const raw = readFileSync(join(mobileDir, "app.json"), "utf8");

    expect(raw).not.toMatch(/Downloads|\/Users\//);
    expect(raw).not.toContain("personewsap-icon-source");
    // Every image the config names resolves to a file that is actually there.
    for (const match of raw.matchAll(/"\.\/assets\/([^"]+\.png)"/g)) {
      expect(existsSync(join(assets, match[1])), match[1]).toBe(true);
    }
  });

  it("keeps the app's display name on the product", () => {
    expect(expo.name).toBe("PersoNewsAP");
  });
});
