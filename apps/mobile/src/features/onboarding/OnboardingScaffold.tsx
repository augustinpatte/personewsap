import type { PropsWithChildren } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
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
  primaryLoading?: boolean;
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
  primaryLoading = false,
  secondaryLabel,
  onSecondaryPress,
  footerNote,
  contentStyle,
  children
}: OnboardingScaffoldProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <ProgressPill label={`Step ${step} of ${totalSteps}`} value={step / totalSteps} />
          <View style={styles.copy}>
            <AppText variant="title">{title}</AppText>
            <AppText color="muted" variant="body">
              {description}
            </AppText>
          </View>
        </View>

        <View style={[styles.body, contentStyle]}>{children}</View>
      </ScrollView>

      <View style={styles.footer}>
        {footerNote ? (
          <AppText color="muted" variant="caption">
            {footerNote}
          </AppText>
        ) : null}
        <PrimaryButton
          disabled={primaryDisabled}
          label={primaryLabel}
          loading={primaryLoading}
          onPress={onPrimaryPress}
        />
        {secondaryLabel && onSecondaryPress ? (
          <SecondaryButton label={secondaryLabel} onPress={onSecondaryPress} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: tokens.color.background,
    flex: 1
  },
  scrollContent: {
    flexGrow: 1,
    gap: tokens.space.xl,
    paddingBottom: tokens.space.lg,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xl
  },
  header: {
    gap: tokens.space.sm
  },
  copy: {
    gap: tokens.space.sm
  },
  body: {
    gap: tokens.space.md
  },
  footer: {
    backgroundColor: tokens.color.background,
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.sm,
    paddingBottom: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md
  }
});
