import { Stack } from "expo-router";
import { StatusBar } from "react-native";

import { tokens } from "../src/design/tokens";
import { AuthProvider } from "../src/features/auth";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.color.background }
        }}
      />
      <StatusBar barStyle="dark-content" />
    </AuthProvider>
  );
}
