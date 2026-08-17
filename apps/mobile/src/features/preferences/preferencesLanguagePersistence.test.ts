import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural tests for the two writes that silently broke the live product:
 *
 *  - the reading-language switch, which goes through the update_profile_language
 *    RPC. When that function is missing from a project the RPC fails with
 *    PGRST202, and the app must report a real failure instead of pretending the
 *    language was saved.
 *  - the preferences save, whose newsletter_article_count must stay inside the
 *    BETWEEN 1 AND 24 CHECK even when the newsletter module is switched off and
 *    the computed total is 0.
 *
 * The previous test for this file only asserted on source text, which is why it
 * stayed green while both writes failed against the real database.
 */

const rpcMock = vi.fn();
const upsertMock = vi.fn();
const fromMock = vi.fn();

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args)
  },
  normalizeSupabaseError: (error: { code?: string; message?: string }, fallback?: string) => ({
    code: error?.code ?? "unknown",
    message: fallback ?? error?.message ?? "unknown error"
  })
}));

const { saveEditablePreferences, toStorableNewsletterArticleCount, updateProfileLanguage } = await import(
  "./preferencesPersistence"
);

beforeEach(() => {
  rpcMock.mockReset();
  upsertMock.mockReset();
  fromMock.mockReset();

  upsertMock.mockResolvedValue({ error: null });
  fromMock.mockImplementation(() => ({ upsert: (...args: unknown[]) => upsertMock(...args) }));
});

describe("updateProfileLanguage", () => {
  it("reports success and calls the RPC with the requested language", async () => {
    rpcMock.mockResolvedValue({ data: [{ language: "fr" }], error: null });

    const result = await updateProfileLanguage("user-1", "fr");

    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("update_profile_language", { p_language: "fr" });
  });

  it("reports a real failure when the RPC is missing from the database", async () => {
    // PGRST202 is what a project without the profile-language migration returns.
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.update_profile_language(p_language) in the schema cache"
      }
    });

    const result = await updateProfileLanguage("user-1", "en");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PGRST202");
      expect(result.error.message).toBe("Could not save your reading language.");
    }
  });

  it("reports a permission failure rather than claiming the language was saved", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });

    const result = await updateProfileLanguage("user-1", "fr");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // French request -> French user-facing message.
      expect(result.error.message).toBe("Impossible d'enregistrer ta langue de lecture.");
    }
  });
});

describe("newsletter_article_count stays inside the database CHECK", () => {
  it("clamps a zero total up to the schema minimum", () => {
    expect(toStorableNewsletterArticleCount(0)).toBe(1);
  });

  it("keeps a normal total unchanged", () => {
    expect(toStorableNewsletterArticleCount(6)).toBe(6);
  });

  it("clamps above the schema maximum", () => {
    expect(toStorableNewsletterArticleCount(99)).toBe(24);
  });

  it("never emits 0 when the newsletter module is disabled", async () => {
    const result = await saveEditablePreferences("user-1", {
      language: "en",
      // Newsletter off, so no topics are selected and the computed total is 0.
      enabledModules: ["business_story", "mini_case"],
      selectedTopics: [],
      miniCaseTopics: ["finance_economy"],
      articlesPerTopic: {}
    });

    expect(result.ok).toBe(true);

    const preferencesUpsert = upsertMock.mock.calls
      .map((call) => call[0])
      .find((payload) => !Array.isArray(payload) && "newsletter_article_count" in payload);

    expect(preferencesUpsert).toBeDefined();
    expect(preferencesUpsert.newsletter_article_count).toBeGreaterThanOrEqual(1);
    expect(preferencesUpsert.newsletter_enabled).toBe(false);
  });

  it("surfaces a database CHECK violation instead of reporting success", async () => {
    fromMock.mockImplementation((table: string) => ({
      upsert: (...args: unknown[]) => {
        if (table === "user_preferences") {
          return Promise.resolve({
            error: {
              code: "23514",
              message: 'new row for relation "user_preferences" violates check constraint'
            }
          });
        }
        return upsertMock(...args);
      }
    }));

    const result = await saveEditablePreferences("user-1", {
      language: "fr",
      enabledModules: ["newsletter", "mini_case"],
      selectedTopics: ["finance_economy"],
      miniCaseTopics: ["finance_economy"],
      articlesPerTopic: { finance_economy: 2 }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("23514");
      expect(result.error.message).toBe("Impossible d'enregistrer tes préférences.");
    }
  });
});
