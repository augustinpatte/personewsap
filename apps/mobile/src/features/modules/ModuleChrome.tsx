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

import { AppText, EmptyState } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { getModuleCopy } from "./moduleCopy";
import type { Language } from "../../types/domain";

/**
 * Shared chrome for the four module tabs: masthead with the discreet account
 * entry (top right), the Today | Archive view switch, and the common loading /
 * error surfaces. Account is no longer a bottom tab; this button is its single
 * always-visible entry point.
 */

export function ModuleHeader({
  eyebrow,
  title,
  language
}: {
  eyebrow: string;
  title: string;
  language: Language | null | undefined;
}) {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { user } = useAuth();
  const copy = getModuleCopy(language).common;
  const initial = user?.email?.trim().charAt(0).toUpperCase() ?? "•";

  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <AppText color="muted" variant="eyebrow">
          {eyebrow}
        </AppText>
        <AppText variant="title">{title}</AppText>
      </View>
      <Pressable
        accessibilityHint={copy.accountHint}
        accessibilityLabel={copy.accountLabel}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => router.push("/account" as Href)}
        style={({ pressed }) => [styles.accountButton, pressed ? styles.pressed : null]}
      >
        <AppText color="accentInk" variant="label">
          {initial}
        </AppText>
      </Pressable>
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
      onActionPress={onRetry}
      title={copy.offlineTitle}
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
    accountButton: {
      alignItems: "center",
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 38,
      justifyContent: "center",
      width: 38
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
