import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { clearMemoryCache, getCachedValue, setCachedValue } from "../../lib/memoryCache";
import {
  clearPreferenceSensitiveContentCache,
  PREFERENCE_SENSITIVE_CACHE_PREFIXES
} from "./contentRefresh";
import { performLanguageChange } from "./languageSwitch";

/**
 * Settings changes reaching the rest of the app.
 *
 * Two separate promises, and they fail in different ways:
 *
 *  - the language is a value that must land in `profiles.language` and then
 *    govern every screen. It broke in production for a reason no client test
 *    could see: the migration that fixes the RPC was written, reviewed and
 *    never pushed, so the deployed function still raised 42702 on every call
 *    and the app dutifully restored the previous language. The guard for that
 *    class of failure is at the bottom of this file, plus the SQL suite that
 *    runs against the deployed function.
 *
 *  - a topic or module preference is a value the SERVER reads when it builds
 *    the next edition. The client's job is only to stop serving answers it
 *    computed before the change.
 */

const READER = "11111111-1111-4111-8111-111111111111";

describe("PART 20 — English to French", () => {
  it("persists fr and never reports the successful save as a failure", async () => {
    const applied: string[] = [];
    const persisted: Array<[string, string]> = [];
    const errors: string[] = [];
    const refreshed: string[] = [];

    const ok = await performLanguageChange({
      language: "fr",
      previousLanguage: "en",
      userId: READER,
      requestId: 1,
      getLatestRequestId: () => 1,
      applyLanguage: (language) => applied.push(language),
      persistLanguage: async (userId, language) => {
        persisted.push([userId, language]);
        return { ok: true };
      },
      clearError: () => {},
      showError: (previous) => errors.push(`error:${previous}`),
      onPersisted: async (language) => {
        refreshed.push(language);
      }
    });

    expect(ok).toBe(true);
    // The RPC is asked for fr, for this reader.
    expect(persisted).toEqual([[READER, "fr"]]);
    // The app moved to French once, and never back.
    expect(applied).toEqual(["fr"]);
    expect(errors).toEqual([]);
    // The profile is re-read afterwards, so the canonical value wins.
    expect(refreshed).toEqual(["fr"]);
  });
});

describe("PART 21 — French to English", () => {
  it("behaves the same in the other direction", async () => {
    const applied: string[] = [];
    const persisted: Array<[string, string]> = [];
    const errors: string[] = [];

    const ok = await performLanguageChange({
      language: "en",
      previousLanguage: "fr",
      userId: READER,
      requestId: 1,
      getLatestRequestId: () => 1,
      applyLanguage: (language) => applied.push(language),
      persistLanguage: async (userId, language) => {
        persisted.push([userId, language]);
        return { ok: true };
      },
      clearError: () => {},
      showError: (previous) => errors.push(`error:${previous}`),
      onPersisted: async () => {}
    });

    expect(ok).toBe(true);
    expect(persisted).toEqual([[READER, "en"]]);
    expect(applied).toEqual(["en"]);
    expect(errors).toEqual([]);
  });

  it("restores the previous language when the RPC really fails", async () => {
    const applied: string[] = [];
    const errors: string[] = [];
    const refreshed: string[] = [];

    const ok = await performLanguageChange({
      language: "fr",
      previousLanguage: "en",
      userId: READER,
      requestId: 1,
      getLatestRequestId: () => 1,
      applyLanguage: (language) => applied.push(language),
      // Exactly what production returned while the migration was unapplied.
      persistLanguage: async () => ({
        ok: false,
        error: { code: "42702", message: 'column reference "language" is ambiguous' }
      }),
      clearError: () => {},
      showError: (previous) => errors.push(`error:${previous}`),
      onPersisted: async (language) => {
        refreshed.push(language);
      }
    });

    expect(ok).toBe(false);
    // Optimistic apply, then an honest rollback — never a silent pretence.
    expect(applied).toEqual(["fr", "en"]);
    expect(errors).toEqual(["error:en"]);
    expect(refreshed).toEqual([]);
  });
});

describe("PART 9 — no bouncing between languages", () => {
  it("ignores a stale result that lands after a newer choice", async () => {
    const applied: string[] = [];
    const errors: string[] = [];

    const ok = await performLanguageChange({
      language: "fr",
      previousLanguage: "en",
      userId: READER,
      requestId: 1,
      // A second tap already started while this save was in flight.
      getLatestRequestId: () => 2,
      applyLanguage: (language) => applied.push(language),
      persistLanguage: async () => ({
        ok: false,
        error: { code: "timeout", message: "late failure" }
      }),
      clearError: () => {},
      showError: (previous) => errors.push(`error:${previous}`),
      onPersisted: async () => {}
    });

    expect(ok).toBe(true);
    // The late failure neither rolls back nor shows an error: the newer choice
    // owns the state.
    expect(applied).toEqual(["fr"]);
    expect(errors).toEqual([]);
  });
});

describe("PART 22 — a saved preference stops the app serving stale answers", () => {
  beforeEach(() => {
    clearMemoryCache();
  });

  it("forgets every memoised content answer", () => {
    for (const prefix of PREFERENCE_SENSITIVE_CACHE_PREFIXES) {
      setCachedValue(`${prefix}:${READER}:whatever`, { stale: true }, 60_000);
    }

    clearPreferenceSensitiveContentCache();

    for (const prefix of PREFERENCE_SENSITIVE_CACHE_PREFIXES) {
      expect(getCachedValue(`${prefix}:${READER}:whatever`)).toBeNull();
    }
  });

  it("covers today, the archive, its search, and opened readings", () => {
    // The five namespaces built by the cache-key helpers. If a sixth appears
    // and is not listed, a preference change would silently miss it.
    expect([...PREFERENCE_SENSITIVE_CACHE_PREFIXES].sort()).toEqual([
      "archive-search",
      "content-item",
      "content-sources",
      "library-drops",
      "today-drop"
    ]);
  });

  it("touches nothing but content", () => {
    setCachedValue("learning-path:reader", { keep: true }, 60_000);
    setCachedValue("session:reader", { keep: true }, 60_000);

    clearPreferenceSensitiveContentCache();

    // Interactions, auth and learning state are not content responses, and a
    // preference change must not be able to throw them away.
    expect(getCachedValue("learning-path:reader")).not.toBeNull();
    expect(getCachedValue("session:reader")).not.toBeNull();
  });

  it("is what Settings runs when preferences are saved", () => {
    const settings = readFileSync(
      join(__dirname, "..", "settings", "SettingsScreen.tsx"),
      "utf8"
    );

    expect(settings).toContain("clearPreferenceSensitiveContentCache");
    expect(settings).toContain("dailyDrop.reload()");
    expect(settings).toContain("archive.reload()");
    // The language path keeps its own handler: its caches are already keyed by
    // language, so it re-reads without clearing anything.
    expect(settings).toContain("handlePreferencesSaved");
  });
});

describe("the 42702 class cannot come back", () => {
  const migrationsDir = join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "supabase",
    "migrations"
  );

  it("qualifies every column reference in the effective RETURNS TABLE function", () => {
    // A RETURNS TABLE output column is also a plpgsql variable, so an
    // UNQUALIFIED reference to one inside a query is ambiguous and raises
    // 42702 when the statement is planned — on every call, whether or not the
    // rows it touches exist. That is precisely what shipped to production.
    //
    // Only the newest definition is checked: an applied migration is immutable
    // history, and 20260822120000 is the broken one this fix supersedes.
    const definitions = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) =>
        /CREATE OR REPLACE FUNCTION public\.update_profile_language/i.test(
          readFileSync(join(migrationsDir, name), "utf8")
        )
      );

    expect(definitions.length).toBeGreaterThan(0);

    const effective = definitions[definitions.length - 1] as string;
    const body =
      readFileSync(join(migrationsDir, effective), "utf8").split(/\$\$/)[1] ?? "";
    const offenders = body
      .split("\n")
      .map((line) => line.trim())
      .filter((statement) => !statement.startsWith("--") && statement.length > 0)
      // A bare `language` after AND/OR/WHERE, i.e. not `<table>.language`.
      .filter((statement) => /(?:AND|OR|WHERE)\s+language\b/i.test(statement));

    expect({ effective, offenders }).toEqual({ effective, offenders: [] });
  });
});
