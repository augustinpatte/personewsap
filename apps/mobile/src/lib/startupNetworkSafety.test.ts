import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cold start with no network must not produce unhandled promise rejections.
 *
 * On device, launching with a momentarily unavailable connection printed a
 * stack of red "TypeError: Network request failed" entries even though auth and
 * the data layer recovered seconds later: the boot fired several
 * `void somePromise` calls whose rejection nobody owned.
 *
 * The data layers are covered behaviourally (miniCaseSync, contentInteractions:
 * a throwing client resolves into an offline/error result). What cannot be
 * exercised in this environment is module top-level and provider effects, so
 * they are pinned here: every fire-and-forget promise at boot carries its own
 * catch.
 */

const srcDir = join(__dirname, "..");

function read(...segments: string[]): string {
  return readFileSync(join(srcDir, ...segments), "utf8");
}

/** The `void x(...)` statements in a file, with what follows them. */
function fireAndForgetStatements(source: string): string[] {
  return source.match(/\bvoid [\s\S]*?;/g) ?? [];
}

describe("supabase auth auto-refresh", () => {
  const source = read("lib", "supabase.ts");

  it("owns the outcome of start/stopAutoRefresh", () => {
    // Both hit the network and both reject when the device has no connection.
    expect(source).toMatch(/setAutoRefresh/);
    expect(source).toMatch(/\.catch\(/);
    expect(source).not.toMatch(/void supabase\.auth\.startAutoRefresh\(\);/);
    expect(source).not.toMatch(/void supabase\.auth\.stopAutoRefresh\(\);/);
  });
});

describe("boot providers", () => {
  it.each([
    ["auth", read("features", "auth", "AuthProvider.tsx")],
    ["learning path", read("features", "learning", "LearningPathContext.tsx")],
    ["archive", read("features", "archive", "ArchiveContext.tsx")]
  ])("%s provider catches every fire-and-forget promise", (_name, source) => {
    const statements = fireAndForgetStatements(source);

    expect(statements.length).toBeGreaterThan(0);

    for (const statement of statements) {
      expect(statement).toMatch(/\.catch\(/);
    }
  });

  it("resolves the initial deep link without leaving a rejection", () => {
    const source = read("features", "auth", "AuthProvider.tsx");

    expect(source).toMatch(/Linking\.getInitialURL\(\)[\s\S]{0,200}\.catch\(/);
  });

  it("keeps a failed outbox flush from failing the learning path load", () => {
    const source = read("features", "learning", "LearningPathContext.tsx");

    expect(source).toMatch(/catch \(flushError\)/);
  });
});

describe("archive is not fetched at boot", () => {
  const source = read("features", "archive", "ArchiveContext.tsx");

  it("waits for an archive view to ask for the first page", () => {
    // Newsletter -> Today needs no archive: one less request competing with
    // auth and the daily drop on a cold connection.
    expect(source).toMatch(/ensureLoaded/);
    expect(source).toMatch(/status: "idle"/);
    expect(source).toMatch(/export function useArchiveData/);
  });

  it.each([
    ["newsletter", read("features", "modules", "NewsletterModuleScreen.tsx")],
    ["stories", read("features", "modules", "StoriesModuleScreen.tsx")],
    ["mini cases", read("features", "modules", "MiniCasesModuleScreen.tsx")]
  ])("the %s archive view requests it", (_name, source) => {
    expect(source).toMatch(/useArchiveData\(\)/);
  });
});
