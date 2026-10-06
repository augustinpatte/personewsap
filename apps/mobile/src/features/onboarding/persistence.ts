import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import { localized } from "../../lib/i18n";
import type { MobileSupabaseClient, NormalizedSupabaseError } from "../../lib/supabase";
import type { Language } from "../../types/domain";
import {
  persistUserPreferenceRows,
  type PreferenceWriteStep
} from "../preferences/preferencesPersistence";
import type { OnboardingState } from "./OnboardingState";
import {
  mapMiniCaseTopicToBackendTopic,
  MAX_MINI_CASE_TOPICS,
  MIN_MINI_CASE_TOPICS,
  normalizeMiniCaseTopics,
  normalizeNewsletterTopics
} from "./options";
import { redactIdentifier } from "../../lib/redactIdentifier";

type SaveOnboardingPreferencesResult =
  | { ok: true }
  | {
      ok: false;
      error: NormalizedSupabaseError;
      /** Set when one of the shared preference writes failed (non-atomic; see persistUserPreferenceRows). */
      failedStep?: PreferenceWriteStep;
      completedSteps?: PreferenceWriteStep[];
    };

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

  // The profile is written first and on its own: it is onboarding-specific, and
  // the shared preference writer below never touches profiles. If a later step
  // fails the profile row stays (it is an idempotent upsert), the reader stays
  // in onboarding because completion is read from the preference tables, and
  // saving again converges.
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

  // The same writer Settings uses: same normalization, same storable
  // newsletter_article_count (never 0 when the newsletter is off), same
  // schema-compatibility fallback.
  const preferencesResult = await persistUserPreferenceRows(
    user.id,
    {
      enabledModules: state.enabledModules,
      selectedTopics,
      miniCaseTopics: selectedMiniCaseTopics,
      articlesPerTopic: state.articlesPerTopic
    },
    language
  );

  if (!preferencesResult.ok) {
    logOnboardingProof(`${preferencesResult.failedStep}_save_failed`, {
      completed_steps: preferencesResult.completedSteps,
      reason: "supabase_error",
      selected_topic_count: selectedTopics.length,
      selected_mini_case_topic_count: selectedMiniCaseTopics.length,
      user_id: redactIdentifier(user.id)
    });

    return {
      ok: false,
      error: preferencesResult.error,
      failedStep: preferencesResult.failedStep,
      completedSteps: preferencesResult.completedSteps
    };
  }

  const totalArticleCount = preferencesResult.newsletterArticleCount;

  logOnboardingProof("onboarding_saved", {
    enabled_topic_count: selectedTopics.length,
    mini_case_primary_topic_id: selectedMiniCaseTopics[0]
      ? mapMiniCaseTopicToBackendTopic(selectedMiniCaseTopics[0])
      : null,
    mini_case_topic_count: selectedMiniCaseTopics.length,
    language,
    newsletter_article_count: totalArticleCount,
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

function logOnboardingProof(event: string, details: Record<string, unknown>) {
  if (__DEV__) {
    console.info("[Onboarding proof]", {
      event,
      ...details
    });
  }
}
