import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { AppText, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { localized } from "../../lib/i18n";
import { getUserFacingErrorMessage } from "../../lib/userFacingErrors";
import type { Language } from "../../types/domain";
import {
  ArticleCountRow,
  LANGUAGE_OPTIONS,
  localizeOptions,
  mapMiniCaseTopicToBackendTopic,
  mapNewsletterTopicToBackendTopic,
  MAX_MINI_CASE_TOPICS,
  MODULE_OPTIONS,
  MINI_CASE_TOPIC_OPTIONS,
  SelectableCard,
  TOPIC_OPTIONS,
  type MiniCaseTopicId,
  type OnboardingModuleId,
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

type PreferencesTab = "newsletter" | "mini_case";

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
  const [activeTab, setActiveTab] = useState<PreferencesTab>("newsletter");
  // Tracks how many loads have completed. A save increments this on start;
  // if the counter has advanced during the save's async work, a fresher load
  // already committed state and the save result should not overwrite it.
  const loadGenerationRef = useRef(0);
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
  const moduleOptions = useMemo(
    () => localizeOptions(MODULE_OPTIONS, uiLanguage),
    [uiLanguage]
  );
  const miniCaseTopicOptions = useMemo(
    () => localizeOptions(MINI_CASE_TOPIC_OPTIONS, uiLanguage),
    [uiLanguage]
  );

  const loadPreferences = useCallback(async () => {
    if (!userId) {
      setDraft(null);
      setSaved(null);
      return;
    }

    // Advance the generation counter so any in-flight save can detect
    // that a fresher load has started and skip overwriting the result.
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;

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
  const selectedMiniCaseTopicOptions = useMemo(
    () =>
      draft?.miniCaseTopics
        .map((topicId) => miniCaseTopicOptions.find((option) => option.id === topicId))
        .filter((topic): topic is (typeof MINI_CASE_TOPIC_OPTIONS)[number] => Boolean(topic)) ?? [],
    [draft?.miniCaseTopics, miniCaseTopicOptions]
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

  const toggleNewsletterTopic = useCallback((topicId: NewsletterTopicId) => {
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

  const toggleModule = useCallback((moduleId: OnboardingModuleId) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const isEnabled = current.enabledModules.includes(moduleId);
      return normalizeEditablePreferences({
        ...current,
        enabledModules: isEnabled
          ? current.enabledModules.filter((enabledModuleId) => enabledModuleId !== moduleId)
          : [...current.enabledModules, moduleId]
      });
    });
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  const toggleMiniCaseTopic = useCallback((topicId: MiniCaseTopicId) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const isSelected = current.miniCaseTopics.includes(topicId);

      if (!isSelected && current.miniCaseTopics.length >= MAX_MINI_CASE_TOPICS) {
        return current;
      }

      return normalizeEditablePreferences({
        ...current,
        miniCaseTopics: isSelected
          ? current.miniCaseTopics.filter((selectedTopicId) => selectedTopicId !== topicId)
          : [...current.miniCaseTopics, topicId]
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

    // Capture the load generation at save-start. If a new load completes
    // while the save is in-flight, the generation will have advanced and
    // the save result should not overwrite the fresher state.
    const saveGeneration = loadGenerationRef.current;

    setSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const normalized = normalizeEditablePreferences(draft);
    const result = await saveEditablePreferences(userId, normalized);

    setSaving(false);

    // A fresh load started (and may have already committed new state) during
    // this save's async work. Discard this result to avoid overwriting it.
    if (loadGenerationRef.current !== saveGeneration) {
      return;
    }

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

  const newsletterNeedsAttention =
    draft.enabledModules.includes("newsletter") && draft.selectedTopics.length === 0;
  const miniCaseNeedsAttention =
    draft.enabledModules.includes("mini_case") && draft.miniCaseTopics.length === 0;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <AppText variant="subtitle">{copy.title}</AppText>
        {loading ? <ActivityIndicator color={tokens.color.accent} size="small" /> : null}
      </View>

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

      <PreferenceGroup title={copy.modules}>
        <AppText color="muted" variant="caption">
          {copy.modulesHelp}
        </AppText>
        {moduleOptions.map((option) => (
          <SelectableCard
            description={option.description}
            key={option.id}
            label={option.label}
            onPress={() => toggleModule(option.id)}
            selected={draft.enabledModules.includes(option.id)}
            selectedBadge={copy.selected}
            unselectedBadge={copy.notSelected}
          />
        ))}
        {draft.enabledModules.length === 0 ? (
          <AppText color="danger" variant="body">
            {copy.missingModule}
          </AppText>
        ) : null}
      </PreferenceGroup>

      <SegmentedControl
        onChange={setActiveTab}
        options={[
          {
            id: "newsletter",
            label: copy.newsletterTab,
            attention: newsletterNeedsAttention
          },
          {
            id: "mini_case",
            label: copy.miniCaseTab,
            attention: miniCaseNeedsAttention
          }
        ]}
        value={activeTab}
      />

      {activeTab === "newsletter" ? (
        <View style={styles.tabBody}>
          <PreferenceGroup title={copy.topics}>
            <AppText color="muted" variant="caption">
              {copy.topicsHelp}
            </AppText>
            {topicOptions.map((option) => (
              <SelectableCard
                description={option.description}
                key={option.id}
                label={option.label}
                onPress={() => toggleNewsletterTopic(option.id)}
                selected={draft.selectedTopics.includes(option.id)}
                selectedBadge={copy.selected}
                unselectedBadge={copy.notSelected}
              />
            ))}
            {newsletterNeedsAttention ? (
              <AppText color="danger" variant="body">
                {copy.missingNewsletterTopic}
              </AppText>
            ) : null}
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
              <AppText color="muted" variant="caption">
                {copy.depthEmpty}
              </AppText>
            )}
          </PreferenceGroup>
        </View>
      ) : (
        <View style={styles.tabBody}>
          <PreferenceGroup title={copy.miniCaseTopics}>
            <AppText color="muted" variant="caption">
              {copy.miniCaseTopicsHelp}
            </AppText>
            {miniCaseTopicOptions.map((option) => {
              const selected = draft.miniCaseTopics.includes(option.id);
              const disabled = !selected && draft.miniCaseTopics.length >= MAX_MINI_CASE_TOPICS;

              return (
                <SelectableCard
                  description={option.description}
                  disabled={disabled}
                  key={option.id}
                  label={option.label}
                  onPress={() => toggleMiniCaseTopic(option.id)}
                  selected={selected}
                  selectedBadge={copy.selected}
                  unselectedBadge={disabled ? copy.limitReached : copy.notSelected}
                />
              );
            })}
            {miniCaseNeedsAttention ? (
              <AppText color="danger" variant="body">
                {copy.missingMiniCaseTopic}
              </AppText>
            ) : (
              <AppText color="muted" variant="caption">
                {copy.miniCaseSelectedFooter(selectedMiniCaseTopicOptions.length)}
              </AppText>
            )}
          </PreferenceGroup>
        </View>
      )}

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
            draft.enabledModules.length === 0 ||
            (draft.enabledModules.includes("newsletter") && draft.selectedTopics.length === 0) ||
            (draft.enabledModules.includes("mini_case") && draft.miniCaseTopics.length === 0)
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

function SegmentedControl({
  onChange,
  options,
  value
}: {
  onChange: (id: PreferencesTab) => void;
  options: Array<{ id: PreferencesTab; label: string; attention?: boolean }>;
  value: PreferencesTab;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.segment}>
      {options.map((option) => {
        const active = option.id === value;

        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={option.id}
            onPress={() => onChange(option.id)}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
          >
            <AppText color={active ? "ink" : "muted"} variant="label">
              {option.label}
            </AppText>
            {option.attention ? <View style={styles.segmentDot} /> : null}
          </Pressable>
        );
      })}
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
    enabledModules: normalized.enabledModules,
    selectedTopics: normalized.selectedTopics,
    miniCaseTopics: normalized.miniCaseTopics,
    articlesPerTopic: normalized.articlesPerTopic
  });
}

function getPreferencesCopy(language: EditablePreferences["language"]) {
  return localized(
    {
      en: {
        title: "Preferences",
        signIn: "Sign in to edit your daily drop preferences.",
        loading: "Loading preferences...",
        tryAgain: "Try again",
        saved: "Saved. Future daily drops will use these preferences.",
        language: "Language",
        modules: "Modules",
        modulesHelp: "Choose which daily formats stay active.",
        newsletterTab: "Newsletter",
        miniCaseTab: "Mini cases",
        topics: "Newsletter topics",
        topicsHelp: "Pick one to eight topics.",
        articleCounts: "Articles per topic",
        depthEmpty: "Pick a newsletter topic to set how many articles you get.",
        miniCaseTopics: "Mini-case topics",
        miniCaseTopicsHelp: "Pick up to three. Kept separate from your newsletter.",
        missingNewsletterTopic: "Select at least one newsletter topic to save preferences.",
        missingModule: "Select at least one module to save preferences.",
        missingMiniCaseTopic: "Select at least one mini-case topic to save preferences.",
        limitReached: "Limit reached",
        selected: "Selected",
        notSelected: "Not selected",
        reset: "Reset",
        saving: "Saving...",
        saveChanges: "Save changes",
        countLabel: (count: number) => `${count} per drop`,
        miniCaseSelectedFooter: (count: number) =>
          `${count}/3 mini-case topic${count === 1 ? "" : "s"} selected`
      },
      fr: {
        title: "Préférences",
        signIn: "Connecte-toi pour modifier tes préférences de mise à jour quotidienne.",
        loading: "Chargement des préférences...",
        tryAgain: "Réessayer",
        saved: "Enregistré. Les prochaines mises à jour utiliseront ces préférences.",
        language: "Langue",
        modules: "Modules",
        modulesHelp: "Choisis les formats quotidiens qui restent actifs.",
        newsletterTab: "Newsletter",
        miniCaseTab: "Mini-cas",
        topics: "Sujets newsletter",
        topicsHelp: "Choisis un à huit sujets.",
        articleCounts: "Articles par sujet",
        depthEmpty: "Choisis un sujet newsletter pour régler le nombre d'articles.",
        miniCaseTopics: "Sujets mini-cas",
        miniCaseTopicsHelp: "Choisis jusqu'à trois sujets. Distinct de ta newsletter.",
        missingNewsletterTopic: "Sélectionne au moins un sujet newsletter pour enregistrer les préférences.",
        missingModule: "Sélectionne au moins un module pour enregistrer les préférences.",
        missingMiniCaseTopic: "Sélectionne au moins un sujet mini-cas pour enregistrer les préférences.",
        limitReached: "Limite atteinte",
        selected: "Sélectionné",
        notSelected: "Non sélectionné",
        reset: "Réinitialiser",
        saving: "Enregistrement...",
        saveChanges: "Enregistrer",
        countLabel: (count: number) => `${count} par jour`,
        miniCaseSelectedFooter: (count: number) =>
          `${count}/3 sujet${count > 1 ? "s" : ""} mini-cas sélectionné${count > 1 ? "s" : ""}`
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
  const changedMiniCaseTopics = getChangedMiniCaseTopics(previous, next);

  for (const topic of changedTopics) {
    trackAnalyticsEvent("topic_preference_updated", {
      language: next.language,
      topic: mapNewsletterTopicToBackendTopic(topic)
    });
  }

  for (const topic of changedMiniCaseTopics) {
    trackAnalyticsEvent("topic_preference_updated", {
      language: next.language,
      topic: mapMiniCaseTopicToBackendTopic(topic)
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

function getChangedMiniCaseTopics(
  previous: EditablePreferences | null,
  next: EditablePreferences
) {
  const changedTopics = new Set<MiniCaseTopicId>();
  const previousTopics = new Set(previous?.miniCaseTopics ?? []);
  const nextTopics = new Set(next.miniCaseTopics);

  for (const topic of previousTopics) {
    if (!nextTopics.has(topic)) {
      changedTopics.add(topic);
    }
  }

  for (const topic of nextTopics) {
    if (!previousTopics.has(topic)) {
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
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.sm,
    justifyContent: "space-between"
  },
  loadingSection: {
    alignItems: "center",
    paddingVertical: tokens.space.xl
  },
  section: {
    gap: tokens.space.lg
  },
  segment: {
    backgroundColor: tokens.color.surfaceMuted,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: tokens.space.xs,
    padding: tokens.space.xs
  },
  segmentDot: {
    backgroundColor: tokens.color.warning,
    borderRadius: tokens.radius.pill,
    height: 6,
    width: 6
  },
  segmentItem: {
    alignItems: "center",
    borderColor: tokens.color.transparent,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: tokens.space.xs,
    justifyContent: "center",
    paddingVertical: tokens.space.sm
  },
  segmentItemActive: {
    backgroundColor: tokens.color.background,
    borderColor: tokens.color.borderStrong
  },
  tabBody: {
    gap: tokens.space.lg
  }
});
