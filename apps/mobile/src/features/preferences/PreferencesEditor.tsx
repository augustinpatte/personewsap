import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AppText, PrimaryButton, ProgressPill, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import type { PreferenceFrequency, TopicId } from "../../types/domain";
import {
  ArticleCountRow,
  FREQUENCY_OPTIONS,
  GOAL_OPTIONS,
  LANGUAGE_OPTIONS,
  SelectableCard,
  TOPIC_OPTIONS
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
  onSaved?: () => Promise<void> | void;
};

export function PreferencesEditor({ userId, refreshKey, onSaved }: PreferencesEditorProps) {
  const [draft, setDraft] = useState<EditablePreferences | null>(null);
  const [saved, setSaved] = useState<EditablePreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPreferences = useCallback(async () => {
    if (!userId) {
      setDraft(null);
      setSaved(null);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const result = await loadEditablePreferences(userId);

    setLoading(false);

    if (!result.ok) {
      setErrorMessage(result.error.message);
      return;
    }

    setDraft(result.preferences);
    setSaved(result.preferences);
  }, [userId]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences, refreshKey]);

  const selectedTopicOptions = useMemo(
    () =>
      draft?.selectedTopics
        .map((topicId) => TOPIC_OPTIONS.find((option) => option.id === topicId))
        .filter((topic): topic is (typeof TOPIC_OPTIONS)[number] => Boolean(topic)) ?? [],
    [draft?.selectedTopics]
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

  const toggleTopic = useCallback((topicId: TopicId) => {
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

  const setArticleCount = useCallback((topicId: TopicId, count: number) => {
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
      setErrorMessage(result.error.message);
      return;
    }

    setDraft(normalized);
    setSaved(normalized);
    setStatusMessage("Saved. Future daily drops will use these preferences.");
    await onSaved?.();
  }, [draft, onSaved, userId]);

  if (!userId) {
    return (
      <View style={styles.section}>
        <AppText variant="subtitle">Preferences</AppText>
        <AppText color="muted" variant="body">
          Sign in to edit your daily drop preferences.
        </AppText>
      </View>
    );
  }

  if (loading && !draft) {
    return (
      <View style={[styles.section, styles.loadingSection]}>
        <ActivityIndicator color={tokens.color.accent} />
        <AppText color="muted" variant="body">
          Loading preferences...
        </AppText>
      </View>
    );
  }

  if (!draft) {
    return (
      <View style={styles.section}>
        <AppText variant="subtitle">Preferences</AppText>
        {errorMessage ? <AppText color="danger" variant="body">{errorMessage}</AppText> : null}
        <SecondaryButton disabled={loading} label="Try again" onPress={loadPreferences} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionTopline}>
        <View style={styles.sectionCopy}>
          <AppText variant="subtitle">Preferences</AppText>
          <AppText color="muted" variant="body">
            Changes apply to future daily drops. Today's drop may already be generated.
          </AppText>
        </View>
        <ProgressPill
          label={loading ? "Refreshing" : `${totalArticleCount} article${totalArticleCount === 1 ? "" : "s"}`}
          tone={loading ? "warning" : "neutral"}
        />
      </View>

      {loading ? (
        <AppText color="muted" variant="caption">
          Refreshing settings. Last loaded choices stay editable while the app checks live data.
        </AppText>
      ) : null}

      <PreferenceGroup title="Language">
        {LANGUAGE_OPTIONS.map((option) => (
          <SelectableCard
            description={option.description}
            key={option.id}
            label={option.label}
            onPress={() => patchDraft({ language: option.id })}
            selected={draft.language === option.id}
          />
        ))}
      </PreferenceGroup>

      <PreferenceGroup title="Goal">
        {GOAL_OPTIONS.map((option) => (
          <SelectableCard
            description={option.description}
            key={option.id}
            label={option.label}
            onPress={() => patchDraft({ goal: option.id })}
            selected={draft.goal === option.id}
          />
        ))}
      </PreferenceGroup>

      <PreferenceGroup title="Topics">
        <AppText color="muted" variant="caption">
          Choose at least one. Topic order follows the sequence you select.
        </AppText>
        {TOPIC_OPTIONS.map((option) => (
          <SelectableCard
            description={option.description}
            key={option.id}
            label={option.label}
            onPress={() => toggleTopic(option.id)}
            selected={draft.selectedTopics.includes(option.id)}
          />
        ))}
      </PreferenceGroup>

      <PreferenceGroup title="Article Counts">
        {selectedTopicOptions.length > 0 ? (
          selectedTopicOptions.map((topic) => (
            <ArticleCountRow
              count={draft.articlesPerTopic[topic.id] ?? 1}
              description={topic.description}
              key={topic.id}
              label={topic.label}
              onChange={(count) => setArticleCount(topic.id, count)}
            />
          ))
        ) : (
          <AppText color="danger" variant="body">
            Select at least one topic to save preferences.
          </AppText>
        )}
      </PreferenceGroup>

      <PreferenceGroup title="Frequency">
        {FREQUENCY_OPTIONS.map((option) => (
          <SelectableCard
            badge={option.badge}
            description={option.description}
            disabled={option.disabled}
            key={option.id}
            label={option.label}
            onPress={() => patchDraft({ frequency: option.id as PreferenceFrequency })}
            selected={draft.frequency === option.id}
          />
        ))}
      </PreferenceGroup>

      {errorMessage ? <AppText color="danger" variant="body">{errorMessage}</AppText> : null}
      {statusMessage ? <AppText color="accent" variant="bodyStrong">{statusMessage}</AppText> : null}

      <View style={styles.actions}>
        <SecondaryButton
          disabled={saving || loading || !hasChanges}
          label="Reset"
          onPress={() => {
            if (saved) {
              setDraft(saved);
              setErrorMessage(null);
              setStatusMessage(null);
            }
          }}
        />
        <PrimaryButton
          disabled={saving || loading || !hasChanges || draft.selectedTopics.length === 0}
          label={saving ? "Saving..." : "Save changes"}
          loading={saving}
          onPress={savePreferences}
          testID="preferences-save-button"
        />
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
    goal: normalized.goal,
    selectedTopics: normalized.selectedTopics,
    articlesPerTopic: normalized.articlesPerTopic,
    frequency: normalized.frequency
  });
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
