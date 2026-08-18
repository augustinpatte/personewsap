import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { legalCopy, LEGAL_LAST_UPDATED } from "../pages/legal/legalCopy";

/**
 * The three public pages the stores require: a privacy policy, a support page,
 * and an external account-deletion route. They must be reachable signed out,
 * exist in both languages, describe the product as it really is, and — for the
 * deletion page — refuse to become a way to delete somebody else's account.
 */

const srcDir = join(__dirname, "..");
const appSource = readFileSync(join(srcDir, "App.tsx"), "utf8");
const deletePage = readFileSync(join(srcDir, "pages", "DeleteAccount.tsx"), "utf8");
const supportPage = readFileSync(join(srcDir, "pages", "Support.tsx"), "utf8");

describe("routes", () => {
  it.each(["/privacy", "/support", "/delete-account"])("%s is registered", (path) => {
    expect(appSource).toMatch(new RegExp(`path="${path}"`));
  });

  it("keeps them above the catch-all", () => {
    for (const path of ["/privacy", "/support", "/delete-account"]) {
      expect(appSource.indexOf(`path="${path}"`)).toBeLessThan(
        appSource.indexOf('path="*"')
      );
    }
  });

  it("is served by the SPA rewrite so a direct link works", () => {
    const vercel = JSON.parse(
      readFileSync(join(srcDir, "..", "vercel.json"), "utf8")
    ) as { rewrites: Array<{ source: string; destination: string }> };

    expect(vercel.rewrites).toContainEqual({ source: "/(.*)", destination: "/" });
  });
});

describe("bilingual parity", () => {
  function shapeOf(value: unknown, path = ""): string[] {
    if (typeof value !== "object" || value === null) {
      return [path];
    }

    if (Array.isArray(value)) {
      // Prose lists may differ in length between languages; the structure that
      // must match is the set of keys.
      return [`${path}[]`];
    }

    return Object.entries(value).flatMap(([key, child]) =>
      shapeOf(child, path ? `${path}.${key}` : key)
    );
  }

  it("FR and EN expose exactly the same keys", () => {
    expect(shapeOf(legalCopy.fr).sort()).toEqual(shapeOf(legalCopy.en).sort());
  });

  it.each(["privacy", "support", "deleteAccount"] as const)(
    "%s has real content in both languages",
    (page) => {
      for (const language of ["fr", "en"] as const) {
        const copy = legalCopy[language][page];

        expect(copy.title.length).toBeGreaterThan(3);
        expect(copy.intro.length).toBeGreaterThan(0);
      }

      // Not the same string in both languages: a copy-paste would pass a
      // key-parity check but ship an untranslated page.
      expect(legalCopy.fr[page].title).not.toBe(legalCopy.en[page].title);
    }
  );

  it("is dated with this pass", () => {
    expect(LEGAL_LAST_UPDATED).toBe("2026-08-18");
  });
});

describe("the privacy policy describes the product as built", () => {
  const privacyText = (language: "fr" | "en") =>
    JSON.stringify(legalCopy[language].privacy).toLowerCase();

  it("states the real cadence, not a daily one", () => {
    expect(privacyText("en")).toContain("four editions a week");
    expect(privacyText("fr")).toContain("quatre éditions par semaine");
  });

  it("carries no retired terminology", () => {
    for (const language of ["fr", "en"] as const) {
      const text = privacyText(language);

      for (const stale of [
        "daily drop",
        "daily reminder",
        "daily learning",
        "mobile beta",
        "brief quotidien",
        "mise à jour quotidienne"
      ]) {
        expect(text).not.toContain(stale);
      }
    }
  });

  it("promises nothing that is not implemented", () => {
    for (const language of ["fr", "en"] as const) {
      const text = privacyText(language);

      // Named third parties are the ones actually used.
      expect(text).toContain("supabase");
      expect(text).toContain("expo");
    }

    expect(privacyText("en")).toContain("no advertising");
    expect(privacyText("fr")).toContain("aucune publicité");
  });
});

describe("the deletion page cannot delete someone else's account", () => {
  it("offers no way to type an account identifier", () => {
    // An email field here would be an account-takeover primitive.
    expect(deletePage).not.toMatch(/type=['"]email['"]/);
    expect(deletePage).not.toMatch(/placeholder=.*email/i);
    expect(deletePage).not.toMatch(/setEmailInput/);
  });

  it("authorises with the visitor's own session token", () => {
    expect(deletePage).toMatch(/getSession\(\)/);
    expect(deletePage).toMatch(/Authorization: `Bearer \$\{accessToken\}`/);
    // The body carries no identity at all.
    expect(deletePage).toMatch(/JSON\.stringify\(\{\}\)/);
  });

  it("sends a signed-out visitor to sign in first", () => {
    expect(deletePage).toMatch(/\/login\?redirect=\/delete-account/);
    expect(deletePage).toMatch(/signedOutHeading/);
  });

  it("requires an explicit acknowledgement before the button works", () => {
    expect(deletePage).toMatch(/disabled=\{\s*!acknowledged/);
  });

  it("signs the visitor out once the account is gone", () => {
    expect(deletePage).toMatch(/auth\.signOut\(\)/);
  });

  it("keeps the account untouched on failure", () => {
    expect(deletePage).toMatch(/setStatus\('error'\)/);
    expect(legalCopy.en.deleteAccount.errorBody).toContain("untouched");
    expect(legalCopy.fr.deleteAccount.errorBody).toContain("intact");
  });
});

describe("support contact", () => {
  it("is configuration, never an invented address", () => {
    expect(supportPage).toMatch(/SUPPORT_EMAIL/);
    expect(supportPage).toMatch(/contactMissing/);

    // No hardcoded mailbox anywhere in the copy.
    expect(JSON.stringify(legalCopy)).not.toMatch(/[\w.]+@[\w.]+\.\w+/);
    expect(legalCopy.en.support.contactMissing).toContain("VITE_SUPPORT_EMAIL");
  });
});
