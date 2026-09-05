import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Knowing which account is signed in.
 *
 * The device bug: Settings showed "augustin.patte@g…" — a one-line clip on a
 * 22pt serif line, which ate exactly the part of the address that identifies
 * the account. The reader could not tell which of their addresses they were
 * signed in with, which is the one question the account card exists to answer.
 *
 * These cases are deliberately about the *constraints* rather than a rendered
 * screenshot: what matters is that the canonical identity is never clipped and
 * is still allowed to grow with Dynamic Type.
 */

const settings = readFileSync(join(__dirname, "SettingsScreen.tsx"), "utf8");

/** The account card, from its declaration to the next top-level function. */
function accountIdentityCard(): string {
  const start = settings.indexOf("function AccountIdentityCard");
  const end = settings.indexOf("function SettingsSection", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return settings.slice(start, end);
}

/** The generic label/value row, which renders the Account section's email. */
function settingsRow(): string {
  const start = settings.indexOf("function SettingsRow");
  const end = settings.indexOf("function getAccountCopy", start);

  return settings.slice(start, end);
}

describe("the account email", () => {
  it("is never clipped to a single line", () => {
    expect(accountIdentityCard()).not.toMatch(/numberOfLines/);
  });

  it("is never given an ellipsis", () => {
    expect(accountIdentityCard()).not.toMatch(/ellipsizeMode/);
    expect(settingsRow()).not.toMatch(/ellipsizeMode/);
  });

  it("is nowhere truncated in the whole Settings screen", () => {
    // Deliberately the whole file: there is no identity context in Settings
    // where clipping the value is the right answer.
    expect(settings).not.toMatch(/numberOfLines/);
  });

  it("can be selected and copied", () => {
    expect(accountIdentityCard()).toMatch(/<AppText selectable/);
    expect(settings).toMatch(/label=\{copy\.emailLabel\}\s*\n\s*selectable/);
  });

  it("is shown in full, never only the local part", () => {
    // The value passed through is `user.email` itself — no split on "@", no
    // slice, no masking.
    expect(settings).toMatch(/email=\{user\?\.email \?\? copy\.noActiveUser\}/);
    expect(settings).not.toMatch(/email.*\.split\(["']@["']\)/);
    expect(settings).not.toMatch(/email.*\.slice\(/);
  });
});

describe("the row a long email lives in", () => {
  it("lets the row grow downwards instead of centring on it", () => {
    // With alignItems "center" a wrapped address drags the avatar and the icon
    // to the middle of the block; "flex-start" keeps them level with the label
    // and lets the row get as tall as the value needs.
    for (const style of ["identityTopline", "settingsRow"]) {
      const block = settings.slice(
        settings.indexOf(`${style}: {`),
        settings.indexOf("}", settings.indexOf(`${style}: {`))
      );

      expect(block, style).toContain('alignItems: "flex-start"');
    }
  });

  it("gives the value the whole remaining width", () => {
    expect(settings).toMatch(/identityCopy: \{\s*\n\s*flex: 1/);
    expect(settings).toMatch(/settingsRowCopy: \{\s*\n\s*flex: 1/);
  });

  it("never scrolls the account row horizontally", () => {
    expect(accountIdentityCard()).not.toMatch(/horizontal/);
    expect(settingsRow()).not.toMatch(/horizontal/);
  });
});

describe("Dynamic Type", () => {
  it("leaves the system text size free to scale the identity", () => {
    // allowFontScaling={false} or a maxFontSizeMultiplier would cap the address
    // at large accessibility sizes; neither appears anywhere in Settings.
    expect(settings).not.toMatch(/allowFontScaling/);
    expect(settings).not.toMatch(/maxFontSizeMultiplier/);
  });

  it("sets the address at body size rather than shrinking it to fit", () => {
    // bodyStrong is the app's standard 16pt reading size; the fix was to stop
    // clipping, not to make the address small enough to squeeze onto one line.
    const card = accountIdentityCard();

    expect(card).toMatch(/<AppText selectable variant="bodyStrong">/);
    expect(card).not.toMatch(/fontSize:/);
  });
});

describe("realistic addresses", () => {
  it("are handled by wrapping, with no per-length special case", () => {
    // The three shapes from QA — a common consumer address, a long
    // institutional one, and a tagged address — differ only in length, and the
    // row treats them identically: it wraps. There is no truncation branch, no
    // measured width and no shortening helper for the card to get wrong.
    const card = accountIdentityCard();

    expect(card).not.toMatch(/\.length\s*[<>]/);
    expect(card).not.toMatch(/substring|substr|truncate|shorten/i);
    // The only fixed dimensions in the card belong to the avatar circle, which
    // is a sibling of the copy block rather than a bound on it.
    expect(card).not.toMatch(/identityCopy[\s\S]{0,120}(width|height):\s*\d/);
  });
});
