import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { useThemedStyles, type ThemeColors } from "../design/theme";

/**
 * Placeholders shaped like the content that is coming.
 *
 * A centred spinner tells the reader that something is happening; it does not
 * tell them what, and the page then jumps when the real content lands. These
 * blocks occupy roughly the geometry of the article they stand in for, so the
 * screen is already composed when the text arrives and only the greys are
 * replaced.
 *
 * Deliberately static. A shimmer is a continuously running animation on every
 * loading screen, which costs more than it returns and has to be undone again
 * for Reduce Motion. Stillness reads as calm, which is the product's register.
 *
 * The fill is `surfaceMuted` from the active palette — warm paper in daylight,
 * warm espresso at night — never a neutral grey that would belong to some other
 * app.
 */

export function SkeletonLine({
  width = "100%",
  height = 16,
  style
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(createStyles);

  return <View style={[styles.block, { width, height }, style]} />;
}

export function SkeletonBlock({
  height = 96,
  style
}: {
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(createStyles);

  return <View style={[styles.block, styles.blockRadius, { height }, style]} />;
}

/**
 * One edition's worth of placeholder: the masthead line, a lead article with a
 * two-line headline and a summary, then two secondary headlines. It mirrors the
 * real Today layout closely enough that the transition is a recolouring rather
 * than a reflow.
 *
 * `accessibilityLabel` carries the caller's "Loading…" string so a screen
 * reader announces the state once instead of reading nine anonymous blocks.
 */
export function ModuleContentSkeleton({ label }: { label: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.container}>
      <View style={styles.group}>
        <SkeletonLine height={11} width="38%" />
        <SkeletonLine height={1} width="100%" />
      </View>

      <View style={styles.group}>
        <SkeletonLine height={11} width="22%" />
        <SkeletonLine height={30} width="92%" />
        <SkeletonLine height={30} width="64%" />
        <SkeletonLine height={13} width="46%" />
        <SkeletonLine height={18} width="100%" />
        <SkeletonLine height={18} width="86%" />
      </View>

      <View style={styles.group}>
        <SkeletonLine height={1} width="100%" />
        <SkeletonLine height={22} width="88%" />
        <SkeletonLine height={13} width="52%" />
      </View>

      <View style={styles.group}>
        <SkeletonLine height={22} width="76%" />
        <SkeletonLine height={13} width="48%" />
      </View>
    </View>
  );
}

/**
 * A single reading: eyebrow, headline, byline, then body lines of uneven
 * length so the block reads as prose rather than as a table.
 */
export function ReaderContentSkeleton({ label }: { label: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.container}>
      <View style={styles.group}>
        <SkeletonLine height={11} width="30%" />
        <SkeletonLine height={34} width="94%" />
        <SkeletonLine height={34} width="70%" />
        <SkeletonLine height={13} width="42%" />
      </View>

      <View style={styles.group}>
        {["100%", "97%", "92%", "99%", "88%", "95%", "60%"].map((width, index) => (
          <SkeletonLine height={18} key={`${width}-${index}`} width={width as `${number}%`} />
        ))}
      </View>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: tokens.space.xl
    },
    group: {
      gap: tokens.space.md
    },
    block: {
      backgroundColor: c.surfaceMuted,
      borderRadius: tokens.radius.xs
    },
    blockRadius: {
      borderRadius: tokens.radius.lg
    }
  });
