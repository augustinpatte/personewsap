import { useEffect } from "react";
import { useRouter, type Href } from "expo-router";

import { useAuth } from "../../src/features/auth";
import {
  clearStoredOnboardingDraft,
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
  const { hydrated, restoredFromStorage, setLanguage, state } = useOnboarding();
  const copy = getOnboardingCopy(state.language);
  const languageOptions = localizeOptions(LANGUAGE_OPTIONS, state.language);

  useEffect(() => {
    if (!hydrated || !restoredFromStorage) {
      return;
    }

    const resumeHref = getResumeHref(state);

    if (resumeHref) {
      router.replace(resumeHref);
    }
  }, [hydrated, restoredFromStorage, router, state]);

  useEffect(() => {
    trackAnalyticsEvent("onboarding_started");
  }, []);

  const returnToLogin = async () => {
    await clearStoredOnboardingDraft();
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
      progressLabel={copy.step(1, 5)}
      secondaryLabel={copy.language.backToLogin}
      onSecondaryPress={returnToLogin}
      step={1}
      title={copy.language.title}
      totalSteps={5}
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

function getResumeHref(state: ReturnType<typeof useOnboarding>["state"]): Href | null {
  if (!state.language) {
    return null;
  }

  if (state.enabledModules.length === 0) {
    return "/(onboarding)/topics" as Href;
  }

  if (state.enabledModules.includes("newsletter") && state.selectedTopics.length === 0) {
    return "/(onboarding)/newsletter-topics" as Href;
  }

  if (state.enabledModules.includes("newsletter") && !state.newsletterConfigurationComplete) {
    return "/(onboarding)/article-count" as Href;
  }

  if (state.enabledModules.includes("mini_case")) {
    return "/(onboarding)/mini-case-topics" as Href;
  }

  return "/(onboarding)/topics" as Href;
}
