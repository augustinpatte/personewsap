import { Redirect, Tabs, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../src/design";
import { ArchiveProvider } from "../../src/features/archive";
import { AuthLoadingScreen, useAuth } from "../../src/features/auth";
import { useLearningPath } from "../../src/features/learning";
import { shouldRedirectToLearningSetup } from "../../src/features/learning/learningPathRouting";
import { localized } from "../../src/lib/i18n";

/**
 * Product-oriented bottom navigation: the four content modules. Account lives
 * outside the tab bar, reached from the top-right entry on every module screen.
 */
export default function TabsLayout() {
  const { profileLanguage, status } = useAuth();
  const learningPath = useLearningPath();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 16);
  const copy = localized(
    {
      en: {
        newsletter: "Newsletter",
        cases: "Mini cases",
        stories: "Stories",
        path: "Path"
      },
      fr: {
        newsletter: "Newsletter",
        cases: "Mini cas",
        stories: "Stories",
        path: "Parcours"
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

  if (
    shouldRedirectToLearningSetup({
      authStatus: status,
      learningStatus: learningPath.status,
      source: learningPath.source,
      learningPathChoiceCompleted: learningPath.learningPathChoiceCompleted,
      learningPathEnabled: learningPath.learningPathEnabled,
      activePath: learningPath.activePath,
      latestCompletedPath: learningPath.latestCompletedPath
    })
  ) {
    return <Redirect href={"/(learning)/setup" as unknown as Href} />;
  }

  return (
    <ArchiveProvider>
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
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.2
          }
        }}
      >
        <Tabs.Screen name="newsletter" options={{ title: copy.newsletter }} />
        <Tabs.Screen name="cases" options={{ title: copy.cases }} />
        <Tabs.Screen name="stories" options={{ title: copy.stories }} />
        <Tabs.Screen name="path" options={{ title: copy.path }} />
      </Tabs>
    </ArchiveProvider>
  );
}
