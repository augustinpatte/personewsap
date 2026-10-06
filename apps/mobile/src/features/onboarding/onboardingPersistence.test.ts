import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural tests for the personal-preference save, through both of its
 * entry points: onboarding (saveOnboardingPreferences) and Settings
 * (saveEditablePreferences). Both now go through one writer,
 * persistUserPreferenceRows.
 *
 * The fake Supabase below enforces the one database rule this save has broken
 * in production: user_preferences.newsletter_article_count BETWEEN 1 AND 24
 * (20260426120000_mobile_app_foundation.sql). Onboarding without the Newsletter
 * module used to write 0 and was rejected with 23514 on every attempt.
 */

vi.stubGlobal("__DEV__", false);

type Row = Record<string, unknown>;
type Write = { table: string; payload: Row | Row[]; options?: Row };

const writes: Write[] = [];
let failures: Record<string, { code: string; message: string } | undefined> = {};
let missingMiniCaseColumn = false;

const USER_ID = "user-0000-0000-0001";

function rejectByConstraint(payload: Row): { code: string; message: string } | null {
  const count = payload.newsletter_article_count;

  if (typeof count !== "number" || count < 1 || count > 24) {
    return {
      code: "23514",
      message:
        'new row for relation "user_preferences" violates check constraint "user_preferences_newsletter_article_count_check"'
    };
  }

  return null;
}

function upsertFor(table: string) {
  return (payload: Row | Row[], options?: Row) => {
    writes.push({ table, payload, options });

    const forced = failures[table];
    if (forced) {
      return Promise.resolve({ data: null, error: forced });
    }

    if (table === "user_preferences" && !Array.isArray(payload)) {
      if (missingMiniCaseColumn && "mini_case_topic_id" in payload) {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST204",
            message: "Could not find the 'mini_case_topic_id' column of 'user_preferences' in the schema cache"
          }
        });
      }

      const violation = rejectByConstraint(payload);
      if (violation) {
        return Promise.resolve({ data: null, error: violation });
      }
    }

    return Promise.resolve({ data: null, error: null });
  };
}

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({ upsert: upsertFor(table) })
  },
  getAuthSession: () =>
    Promise.resolve({
      data: { user: { id: USER_ID, email: "reader@example.com" } },
      error: null
    }),
  normalizeSupabaseError: (error: { code?: string; message?: string } | null, fallback?: string) => ({
    code: error?.code ?? "unknown",
    message: fallback ?? error?.message ?? "unknown error"
  })
}));

const { saveOnboardingPreferences } = await import("./persistence");
const { saveEditablePreferences } = await import("../preferences/preferencesPersistence");

type OnboardingInput = Parameters<typeof saveOnboardingPreferences>[0];

function onboardingState(overrides: Partial<OnboardingInput>): OnboardingInput {
  return {
    language: "en",
    enabledModules: [],
    selectedTopics: [],
    selectedMiniCaseTopics: [],
    articlesPerTopic: {},
    newsletterConfigurationComplete: false,
    ...overrides
  };
}

function writesTo(table: string): Write[] {
  return writes.filter((write) => write.table === table);
}

function lastPreferencesPayload(): Row {
  const preferenceWrites = writesTo("user_preferences");
  return preferenceWrites[preferenceWrites.length - 1]?.payload as Row;
}

beforeEach(() => {
  writes.length = 0;
  failures = {};
  missingMiniCaseColumn = false;
});

describe("onboarding without the Newsletter module", () => {
  it("A. saves Business Stories only", async () => {
    const result = await saveOnboardingPreferences(
      onboardingState({ enabledModules: ["business_story"] })
    );

    expect(result).toEqual({ ok: true });
    expect(lastPreferencesPayload()).toMatchObject({
      user_id: USER_ID,
      newsletter_enabled: false,
      business_stories_enabled: true,
      mini_cases_enabled: false,
      learning_path_enabled: false,
      newsletter_article_count: 1
    });
  });

  it("B. saves Mini Cases only, with their topics", async () => {
    const result = await saveOnboardingPreferences(
      onboardingState({
        enabledModules: ["mini_case"],
        selectedMiniCaseTopics: ["ai", "law_compliance"]
      })
    );

    expect(result).toEqual({ ok: true });
    expect(lastPreferencesPayload()).toMatchObject({
      newsletter_enabled: false,
      business_stories_enabled: false,
      mini_cases_enabled: true,
      mini_case_topic_id: "tech_ai"
    });

    const miniCaseRows = writesTo("user_mini_case_topic_preferences")[0].payload as Row[];
    expect(miniCaseRows.filter((row) => row.enabled).map((row) => row.topic_id)).toEqual([
      "ai",
      "law_compliance"
    ]);
  });

  it("saves a Learning Path-only reader", async () => {
    const result = await saveOnboardingPreferences(
      onboardingState({ enabledModules: ["learning_path"] })
    );

    expect(result).toEqual({ ok: true });
    expect(lastPreferencesPayload()).toMatchObject({
      learning_path_enabled: true,
      learning_path_choice_completed: true,
      newsletter_enabled: false,
      newsletter_article_count: 1
    });
  });
});

describe("C. newsletter_article_count always satisfies the database CHECK", () => {
  const configurations: Array<[string, Partial<OnboardingInput>]> = [
    ["no newsletter", { enabledModules: ["business_story"] }],
    [
      "one topic, one article",
      {
        enabledModules: ["newsletter"],
        selectedTopics: ["ai"],
        articlesPerTopic: { ai: 1 },
        newsletterConfigurationComplete: true
      }
    ],
    [
      "every topic at the maximum",
      {
        enabledModules: ["newsletter"],
        selectedTopics: ["sport", "international", "finance_economy", "stock_market", "automotive", "pharma", "ai", "culture"],
        articlesPerTopic: {
          sport: 2,
          international: 2,
          finance_economy: 2,
          stock_market: 2,
          automotive: 2,
          pharma: 2,
          ai: 2,
          culture: 2
        },
        newsletterConfigurationComplete: true
      }
    ],
    [
      "out-of-range article counts in the draft",
      {
        enabledModules: ["newsletter"],
        selectedTopics: ["ai"],
        articlesPerTopic: { ai: 50 },
        newsletterConfigurationComplete: true
      }
    ]
  ];

  it.each(configurations)("%s", async (_name, overrides) => {
    const result = await saveOnboardingPreferences(onboardingState(overrides));

    expect(result).toEqual({ ok: true });
    const count = lastPreferencesPayload().newsletter_article_count as number;
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(24);
  });
});

describe("D. module flags survive the persistence path", () => {
  it("writes exactly the modules the reader chose", async () => {
    await saveOnboardingPreferences(
      onboardingState({
        enabledModules: ["business_story", "learning_path"]
      })
    );

    expect(lastPreferencesPayload()).toMatchObject({
      newsletter_enabled: false,
      business_stories_enabled: true,
      mini_cases_enabled: false,
      learning_path_enabled: true
    });
  });

  it("keeps the module flags in the legacy mini_case_topic_id fallback", async () => {
    missingMiniCaseColumn = true;

    const result = await saveOnboardingPreferences(
      onboardingState({ enabledModules: ["business_story"] })
    );

    expect(result).toEqual({ ok: true });

    const [first, retry] = writesTo("user_preferences").map((write) => write.payload as Row);
    expect(first).toHaveProperty("mini_case_topic_id");
    expect(retry).not.toHaveProperty("mini_case_topic_id");
    // The old onboarding fallback dropped these, and the columns default to
    // true — which silently switched every module back on.
    expect(retry).toMatchObject({
      newsletter_enabled: false,
      business_stories_enabled: true,
      mini_cases_enabled: false,
      learning_path_enabled: false,
      newsletter_article_count: 1
    });
  });
});

describe("E. onboarding and Settings write the same rows for the same choices", () => {
  it.each([
    [
      "newsletter + mini cases",
      {
        enabledModules: ["newsletter", "mini_case"] as const,
        selectedTopics: ["ai", "pharma"] as const,
        miniCaseTopics: ["stock_market"] as const,
        articlesPerTopic: { ai: 2, pharma: 1 }
      }
    ],
    [
      "business stories only",
      {
        enabledModules: ["business_story"] as const,
        selectedTopics: [] as const,
        miniCaseTopics: [] as const,
        articlesPerTopic: {}
      }
    ]
  ])("%s", async (_name, choices) => {
    await saveOnboardingPreferences(
      onboardingState({
        enabledModules: [...choices.enabledModules],
        selectedTopics: [...choices.selectedTopics],
        selectedMiniCaseTopics: [...choices.miniCaseTopics],
        articlesPerTopic: choices.articlesPerTopic,
        newsletterConfigurationComplete: choices.selectedTopics.length > 0
      })
    );
    const fromOnboarding = writes.filter((write) => write.table !== "profiles");

    writes.length = 0;

    await saveEditablePreferences(USER_ID, {
      language: "en",
      enabledModules: [...choices.enabledModules],
      selectedTopics: [...choices.selectedTopics],
      miniCaseTopics: [...choices.miniCaseTopics],
      articlesPerTopic: choices.articlesPerTopic
    });
    const fromSettings = [...writes];

    expect(fromOnboarding).toEqual(fromSettings);
  });
});

describe("F. the standard Newsletter onboarding still works", () => {
  it("writes the profile, preferences, topics and mini-case topics", async () => {
    const result = await saveOnboardingPreferences(
      onboardingState({
        language: "fr",
        enabledModules: ["newsletter", "business_story", "mini_case"],
        selectedTopics: ["ai", "finance_economy"],
        selectedMiniCaseTopics: ["finance_economy"],
        articlesPerTopic: { ai: 2, finance_economy: 1 },
        newsletterConfigurationComplete: true
      })
    );

    expect(result).toEqual({ ok: true });
    expect(writes.map((write) => write.table)).toEqual([
      "profiles",
      "user_preferences",
      "user_topic_preferences",
      "user_mini_case_topic_preferences"
    ]);
    expect(writesTo("profiles")[0].payload).toMatchObject({
      id: USER_ID,
      email: "reader@example.com",
      language: "fr"
    });
    expect(lastPreferencesPayload()).toMatchObject({
      newsletter_enabled: true,
      business_stories_enabled: true,
      mini_cases_enabled: true,
      newsletter_article_count: 3
    });

    const topicRows = writesTo("user_topic_preferences")[0].payload as Row[];
    // Rows come in catalogue order; `position` carries the reader's order.
    const enabledTopics = topicRows
      .filter((row) => row.enabled)
      .sort((left, right) => (left.position as number) - (right.position as number));
    expect(enabledTopics).toEqual([
      expect.objectContaining({ topic_id: "tech_ai", articles_count: 2, position: 1 }),
      expect.objectContaining({ topic_id: "finance", articles_count: 1, position: 2 })
    ]);
    expect(writesTo("user_topic_preferences")[0].options).toEqual({ onConflict: "user_id,topic_id" });
  });
});

describe("G. a failed write is reported, never swallowed", () => {
  it.each([
    ["user_preferences", [], "Impossible d'enregistrer tes préférences."],
    ["user_topic_preferences", ["user_preferences"], "Impossible d'enregistrer tes sujets newsletter."],
    [
      "user_mini_case_topic_preferences",
      ["user_preferences", "user_topic_preferences"],
      "Impossible d'enregistrer tes sujets mini-cas."
    ]
  ])("onboarding: %s fails", async (table, completedSteps, message) => {
    failures[table] = { code: "42501", message: "permission denied" };

    const result = await saveOnboardingPreferences(
      onboardingState({
        language: "fr",
        enabledModules: ["newsletter", "mini_case"],
        selectedTopics: ["ai"],
        selectedMiniCaseTopics: ["ai"],
        articlesPerTopic: { ai: 1 },
        newsletterConfigurationComplete: true
      })
    );

    expect(result).toEqual({
      ok: false,
      error: { code: "42501", message },
      failedStep: table,
      completedSteps
    });
    // Nothing after the failed step is written.
    expect(writes.map((write) => write.table)).toEqual(["profiles", ...completedSteps, table]);
  });

  it("onboarding: a failed profile write stops before any preference write", async () => {
    failures.profiles = { code: "42501", message: "permission denied" };

    const result = await saveOnboardingPreferences(
      onboardingState({ enabledModules: ["business_story"] })
    );

    expect(result.ok).toBe(false);
    expect(writes.map((write) => write.table)).toEqual(["profiles"]);
  });

  it("Settings: reports the failed step and what was already committed", async () => {
    failures.user_topic_preferences = { code: "08006", message: "connection failure" };

    const result = await saveEditablePreferences(USER_ID, {
      language: "en",
      enabledModules: ["newsletter"],
      selectedTopics: ["ai"],
      miniCaseTopics: [],
      articlesPerTopic: { ai: 1 }
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "08006", message: "Could not save your newsletter topics." },
      failedStep: "user_topic_preferences",
      completedSteps: ["user_preferences"]
    });
  });

  it("onboarding: a thrown write becomes a failure result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    failures = {};
    const original = writes.push.bind(writes);
    writes.push = (write: Write) => {
      if (write.table === "user_preferences") {
        throw new Error("socket hang up");
      }
      return original(write);
    };

    try {
      const result = await saveOnboardingPreferences(
        onboardingState({ enabledModules: ["business_story"] })
      );

      expect(result).toMatchObject({
        ok: false,
        error: { message: "Could not save your preferences." },
        failedStep: "user_preferences",
        completedSteps: []
      });
    } finally {
      writes.push = original;
    }
  });
});
