import { Redirect, Stack } from "expo-router";

import { AuthLoadingScreen, useAuth } from "../../src/features/auth";
import { OnboardingProvider } from "../../src/features/onboarding";

export default function OnboardingLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "signedOut") {
    return <Redirect href="/(auth)/login" />;
  }

  if (status === "ready") {
    return <Redirect href="/(tabs)/today" />;
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
