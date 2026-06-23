import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../src/design";
import { AuthLoadingScreen, useAuth } from "../../src/features/auth";
import { localized } from "../../src/lib/i18n";

export default function TabsLayout() {
  const { profileLanguage, status } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 16);
  const copy = localized(
    {
      en: {
        account: "Account",
        library: "Library",
        today: "Today"
      },
      fr: {
        account: "Compte",
        library: "Bibliothèque",
        today: "Aujourd'hui"
      }
    },
    profileLanguage
  );

  if (status === "loading") {
    return <AuthLoadingScreen language={profileLanguage} />;
  }

  if (status === "signedOut") {
    return <Redirect href="/(auth)/login" />;
  }

  if (status === "needsOnboarding") {
    return <Redirect href="/(onboarding)/language" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 10
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700"
        }
      }}
    >
      <Tabs.Screen name="today" options={{ title: copy.today }} />
      <Tabs.Screen name="library" options={{ title: copy.library }} />
      <Tabs.Screen name="account" options={{ title: copy.account }} />
    </Tabs>
  );
}
