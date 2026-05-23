import { Redirect, useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Alert } from "react-native";

import { EmptyState } from "../../src/components";
import { useAuth } from "../../src/features/auth";
import {
  ArticleCountRow,
  clearStoredOnboardingDraft,
  getOnboardingCopy,
  localizeOptions,
  OnboardingScaffold,
  saveOnboardingPreferences,
  TOPIC_OPTIONS,
  useOnboarding
} from "../../src/features/onboarding";
import { trackAnalyticsEvent } from "../../src/lib/analytics";
import { getUserFacingError } from "../../src/lib/userFacingErrors";

type SelectedTopic = (typeof TOPIC_OPTIONS)[number];

const miniCaseTopicsHref = "/(onboarding)/mini-case-topics" as Href;

function isSelectedTopic(topic: SelectedTopic | undefined): topic is SelectedTopic {
  return Boolean(topic);
}

export default function ArticleCountScreen() {
  const router = useRouter();
  const { refreshAuthState } = useAuth();
  const { completeNewsletterConfiguration, setArticleCount, state } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const copy = getOnboardingCopy(state.language);
  const topicOptions = useMemo(
    () => localizeOptions(TOPIC_OPTIONS, state.language),
    [state.language]
  );
  const selectedTopics = useMemo(
    () =>
      state.selectedTopics
        .map((topicId) => topicOptions.find((option) => option.id === topicId))
        .filter(isSelectedTopic),
    [state.selectedTopics, topicOptions]
  );
  const hasRequiredPreferences =
    Boolean(state.language) &&
    selectedTopics.length > 0;

  if (!state.language) {
    return <Redirect href="/(onboarding)/language" />;
  }

  if (!state.enabledModules.includes("newsletter")) {
    return <Redirect href="/(onboarding)/mini-case-topics" />;
  }

  const savePreferences = async () => {
    completeNewsletterConfiguration();
    setSaving(true);

    const result = await saveOnboardingPreferences({
      ...state,
      newsletterConfigurationComplete: true
    });

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
      description={copy.articleCount.description}
      footerNote={
        selectedTopics.length > 0
          ? copy.articleCount.selectedFooter
          : copy.articleCount.emptyFooter
      }
      primaryDisabled={saving || !hasRequiredPreferences}
      primaryLabel={
        state.enabledModules.includes("mini_case")
          ? copy.common.continue
          : saving
            ? copy.articleCount.saving
            : copy.articleCount.save
      }
      primaryLoading={saving}
      onPrimaryPress={() => {
        completeNewsletterConfiguration();
        if (state.enabledModules.includes("mini_case")) {
          router.push(miniCaseTopicsHref);
          return;
        }

        void savePreferences();
      }}
      progressLabel={copy.step(4, 5)}
      secondaryLabel={copy.common.back}
      onSecondaryPress={() => router.back()}
      step={4}
      title={copy.articleCount.title}
      totalSteps={5}
    >
      {selectedTopics.length > 0 ? (
        selectedTopics.map((topic) => (
          <ArticleCountRow
            count={state.articlesPerTopic[topic.id] ?? 1}
            countLabel={copy.articleCount.countLabel(state.articlesPerTopic[topic.id] ?? 1)}
            description={topic.description}
            key={topic.id}
            label={topic.label}
            onChange={(count) => setArticleCount(topic.id, count)}
          />
        ))
      ) : (
        <EmptyState
          actionLabel={copy.articleCount.emptyAction}
          description={copy.articleCount.emptyDescription}
          onActionPress={() => router.replace("/(onboarding)/topics")}
          title={copy.articleCount.emptyTitle}
        />
      )}
    </OnboardingScaffold>
  );
}
