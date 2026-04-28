import { normalizeSupabaseError, supabase } from "../../lib/supabase";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import type { GoalId, Language, PreferenceFrequency, TopicId } from "../../types/domain";
import { TOPIC_OPTIONS } from "../onboarding/options";

export type EditablePreferences = {
  language: Language;
  goal: GoalId;
  selectedTopics: TopicId[];
  articlesPerTopic: Partial<Record<TopicId, number>>;
  frequency: PreferenceFrequency;
};

type PreferencesResult =
  | { ok: true; preferences: EditablePreferences }
  | { ok: false; error: NormalizedSupabaseError };

type SavePreferencesResult =
  | { ok: true }
  | { ok: false; error: NormalizedSupabaseError };

const DEFAULT_PREFERENCES: EditablePreferences = {
  language: "en",
  goal: "understand_world",
  selectedTopics: [],
  articlesPerTopic: {},
  frequency: "daily"
};

export async function loadEditablePreferences(userId: string): Promise<PreferencesResult> {
  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: "Live account preferences are not configured for this build."
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
      return { ok: false, error: normalizeSupabaseError(profileError) };
    }

    const { data: userPreferences, error: preferencesError } = await supabase
      .from("user_preferences")
      .select("goal, frequency, newsletter_article_count")
      .eq("user_id", userId)
      .maybeSingle();

    if (preferencesError) {
      return { ok: false, error: normalizeSupabaseError(preferencesError) };
    }

    const { data: topicPreferences, error: topicPreferencesError } = await supabase
      .from("user_topic_preferences")
      .select("topic_id, articles_count, enabled, position")
      .eq("user_id", userId)
      .order("position", { ascending: true, nullsFirst: false });

    if (topicPreferencesError) {
      return { ok: false, error: normalizeSupabaseError(topicPreferencesError) };
    }

    const selectedTopics =
      topicPreferences
        ?.filter((preference) => preference.enabled)
        .map((preference) => preference.topic_id) ?? [];
    const articlesPerTopic = Object.fromEntries(
      topicPreferences?.map((preference) => [
        preference.topic_id,
        clampArticleCount(preference.articles_count)
      ]) ?? []
    ) as Partial<Record<TopicId, number>>;

    return {
      ok: true,
      preferences: normalizeEditablePreferences({
        language: profile?.language ?? DEFAULT_PREFERENCES.language,
        goal: userPreferences?.goal ?? DEFAULT_PREFERENCES.goal,
        frequency: userPreferences?.frequency ?? DEFAULT_PREFERENCES.frequency,
        selectedTopics,
        articlesPerTopic
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error, "Could not load your preferences.")
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
        message: "Live account preferences are not configured for this build."
      }
    };
  }

  const normalized = normalizeEditablePreferences(preferences);

  if (normalized.selectedTopics.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_topics",
        message: "Choose at least one topic before saving preferences."
      }
    };
  }

  try {
    const profileResult = await supabase
      .from("profiles")
      .update({ language: normalized.language })
      .eq("id", userId);

    if (profileResult.error) {
      return { ok: false, error: normalizeSupabaseError(profileResult.error) };
    }

    const newsletterArticleCount = normalized.selectedTopics.reduce(
      (total, topicId) => total + (normalized.articlesPerTopic[topicId] ?? 1),
      0
    );

    const userPreferencesResult = await supabase.from("user_preferences").upsert({
      user_id: userId,
      goal: normalized.goal,
      frequency: normalized.frequency,
      newsletter_article_count: newsletterArticleCount
    });

    if (userPreferencesResult.error) {
      return { ok: false, error: normalizeSupabaseError(userPreferencesResult.error) };
    }

    const selectedTopicIds = new Set(normalized.selectedTopics);
    const topicPreferenceRows = TOPIC_OPTIONS.map((topic, index) => {
      const enabled = selectedTopicIds.has(topic.id);

      return {
        user_id: userId,
        topic_id: topic.id,
        articles_count: enabled ? normalized.articlesPerTopic[topic.id] ?? 1 : 1,
        enabled,
        position: enabled ? normalized.selectedTopics.indexOf(topic.id) + 1 : index + 1
      };
    });

    const topicPreferencesResult = await supabase
      .from("user_topic_preferences")
      .upsert(topicPreferenceRows, { onConflict: "user_id,topic_id" });

    if (topicPreferencesResult.error) {
      return { ok: false, error: normalizeSupabaseError(topicPreferencesResult.error) };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error, "Could not save your preferences.")
    };
  }
}

export function normalizeEditablePreferences(preferences: EditablePreferences): EditablePreferences {
  const selectedTopics = preferences.selectedTopics.filter(
    (topicId, index, topics) => topics.indexOf(topicId) === index
  );

  return {
    ...preferences,
    selectedTopics,
    articlesPerTopic: Object.fromEntries(
      selectedTopics.map((topicId) => [
        topicId,
        clampArticleCount(preferences.articlesPerTopic[topicId] ?? 1)
      ])
    ) as Partial<Record<TopicId, number>>
  };
}

function clampArticleCount(count: number) {
  return Math.min(Math.max(count, 1), 3);
}
