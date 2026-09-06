import { Stack } from "expo-router";

import { AppLaunchScreen, useAuth } from "../../src/features/auth";

/**
 * The Teams stack: detail, join and create.
 *
 * A stack rather than more tabs. These are places you go from Teams and come
 * back from, and the bottom bar is full at five — a sixth destination would make
 * every label unreadable at 10.5pt.
 */
export default function TeamsLayout() {
  const { profileLanguage, status } = useAuth();

  if (status === "loading") {
    return <AppLaunchScreen language={profileLanguage} />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}
