import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Terminology that stopped being true.
 *
 * PersoNewsAP published a daily drop when this copy was written; it now
 * publishes four editions a week and runs a self-paced learning path. Wording
 * like "daily reminder" or "mise à jour quotidienne" is not a style problem —
 * it promises a cadence the product does not have, on screens a store reviewer
 * reads.
 *
 * `daily_drop`, `dailyDrop` and `DailyDrop` are schema and code names and stay
 * exactly as they are.
 */

const mobileRoot = join(__dirname, "..");
const appRoot = join(mobileRoot, "..", "app");

const RETIRED_TERMS = [
  "daily drop",
  "daily drops",
  "daily reminder",
  "daily reminders",
  "daily learning",
  "daily briefing",
  "brief quotidien",
  "mise à jour quotidienne",
  "édition quotidienne",
  "rappel quotidien",
  "mobile beta",
  "bêta mobile"
];

/** Source files that carry user-facing strings. */
function collectSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      // Sample editorial content is fixture text, not interface copy.
      if (entry === "node_modules" || entry === "mocks") {
        continue;
      }

      files.push(...collectSourceFiles(path));
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry) || entry.includes(".test.")) {
      continue;
    }

    files.push(path);
  }

  return files;
}

/** Strips comments: internal prose may still say "daily drop" about the table. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("user-facing copy matches the product", () => {
  const files = [...collectSourceFiles(mobileRoot), ...collectSourceFiles(appRoot)];

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(RETIRED_TERMS)("no screen still says %s", (term) => {
    const offenders = files.filter((file) => {
      const code = stripComments(readFileSync(file, "utf8")).toLowerCase();

      return code.includes(term);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps the schema names untouched", () => {
    const dataLayer = readFileSync(
      join(mobileRoot, "features", "today", "dailyDropData.ts"),
      "utf8"
    );

    // The table is still public.daily_drops, and renaming it was never the point.
    expect(dataLayer).toMatch(/from\("daily_drops"\)/);
    expect(dataLayer).toMatch(/daily_drop_items/);
  });
});

describe("the in-app privacy screen agrees with the public policy", () => {
  const screen = readFileSync(join(appRoot, "privacy.tsx"), "utf8");

  it("states the real cadence and the real deletion behaviour", () => {
    expect(screen).toMatch(/four a week/);
    expect(screen).toMatch(/quatre par semaine/);
    expect(screen).toMatch(/immediate and permanent/);
    expect(screen).toMatch(/immédiate, définitive/);
  });

  it("is dated with this pass in both languages", () => {
    expect(screen).toMatch(/18 August 2026/);
    expect(screen).toMatch(/18 août 2026/);
  });
});
