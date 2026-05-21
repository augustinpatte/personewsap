import { useEffect } from "react";
import { useRouter } from "expo-router";

import { useAuth } from "../../src/features/auth";
import {
  getOnboardingCopy,
  LANGUAGE_OPTIONS,
  localizeOptions,
  OnboardingScaffold,
  SelectableCard,
  useOnboarding
} from "../../src/features/onboarding";
import { trackAnalyticsEvent } from "../../src/lib/analytics";

export default function LanguageScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { setLanguage, state } = useOnboarding();
  const copy = getOnboardingCopy(state.language);
  const languageOptions = localizeOptions(LANGUAGE_OPTIONS, state.language);

  useEffect(() => {
    trackAnalyticsEvent("onboarding_started");
  }, []);

  const returnToLogin = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  return (
    <OnboardingScaffold
      description={copy.language.description}
      footerNote={state.language ? copy.language.selectedFooter : copy.language.emptyFooter}
      primaryDisabled={!state.language}
      primaryLabel={copy.common.continue}
      onPrimaryPress={() => router.push("/(onboarding)/topics")}
      progressLabel={copy.step(1, 3)}
      secondaryLabel={copy.language.backToLogin}
      onSecondaryPress={returnToLogin}
      step={1}
      title={copy.language.title}
      totalSteps={3}
    >
      {languageOptions.map((option) => (
        <SelectableCard
          description={option.description}
          key={option.id}
          label={option.label}
          onPress={() => {
            setLanguage(option.id);
            trackAnalyticsEvent("language_updated", {
              language: option.id
            });
          }}
          selected={state.language === option.id}
        />
      ))}
    </OnboardingScaffold>
  );
}
