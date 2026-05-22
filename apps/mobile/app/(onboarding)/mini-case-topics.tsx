import { useState } from "react";
import { Alert } from "react-native";
import { Redirect, useRouter } from "expo-router";

import { useAuth } from "../../src/features/auth";
import {
  clearStoredOnboardingDraft,
  getOnboardingCopy,
  localizeOptions,
  MAX_MINI_CASE_TOPICS,
  MINI_CASE_TOPIC_OPTIONS,
  OnboardingScaffold,
  saveOnboardingPreferences,
  SelectableCard,
  useOnboarding
} from "../../src/features/onboarding";
import { trackAnalyticsEvent } from "../../src/lib/analytics";
import { getUserFacingError } from "../../src/lib/userFacingErrors";

export default function MiniCaseTopicsScreen() {
  const router = useRouter();
  const { refreshAuthState } = useAuth();
  const { state, toggleMiniCaseTopic } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const copy = getOnboardingCopy(state.language);
  const miniCaseTopicOptions = localizeOptions(MINI_CASE_TOPIC_OPTIONS, state.language);
  const selectedCount = state.selectedMiniCaseTopics.length;

  if (!state.language) {
    return <Redirect href="/(onboarding)/language" />;
  }

  if (state.selectedTopics.length === 0) {
    return <Redirect href="/(onboarding)/topics" />;
  }

  if (!state.newsletterConfigurationComplete) {
    return <Redirect href="/(onboarding)/article-count" />;
  }

  const savePreferences = async () => {
    setSaving(true);

    const result = await saveOnboardingPreferences(state);

    setSaving(false);

    if (!result.ok) {
      trackAnalyticsEvent("error_viewed", {
        language: state.language ?? undefined
      });
      const userFacingError = getUserFacingError(result.error, state.language, "onboarding");
      Alert.alert(userFacingError.title, userFacingError.message);
      return;
    }

    trackAnalyticsEvent("onboarding_completed", {
      language: state.language ?? undefined
    });
    await clearStoredOnboardingDraft();
    await refreshAuthState();
    router.replace("/(tabs)/today");
  };

  return (
    <OnboardingScaffold
      description={copy.miniCaseTopics.description}
      footerNote={
        selectedCount >= MAX_MINI_CASE_TOPICS
          ? copy.miniCaseTopics.maxFooter
          : selectedCount > 0
            ? copy.miniCaseTopics.selectedFooter(selectedCount)
            : copy.miniCaseTopics.emptyFooter
      }
      primaryDisabled={saving || selectedCount === 0}
      primaryLabel={saving ? copy.miniCaseTopics.saving : copy.miniCaseTopics.save}
      primaryLoading={saving}
      onPrimaryPress={savePreferences}
      progressLabel={copy.step(4, 4)}
      secondaryLabel={copy.common.back}
      onSecondaryPress={() => router.back()}
      step={4}
      title={copy.miniCaseTopics.title}
      totalSteps={4}
    >
      {miniCaseTopicOptions.map((option) => {
        const selected = state.selectedMiniCaseTopics.includes(option.id);
        const disabled = !selected && selectedCount >= MAX_MINI_CASE_TOPICS;

        return (
          <SelectableCard
            description={option.description}
            disabled={disabled}
            key={option.id}
            label={option.label}
            onPress={() => {
              toggleMiniCaseTopic(option.id);
              trackAnalyticsEvent("topic_preference_updated", {
                language: state.language ?? undefined,
                topic: option.backendTopicId
              });
            }}
            selected={selected}
            selectedBadge={copy.common.selected}
            unselectedBadge={disabled ? copy.miniCaseTopics.maxFooter : copy.common.notSelected}
          />
        );
      })}
    </OnboardingScaffold>
  );
}
