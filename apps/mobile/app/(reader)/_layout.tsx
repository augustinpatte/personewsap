import { Stack } from "expo-router";

import { tokens } from "../../src/design/tokens";

export default function ReaderLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: tokens.color.background }
      }}
    />
  );
}
