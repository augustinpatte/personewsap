import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AppScreen, TemporaryBrandMark } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors } from "../../design/theme";
import { useBootLanguage } from "../../lib/useBootLanguage";
import type { Language } from "../../types/domain";
import { getLaunchCopy } from "./launchCopy";

/**
 * What the reader sees between tapping the icon and the app knowing who they
 * are.
 *
 * THE MARK, AND NOTHING ELSE. It used to carry the word mark, a tagline and a
 * two-line slogan under the monogram — a small launch page. It is deliberately
 * down to "PN" now: the wait is short, the name is already on the icon the
 * reader just tapped, and a sentence that has to wait for the profile to know
 * which language to speak is the wrong thing to put in front of a cold start.
 *
 * The one line of text that remains is not drawn: the spinner's accessibility
 * label, which stays silent until the language is known (from the profile, or
 * from the last one this device saw) rather than guessing English.
 *
 * Nothing here delays the app. The screen is unmounted the moment auth
 * resolves; the branding is what fills a wait, never a reason for one.
 */
export function AppLaunchScreen({ language = null }: { language?: Language | null }) {
  const colors = useThemeColors();
  const bootLanguage = useBootLanguage(language);
  const copy = getLaunchCopy(bootLanguage);

  return (
    <AppScreen centered scroll={false}>
      <View style={styles.launch}>
        <TemporaryBrandMark />

        {/* The least important thing on the screen: it reports that work is
            happening, in a tone that sits behind the mark rather than in front
            of it. */}
        <ActivityIndicator
          accessibilityLabel={copy?.loadingAccessibilityLabel}
          color={colors.mutedSoft}
        />
      </View>
    </AppScreen>
  );
}

// No colour lives here: the launch screen paints nothing of its own, so the
// same StyleSheet serves both themes.
const styles = StyleSheet.create({
  launch: {
    alignItems: "center",
    gap: tokens.space.xl
  }
});
