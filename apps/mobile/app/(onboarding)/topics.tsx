import { Redirect, useRouter } from "expo-router";

import {
  getOnboardingCopy,
  localizeOptions,
  OnboardingScaffold,
  SelectableCard,
  TOPIC_OPTIONS,
  useOnboarding
} from "../../src/features/onboarding";
import { trackAnalyticsEvent } from "../../src/lib/analytics";

export default function TopicsScreen() {
  const router = useRouter();
  const { state, toggleTopic } = useOnboarding();
  const copy = getOnboardingCopy(state.language);
  const topicOptions = localizeOptions(TOPIC_OPTIONS, state.language);

  if (!state.language) {
    return <Redirect href="/(onboarding)/language" />;
  }

  return (
    <OnboardingScaffold
      description={copy.topics.description}
      footerNote={
        state.selectedTopics.length > 0
          ? copy.topics.selectedFooter(state.selectedTopics.length)
          : copy.topics.emptyFooter
      }
      primaryDisabled={state.selectedTopics.length === 0}
      primaryLabel={copy.common.continue}
      onPrimaryPress={() => router.push("/(onboarding)/article-count")}
      progressLabel={copy.step(2, 3)}
      secondaryLabel={copy.common.back}
      onSecondaryPress={() => router.back()}
      step={2}
      title={copy.topics.title}
      totalSteps={3}
    >
      {topicOptions.map((option) => (
        <SelectableCard
          description={option.description}
          key={option.id}
          label={option.label}
          onPress={() => {
            toggleTopic(option.id);
            trackAnalyticsEvent("topic_preference_updated", {
              language: state.language ?? undefined,
              topic: option.backendTopicId
            });
          }}
          selected={state.selectedTopics.includes(option.id)}
          selectedBadge={copy.common.selected}
          unselectedBadge={copy.common.notSelected}
        />
      ))}
    </OnboardingScaffold>
  );
}
