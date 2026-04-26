import type { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { tokens } from "../design/tokens";

export function AppScreen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.inner}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.color.background
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.xl
  },
  inner: {
    flex: 1,
    justifyContent: "center"
  }
});
