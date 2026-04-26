import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { tokens } from "../design/tokens";
import { AppText } from "./AppText";

type SecondaryButtonProps = {
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  leftAccessory?: ReactNode;
  rightAccessory?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  leftAccessory,
  rightAccessory,
  accessibilityLabel,
  testID,
  style
}: SecondaryButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style
      ]}
    >
      <View style={styles.content}>
        {leftAccessory}
        <AppText color={disabled ? "mutedSoft" : "accentInk"} style={styles.label} variant="label">
          {label}
        </AppText>
        {rightAccessory}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md
  },
  pressed: {
    backgroundColor: tokens.color.accentSoft,
    borderColor: tokens.color.accent
  },
  disabled: {
    backgroundColor: tokens.color.surfaceMuted,
    borderColor: tokens.color.border
  },
  content: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.sm,
    justifyContent: "center"
  },
  label: {
    textAlign: "center"
  }
});
