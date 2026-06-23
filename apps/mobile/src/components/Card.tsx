import type { PropsWithChildren } from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle
} from "react-native";

import { tokens } from "../design/tokens";
import { useThemedStyles, type ThemeColors } from "../design/theme";

type CardTone = "default" | "muted" | "accent";
type CardPadding = "none" | "sm" | "md" | "lg";

type CardProps = PropsWithChildren<
  ViewProps & {
    tone?: CardTone;
    padding?: CardPadding;
    elevated?: boolean;
    style?: StyleProp<ViewStyle>;
  }
>;

export function Card({
  tone = "default",
  padding = "md",
  elevated = false,
  style,
  children,
  ...viewProps
}: CardProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View
      {...viewProps}
      style={[
        styles.base,
        styles[tone],
        styles[`${padding}Padding`],
        elevated ? styles.elevated : null,
        style
      ]}
    >
      {children}
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    base: {
      borderColor: c.border,
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      gap: tokens.space.md
    },
    default: {
      backgroundColor: c.surface
    },
    muted: {
      backgroundColor: c.backgroundRaised
    },
    accent: {
      backgroundColor: c.accentSoft,
      borderColor: c.accentSoft
    },
    nonePadding: {
      padding: tokens.space.none
    },
    smPadding: {
      padding: tokens.space.md
    },
    mdPadding: {
      padding: tokens.space.lg
    },
    lgPadding: {
      padding: tokens.space.xl
    },
    elevated: tokens.shadow.md
  });
