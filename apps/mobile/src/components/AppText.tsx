import type { PropsWithChildren } from "react";
import {
  StyleSheet,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle
} from "react-native";

import { tokens } from "../design/tokens";
import { useThemeColors, type ThemeColorToken } from "../design/theme";

type AppTextVariant =
  | "display"
  | "title"
  | "subtitle"
  | "lede"
  | "read"
  | "quote"
  | "pullQuote"
  | "body"
  | "bodyStrong"
  | "label"
  | "caption"
  | "eyebrow";

// Each variant carries a default semantic color that is resolved against the
// active theme at render time. An explicit `color` prop always wins.
const variantColor: Record<AppTextVariant, ThemeColorToken> = {
  display: "ink",
  title: "ink",
  subtitle: "ink",
  lede: "inkSoft",
  read: "ink",
  quote: "ink",
  pullQuote: "ink",
  body: "inkSoft",
  bodyStrong: "ink",
  label: "ink",
  caption: "muted",
  eyebrow: "muted"
};

type AppTextProps = PropsWithChildren<
  TextProps & {
    variant?: AppTextVariant;
    color?: ThemeColorToken;
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
  const colors = useThemeColors();
  const resolvedColor = colors[color ?? variantColor[variant]];

  return (
    <Text
      {...textProps}
      style={[
        styles.base,
        styles[variant],
        { color: resolvedColor },
        align ? { textAlign: align } : null,
        style
      ]}
    >
      {children}
    </Text>
  );
}

// Structural styles only — no color lives here so the same StyleSheet serves
// both light and dark. Color is injected per-render from the theme above.
const styles = StyleSheet.create({
  base: {
    fontFamily: tokens.typography.family.regular,
    letterSpacing: 0
  },
  display: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.display,
    fontWeight: tokens.typography.weight.bold,
    letterSpacing: -0.5,
    lineHeight: tokens.typography.lineHeight.display
  },
  title: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.title,
    fontWeight: tokens.typography.weight.bold,
    letterSpacing: -0.3,
    lineHeight: tokens.typography.lineHeight.title
  },
  subtitle: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.subtitle,
    fontWeight: tokens.typography.weight.semibold,
    letterSpacing: -0.2,
    lineHeight: tokens.typography.lineHeight.subtitle
  },
  lede: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.lede,
    fontWeight: tokens.typography.weight.regular,
    lineHeight: tokens.typography.lineHeight.lede
  },
  read: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.read,
    fontWeight: tokens.typography.weight.regular,
    lineHeight: tokens.typography.lineHeight.read
  },
  quote: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.quote,
    fontWeight: tokens.typography.weight.medium,
    lineHeight: tokens.typography.lineHeight.quote
  },
  pullQuote: {
    fontFamily: tokens.typography.family.serif,
    fontSize: tokens.typography.size.quote,
    fontStyle: "italic",
    fontWeight: tokens.typography.weight.medium,
    letterSpacing: -0.2,
    lineHeight: tokens.typography.lineHeight.quote
  },
  body: {
    fontSize: tokens.typography.size.body,
    fontWeight: tokens.typography.weight.regular,
    lineHeight: tokens.typography.lineHeight.body
  },
  bodyStrong: {
    fontSize: tokens.typography.size.body,
    fontWeight: tokens.typography.weight.semibold,
    lineHeight: tokens.typography.lineHeight.body
  },
  label: {
    fontSize: tokens.typography.size.label,
    fontWeight: tokens.typography.weight.semibold,
    letterSpacing: 0.1,
    lineHeight: tokens.typography.lineHeight.label
  },
  caption: {
    fontSize: tokens.typography.size.caption,
    fontWeight: tokens.typography.weight.medium,
    letterSpacing: 0.1,
    lineHeight: tokens.typography.lineHeight.caption
  },
  eyebrow: {
    fontSize: tokens.typography.size.eyebrow,
    fontWeight: tokens.typography.weight.semibold,
    letterSpacing: 1.5,
    lineHeight: tokens.typography.lineHeight.eyebrow,
    textTransform: "uppercase"
  }
});
