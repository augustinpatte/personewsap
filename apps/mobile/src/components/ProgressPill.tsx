import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { AppText } from "./AppText";

type ProgressPillTone = "neutral" | "accent" | "success" | "warning";

type ProgressPillProps = {
  label: string;
  value?: number;
  tone?: ProgressPillTone;
  style?: StyleProp<ViewStyle>;
};

const toneStyles = {
  neutral: {
    backgroundColor: tokens.color.surfaceMuted,
    foregroundColor: tokens.color.inkSoft,
    trackColor: tokens.color.border
  },
  accent: {
    backgroundColor: tokens.color.accentSoft,
    foregroundColor: tokens.color.accentInk,
    trackColor: tokens.color.accent
  },
  success: {
    backgroundColor: tokens.color.successSoft,
    foregroundColor: tokens.color.success,
    trackColor: tokens.color.success
  },
  warning: {
    backgroundColor: tokens.color.warningSoft,
    foregroundColor: tokens.color.warning,
    trackColor: tokens.color.warning
  }
} as const;

export function ProgressPill({
  label,
  value,
  tone = "accent",
  style
}: ProgressPillProps) {
  const clampedValue = typeof value === "number" ? Math.min(Math.max(value, 0), 1) : undefined;
  const toneStyle = toneStyles[tone];

  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.backgroundColor }, style]}>
      <AppText style={{ color: toneStyle.foregroundColor }} variant="caption">
        {label}
      </AppText>
      {typeof clampedValue === "number" ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              {
                backgroundColor: toneStyle.trackColor,
                width: `${Math.round(clampedValue * 100)}%`
              }
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: tokens.radius.pill,
    flexDirection: "row",
    gap: tokens.space.sm,
    minHeight: 30,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs
  },
  track: {
    backgroundColor: tokens.color.white,
    borderRadius: tokens.radius.pill,
    height: 4,
    overflow: "hidden",
    width: 42
  },
  fill: {
    borderRadius: tokens.radius.pill,
    height: "100%"
  }
});
