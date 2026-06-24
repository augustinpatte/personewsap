import { normalizeSupabaseError, supabase } from "../../lib/supabase";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import { localized } from "../../lib/i18n";
import type { Language, TopicId } from "../../types/domain";
import {
  buildMiniCaseTopicPreferenceRows,
  buildNewsletterTopicPreferenceRows,
  clampNewsletterArticleCount,
  isMiniCaseTopicId,
  mapBackendTopicToMiniCaseTopic,
  mapBackendTopicToNewsletterTopic,
  mapMiniCaseTopicToBackendTopic,
  MAX_MINI_CASE_TOPICS,
  MIN_MINI_CASE_TOPICS,
  ONBOARDING_MODULE_IDS,
  normalizeMiniCaseTopics,
  normalizeNewsletterTopics,
  type MiniCaseTopicId,
  type OnboardingModuleId,
  type NewsletterTopicId
} from "../onboarding/options";

export type EditablePreferences = {
  language: Language;
  enabledModules: OnboardingModuleId[];
  selectedTopics: NewsletterTopicId[];
  miniCaseTopics: MiniCaseTopicId[];
  articlesPerTopic: Partial<Record<NewsletterTopicId, number>>;
};

type PreferencesResult =
  | { ok: true; preferences: EditablePreferences }
  | { ok: false; error: NormalizedSupabaseError };

type SavePreferencesResult =
  | { ok: true }
  | { ok: false; error: NormalizedSupabaseError };

const DEFAULT_PREFERENCES: EditablePreferences = {
  language: "en",
  enabledModules: ["newsletter", "business_story", "mini_case"],
  selectedTopics: [],
  miniCaseTopics: [],
  articlesPerTopic: {}
};

export async function loadEditablePreferences(
  userId: string,
  uiLanguage: Language | null = null
): Promise<PreferencesResult> {
  const loadErrorMessage = localized(
    {
      en: "Could not load your preferences.",
      fr: "Impossible de charger tes préférences."
    },
    uiLanguage
  );

  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: localized(
          {
            en: "Live account preferences are not configured for this build.",
            fr: "Les préférences de compte live ne sont pas configurées pour cette version."
          },
          uiLanguage
        )
      }
    };
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("language")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      return { ok: false, error: normalizeSupabaseError(profileError, loadErrorMessage) };
    }

    const { data: topicPreferences, error: topicPreferencesError } = await supabase
      .from("user_topic_preferences")
      .select("topic_id, articles_count, enabled, position")
      .eq("user_id", userId)
      .order("position", { ascending: true, nullsFirst: false });

    if (topicPreferencesError) {
      return { ok: false, error: normalizeSupabaseError(topicPreferencesError, loadErrorMessage) };
    }

    const { data: userPreferences, error: userPreferencesError } = await supabase
      .from("user_preferences")
      .select("newsletter_enabled,business_stories_enabled,mini_cases_enabled,mini_case_topic_id")
      .eq("user_id", userId)
      .maybeSingle();

    const legacyMiniCaseColumnMissing = isMissingColumnError(
      userPreferencesError,
      "mini_case_topic_id"
    );

    if (legacyMiniCaseColumnMissing) {
      logPreferencesDebug("user_preferences_legacy_mini_case_column_missing", {
        error: describeSupabaseError(userPreferencesError),
        query: "user_preferences.select",
        user_id: redactIdentifier(userId)
      });
    } else if (userPreferencesError) {
      return { ok: false, error: normalizeSupabaseError(userPreferencesError, loadErrorMessage) };
    }

    const { data: miniCaseTopicPreferences, error: miniCaseTopicPreferencesError } =
      await supabase
        .from("user_mini_case_topic_preferences")
        .select("topic_id, enabled, position")
        .eq("user_id", userId)
        .order("position", { ascending: true, nullsFirst: false });

    if (miniCaseTopicPreferencesError) {
      logPreferencesDebug("user_mini_case_topic_preferences_read_failed", {
        error: describeSupabaseError(miniCaseTopicPreferencesError),
        query: "user_mini_case_topic_preferences.select",
        user_id: redactIdentifier(userId)
      });

      return {
        ok: false,
        error: normalizeSupabaseError(miniCaseTopicPreferencesError, loadErrorMessage)
      };
    }

    const selectedTopics =
      topicPreferences
        ?.filter((preference) => preference.enabled)
        .map((preference) => mapBackendTopicToNewsletterTopic(preference.topic_id))
        .filter((topicId): topicId is NewsletterTopicId => Boolean(topicId)) ?? [];
    const articlesPerTopic = Object.fromEntries(
      topicPreferences
        ?.map((preference) => {
          const topicId = mapBackendTopicToNewsletterTopic(preference.topic_id);

          return topicId
            ? [topicId, clampNewsletterArticleCount(preference.articles_count)]
            : null;
        })
        .filter((entry): entry is [NewsletterTopicId, number] => Boolean(entry)) ?? []
    ) as Partial<Record<NewsletterTopicId, number>>;
    const loadedMiniCaseTopics = normalizeMiniCaseTopics(
      miniCaseTopicPreferences
        ?.filter((preference) => preference.enabled)
        .map((preference) => normalizeStoredMiniCaseTopicId(preference.topic_id))
        .filter((topicId): topicId is MiniCaseTopicId => Boolean(topicId)) ?? []
    );
    const fallbackMiniCaseTopic = userPreferences?.mini_case_topic_id
      ? mapBackendTopicToMiniCaseTopic(userPreferences.mini_case_topic_id)
      : null;
    const fallbackMiniCaseTopics = fallbackMiniCaseTopic
      ? normalizeMiniCaseTopics([fallbackMiniCaseTopic])
      : [];
    const miniCaseTopics =
      loadedMiniCaseTopics.length > 0 ? loadedMiniCaseTopics : fallbackMiniCaseTopics;

    return {
      ok: true,
      preferences: normalizeEditablePreferences({
        language: profile?.language ?? DEFAULT_PREFERENCES.language,
        enabledModules: normalizeEnabledModules(userPreferences),
        selectedTopics,
        miniCaseTopics,
        articlesPerTopic
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error, loadErrorMessage)
    };
  }
}

export async function saveEditablePreferences(
  userId: string,
  preferences: EditablePreferences
): Promise<SavePreferencesResult> {
  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: localized(
          {
            en: "Live account preferences are not configured for this build.",
            fr: "Les préférences de compte live ne sont pas configurées pour cette version."
          },
          preferences.language
        )
      }
    };
  }

  const normalized = normalizeEditablePreferences(preferences);

  if (normalized.enabledModules.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_modules",
        message: localized(
          {
            en: "Choose at least one daily module before saving preferences.",
            fr: "Choisis au moins un module quotidien avant d'enregistrer les préférences."
          },
          normalized.language
        )
      }
    };
  }

  if (normalized.enabledModules.includes("newsletter") && normalized.selectedTopics.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_topics",
        message: localized(
          {
            en: "Choose at least one newsletter topic before saving preferences.",
            fr: "Choisis au moins un sujet newsletter avant d'enregistrer les préférences."
          },
          normalized.language
        )
      }
    };
  }

  if (
    normalized.enabledModules.includes("mini_case") &&
    (normalized.miniCaseTopics.length < MIN_MINI_CASE_TOPICS ||
      normalized.miniCaseTopics.length > MAX_MINI_CASE_TOPICS)
  ) {
    return {
      ok: false,
      error: {
        code: "missing_mini_case_topics",
        message: localized(
          {
            en: "Choose one to three mini-case topics before saving preferences.",
            fr: "Choisis un à trois sujets mini-cas avant d'enregistrer les préférences."
          },
          normalized.language
        )
      }
    };
  }

  try {
    const profileResult = await supabase
      .from("profiles")
      .update({ language: normalized.language })
      .eq("id", userId);

    if (profileResult.error) {
      return {
        ok: false,
        error: normalizeSupabaseError(
          profileResult.error,
          localized(
            {
              en: "Could not save your profile.",
              fr: "Impossible d'enregistrer ton profil."
            },
            normalized.language
          )
        )
      };
    }

    const newsletterArticleCount = normalized.selectedTopics.reduce(
      (total, topicId) =>
        total + clampNewsletterArticleCount(normalized.articlesPerTopic[topicId] ?? 1),
      0
    );

    const userPreferencesResult = await upsertUserPreferences({
      newsletterArticleCount,
      businessStoriesEnabled: normalized.enabledModules.includes("business_story"),
      miniCasesEnabled: normalized.enabledModules.includes("mini_case"),
      newsletterEnabled: normalized.enabledModules.includes("newsletter"),
      primaryMiniCaseTopicId: normalized.miniCaseTopics[0]
        ? mapMiniCaseTopicToBackendTopic(normalized.miniCaseTopics[0])
        : null,
      userId
    });

    if (userPreferencesResult.error) {
      return {
        ok: false,
        error: normalizeSupabaseError(
          userPreferencesResult.error,
          localized(
            {
              en: "Could not save your preferences.",
              fr: "Impossible d'enregistrer tes préférences."
            },
            normalized.language
          )
        )
      };
    }

    const topicPreferenceRows = buildNewsletterTopicPreferenceRows({
      articlesPerTopic: normalized.articlesPerTopic,
      selectedTopics: normalized.selectedTopics,
      userId
    });

    const topicPreferencesResult = await supabase
      .from("user_topic_preferences")
      .upsert(topicPreferenceRows, { onConflict: "user_id,topic_id" });

    if (topicPreferencesResult.error) {
      return {
        ok: false,
        error: normalizeSupabaseError(
          topicPreferencesResult.error,
          localized(
            {
              en: "Could not save your newsletter topics.",
              fr: "Impossible d'enregistrer tes sujets newsletter."
            },
            normalized.language
          )
        )
      };
    }

    const miniCaseTopicPreferenceRows = buildMiniCaseTopicPreferenceRows({
      selectedTopics: normalized.miniCaseTopics,
      userId
    });

    const miniCaseTopicPreferencesResult = await supabase
      .from("user_mini_case_topic_preferences")
      .upsert(miniCaseTopicPreferenceRows, { onConflict: "user_id,topic_id" });

    if (miniCaseTopicPreferencesResult.error) {
      logPreferencesDebug("user_mini_case_topic_preferences_save_failed", {
        error: describeSupabaseError(miniCaseTopicPreferencesResult.error),
        attempted_rows: summarizeMiniCaseTopicRows(miniCaseTopicPreferenceRows),
        query: "user_mini_case_topic_preferences.upsert",
        user_id: redactIdentifier(userId)
      });

      return {
        ok: false,
        error: normalizeSupabaseError(
          miniCaseTopicPreferencesResult.error,
          localized(
            {
              en: "Could not save your mini-case topics.",
              fr: "Impossible d'enregistrer tes sujets mini-cas."
            },
            normalized.language
          )
        )
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(
        error,
        localized(
          {
            en: "Could not save your preferences.",
            fr: "Impossible d'enregistrer tes préférences."
          },
          normalized.language
        )
      )
    };
  }
}

/**
 * Persist only the reading language to profiles.language. Used for the immediate
 * language switch in Account, which applies app-wide instantly and must survive a
 * restart without depending on a full preferences save (topics/modules untouched).
 */
export async function updateProfileLanguage(
  userId: string,
  language: Language
): Promise<SavePreferencesResult> {
  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: localized(
          {
            en: "Live account preferences are not configured for this build.",
            fr: "Les préférences de compte live ne sont pas configurées pour cette version."
          },
          language
        )
      }
    };
  }

  const result = await supabase.from("profiles").update({ language }).eq("id", userId);

  if (result.error) {
    return {
      ok: false,
      error: normalizeSupabaseError(
        result.error,
        localized(
          {
            en: "Could not save your reading language.",
            fr: "Impossible d'enregistrer ta langue de lecture."
          },
          language
        )
      )
    };
  }

  return { ok: true };
}

export function normalizeEditablePreferences(preferences: EditablePreferences): EditablePreferences {
  const selectedTopics = normalizeNewsletterTopics(preferences.selectedTopics);
  const miniCaseTopics = normalizeMiniCaseTopics(preferences.miniCaseTopics);
  const enabledModules = normalizeEnabledModuleIds(preferences.enabledModules);

  return {
    ...preferences,
    enabledModules,
    selectedTopics,
    miniCaseTopics,
    articlesPerTopic: Object.fromEntries(
      selectedTopics.map((topicId) => [
        topicId,
        clampNewsletterArticleCount(preferences.articlesPerTopic[topicId] ?? 1)
      ])
    ) as Partial<Record<NewsletterTopicId, number>>
  };
}

function logPreferencesDebug(event: string, details: Record<string, unknown>) {
  if (__DEV__) {
    console.info("[Preferences debug]", {
      event,
      ...details
    });
  }
}

function describeSupabaseError(error: unknown): Record<string, unknown> {
  if (!isRecord(error)) {
    return { message: String(error) };
  }

  return {
    code: typeof error.code === "string" ? error.code : undefined,
    details: typeof error.details === "string" ? error.details : undefined,
    hint: typeof error.hint === "string" ? error.hint : undefined,
    message: typeof error.message === "string" ? error.message : undefined
  };
}

function summarizeMiniCaseTopicRows(
  rows: ReturnType<typeof buildMiniCaseTopicPreferenceRows>
): Array<{ topic_id: string; enabled: boolean; position: number }> {
  return rows.map((row) => ({
    topic_id: row.topic_id,
    enabled: row.enabled,
    position: row.position
  }));
}

function redactIdentifier(identifier: string): string {
  return identifier.length <= 8
    ? identifier
    : `${identifier.slice(0, 4)}...${identifier.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeStoredMiniCaseTopicId(value: string | null): MiniCaseTopicId | null {
  if (!value) {
    return null;
  }

  if (isMiniCaseTopicId(value)) {
    return value;
  }

  switch (value) {
    case "ai":
    case "law_compliance":
    case "health_pharma":
    case "engineering_operations":
    case "finance_economy":
    case "stock_market":
      return value;
    case "artificial_intelligence":
      return "ai";
    case "health":
      return "health_pharma";
    case "market":
      return "stock_market";
    default:
      break;
  }

  return mapBackendTopicToMiniCaseTopic(value as TopicId);
}

async function upsertUserPreferences(input: {
  businessStoriesEnabled: boolean;
  miniCasesEnabled: boolean;
  newsletterEnabled: boolean;
  newsletterArticleCount: number;
  primaryMiniCaseTopicId: TopicId | null;
  userId: string;
}) {
  if (!supabase) {
    return {
      data: null,
      error: {
        code: "missing_supabase_config",
        message: "Supabase is not configured."
      }
    };
  }

  const result = await supabase.from("user_preferences").upsert({
    user_id: input.userId,
    business_stories_enabled: input.businessStoriesEnabled,
    mini_cases_enabled: input.miniCasesEnabled,
    mini_case_topic_id: input.primaryMiniCaseTopicId,
    newsletter_enabled: input.newsletterEnabled,
    newsletter_article_count: input.newsletterArticleCount
  });

  if (!isMissingColumnError(result.error, "mini_case_topic_id")) {
    return result;
  }

  logPreferencesDebug("user_preferences_legacy_mini_case_column_missing", {
    error: describeSupabaseError(result.error),
    query: "user_preferences.upsert",
    user_id: redactIdentifier(input.userId)
  });

  return supabase.from("user_preferences").upsert({
    user_id: input.userId,
    business_stories_enabled: input.businessStoriesEnabled,
    mini_cases_enabled: input.miniCasesEnabled,
    newsletter_enabled: input.newsletterEnabled,
    newsletter_article_count: input.newsletterArticleCount
  });
}

function normalizeEnabledModules(
  userPreferences:
    | {
        newsletter_enabled?: boolean | null;
        business_stories_enabled?: boolean | null;
        mini_cases_enabled?: boolean | null;
      }
    | null
    | undefined
): OnboardingModuleId[] {
  if (!userPreferences) {
    return DEFAULT_PREFERENCES.enabledModules;
  }

  return normalizeEnabledModuleIds([
    userPreferences.newsletter_enabled === false ? null : "newsletter",
    userPreferences.business_stories_enabled === false ? null : "business_story",
    userPreferences.mini_cases_enabled === false ? null : "mini_case"
  ].filter((moduleId): moduleId is OnboardingModuleId => Boolean(moduleId)));
}

function normalizeEnabledModuleIds(moduleIds: readonly OnboardingModuleId[]) {
  return moduleIds.filter(
    (moduleId, index, modules) =>
      ONBOARDING_MODULE_IDS.includes(moduleId) && modules.indexOf(moduleId) === index
  );
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return (
    error.code === "PGRST204" &&
    typeof error.message === "string" &&
    error.message.includes(columnName)
  );
}
