import { Redirect, Stack } from "expo-router";

import { AuthLoadingScreen, useAuth } from "../../src/features/auth";

export default function AuthLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (status === "needsOnboarding") {
    return <Redirect href="/(onboarding)/language" />;
  }

  if (status === "ready") {
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
