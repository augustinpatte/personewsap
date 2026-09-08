import { Redirect, Stack } from "expo-router";

import { useThemeColors } from "../../src/design";
import { AppLaunchScreen, useAuth } from "../../src/features/auth";
import { OnboardingProvider } from "../../src/features/onboarding";

export default function OnboardingLayout() {
  const { profileLanguage, status } = useAuth();
  const colors = useThemeColors();

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
          animation: "slide_from_right",
          contentStyle: { backgroundColor: colors.background }
        }}
      />
    </OnboardingProvider>
  );
}
