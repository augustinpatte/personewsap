import { Redirect, Stack, useSegments } from "expo-router";

import { AuthLoadingScreen, useAuth } from "../../src/features/auth";

export default function AuthLayout() {
  const { status } = useAuth();
  const segments = useSegments();
  const isResetPasswordRoute = segments[segments.length - 1] === "reset-password";

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "needsOnboarding" && !isResetPasswordRoute) {
    return <Redirect href="/(onboarding)/language" />;
  }

  if (status === "ready" && !isResetPasswordRoute) {
    return <Redirect href="/(tabs)/today" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right"
      }}
    />
  );
}
