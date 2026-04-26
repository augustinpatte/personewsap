import type { PropsWithChildren } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import {
  AppScreen,
  AppText,
  PrimaryButton,
  ProgressPill,
  SecondaryButton
} from "../../components";
import { tokens } from "../../design/tokens";

type OnboardingScaffoldProps = PropsWithChildren<{
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimaryPress: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  footerNote?: string;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function OnboardingScaffold({
  step,
  totalSteps,
  title,
  description,
  primaryLabel,
  onPrimaryPress,
  primaryDisabled = false,
  secondaryLabel,
  onSecondaryPress,
  footerNote,
  contentStyle,
  children
}: OnboardingScaffoldProps) {
  return (
    <AppScreen contentStyle={styles.screen}>
      <AppScreen.Header>
        <ProgressPill label={`Step ${step} of ${totalSteps}`} value={step / totalSteps} />
        <View style={styles.copy}>
          <AppText variant="title">{title}</AppText>
          <AppText color="muted" variant="body">
            {description}
          </AppText>
        </View>
      </AppScreen.Header>

      <AppScreen.Body style={[styles.body, contentStyle]}>{children}</AppScreen.Body>

      <AppScreen.Footer>
        {footerNote ? (
          <AppText color="muted" variant="caption">
            {footerNote}
          </AppText>
        ) : null}
        <PrimaryButton
          disabled={primaryDisabled}
          label={primaryLabel}
          onPress={onPrimaryPress}
        />
        {secondaryLabel && onSecondaryPress ? (
          <SecondaryButton label={secondaryLabel} onPress={onSecondaryPress} />
        ) : null}
      </AppScreen.Footer>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: "space-between"
  },
  copy: {
    gap: tokens.space.sm
  },
  body: {
    gap: tokens.space.md
  }
});
