import { Stack } from "expo-router";

import { useThemeColors } from "../../src/design";

export default function ReaderLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: colors.background }
      }}
    />
  );
}
