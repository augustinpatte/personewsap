import { useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";

import {
  FREQUENCY_OPTIONS,
  OnboardingScaffold,
  SelectableCard,
  saveOnboardingPreferences,
  useOnboarding
} from "../../src/features/onboarding";

export default function FrequencyScreen() {
  const router = useRouter();
  const { setFrequency, state } = useOnboarding();
  const [saving, setSaving] = useState(false);

  const savePreferences = async () => {
    setSaving(true);

    const result = await saveOnboardingPreferences(state);

    setSaving(false);

    if (!result.ok) {
      Alert.alert("Could not save preferences", result.error.message);
      return;
    }

    router.replace("/(tabs)/today");
  };

  return (
    <OnboardingScaffold
      description="PersoNewsAP is built around one focused update. Daily is the launch cadence."
      footerNote="Preferences are saved to your PersoNewsAP account."
      primaryDisabled={saving}
      primaryLabel={saving ? "Saving..." : "Save preferences"}
      primaryLoading={saving}
      onPrimaryPress={savePreferences}
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
