import { useMemo } from "react";
import { useRouter } from "expo-router";

import { EmptyState } from "../../src/components";
import {
  getOnboardingCopy,
  localizeOptions,
  OnboardingScaffold,
  SelectableCard,
  TOPIC_OPTIONS,
  useOnboarding
} from "../../src/features/onboarding";

type SelectedTopic = (typeof TOPIC_OPTIONS)[number];

function isSelectedTopic(topic: SelectedTopic | undefined): topic is SelectedTopic {
  return Boolean(topic);
}

export default function MiniCaseTopicScreen() {
  const router = useRouter();
  const { setMiniCaseTopic, state } = useOnboarding();
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
  const description =
    selectedTopics.length === 1
      ? copy.miniCaseTopic.singleDescription
      : copy.miniCaseTopic.description;

  return (
    <OnboardingScaffold
      description={description}
      footerNote={
        state.miniCaseTopicId
          ? copy.miniCaseTopic.selectedFooter
          : copy.miniCaseTopic.emptyFooter
      }
      primaryDisabled={!state.miniCaseTopicId}
      primaryLabel={copy.common.continue}
      onPrimaryPress={() => router.push("/(onboarding)/article-count")}
      progressLabel={copy.step(3, 4)}
      secondaryLabel={copy.common.back}
      onSecondaryPress={() => router.back()}
      step={3}
      title={copy.miniCaseTopic.title}
      totalSteps={4}
    >
      {selectedTopics.length > 0 ? (
        selectedTopics.map((option) => (
          <SelectableCard
            description={option.description}
            key={option.id}
            label={option.label}
            onPress={() => setMiniCaseTopic(option.id)}
            selected={state.miniCaseTopicId === option.id}
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
