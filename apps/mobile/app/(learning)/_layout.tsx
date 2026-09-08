import { Redirect, Stack } from "expo-router";

import { useThemeColors } from "../../src/design";
import { AppLaunchScreen, useAuth } from "../../src/features/auth";

export default function LearningLayout() {
  const { profileLanguage, status } = useAuth();
  const colors = useThemeColors();

  if (status === "loading") {
    return <AppLaunchScreen language={profileLanguage} />;
  }

  if (status === "signedOut") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background }
      }}
    />
  );
}
