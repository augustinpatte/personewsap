import { Redirect, useRouter, type Href } from "expo-router";
import { useMemo } from "react";

import { EmptyState } from "../../src/components";
import {
  ArticleCountRow,
  getOnboardingCopy,
  localizeOptions,
  OnboardingScaffold,
  TOPIC_OPTIONS,
  useOnboarding
} from "../../src/features/onboarding";

type SelectedTopic = (typeof TOPIC_OPTIONS)[number];

const miniCaseTopicsHref = "/(onboarding)/mini-case-topics" as Href;

function isSelectedTopic(topic: SelectedTopic | undefined): topic is SelectedTopic {
  return Boolean(topic);
}

export default function ArticleCountScreen() {
  const router = useRouter();
  const { completeNewsletterConfiguration, setArticleCount, state } = useOnboarding();
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

  return (
    <OnboardingScaffold
      description={copy.articleCount.description}
      footerNote={
        selectedTopics.length > 0
          ? copy.articleCount.selectedFooter
          : copy.articleCount.emptyFooter
      }
      primaryDisabled={!hasRequiredPreferences}
      primaryLabel={copy.common.continue}
      onPrimaryPress={() => {
        completeNewsletterConfiguration();
        router.push(miniCaseTopicsHref);
      }}
      progressLabel={copy.step(3, 4)}
      secondaryLabel={copy.common.back}
      onSecondaryPress={() => router.back()}
      step={3}
      title={copy.articleCount.title}
      totalSteps={4}
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
