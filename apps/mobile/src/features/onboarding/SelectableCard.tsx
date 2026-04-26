import { Pressable, StyleSheet, View } from "react-native";

import { AppText, Card, ProgressPill } from "../../components";
import { tokens } from "../../design/tokens";

type SelectableCardProps = {
  label: string;
  description: string;
  selected?: boolean;
  disabled?: boolean;
  badge?: string;
  onPress: () => void;
};

export function SelectableCard({
  label,
  description,
  selected = false,
  disabled = false,
  badge,
  onPress
}: SelectableCardProps) {
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

const styles = StyleSheet.create({
  card: {
    borderColor: tokens.color.border
  },
  selected: {
    borderColor: tokens.color.accent
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
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22
  },
  checkSelected: {
    backgroundColor: tokens.color.accent,
    borderColor: tokens.color.accent
  },
  checkDot: {
    backgroundColor: tokens.color.white,
    borderRadius: tokens.radius.pill,
    height: 7,
    width: 7
  }
});
