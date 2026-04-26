import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { tokens } from "../design/tokens";
import { AppText } from "./AppText";

type PrimaryButtonProps = {
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  leftAccessory?: ReactNode;
  rightAccessory?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  leftAccessory,
  rightAccessory,
  accessibilityLabel,
  testID,
  style
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={tokens.color.white} size="small" /> : leftAccessory}
        <AppText color="white" style={styles.label} variant="label">
          {label}
        </AppText>
        {rightAccessory ? <View style={styles.accessory}>{rightAccessory}</View> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.md,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md
  },
  pressed: {
    backgroundColor: tokens.color.accentPressed
  },
  disabled: {
    backgroundColor: tokens.color.mutedSoft
  },
  content: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.sm,
    justifyContent: "center"
  },
  label: {
    textAlign: "center"
  },
  accessory: {
    alignItems: "center",
    justifyContent: "center"
  }
});
