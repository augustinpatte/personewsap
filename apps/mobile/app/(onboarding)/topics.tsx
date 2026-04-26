import { useRouter } from "expo-router";

import {
  OnboardingScaffold,
  SelectableCard,
  TOPIC_OPTIONS,
  useOnboarding
} from "../../src/features/onboarding";

export default function TopicsScreen() {
  const router = useRouter();
  const { state, toggleTopic } = useOnboarding();

  return (
    <OnboardingScaffold
      description="Choose a focused mix. The product stays one daily drop, not a feed."
      footerNote={`${state.selectedTopics.length} selected`}
      primaryDisabled={state.selectedTopics.length === 0}
      primaryLabel="Set article counts"
      onPrimaryPress={() => router.push("/(onboarding)/article-count")}
      secondaryLabel="Back"
      onSecondaryPress={() => router.back()}
      step={3}
      title="Pick your signal"
      totalSteps={5}
    >
      {TOPIC_OPTIONS.map((option) => (
        <SelectableCard
          description={option.description}
          key={option.id}
          label={option.label}
          onPress={() => toggleTopic(option.id)}
          selected={state.selectedTopics.includes(option.id)}
        />
      ))}
    </OnboardingScaffold>
  );
}
