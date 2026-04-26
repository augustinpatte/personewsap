import { Stack } from "expo-router";
import { StatusBar } from "react-native";

import { tokens } from "../src/design/tokens";

export default function RootLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.color.background }
        }}
      />
      <StatusBar barStyle="dark-content" />
    </>
  );
}
