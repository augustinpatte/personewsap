import { useMemo } from "react";
import { useRouter } from "expo-router";

import { EmptyState } from "../../src/components";
import {
  ArticleCountRow,
  OnboardingScaffold,
  TOPIC_OPTIONS,
  useOnboarding
} from "../../src/features/onboarding";

type SelectedTopic = (typeof TOPIC_OPTIONS)[number];

function isSelectedTopic(topic: SelectedTopic | undefined): topic is SelectedTopic {
  return Boolean(topic);
}

export default function ArticleCountScreen() {
  const router = useRouter();
  const { setArticleCount, state } = useOnboarding();
  const selectedTopics = useMemo(
    () =>
      state.selectedTopics
        .map((topicId) => TOPIC_OPTIONS.find((option) => option.id === topicId))
        .filter(isSelectedTopic),
    [state.selectedTopics]
  );

  return (
    <OnboardingScaffold
      description="Choose how much depth each selected topic gets in the newsletter slot."
      primaryDisabled={selectedTopics.length === 0}
      primaryLabel="Continue"
      onPrimaryPress={() => router.push("/(onboarding)/frequency")}
      secondaryLabel="Back"
      onSecondaryPress={() => router.back()}
      step={4}
      title="Tune the daily dose"
      totalSteps={5}
    >
      {selectedTopics.length > 0 ? (
        selectedTopics.map((topic) => (
          <ArticleCountRow
            count={state.articlesPerTopic[topic.id] ?? 1}
            description={topic.description}
            key={topic.id}
            label={topic.label}
            onChange={(count) => setArticleCount(topic.id, count)}
          />
        ))
      ) : (
        <EmptyState
          actionLabel="Choose topics"
          description="Select at least one topic before setting article counts."
          onActionPress={() => router.replace("/(onboarding)/topics")}
          title="No topics selected"
        />
      )}
    </OnboardingScaffold>
  );
}
