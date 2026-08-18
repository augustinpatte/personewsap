import { useRouter, type Href } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";
import type { PropsWithChildren } from "react";

import { AppText, EmptyState, IconBadge, type IconBadgeName } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { getModuleCopy } from "./moduleCopy";
import type { Language } from "../../types/domain";
import type { OnboardingModuleId } from "../onboarding";

/**
 * Shared chrome for the four module tabs: masthead, the Today | Archive view
 * switch, and the common loading / error surfaces. Settings is now a permanent
 * tab, so module headers do not carry a second account shortcut.
 */

export function ModuleHeader({
  eyebrow,
  iconName,
  title,
  metaItems
}: {
  eyebrow: string;
  iconName: IconBadgeName;
  title: string;
  metaItems?: Array<string | null | undefined>;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.header}>
      <IconBadge accessibilityLabel={eyebrow} name={iconName} tone="accent" />
      <View style={styles.headerCopy}>
        <AppText color="muted" variant="eyebrow">
          {eyebrow}
        </AppText>
        <AppText variant="title">{title}</AppText>
        {metaItems ? <MetaLine items={metaItems} /> : null}
      </View>
    </View>
  );
}

export function ViewSwitch({
  leftLabel,
  rightLabel,
  value,
  onChange
}: {
  leftLabel: string;
  rightLabel: string;
  value: "left" | "right";
  onChange: (value: "left" | "right") => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View accessibilityRole="tablist" style={styles.switchRow}>
      {(
        [
          { key: "left", label: leftLabel },
          { key: "right", label: rightLabel }
        ] as const
      ).map(({ key, label }) => {
        const active = value === key;

        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={key}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.switchItem,
              active ? styles.switchItemActive : null,
              pressed ? styles.pressed : null
            ]}
          >
            <AppText color={active ? "ink" : "muted"} variant="label">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Scrollable body for a module view. The screen chrome (header + switch) sits
 * above it inside one SafeAreaView, so this deliberately is NOT another
 * SafeAreaView — just a padded scroll surface.
 */
export function ModuleScroll({
  children,
  contentStyle
}: PropsWithChildren<{ contentStyle?: StyleProp<ViewStyle> }>) {
  const styles = useThemedStyles(createStyles);

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/**
 * A printed rule, optionally carrying a small-caps label.
 *
 * The device that makes a screen read as a publication rather than a stack of
 * cards: it separates without boxing, so the paper background stays continuous.
 * Decorative, so it is hidden from screen readers when it carries no label.
 */
export function EditorialRule({ label }: { label?: string }) {
  const styles = useThemedStyles(createStyles);

  if (!label) {
    return <View accessibilityElementsHidden importantForAccessibility="no" style={styles.rule} />;
  }

  return (
    <View style={styles.ruleRow}>
      <View style={styles.ruleSegment} />
      <AppText color="muted" variant="eyebrow">
        {label}
      </AppText>
      <View style={styles.ruleSegment} />
    </View>
  );
}

/**
 * One quiet line of metadata — topic, reading time, state — separated by
 * middots. Empty entries are dropped so a missing value never leaves a dangling
 * separator, and the whole line is announced as one phrase rather than as three
 * disconnected fragments.
 */
export function MetaLine({
  items,
  tone = "muted"
}: {
  items: Array<string | null | undefined>;
  tone?: "muted" | "accentInk";
}) {
  const parts = items.filter((item): item is string => Boolean(item && item.trim()));

  if (parts.length === 0) {
    return null;
  }

  return (
    <AppText accessibilityLabel={parts.join(", ")} color={tone} variant="caption">
      {parts.join("  ·  ")}
    </AppText>
  );
}

/**
 * A small square monogram: the first letters of a company or market, set in the
 * editorial serif. It gives a story a visual identity without inventing a logo
 * or loading a remote image.
 */
export function Monogram({ label }: { label: string }) {
  const styles = useThemedStyles(createStyles);
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={styles.monogram}>
      <AppText color="accentInk" variant="label">
        {initials || "—"}
      </AppText>
    </View>
  );
}

export function ModuleLoading({ label }: { label: string }) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();

  return (
    <View accessibilityLabel={label} style={styles.loading}>
      <ActivityIndicator color={colors.muted} />
    </View>
  );
}

export function ModuleError({
  language,
  onRetry
}: {
  language: Language | null | undefined;
  onRetry: () => void;
}) {
  const copy = getModuleCopy(language).common;

  return (
    <EmptyState
      actionLabel={copy.retry}
      description={copy.offlineBody}
      iconName="wifi-off"
      onActionPress={onRetry}
      title={copy.offlineTitle}
    />
  );
}

export function ModuleDisabledState({
  language,
  moduleId
}: {
  language: Language | null | undefined;
  moduleId: Exclude<OnboardingModuleId, "learning_path">;
}) {
  const router = useRouter();
  const copy = getModuleCopy(language).disabled[moduleId];

  return (
    <EmptyState
      actionLabel={copy.action}
      description={copy.body}
      iconName="sliders"
      onActionPress={() => router.push("/(tabs)/settings" as Href)}
      title={copy.title}
    />
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: tokens.space.md,
      justifyContent: "space-between"
    },
    headerCopy: {
      flex: 1,
      gap: tokens.space.xs
    },
    pressed: {
      opacity: 0.6
    },
    switchRow: {
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: tokens.space.xl
    },
    switchItem: {
      borderBottomColor: "transparent",
      borderBottomWidth: 2,
      marginBottom: -1,
      minHeight: 44,
      justifyContent: "center"
    },
    switchItemActive: {
      borderBottomColor: c.accent
    },
    rule: {
      backgroundColor: c.border,
      height: 1
    },
    ruleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    ruleSegment: {
      backgroundColor: c.border,
      flex: 1,
      height: 1
    },
    monogram: {
      alignItems: "center",
      backgroundColor: c.accentSoft,
      borderRadius: tokens.radius.sm,
      height: 40,
      justifyContent: "center",
      width: 40
    },
    loading: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: tokens.space.xxl
    },
    scrollContent: {
      flexGrow: 1,
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.lg
    }
  });
