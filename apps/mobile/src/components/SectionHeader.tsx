import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { AppText } from "./AppText";
import { SecondaryButton } from "./SecondaryButton";

type SectionHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({
  title,
  eyebrow,
  description,
  actionLabel,
  onActionPress,
  style
}: SectionHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.copy}>
        {eyebrow ? <AppText variant="eyebrow">{eyebrow}</AppText> : null}
        <AppText variant="subtitle">{title}</AppText>
        {description ? (
          <AppText color="muted" variant="caption">
            {description}
          </AppText>
        ) : null}
      </View>
      {actionLabel ? (
        <SecondaryButton label={actionLabel} onPress={onActionPress} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  copy: {
    flex: 1,
    gap: tokens.space.xs
  },
  action: {
    minHeight: 38,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  }
});
