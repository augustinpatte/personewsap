import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "react-native";

import { AppErrorBoundary } from "../src/components";
import { tokens } from "../src/design/tokens";
import { AuthProvider, useAuth } from "../src/features/auth";
import { trackAnalyticsEvent } from "../src/lib/analytics";

export default function RootLayout() {
  useEffect(() => {
    trackAnalyticsEvent("app_opened");
  }, []);

  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { profileLanguage } = useAuth();

  return (
    <AppErrorBoundary language={profileLanguage}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.color.background }
        }}
      />
      <StatusBar barStyle="dark-content" />
    </AppErrorBoundary>
  );
}
