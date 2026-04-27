import { useRouter } from "expo-router";

import { useAuth } from "../../src/features/auth";
import {
  LANGUAGE_OPTIONS,
  OnboardingScaffold,
  SelectableCard,
  useOnboarding
} from "../../src/features/onboarding";

export default function LanguageScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { setLanguage, state } = useOnboarding();

  const returnToLogin = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  return (
    <OnboardingScaffold
      description="Choose the language for your daily drop. FR and EN are written as native editorial versions."
      primaryDisabled={!state.language}
      primaryLabel="Continue"
      onPrimaryPress={() => router.push("/(onboarding)/goals")}
      secondaryLabel="Back to login"
      onSecondaryPress={returnToLogin}
      step={1}
      title="Pick your briefing language"
      totalSteps={5}
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <SelectableCard
          description={option.description}
          key={option.id}
          label={option.label}
          onPress={() => setLanguage(option.id)}
          selected={state.language === option.id}
        />
      ))}
    </OnboardingScaffold>
  );
}
