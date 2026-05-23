import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import { localized } from "../../lib/i18n";
import type { MobileSupabaseClient, NormalizedSupabaseError } from "../../lib/supabase";
import type { Language, TopicId } from "../../types/domain";
import type { OnboardingState } from "./OnboardingState";
import {
  buildMiniCaseTopicPreferenceRows,
  buildNewsletterTopicPreferenceRows,
  clampNewsletterArticleCount,
  mapMiniCaseTopicToBackendTopic,
  MAX_MINI_CASE_TOPICS,
  MIN_MINI_CASE_TOPICS,
  normalizeMiniCaseTopics,
  normalizeNewsletterTopics
} from "./options";

type SaveOnboardingPreferencesResult =
  | { ok: true }
  | { ok: false; error: NormalizedSupabaseError };

const DEFAULT_TIMEZONE = "UTC";

export async function saveOnboardingPreferences(
  state: OnboardingState
): Promise<SaveOnboardingPreferencesResult> {
  const client = supabase;
  const language = state.language;
  const selectedTopics = normalizeNewsletterTopics(state.selectedTopics);
  const selectedMiniCaseTopics = normalizeMiniCaseTopics(state.selectedMiniCaseTopics);
  const newsletterEnabled = state.enabledModules.includes("newsletter");
  const miniCasesEnabled = state.enabledModules.includes("mini_case");

  if (!client) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "missing_supabase_config"
    });

    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: localized(
          {
            en: "Live account setup is not configured for this build.",
            fr: "La configuration du compte live n'est pas prête pour cette version."
          },
          language
        ),
        hint:
          "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
      }
    };
  }

  if (
    !language ||
    state.enabledModules.length === 0 ||
    (newsletterEnabled && (selectedTopics.length === 0 || !state.newsletterConfigurationComplete)) ||
    (miniCasesEnabled &&
      (selectedMiniCaseTopics.length < MIN_MINI_CASE_TOPICS ||
        selectedMiniCaseTopics.length > MAX_MINI_CASE_TOPICS))
  ) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "incomplete_onboarding"
    });

    return {
      ok: false,
      error: {
        code: "incomplete_onboarding",
        message: localized(
          {
            en: "Complete newsletter topics, article counts, and mini-case topics before saving.",
            fr: "Termine les modules, sujets et options nécessaires avant d'enregistrer."
          },
          language
        )
      }
    };
  }

  try {
    return await saveValidatedOnboardingPreferences(
      client,
      state,
      language,
      selectedTopics,
      selectedMiniCaseTopics
    );
  } catch (error) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "exception"
    });

    return {
      ok: false,
      error: normalizeSupabaseError(
        error,
        localized(
          {
            en: "Could not save onboarding preferences.",
            fr: "Impossible d'enregistrer tes préférences de configuration."
          },
          language
        )
      )
    };
  }
}

async function saveValidatedOnboardingPreferences(
  client: MobileSupabaseClient,
  state: OnboardingState,
  language: Language,
  selectedTopics: ReturnType<typeof normalizeNewsletterTopics>,
  selectedMiniCaseTopics: ReturnType<typeof normalizeMiniCaseTopics>
): Promise<SaveOnboardingPreferencesResult> {
  const sessionResult = await getAuthSession();

  if (sessionResult.error || !sessionResult.data?.user) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "missing_auth_session"
    });

    return {
      ok: false,
      error:
        sessionResult.error ??
        ({
          code: "missing_auth_session",
          message: localized(
            {
              en: "Sign in before saving onboarding preferences.",
              fr: "Connecte-toi avant d'enregistrer tes préférences de configuration."
            },
            language
          )
        } satisfies NormalizedSupabaseError)
    };
  }

  const user = sessionResult.data.user;

  if (!user.email) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "missing_user_email",
      user_id: redactIdentifier(user.id)
    });

    return {
      ok: false,
      error: {
        code: "missing_user_email",
        message: localized(
          {
            en: "The authenticated user does not have an email address.",
            fr: "L'utilisateur connecté n'a pas d'adresse email."
          },
          language
        )
      }
    };
  }

  const totalArticleCount = selectedTopics.reduce(
    (total, topicId) =>
      total + clampNewsletterArticleCount(state.articlesPerTopic[topicId] ?? 1),
    0
  );
  const profileResult = await client.from("profiles").upsert({
    id: user.id,
    email: user.email,
    language,
    timezone: getDeviceTimezone()
  });

  if (profileResult.error) {
    logOnboardingProof("profile_save_failed", {
      reason: "supabase_error",
      user_id: redactIdentifier(user.id)
    });

    return {
      ok: false,
      error: normalizeSupabaseError(
        profileResult.error,
        localized(
          {
            en: "Could not save your profile.",
            fr: "Impossible d'enregistrer ton profil."
          },
          language
        )
      )
    };
  }

  logOnboardingProof("profile_saved", {
    language,
    user_id: redactIdentifier(user.id)
  });

  const preferencesResult = await upsertUserPreferences(client, {
    businessStoriesEnabled: state.enabledModules.includes("business_story"),
    miniCasesEnabled: state.enabledModules.includes("mini_case"),
    newsletterEnabled: state.enabledModules.includes("newsletter"),
    newsletterArticleCount: totalArticleCount,
    primaryMiniCaseTopicId: selectedMiniCaseTopics[0]
      ? mapMiniCaseTopicToBackendTopic(selectedMiniCaseTopics[0])
      : null,
    userId: user.id
  });

  if (preferencesResult.error) {
    logOnboardingProof("user_preferences_save_failed", {
      reason: "supabase_error",
      user_id: redactIdentifier(user.id)
    });

    return {
      ok: false,
      error: normalizeSupabaseError(
        preferencesResult.error,
        localized(
          {
            en: "Could not save your preferences.",
            fr: "Impossible d'enregistrer tes préférences."
          },
          language
        )
      )
    };
  }

  logOnboardingProof("user_preferences_saved", {
    mini_case_primary_topic_id: mapMiniCaseTopicToBackendTopic(selectedMiniCaseTopics[0]),
    newsletter_article_count: totalArticleCount,
    user_id: redactIdentifier(user.id)
  });

  const topicPreferenceRows = buildNewsletterTopicPreferenceRows({
    articlesPerTopic: state.articlesPerTopic,
    selectedTopics,
    userId: user.id
  });

  const topicsResult = await client.from("user_topic_preferences").upsert(
    topicPreferenceRows,
    {
      onConflict: "user_id,topic_id"
    }
  );

  if (topicsResult.error) {
    logOnboardingProof("user_topic_preferences_save_failed", {
      reason: "supabase_error",
      selected_topic_count: selectedTopics.length,
      user_id: redactIdentifier(user.id)
    });

    return {
      ok: false,
      error: normalizeSupabaseError(
        topicsResult.error,
        localized(
          {
            en: "Could not save your newsletter topics.",
            fr: "Impossible d'enregistrer tes sujets newsletter."
          },
          language
        )
      )
    };
  }

  const miniCaseTopicPreferenceRows = buildMiniCaseTopicPreferenceRows({
    selectedTopics: selectedMiniCaseTopics,
    userId: user.id
  });

  const miniCaseTopicsResult = await client
    .from("user_mini_case_topic_preferences")
    .upsert(miniCaseTopicPreferenceRows, {
      onConflict: "user_id,topic_id"
    });

  if (miniCaseTopicsResult.error) {
    logOnboardingProof("user_mini_case_topic_preferences_save_failed", {
      error: describeSupabaseError(miniCaseTopicsResult.error),
      attempted_rows: summarizeMiniCaseTopicRows(miniCaseTopicPreferenceRows),
      query: "user_mini_case_topic_preferences.upsert",
      reason: "supabase_error",
      selected_topic_count: selectedMiniCaseTopics.length,
      user_id: redactIdentifier(user.id)
    });

    return {
      ok: false,
      error: normalizeSupabaseError(
        miniCaseTopicsResult.error,
        localized(
          {
            en: "Could not save your mini-case topics.",
            fr: "Impossible d'enregistrer tes sujets mini-cas."
          },
          language
        )
      )
    };
  }

  logOnboardingProof("onboarding_saved", {
    enabled_topic_count: selectedTopics.length,
    mini_case_topic_count: selectedMiniCaseTopics.length,
    language,
    total_topic_rows: topicPreferenceRows.length,
    user_id: redactIdentifier(user.id)
  });

  logOnboardingProof("daily_job_test_eligible", {
    enabled_topic_count: selectedTopics.length,
    enabled_mini_case_topic_count: selectedMiniCaseTopics.length,
    has_profile: true,
    has_mini_case_topic_preferences: true,
    has_user_preferences: true,
    has_user_topic_preferences: true,
    language,
    newsletter_article_count: totalArticleCount,
    user_id: redactIdentifier(user.id)
  });

  return { ok: true };
}

function getDeviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}

async function upsertUserPreferences(
  client: MobileSupabaseClient,
  input: {
    businessStoriesEnabled: boolean;
    miniCasesEnabled: boolean;
    newsletterEnabled: boolean;
    newsletterArticleCount: number;
    primaryMiniCaseTopicId: TopicId | null;
    userId: string;
  }
) {
  const payload = {
    user_id: input.userId,
    business_stories_enabled: input.businessStoriesEnabled,
    mini_cases_enabled: input.miniCasesEnabled,
    mini_case_topic_id: input.primaryMiniCaseTopicId,
    newsletter_enabled: input.newsletterEnabled,
    newsletter_article_count: input.newsletterArticleCount
  };
  const result = await client.from("user_preferences").upsert(payload);

  if (!isMissingColumnError(result.error, "mini_case_topic_id")) {
    return result;
  }

  logOnboardingProof("user_preferences_legacy_mini_case_column_missing", {
    error: describeSupabaseError(result.error),
    query: "user_preferences.upsert",
    user_id: redactIdentifier(input.userId)
  });

  return client.from("user_preferences").upsert({
    user_id: input.userId,
    newsletter_article_count: input.newsletterArticleCount
  });
}

function logOnboardingProof(event: string, details: Record<string, unknown>) {
  if (__DEV__) {
    console.info("[Onboarding proof]", {
      event,
      ...details
    });
  }
}

function redactIdentifier(identifier: string): string {
  return identifier.length <= 8
    ? identifier
    : `${identifier.slice(0, 4)}...${identifier.slice(-4)}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
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
