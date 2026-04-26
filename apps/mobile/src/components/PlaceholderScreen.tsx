import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

import { tokens } from "../design/tokens";
import { AppScreen } from "./AppScreen";

type PlaceholderScreenProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  description: string;
}>;

export function PlaceholderScreen({
  eyebrow,
  title,
  description,
  children
}: PlaceholderScreenProps) {
  return (
    <AppScreen>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {children ? <View style={styles.children}>{children}</View> : null}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    backgroundColor: tokens.color.surface,
    padding: tokens.space.xl,
    shadowColor: tokens.color.ink,
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3
  },
  eyebrow: {
    color: tokens.color.accent,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: tokens.space.sm,
    textTransform: "uppercase"
  },
  title: {
    color: tokens.color.ink,
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 39,
    marginBottom: tokens.space.md
  },
  description: {
    color: tokens.color.muted,
    fontSize: 16,
    lineHeight: 24
  },
  children: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    marginTop: tokens.space.lg,
    paddingTop: tokens.space.lg
  }
});
