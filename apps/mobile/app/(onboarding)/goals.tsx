import { useRouter } from "expo-router";

import {
  GOAL_OPTIONS,
  OnboardingScaffold,
  SelectableCard,
  useOnboarding
} from "../../src/features/onboarding";

export default function GoalsScreen() {
  const router = useRouter();
  const { setGoal, state } = useOnboarding();

  return (
    <OnboardingScaffold
      description="Tell PersoNewsAP what the five minutes should sharpen first."
      footerNote={state.goal ? "Good. Next, pick the topics that should show up in your drop." : "Choose one goal to continue."}
      primaryDisabled={!state.goal}
      primaryLabel="Continue"
      onPrimaryPress={() => router.push("/(onboarding)/topics")}
      secondaryLabel="Back"
      onSecondaryPress={() => router.back()}
      step={2}
      title="What are you training for?"
      totalSteps={5}
    >
      {GOAL_OPTIONS.map((option) => (
        <SelectableCard
          description={option.description}
          key={option.id}
          label={option.label}
          onPress={() => setGoal(option.id)}
          selected={state.goal === option.id}
        />
      ))}
    </OnboardingScaffold>
  );
}
