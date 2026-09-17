import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs, type Href } from "expo-router";

import { GlassTabBar } from "../../src/components";
import { useTheme } from "../../src/design";
import { ArchiveProvider } from "../../src/features/archive";
import { AppLaunchScreen, useAuth } from "../../src/features/auth";
import { useLearningPath } from "../../src/features/learning";
import { NotificationDisabledBanner } from "../../src/features/notifications";
import { shouldRedirectToLearningSetup } from "../../src/features/learning/learningPathRouting";
import { localized } from "../../src/lib/i18n";

/**
 * Product-oriented bottom navigation: the four content modules plus Teams.
 *
 * Settings left this bar when Teams arrived. Five is the most a bottom bar can
 * carry at 10.5pt without the labels becoming unreadable, and between "the
 * private league you check every edition" and "where the language switch
 * lives", the league is the one that belongs one tap away. Account is reachable
 * from every module masthead instead, and /account still resolves.
 *
 * One sober line icon per destination, so the tabs are told apart at a glance
 * rather than by reading five short words.
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
  path: "compass",
  teams: "users"
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
  const copy = localized(
    {
      en: {
        newsletter: "Newsletter",
        cases: "Mini cases",
        stories: "Stories",
        path: "Path",
        teams: "Teams"
      },
      fr: {
        newsletter: "Newsletter",
        cases: "Mini cas",
        stories: "Stories",
        path: "Parcours",
        // "Teams" is the product's own word in both languages: a French reader
        // says "ma team", and "Équipes" would name something this is not.
        teams: "Teams"
      }
    },
    profileLanguage
  );

  if (status === "loading") {
    return <AppLaunchScreen language={profileLanguage} />;
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
        // ONE BAR, NOT FIVE BUTTONS. The glass, the moving capsule, the labels
        // and the drag all live in GlassTabBar, because a selection that
        // follows the finger across tabs needs the row to be a single touch
        // responder — five `tabBarButton`s each keep their own touches, so a
        // finger crossing between them is simply lost. Routes, state and
        // navigation are unchanged: the bar renders what the navigator holds.
        tabBar={(props) => <GlassTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          // Each tab's scene container. Left unset it is painted by
          // @react-navigation/elements' Background with the navigation theme's
          // colour — which used to be the library's stock light grey in both
          // schemes, and was what flashed between two tabs at night. The theme
          // is PersoNewsAP's now; this states the same answer where the switch
          // actually happens.
          sceneStyle: { backgroundColor: colors.background },
          // Read by GlassTabBar for the icon and the label of each tab.
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.muted
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
        <Tabs.Screen
          name="teams"
          options={{
            title: copy.teams,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon color={color} focused={focused} name={TAB_ICONS.teams} />
            )
          }}
        />
        {/* Settings is a route inside the tab group but not a tab: it keeps the
            tab bar and its inset while staying out of the five destinations.
            Reached from the masthead on every module screen. */}
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
      {/* Over the tabs, not in them: the authenticated app is where a reader
          can act on it, it floats instead of pushing the screen down, and it
          leaves on its own after five seconds. */}
      <NotificationDisabledBanner />
    </ArchiveProvider>
  );
}
