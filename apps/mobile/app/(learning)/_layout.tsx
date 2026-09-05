import { Redirect, Stack } from "expo-router";

import { AppLaunchScreen, useAuth } from "../../src/features/auth";

export default function LearningLayout() {
  const { profileLanguage, status } = useAuth();

  if (status === "loading") {
    return <AppLaunchScreen language={profileLanguage} />;
  }

  if (status === "signedOut") {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
