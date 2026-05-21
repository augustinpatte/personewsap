import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import { localized } from "../../lib/i18n";
import type { MobileSupabaseClient, NormalizedSupabaseError } from "../../lib/supabase";
import type { Language } from "../../types/domain";
import type { OnboardingState } from "./OnboardingState";
import {
  buildNewsletterTopicPreferenceRows,
  clampNewsletterArticleCount,
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

  if (!language || selectedTopics.length === 0) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "incomplete_onboarding"
    });

    return {
      ok: false,
      error: {
        code: "incomplete_onboarding",
        message: localized(
          {
            en: "Choose a language and at least one newsletter category before saving.",
            fr: "Choisis une langue et au moins une catégorie newsletter avant d'enregistrer."
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
      selectedTopics
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
  selectedTopics: ReturnType<typeof normalizeNewsletterTopics>
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

  const preferencesResult = await client.from("user_preferences").upsert({
    user_id: user.id,
    newsletter_article_count: totalArticleCount
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

  logOnboardingProof("onboarding_saved", {
    enabled_topic_count: selectedTopics.length,
    language,
    total_topic_rows: topicPreferenceRows.length,
    user_id: redactIdentifier(user.id)
  });

  logOnboardingProof("daily_job_test_eligible", {
    enabled_topic_count: selectedTopics.length,
    has_profile: true,
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
