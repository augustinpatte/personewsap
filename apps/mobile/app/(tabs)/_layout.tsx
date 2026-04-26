import { Tabs } from "expo-router";

import { tokens } from "../../src/design/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.color.ink,
        tabBarInactiveTintColor: tokens.color.muted,
        tabBarStyle: {
          backgroundColor: tokens.color.surface,
          borderTopColor: tokens.color.border,
          height: 84,
          paddingBottom: 20,
          paddingTop: 10
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700"
        }
      }}
    >
      <Tabs.Screen name="today" options={{ title: "Today" }} />
      <Tabs.Screen name="library" options={{ title: "Library" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
