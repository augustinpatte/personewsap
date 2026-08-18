import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { useThemedStyles, type ThemeColors } from "../design/theme";
import { AppText } from "./AppText";
import { IconBadge, type IconBadgeName } from "./IconBadge";
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
  iconName?: IconBadgeName;
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
  iconName,
  style
}: EmptyStateProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.copy}>
        {iconName ? <IconBadge name={iconName} tone="muted" /> : null}
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

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      alignItems: "stretch",
      backgroundColor: c.backgroundRaised,
      borderColor: c.border,
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
