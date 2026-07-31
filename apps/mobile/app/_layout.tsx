import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "react-native";

import { AppErrorBoundary } from "../src/components";
import { ThemeProvider, useTheme } from "../src/design";
import { AuthProvider, useAuth } from "../src/features/auth";
import { LearningPathProvider } from "../src/features/learning";
import { DailyDropProvider } from "../src/features/today";
import { trackAnalyticsEvent } from "../src/lib/analytics";

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
  const { profileLanguage } = useAuth();
  const { colors, isDark } = useTheme();

  return (
    <AppErrorBoundary language={profileLanguage}>
      <LearningPathProvider>
        <DailyDropProvider>
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
