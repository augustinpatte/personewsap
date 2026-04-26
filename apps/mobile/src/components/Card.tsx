import type { PropsWithChildren } from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle
} from "react-native";

import { tokens } from "../design/tokens";

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

const styles = StyleSheet.create({
  base: {
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    gap: tokens.space.md
  },
  default: {
    backgroundColor: tokens.color.surface
  },
  muted: {
    backgroundColor: tokens.color.backgroundRaised
  },
  accent: {
    backgroundColor: tokens.color.accentSoft,
    borderColor: tokens.color.accentSoft
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
