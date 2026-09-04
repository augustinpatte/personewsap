import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "react-native";

import { AppErrorBoundary } from "../src/components";
import { ThemeProvider, useTheme } from "../src/design";
import { AuthProvider, useAuth } from "../src/features/auth";
import { LearningPathProvider } from "../src/features/learning";
import {
  configureNotificationPresentation,
  useNotificationRouting,
  usePushTokenRefresh
} from "../src/features/notifications";
import { DailyDropProvider } from "../src/features/today";
import { trackAnalyticsEvent } from "../src/lib/analytics";

// Set once, at module scope: expo-notifications expects the handler to exist
// before any notification can arrive, including the one that launched the app.
configureNotificationPresentation();

export default function RootLayout() {
  useEffect(() => {
    trackAnalyticsEvent("app_opened");
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { profileLanguage, user } = useAuth();
  const { colors, isDark } = useTheme();
  const accountScopeKey = user?.id ?? "signed-out";
  // A tapped "edition is ready" notification opens the Newsletter tab, from a
  // warm start or a cold one. Inside AuthProvider so it can wait for the
  // session rather than racing the auth redirect.
  useNotificationRouting();
  usePushTokenRefresh();

  return (
    <AppErrorBoundary language={profileLanguage}>
      <LearningPathProvider key={`learning-${accountScopeKey}`}>
        <DailyDropProvider key={`daily-drop-${accountScopeKey}`}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background }
            }}
          />
        </DailyDropProvider>
      </LearningPathProvider>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
    </AppErrorBoundary>
  );
}
