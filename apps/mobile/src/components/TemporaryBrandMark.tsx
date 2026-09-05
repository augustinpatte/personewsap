import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { useThemedStyles, type ThemeColors } from "../design/theme";
import { AppText } from "./AppText";

/**
 * TEMPORARY — the stand-in for the PersoNewsAP logo, which does not exist yet.
 *
 * Drawn entirely from type and two React Native views: a serif "PN" inside a
 * quiet rounded square. No image file ships for it, deliberately — a generated
 * placeholder image would have to be found and deleted later, and would read as
 * a real mark in the meantime.
 *
 * ── REPLACING THIS WITH THE REAL LOGO ──────────────────────────────────────
 * This is the only file that renders the brand mark. When the final artwork
 * arrives, swap the body of the component for the image and keep the props:
 *
 *   return <Image source={require("../../assets/logo.png")} style={styles.mark} />;
 *
 * Nothing else in the app needs to change.
 */
export function TemporaryBrandMark({
  accessibilityLabel,
  style
}: {
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      importantForAccessibility={accessibilityLabel ? "auto" : "no-hide-descendants"}
      style={[styles.mark, style]}
    >
      <AppText style={styles.monogram} variant="subtitle">
        PN
      </AppText>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    mark: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      height: 72,
      justifyContent: "center",
      width: 72
    },
    monogram: {
      // Small caps set as a mark rather than as a headline: the pair needs air
      // between the letters to read as a monogram instead of a word.
      color: c.ink,
      letterSpacing: tokens.typography.tracking.smallCaps
    }
  });
