import { Redirect, Stack } from "expo-router";

import { AppLaunchScreen, useAuth } from "../../src/features/auth";
import { OnboardingProvider } from "../../src/features/onboarding";

export default function OnboardingLayout() {
  const { profileLanguage, status } = useAuth();

  if (status === "loading") {
    return <AppLaunchScreen language={profileLanguage} />;
  }

  if (status === "signedOut") {
    return <Redirect href="/(auth)/login" />;
  }

  if (status === "ready") {
    return <Redirect href="/(tabs)/newsletter" />;
  }

  return (
    <OnboardingProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right"
        }}
      />
    </OnboardingProvider>
  );
}
