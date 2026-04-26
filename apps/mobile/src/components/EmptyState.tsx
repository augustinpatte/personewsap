import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { AppText } from "./AppText";
import { PrimaryButton } from "./PrimaryButton";
import { SecondaryButton } from "./SecondaryButton";

type EmptyStateProps = {
  title: string;
  description: string;
  eyebrow?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  secondaryActionLabel?: string;
  onSecondaryActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({
  title,
  description,
  eyebrow,
  actionLabel,
  onActionPress,
  secondaryActionLabel,
  onSecondaryActionPress,
  style
}: EmptyStateProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.copy}>
        {eyebrow ? <AppText align="center" variant="eyebrow">{eyebrow}</AppText> : null}
        <AppText align="center" variant="subtitle">
          {title}
        </AppText>
        <AppText align="center" color="muted" variant="body">
          {description}
        </AppText>
      </View>
      {actionLabel || secondaryActionLabel ? (
        <View style={styles.actions}>
          {actionLabel ? <PrimaryButton label={actionLabel} onPress={onActionPress} /> : null}
          {secondaryActionLabel ? (
            <SecondaryButton label={secondaryActionLabel} onPress={onSecondaryActionPress} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "stretch",
    backgroundColor: tokens.color.backgroundRaised,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    gap: tokens.space.lg,
    padding: tokens.space.xl
  },
  copy: {
    alignItems: "center",
    gap: tokens.space.sm
  },
  actions: {
    gap: tokens.space.sm
  }
});
