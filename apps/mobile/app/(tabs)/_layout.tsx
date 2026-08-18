import { Feather } from "@expo/vector-icons";
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
 *
 * One sober line icon per destination, so the four tabs are told apart at a
 * glance rather than by reading four short words.
 *
 * Feather is used for its single-weight, thin geometry: it sits with the
 * editorial serif type instead of competing with it. Deliberately not emoji,
 * not filled glyphs, not illustrations — and small, because the label stays the
 * primary identifier and the icon only supports it.
 */
const TAB_ICONS = {
  newsletter: "file-text",
  cases: "check-square",
  stories: "briefcase",
  path: "compass"
} as const;

function TabIcon({
  name,
  color,
  focused
}: {
  name: (typeof TAB_ICONS)[keyof typeof TAB_ICONS];
  color: string;
  focused: boolean;
}) {
  return (
    <Feather
      color={color}
      name={name}
      // A hair heavier when active: enough to read as selected next to the
      // colour change, without turning into a different icon.
      size={focused ? 21 : 20}
      style={{ opacity: focused ? 1 : 0.75 }}
    />
  );
}

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
          },
          tabBarItemStyle: {
            // Comfortably above the 44pt minimum target on every device.
            paddingVertical: 4
          }
        }}
      >
        <Tabs.Screen
          name="newsletter"
          options={{
            title: copy.newsletter,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon color={color} focused={focused} name={TAB_ICONS.newsletter} />
            )
          }}
        />
        <Tabs.Screen
          name="cases"
          options={{
            title: copy.cases,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon color={color} focused={focused} name={TAB_ICONS.cases} />
            )
          }}
        />
        <Tabs.Screen
          name="stories"
          options={{
            title: copy.stories,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon color={color} focused={focused} name={TAB_ICONS.stories} />
            )
          }}
        />
        <Tabs.Screen
          name="path"
          options={{
            title: copy.path,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon color={color} focused={focused} name={TAB_ICONS.path} />
            )
          }}
        />
      </Tabs>
    </ArchiveProvider>
  );
}
