import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { tokens } from "../design/tokens";
import { useThemedStyles, type ThemeColors } from "../design/theme";
import { AppScreen } from "./AppScreen";
import { AppText } from "./AppText";
import { Card } from "./Card";

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
  const styles = useThemedStyles(createStyles);

  return (
    <AppScreen centered>
      <Card elevated padding="lg" style={styles.panel}>
        <AppText variant="eyebrow">{eyebrow}</AppText>
        <AppText variant="title">{title}</AppText>
        <AppText color="muted" variant="body">
          {description}
        </AppText>
        {children ? <View style={styles.children}>{children}</View> : null}
      </Card>
    </AppScreen>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    panel: {
      gap: tokens.space.md
    },
    children: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      marginTop: tokens.space.lg,
      paddingTop: tokens.space.lg
    }
  });
