import { Redirect, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { useAuth } from "../../src/features/auth";
import {
  clearStoredOnboardingDraft,
  getOnboardingCopy,
  localizeOptions,
  MODULE_OPTIONS,
  OnboardingScaffold,
  saveOnboardingPreferences,
  SelectableCard,
  useOnboarding
} from "../../src/features/onboarding";
import { trackAnalyticsEvent } from "../../src/lib/analytics";
import { getUserFacingError } from "../../src/lib/userFacingErrors";

const newsletterTopicsHref = "/(onboarding)/newsletter-topics" as Href;
const miniCaseTopicsHref = "/(onboarding)/mini-case-topics" as Href;

export default function ModuleSelectionScreen() {
  const router = useRouter();
  const { refreshAuthState } = useAuth();
  const { state, toggleModule } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const copy = getOnboardingCopy(state.language);
  const moduleOptions = localizeOptions(MODULE_OPTIONS, state.language);

  if (!state.language) {
    return <Redirect href="/(onboarding)/language" />;
  }

  const nextHref = state.enabledModules.includes("newsletter")
    ? newsletterTopicsHref
    : miniCaseTopicsHref;

  const savePreferences = async () => {
    setSaving(true);

    const result = await saveOnboardingPreferences(state);

    setSaving(false);

    if (!result.ok) {
      trackAnalyticsEvent("error_viewed", {
        language: state.language ?? undefined
      });
      const userFacingError = getUserFacingError(result.error, state.language, "onboarding");
      Alert.alert(userFacingError.title, userFacingError.message);
      return;
    }

    trackAnalyticsEvent("onboarding_completed", {
      language: state.language ?? undefined
    });
    await clearStoredOnboardingDraft();
    await refreshAuthState();
    router.replace("/(tabs)/today");
  };

  return (
    <OnboardingScaffold
      description={copy.modules.description}
      footerNote={
        state.enabledModules.length > 0
          ? copy.modules.selectedFooter(state.enabledModules.length)
          : copy.modules.emptyFooter
      }
      primaryDisabled={saving || state.enabledModules.length === 0}
      primaryLabel={
        !state.enabledModules.includes("newsletter") && !state.enabledModules.includes("mini_case")
          ? saving
            ? copy.articleCount.saving
            : copy.articleCount.save
          : copy.common.continue
      }
      primaryLoading={saving}
      onPrimaryPress={() => {
        if (!state.enabledModules.includes("newsletter") && !state.enabledModules.includes("mini_case")) {
          void savePreferences();
          return;
        }

        router.push(nextHref);
      }}
      progressLabel={copy.step(2, 5)}
      secondaryLabel={copy.common.back}
      onSecondaryPress={() => router.back()}
      step={2}
      title={copy.modules.title}
      totalSteps={5}
    >
      {moduleOptions.map((option) => (
        <SelectableCard
          description={option.description}
          key={option.id}
          label={option.label}
          onPress={() => toggleModule(option.id)}
          selected={state.enabledModules.includes(option.id)}
          selectedBadge={copy.common.selected}
          unselectedBadge={copy.common.notSelected}
        />
      ))}
    </OnboardingScaffold>
  );
}
