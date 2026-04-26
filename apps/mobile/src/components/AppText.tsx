import type { PropsWithChildren } from "react";
import {
  StyleSheet,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle
} from "react-native";

import { tokens, type ColorToken } from "../design/tokens";

type AppTextVariant =
  | "display"
  | "title"
  | "subtitle"
  | "body"
  | "bodyStrong"
  | "label"
  | "caption"
  | "eyebrow";

type AppTextProps = PropsWithChildren<
  TextProps & {
    variant?: AppTextVariant;
    color?: ColorToken;
    align?: TextStyle["textAlign"];
    style?: StyleProp<TextStyle>;
  }
>;

export function AppText({
  variant = "body",
  color,
  align,
  style,
  children,
  ...textProps
}: AppTextProps) {
  return (
    <Text
      {...textProps}
      style={[
        styles.base,
        styles[variant],
        color ? { color: tokens.color[color] } : null,
        align ? { textAlign: align } : null,
        style
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    color: tokens.color.ink,
    fontFamily: tokens.typography.family.regular,
    letterSpacing: 0
  },
  display: {
    fontSize: tokens.typography.size.display,
    fontWeight: tokens.typography.weight.bold,
    lineHeight: tokens.typography.lineHeight.display
  },
  title: {
    fontSize: tokens.typography.size.title,
    fontWeight: tokens.typography.weight.bold,
    lineHeight: tokens.typography.lineHeight.title
  },
  subtitle: {
    color: tokens.color.inkSoft,
    fontSize: tokens.typography.size.subtitle,
    fontWeight: tokens.typography.weight.semibold,
    lineHeight: tokens.typography.lineHeight.subtitle
  },
  body: {
    color: tokens.color.inkSoft,
    fontSize: tokens.typography.size.body,
    fontWeight: tokens.typography.weight.regular,
    lineHeight: tokens.typography.lineHeight.body
  },
  bodyStrong: {
    color: tokens.color.ink,
    fontSize: tokens.typography.size.body,
    fontWeight: tokens.typography.weight.semibold,
    lineHeight: tokens.typography.lineHeight.body
  },
  label: {
    fontSize: tokens.typography.size.label,
    fontWeight: tokens.typography.weight.semibold,
    lineHeight: tokens.typography.lineHeight.label
  },
  caption: {
    color: tokens.color.muted,
    fontSize: tokens.typography.size.caption,
    fontWeight: tokens.typography.weight.medium,
    lineHeight: tokens.typography.lineHeight.caption
  },
  eyebrow: {
    color: tokens.color.accent,
    fontSize: tokens.typography.size.eyebrow,
    fontWeight: tokens.typography.weight.bold,
    lineHeight: tokens.typography.lineHeight.eyebrow,
    textTransform: "uppercase"
  }
});
