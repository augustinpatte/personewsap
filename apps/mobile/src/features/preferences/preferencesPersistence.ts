import { normalizeSupabaseError, supabase } from "../../lib/supabase";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import { localized } from "../../lib/i18n";
import type { Language } from "../../types/domain";
import {
  buildNewsletterTopicPreferenceRows,
  clampNewsletterArticleCount,
  mapBackendTopicToNewsletterTopic,
  normalizeNewsletterTopics,
  type NewsletterTopicId
} from "../onboarding/options";

export type EditablePreferences = {
  language: Language;
  selectedTopics: NewsletterTopicId[];
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
  selectedTopics: [],
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

    return {
      ok: true,
      preferences: normalizeEditablePreferences({
        language: profile?.language ?? DEFAULT_PREFERENCES.language,
        selectedTopics,
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

  if (normalized.selectedTopics.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_topics",
        message: localized(
          {
            en: "Choose at least one newsletter category before saving preferences.",
            fr: "Choisis au moins une catégorie newsletter avant d'enregistrer les préférences."
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

    const userPreferencesResult = await supabase.from("user_preferences").upsert({
      user_id: userId,
      newsletter_article_count: newsletterArticleCount
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

export function normalizeEditablePreferences(preferences: EditablePreferences): EditablePreferences {
  const selectedTopics = normalizeNewsletterTopics(preferences.selectedTopics);

  return {
    ...preferences,
    selectedTopics,
    articlesPerTopic: Object.fromEntries(
      selectedTopics.map((topicId) => [
        topicId,
        clampNewsletterArticleCount(preferences.articlesPerTopic[topicId] ?? 1)
      ])
    ) as Partial<Record<NewsletterTopicId, number>>
  };
}
