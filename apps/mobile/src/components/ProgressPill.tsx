import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { useThemeColors, type ThemeColors } from "../design/theme";
import { AppText } from "./AppText";

type ProgressPillTone = "neutral" | "accent" | "success" | "warning";

type ProgressPillProps = {
  label: string;
  value?: number;
  tone?: ProgressPillTone;
  style?: StyleProp<ViewStyle>;
};

function toneStylesFor(
  c: ThemeColors
): Record<
  ProgressPillTone,
  { backgroundColor: string; foregroundColor: string; trackColor: string }
> {
  return {
    neutral: {
      backgroundColor: c.surfaceMuted,
      foregroundColor: c.inkSoft,
      trackColor: c.border
    },
    accent: {
      backgroundColor: c.accentSoft,
      foregroundColor: c.accentInk,
      trackColor: c.accent
    },
    success: {
      backgroundColor: c.successSoft,
      foregroundColor: c.success,
      trackColor: c.success
    },
    warning: {
      backgroundColor: c.warningSoft,
      foregroundColor: c.warning,
      trackColor: c.warning
    }
  };
}

export function ProgressPill({
  label,
  value,
  tone = "accent",
  style
}: ProgressPillProps) {
  const colors = useThemeColors();
  const clampedValue = typeof value === "number" ? Math.min(Math.max(value, 0), 1) : undefined;
  const toneStyle = toneStylesFor(colors)[tone];

  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.backgroundColor }, style]}>
      <AppText style={{ color: toneStyle.foregroundColor }} variant="caption">
        {label}
      </AppText>
      {typeof clampedValue === "number" ? (
        <View style={[styles.track, { backgroundColor: colors.border }]}>
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
