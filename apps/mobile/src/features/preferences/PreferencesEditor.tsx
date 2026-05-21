import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AppText, PrimaryButton, ProgressPill, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { formatLanguageName, localized } from "../../lib/i18n";
import { getUserFacingErrorMessage } from "../../lib/userFacingErrors";
import type { Language } from "../../types/domain";
import {
  ArticleCountRow,
  LANGUAGE_OPTIONS,
  localizeOptions,
  mapNewsletterTopicToBackendTopic,
  SelectableCard,
  TOPIC_OPTIONS,
  type NewsletterTopicId
} from "../onboarding";
import {
  loadEditablePreferences,
  normalizeEditablePreferences,
  saveEditablePreferences,
  type EditablePreferences
} from "./preferencesPersistence";

type PreferencesEditorProps = {
  userId: string | null;
  refreshKey: number;
  uiLanguage?: Language | null;
  onSaved?: () => Promise<void> | void;
};

export function PreferencesEditor({
  userId,
  refreshKey,
  uiLanguage: preferredUiLanguage,
  onSaved
}: PreferencesEditorProps) {
  const [draft, setDraft] = useState<EditablePreferences | null>(null);
  const [saved, setSaved] = useState<EditablePreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const uiLanguage = draft?.language ?? saved?.language ?? preferredUiLanguage ?? "en";
  const copy = getPreferencesCopy(uiLanguage);
  const languageOptions = useMemo(
    () => localizeOptions(LANGUAGE_OPTIONS, uiLanguage),
    [uiLanguage]
  );
  const topicOptions = useMemo(
    () => localizeOptions(TOPIC_OPTIONS, uiLanguage),
    [uiLanguage]
  );

  const loadPreferences = useCallback(async () => {
    if (!userId) {
      setDraft(null);
      setSaved(null);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const result = await loadEditablePreferences(userId, preferredUiLanguage ?? null);

    setLoading(false);

    if (!result.ok) {
      setErrorMessage(
        getUserFacingErrorMessage(result.error, preferredUiLanguage, "preferences")
      );
      return;
    }

    setDraft(result.preferences);
    setSaved(result.preferences);
  }, [preferredUiLanguage, userId]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences, refreshKey]);

  useEffect(() => {
    if (errorMessage) {
      trackAnalyticsEvent("error_viewed", {
        language: draft?.language ?? saved?.language ?? undefined
      });
    }
  }, [draft?.language, errorMessage, saved?.language]);

  const selectedTopicOptions = useMemo(
    () =>
      draft?.selectedTopics
        .map((topicId) => topicOptions.find((option) => option.id === topicId))
        .filter((topic): topic is (typeof TOPIC_OPTIONS)[number] => Boolean(topic)) ?? [],
    [draft?.selectedTopics, topicOptions]
  );

  const totalArticleCount = useMemo(
    () =>
      draft?.selectedTopics.reduce(
        (total, topicId) => total + (draft.articlesPerTopic[topicId] ?? 1),
        0
      ) ?? 0,
    [draft]
  );

  const hasChanges = useMemo(() => {
    if (!draft || !saved) {
      return false;
    }

    return serializePreferences(draft) !== serializePreferences(saved);
  }, [draft, saved]);

  const patchDraft = useCallback((patch: Partial<EditablePreferences>) => {
    setDraft((current) => (current ? normalizeEditablePreferences({ ...current, ...patch }) : current));
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  const toggleTopic = useCallback((topicId: NewsletterTopicId) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const isSelected = current.selectedTopics.includes(topicId);
      const selectedTopics = isSelected
        ? current.selectedTopics.filter((selectedTopicId) => selectedTopicId !== topicId)
        : [...current.selectedTopics, topicId];
      const articlesPerTopic = { ...current.articlesPerTopic };

      if (isSelected) {
        delete articlesPerTopic[topicId];
      } else {
        articlesPerTopic[topicId] = articlesPerTopic[topicId] ?? 1;
      }

      return normalizeEditablePreferences({
        ...current,
        selectedTopics,
        articlesPerTopic
      });
    });
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  const setArticleCount = useCallback((topicId: NewsletterTopicId, count: number) => {
    setDraft((current) =>
      current
        ? normalizeEditablePreferences({
            ...current,
            articlesPerTopic: {
              ...current.articlesPerTopic,
              [topicId]: count
            }
          })
        : current
    );
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  const savePreferences = useCallback(async () => {
    if (!userId || !draft) {
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const normalized = normalizeEditablePreferences(draft);
    const result = await saveEditablePreferences(userId, normalized);

    setSaving(false);

    if (!result.ok) {
      setErrorMessage(getUserFacingErrorMessage(result.error, normalized.language, "preferences"));
      return;
    }

    trackSavedPreferenceUpdates(saved, normalized);
    setDraft(normalized);
    setSaved(normalized);
    setStatusMessage(getPreferencesCopy(normalized.language).saved);
    await onSaved?.();
  }, [draft, onSaved, saved, userId]);

  if (!userId) {
    return (
      <View style={styles.section}>
        <AppText variant="subtitle">{copy.title}</AppText>
        <AppText color="muted" variant="body">
          {copy.signIn}
        </AppText>
      </View>
    );
  }

  if (loading && !draft) {
    return (
      <View style={[styles.section, styles.loadingSection]}>
        <ActivityIndicator color={tokens.color.accent} />
        <AppText color="muted" variant="body">
          {copy.loading}
        </AppText>
      </View>
    );
  }

  if (!draft) {
    return (
      <View style={styles.section}>
        <AppText variant="subtitle">{copy.title}</AppText>
        {errorMessage ? <AppText color="danger" variant="body">{errorMessage}</AppText> : null}
        <SecondaryButton disabled={loading} label={copy.tryAgain} onPress={loadPreferences} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionTopline}>
        <View style={styles.sectionCopy}>
          <AppText variant="subtitle">{copy.title}</AppText>
          <AppText color="muted" variant="body">
            {copy.description}
          </AppText>
        </View>
        <ProgressPill
          label={loading ? copy.refreshing : copy.articlePill(totalArticleCount)}
          tone={loading ? "warning" : "neutral"}
        />
      </View>

      {loading ? (
        <AppText color="muted" variant="caption">
          {copy.refreshingDetail}
        </AppText>
      ) : null}

      <PreferenceSummary
        copy={copy}
        preferences={draft}
        topicOptions={topicOptions}
        totalArticleCount={totalArticleCount}
      />

      <PreferenceGroup title={copy.language}>
        {languageOptions.map((option) => (
          <SelectableCard
            description={option.description}
            key={option.id}
            label={option.label}
            onPress={() => patchDraft({ language: option.id })}
            selected={draft.language === option.id}
          />
        ))}
      </PreferenceGroup>

      <PreferenceGroup title={copy.topics}>
        <AppText color="muted" variant="caption">
          {copy.topicsHelp}
        </AppText>
        {topicOptions.map((option) => (
          <SelectableCard
            description={option.description}
            key={option.id}
            label={option.label}
            onPress={() => toggleTopic(option.id)}
            selected={draft.selectedTopics.includes(option.id)}
            selectedBadge={copy.selected}
            unselectedBadge={copy.notSelected}
          />
        ))}
      </PreferenceGroup>

      <PreferenceGroup title={copy.articleCounts}>
        {selectedTopicOptions.length > 0 ? (
          selectedTopicOptions.map((topic) => (
            <ArticleCountRow
              count={draft.articlesPerTopic[topic.id] ?? 1}
              countLabel={copy.countLabel(draft.articlesPerTopic[topic.id] ?? 1)}
              description={topic.description}
              key={topic.id}
              label={topic.label}
              onChange={(count) => setArticleCount(topic.id, count)}
            />
          ))
        ) : (
          <AppText color="danger" variant="body">
            {copy.missingTopic}
          </AppText>
        )}
      </PreferenceGroup>

      {errorMessage ? <AppText color="danger" variant="body">{errorMessage}</AppText> : null}
      {statusMessage ? <AppText color="accent" variant="bodyStrong">{statusMessage}</AppText> : null}

      <View style={styles.actions}>
        <SecondaryButton
          disabled={saving || loading || !hasChanges}
          label={copy.reset}
          onPress={() => {
            if (saved) {
              setDraft(saved);
              setErrorMessage(null);
              setStatusMessage(null);
            }
          }}
        />
        <PrimaryButton
          disabled={
            saving ||
            loading ||
            !hasChanges ||
            draft.selectedTopics.length === 0
          }
          label={saving ? copy.saving : copy.saveChanges}
          loading={saving}
          onPress={savePreferences}
          testID="preferences-save-button"
        />
      </View>
    </View>
  );
}

function PreferenceSummary({
  copy,
  preferences,
  topicOptions,
  totalArticleCount
}: {
  copy: ReturnType<typeof getPreferencesCopy>;
  preferences: EditablePreferences;
  topicOptions: Array<(typeof TOPIC_OPTIONS)[number]>;
  totalArticleCount: number;
}) {
  const topicLabels = preferences.selectedTopics
    .map((topicId) => topicOptions.find((topic) => topic.id === topicId)?.label)
    .filter((label): label is string => Boolean(label));
  return (
    <View style={styles.summaryPanel}>
      <View style={styles.summaryRow}>
        <AppText color="muted" variant="caption">
          {copy.language}
        </AppText>
        <AppText variant="bodyStrong">
          {formatLanguageName(preferences.language, preferences.language)}
        </AppText>
      </View>
      <View style={styles.summaryRow}>
        <AppText color="muted" variant="caption">
          {copy.topics}
        </AppText>
        <AppText style={styles.summaryValue} variant="bodyStrong">
          {topicLabels.length > 0 ? topicLabels.join(", ") : copy.missingTopic}
        </AppText>
      </View>
      <View style={styles.summaryRow}>
        <AppText color="muted" variant="caption">
          {copy.articleCounts}
        </AppText>
        <AppText variant="bodyStrong">{copy.summaryArticles(totalArticleCount)}</AppText>
      </View>
    </View>
  );
}

function PreferenceGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.group}>
      <AppText color="muted" style={styles.groupTitle} variant="caption">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function serializePreferences(preferences: EditablePreferences) {
  const normalized = normalizeEditablePreferences(preferences);

  return JSON.stringify({
    language: normalized.language,
    selectedTopics: normalized.selectedTopics,
    articlesPerTopic: normalized.articlesPerTopic
  });
}

function getPreferencesCopy(language: EditablePreferences["language"]) {
  return localized(
    {
      en: {
        title: "Preferences",
        description:
          "Changes apply to future daily drops. Today's drop may already be generated.",
        signIn: "Sign in to edit your daily drop preferences.",
        loading: "Loading preferences...",
        tryAgain: "Try again",
        refreshing: "Refreshing",
        refreshingDetail:
          "Refreshing settings. Last loaded choices stay editable while the app checks live data.",
        saved:
          "Saved. Future daily drops will use these newsletter preferences.",
        language: "Language",
        topics: "Newsletter topics",
        topicsHelp:
          "Choose one or more categories. These choices guide newsletter depth and mini-cases.",
        articleCounts: "Newsletter depth",
        missingTopic: "Select at least one newsletter category to save preferences.",
        selected: "Selected",
        notSelected: "Not selected",
        reset: "Reset",
        saving: "Saving...",
        saveChanges: "Save changes",
        articlePill: (count: number) => `${count} article${count === 1 ? "" : "s"}`,
        countLabel: (count: number) => `${count} per drop`,
        summaryArticles: (count: number) =>
          `${count} article${count === 1 ? "" : "s"} · daily`
      },
      fr: {
        title: "Préférences",
        description:
          "Les changements s'appliquent aux prochaines mises à jour quotidiennes. Celle d'aujourd'hui peut déjà être générée.",
        signIn: "Connecte-toi pour modifier tes préférences de mise à jour quotidienne.",
        loading: "Chargement des préférences...",
        tryAgain: "Réessayer",
        refreshing: "Actualisation",
        refreshingDetail:
          "Actualisation des réglages. Les derniers choix chargés restent modifiables pendant la vérification.",
        saved:
          "Enregistré. Les prochaines mises à jour utiliseront ces préférences newsletter.",
        language: "Langue",
        topics: "Sujets newsletter",
        topicsHelp:
          "Choisis une ou plusieurs catégories. Ces choix guident la profondeur newsletter et les mini-cas.",
        articleCounts: "Profondeur newsletter",
        missingTopic: "Sélectionne au moins une catégorie newsletter pour enregistrer les préférences.",
        selected: "Sélectionné",
        notSelected: "Non sélectionné",
        reset: "Réinitialiser",
        saving: "Enregistrement...",
        saveChanges: "Enregistrer",
        articlePill: (count: number) => `${count} article${count > 1 ? "s" : ""}`,
        countLabel: (count: number) => `${count} par jour`,
        summaryArticles: (count: number) =>
          `${count} article${count > 1 ? "s" : ""} · quotidien`
      }
    },
    language
  );
}

function trackSavedPreferenceUpdates(
  previous: EditablePreferences | null,
  next: EditablePreferences
) {
  if (previous?.language !== next.language) {
    trackAnalyticsEvent("language_updated", {
      language: next.language
    });
  }

  const changedTopics = getChangedTopics(previous, next);

  for (const topic of changedTopics) {
    trackAnalyticsEvent("topic_preference_updated", {
      language: next.language,
      topic: mapNewsletterTopicToBackendTopic(topic)
    });
  }
}

function getChangedTopics(
  previous: EditablePreferences | null,
  next: EditablePreferences
) {
  const changedTopics = new Set<NewsletterTopicId>();
  const previousTopics = new Set(previous?.selectedTopics ?? []);
  const nextTopics = new Set(next.selectedTopics);

  for (const topic of previousTopics) {
    if (!nextTopics.has(topic)) {
      changedTopics.add(topic);
    }
  }

  for (const topic of nextTopics) {
    if (!previousTopics.has(topic)) {
      changedTopics.add(topic);
      continue;
    }

    if ((previous?.articlesPerTopic[topic] ?? 1) !== (next.articlesPerTopic[topic] ?? 1)) {
      changedTopics.add(topic);
    }
  }

  return changedTopics;
}

const styles = StyleSheet.create({
  actions: {
    gap: tokens.space.md
  },
  group: {
    gap: tokens.space.md
  },
  groupTitle: {
    textTransform: "uppercase"
  },
  loadingSection: {
    alignItems: "center",
    paddingVertical: tokens.space.xl
  },
  summaryPanel: {
    backgroundColor: tokens.color.backgroundRaised,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.md,
    padding: tokens.space.md
  },
  summaryRow: {
    gap: tokens.space.xs
  },
  summaryValue: {
    flexShrink: 1
  },
  section: {
    gap: tokens.space.lg
  },
  sectionCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  sectionTopline: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  }
});
