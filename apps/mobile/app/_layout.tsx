import { useEffect, useMemo } from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
  type Theme as NavigationTheme
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar, StyleSheet, View } from "react-native";

import { AppErrorBoundary } from "../src/components";
import { ThemeProvider, navigationPaletteFor, useTheme } from "../src/design";
import { AuthProvider, useAuth } from "../src/features/auth";
import { LearningPathProvider } from "../src/features/learning";
import {
  configureNotificationPresentation,
  useProfileTimezoneSync,
  usePushTokenRefresh
} from "../src/features/notifications";
import { NotificationRoutingBridge } from "../src/features/notifications/NotificationRoutingBridge";
import { readCurrentDeviceTimeZone } from "../src/features/notifications/deviceTimeZone";
import { DailyDropProvider } from "../src/features/today";
import { trackAnalyticsEvent } from "../src/lib/analytics";
import { registerDeviceTimeZoneReader } from "../src/lib/localDate";

// Set once, at module scope: expo-notifications expects the handler to exist
// before any notification can arrive, including the one that launched the app.
configureNotificationPresentation();
// One device-zone reader for the whole app: Today's dates and profiles.timezone
// both follow the OS zone as it is now, not the JS engine's cached one.
registerDeviceTimeZoneReader(readCurrentDeviceTimeZone);

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
  // Tapped notifications are followed by NotificationRoutingBridge, inside
  // DailyDropProvider, so the edition they name is loaded as they route.
  usePushTokenRefresh();
  // The server notifies at 20:00 and 08:30 in profiles.timezone; this keeps it
  // on the phone's zone when the reader travels.
  useProfileTimezoneSync();

  /**
   * The palette React Navigation paints between screens.
   *
   * Expo Router mounts its NavigationContainer with the library's stock
   * DefaultTheme — light grey scenes and white cards — and every navigator in
   * the app inherited it, in both schemes. That grey is what showed for a frame
   * on a tab switch, on a push whose screen had not laid out yet, and behind a
   * detached screen; at night it read as a white flash between two dark
   * screens. Overriding the theme here fixes every navigator at once, including
   * any added later, rather than leaving each one to remember a `contentStyle`.
   *
   * `fonts` comes from the library's own base theme: it is the one half of a
   * navigation theme this app has no opinion about, and inventing values for it
   * would break the stock header typography it feeds.
   */
  const navigationTheme = useMemo<NavigationTheme>(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      dark: isDark,
      colors: navigationPaletteFor(colors)
    }),
    [colors, isDark]
  );

  return (
    <AppErrorBoundary language={profileLanguage}>
      {/* The last surface under everything. React Native's own root view is a
          single colour baked into app.json and cannot follow the scheme, so
          this view stands in front of it: whatever a navigator detaches,
          freezes or has not painted yet reveals PersoNewsAP paper (or
          PersoNewsAP night), never the platform default. */}
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <NavigationThemeProvider value={navigationTheme}>
          <LearningPathProvider key={`learning-${accountScopeKey}`}>
            <DailyDropProvider key={`daily-drop-${accountScopeKey}`}>
              <NotificationRoutingBridge />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background }
                }}
              />
            </DailyDropProvider>
          </LearningPathProvider>
        </NavigationThemeProvider>
      </View>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  }
});
