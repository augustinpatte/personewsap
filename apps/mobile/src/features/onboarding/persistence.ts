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
    return { ok: false, error: normalizeSupabaseError(profileResult.error) };
  }

  const preferencesResult = await client.from("user_preferences").upsert({
    user_id: user.id,
    goal,
    frequency: state.frequency,
    newsletter_article_count: totalArticleCount
  });

  if (preferencesResult.error) {
    return { ok: false, error: normalizeSupabaseError(preferencesResult.error) };
  }

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
    return { ok: false, error: normalizeSupabaseError(topicsResult.error) };
  }

  return { ok: true };
}

function getDeviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}
