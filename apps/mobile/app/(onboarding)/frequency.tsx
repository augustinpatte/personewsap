import { Alert } from "react-native";
import { useRouter } from "expo-router";

import {
  FREQUENCY_OPTIONS,
  OnboardingScaffold,
  SelectableCard,
  useOnboarding
} from "../../src/features/onboarding";

export default function FrequencyScreen() {
  const router = useRouter();
  const { savePlaceholder, setFrequency, state } = useOnboarding();

  const saveLocalPlaceholder = () => {
    savePlaceholder();
    Alert.alert(
      "Preferences saved locally",
      "This is a placeholder save. Supabase persistence will be wired in a later step."
    );
    router.replace("/(tabs)/today");
  };

  return (
    <OnboardingScaffold
      description="PersoNewsAP is built around one focused update. Daily is the launch cadence."
      footerNote="No Supabase write yet. This save is local-only."
      primaryLabel="Save preferences"
      onPrimaryPress={saveLocalPlaceholder}
      secondaryLabel="Back"
      onSecondaryPress={() => router.back()}
      step={5}
      title="Set the rhythm"
      totalSteps={5}
    >
      {FREQUENCY_OPTIONS.map((option) => (
        <SelectableCard
          badge={option.badge}
          description={option.description}
          disabled={option.disabled}
          key={option.id}
          label={option.label}
          onPress={() => setFrequency(option.id)}
          selected={state.frequency === option.id}
        />
      ))}
    </OnboardingScaffold>
  );
}
