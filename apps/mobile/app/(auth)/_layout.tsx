import { Redirect, Stack, useSegments } from "expo-router";

import { useThemeColors } from "../../src/design";
import { AppLaunchScreen, useAuth } from "../../src/features/auth";

export default function AuthLayout() {
  const { profileLanguage, status } = useAuth();
  const colors = useThemeColors();
  const segments = useSegments();
  const isResetPasswordRoute = segments[segments.length - 1] === "reset-password";

  if (status === "loading") {
    return <AppLaunchScreen language={profileLanguage} />;
  }

  if (status === "needsOnboarding" && !isResetPasswordRoute) {
    return <Redirect href="/(onboarding)/language" />;
  }

  if (status === "ready" && !isResetPasswordRoute) {
    return <Redirect href="/(tabs)/newsletter" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        // Stated rather than inherited. The navigation theme already carries
        // the same colour, and saying it here means a screen mid-push shows
        // paper even if that theme is ever lost.
        contentStyle: { backgroundColor: colors.background }
      }}
    />
  );
}
