import { Pressable, StyleSheet, View } from "react-native";

import { AppText, Card, ProgressPill } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";

type SelectableCardProps = {
  label: string;
  description: string;
  selected?: boolean;
  disabled?: boolean;
  badge?: string;
  selectedBadge?: string;
  unselectedBadge?: string;
  onPress: () => void;
};

export function SelectableCard({
  label,
  description,
  selected = false,
  disabled = false,
  badge,
  selectedBadge,
  unselectedBadge,
  onPress
}: SelectableCardProps) {
  const styles = useThemedStyles(createStyles);
  const selectionBadge = selected ? selectedBadge : unselectedBadge;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      {({ pressed }) => (
        <Card
          padding="md"
          style={[
            styles.card,
            selected ? styles.selected : null,
            pressed && !disabled ? styles.pressed : null,
            disabled ? styles.disabled : null
          ]}
          tone={selected ? "accent" : "default"}
        >
          <View style={styles.row}>
            <View style={styles.copy}>
              <AppText color={disabled ? "mutedSoft" : "ink"} variant="bodyStrong">
                {label}
              </AppText>
              <AppText color={disabled ? "mutedSoft" : "muted"} variant="caption">
                {description}
              </AppText>
            </View>
            {badge ? (
              <ProgressPill label={badge} tone={disabled ? "neutral" : "accent"} />
            ) : selectionBadge ? (
              <ProgressPill
                label={selectionBadge}
                tone={disabled ? "neutral" : selected ? "accent" : "neutral"}
              />
            ) : (
              <View style={[styles.check, selected ? styles.checkSelected : null]}>
                {selected ? <View style={styles.checkDot} /> : null}
              </View>
            )}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderColor: c.border
    },
    selected: {
      borderColor: c.accent
    },
    pressed: {
      transform: [{ scale: 0.99 }]
    },
    disabled: {
      opacity: 0.62
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    copy: {
      flex: 1,
      gap: tokens.space.xs
    },
    check: {
      alignItems: "center",
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 22,
      justifyContent: "center",
      width: 22
    },
    checkSelected: {
      backgroundColor: c.accent,
      borderColor: c.accent
    },
    checkDot: {
      backgroundColor: c.onAccent,
      borderRadius: tokens.radius.pill,
      height: 7,
      width: 7
    }
  });
