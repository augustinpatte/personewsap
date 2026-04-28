import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import type { MobileSupabaseClient, NormalizedSupabaseError } from "../../lib/supabase";
import type { GoalId, Language } from "../../types/domain";
import type { OnboardingState } from "./OnboardingState";
import { TOPIC_OPTIONS } from "./options";

type SaveOnboardingPreferencesResult =
  | { ok: true }
  | { ok: false; error: NormalizedSupabaseError };

const DEFAULT_TIMEZONE = "UTC";

export async function saveOnboardingPreferences(
  state: OnboardingState
): Promise<SaveOnboardingPreferencesResult> {
  const client = supabase;
  const language = state.language;
  const goal = state.goal;

  if (!client) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "missing_supabase_config"
    });

    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: "Live account setup is not configured for this build.",
        hint:
          "Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
      }
    };
  }

  if (!language || !goal || state.selectedTopics.length === 0) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "incomplete_onboarding"
    });

    return {
      ok: false,
      error: {
        code: "incomplete_onboarding",
        message: "Choose a language, goal, and at least one topic before saving."
      }
    };
  }

  try {
    return await saveValidatedOnboardingPreferences(client, state, language, goal);
  } catch (error) {
    logOnboardingProof("onboarding_save_failed", {
      reason: "exception"
    });

    return { ok: false, error: normalizeSupabaseError(error) };
  }
}

async function saveValidatedOnboardingPreferences(
  client: MobileSupabaseClient,
  state: OnboardingState,
  language: Language,
  goal: GoalId
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
          message: "Sign in before saving onboarding preferences."
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
        message: "The authenticated user does not have an email address."
      }
    };
  }

  const selectedTopicIds = new Set(state.selectedTopics);
  const totalArticleCount = state.selectedTopics.reduce(
    (total, topicId) => total + (state.articlesPerTopic[topicId] ?? 1),
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

    return { ok: false, error: normalizeSupabaseError(profileResult.error) };
  }

  logOnboardingProof("profile_saved", {
    language,
    user_id: redactIdentifier(user.id)
  });

  const preferencesResult = await client.from("user_preferences").upsert({
    user_id: user.id,
    goal,
    frequency: state.frequency,
    newsletter_article_count: totalArticleCount
  });

  if (preferencesResult.error) {
    logOnboardingProof("user_preferences_save_failed", {
      reason: "supabase_error",
      user_id: redactIdentifier(user.id)
    });

    return { ok: false, error: normalizeSupabaseError(preferencesResult.error) };
  }

  logOnboardingProof("user_preferences_saved", {
    frequency: state.frequency,
    goal,
    newsletter_article_count: totalArticleCount,
    user_id: redactIdentifier(user.id)
  });

  const topicPreferenceRows = TOPIC_OPTIONS.map((topic, index) => {
    const enabled = selectedTopicIds.has(topic.id);

    return {
      user_id: user.id,
      topic_id: topic.id,
      articles_count: enabled ? state.articlesPerTopic[topic.id] ?? 1 : 1,
      enabled,
      position: enabled ? state.selectedTopics.indexOf(topic.id) + 1 : index + 1
    };
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
      selected_topic_count: state.selectedTopics.length,
      user_id: redactIdentifier(user.id)
    });

    return { ok: false, error: normalizeSupabaseError(topicsResult.error) };
  }

  logOnboardingProof("onboarding_saved", {
    enabled_topic_count: state.selectedTopics.length,
    language,
    total_topic_rows: topicPreferenceRows.length,
    user_id: redactIdentifier(user.id)
  });

  logOnboardingProof("daily_job_test_eligible", {
    enabled_topic_count: state.selectedTopics.length,
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
