import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { useThemedStyles, type ThemeColors } from "../design/theme";

export type IconBadgeName = ComponentProps<typeof Feather>["name"];

type IconBadgeTone = "default" | "accent" | "muted" | "danger";

type IconBadgeProps = {
  name: IconBadgeName;
  tone?: IconBadgeTone;
  size?: "sm" | "md";
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function IconBadge({
  accessibilityLabel,
  name,
  size = "md",
  style,
  tone = "default"
}: IconBadgeProps) {
  const styles = useThemedStyles(createStyles);
  const iconSize = size === "sm" ? 16 : 18;

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityElementsHidden={!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      importantForAccessibility={accessibilityLabel ? "auto" : "no-hide-descendants"}
      style={[styles.badge, styles[tone], styles[`${size}Badge`], style]}
    >
      <Feather name={name} size={iconSize} style={styles[`${tone}Icon`]} />
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    badge: {
      alignItems: "center",
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      justifyContent: "center"
    },
    smBadge: {
      height: 34,
      width: 34
    },
    mdBadge: {
      height: 42,
      width: 42
    },
    default: {
      backgroundColor: c.surface,
      borderColor: c.borderStrong
    },
    accent: {
      backgroundColor: c.accentSoft,
      borderColor: c.accent
    },
    muted: {
      backgroundColor: c.backgroundRaised,
      borderColor: c.border
    },
    danger: {
      backgroundColor: c.dangerSoft,
      borderColor: c.danger
    },
    defaultIcon: {
      color: c.ink
    },
    accentIcon: {
      color: c.accentInk
    },
    mutedIcon: {
      color: c.muted
    },
    dangerIcon: {
      color: c.danger
    }
  });
