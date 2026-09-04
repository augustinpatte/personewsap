import { useRouter, type Href } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";
import type { PropsWithChildren } from "react";

import {
  AppText,
  ContentReveal,
  EmptyState,
  IconBadge,
  ModuleContentSkeleton,
  type IconBadgeName
} from "../../components";
import { usePressedSurfaceStyle } from "../../design/usePressedSurfaceStyle";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { EditionProgressState } from "./editionProgress";
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
  const pressedSurface = usePressedSurfaceStyle();

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
            // The label is short and the row is tall enough, but the horizontal
            // reach is only as wide as the word: extend it rather than pad the
            // layout, so a near-miss still switches views.
            hitSlop={{ bottom: 8, left: 10, right: 10, top: 8 }}
            key={key}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.switchItem,
              active ? styles.switchItemActive : null,
              pressed ? pressedSurface : null
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
  contentStyle,
  reveal = false
}: PropsWithChildren<{
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Fade the content in on mount. Set only where this scroll is what replaces
   * a loading placeholder, so a screen that was always there does not fade
   * every time the reader switches back to it.
   */
  reveal?: boolean;
}>) {
  const styles = useThemedStyles(createStyles);

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {reveal ? <ContentReveal>{children}</ContentReveal> : children}
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

/**
 * Content loading, shaped like the content.
 *
 * This is the shared "the edition is on its way" surface for every daily module
 * and the archive. It used to be a centred spinner, which said only that
 * something was happening and then let the page jump when the text arrived.
 *
 * Note what this is NOT used for: anything the reader explicitly asked for and
 * is waiting on — saving a preference, loading an earlier page. Those keep
 * their spinner, because there the spinner is the answer to a question the
 * reader just asked.
 */
export function ModuleLoading({ label }: { label: string }) {
  return (
    <ModuleScroll>
      <ModuleContentSkeleton label={label} />
    </ModuleScroll>
  );
}

/**
 * One line telling the reader where they are in today's edition.
 *
 * Orientation, not a scoreboard: a hairline rule that fills, and a sentence.
 * No streak, no points, no badge — the product's promise is that the session
 * ends, and the only thing worth showing is how close that end is.
 *
 * It renders nothing at all when there is no live edition to be part-way
 * through, so a quiet day stays quiet instead of showing an empty gauge.
 */
export function EditionProgress({
  language,
  state
}: {
  language: Language | null | undefined;
  state: EditionProgressState;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language).common;

  if (state.kind === "hidden") {
    return null;
  }

  const complete = state.kind === "complete";
  const ratio = complete ? 1 : state.ratio;
  const label = complete
    ? copy.editionComplete
    : copy.editionProgress(state.completed, state.total);

  return (
    <View style={styles.progress}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={styles.progressTrack}
      >
        <View
          style={[
            styles.progressFill,
            // Percentage width: the track is as wide as the column, whatever
            // the device, and the fill stays proportional under Dynamic Type.
            { width: `${Math.round(ratio * 100)}%` },
            complete ? styles.progressFillComplete : null
          ]}
        />
      </View>
      <AppText color={complete ? "accentInk" : "muted"} variant="caption">
        {label}
      </AppText>
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
    progress: {
      gap: tokens.space.sm
    },
    progressTrack: {
      backgroundColor: c.border,
      borderRadius: tokens.radius.pill,
      height: 2,
      overflow: "hidden"
    },
    progressFill: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 2
    },
    progressFillComplete: {
      backgroundColor: c.success
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
    scrollContent: {
      flexGrow: 1,
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.lg
    }
  });
