import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AppScreen, AppText, ContentReveal, TemporaryBrandMark } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors } from "../../design/theme";
import { useBootLanguage } from "../../lib/useBootLanguage";
import type { Language } from "../../types/domain";
import { BRAND_NAME, getLaunchCopy } from "./launchCopy";

/**
 * What the reader sees between tapping the icon and the app knowing who they
 * are.
 *
 * It replaced a card that said "Loading your session" — in English, because the
 * profile that carries the language had not arrived yet. The rule now is that
 * the first user-facing text either speaks the reader's language or says
 * nothing at all: the brand block is language-neutral and renders immediately,
 * the two localized lines join it as soon as the language is known (from the
 * profile, or from the last one this device saw).
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

        <View style={styles.identity}>
          <AppText align="center" variant="title">
            {BRAND_NAME}
          </AppText>

          {copy ? (
            // Opacity only, and only on the lines that had to wait for the
            // language: the mark and the name are already in place, so nothing
            // moves — the sentence simply arrives. ContentReveal is a no-op
            // under Reduce Motion.
            <ContentReveal style={styles.copy}>
              <AppText align="center" color="muted" variant="caption">
                {copy.tagline}
              </AppText>

              <View style={styles.slogan}>
                {copy.sloganLines.map((line) => (
                  <AppText align="center" color="inkSoft" key={line} variant="body">
                    {line}
                  </AppText>
                ))}
              </View>
            </ContentReveal>
          ) : null}
        </View>

        {/* The least important thing on the screen: it reports that work is
            happening, in a tone that sits behind the type rather than in front
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
  },
  identity: {
    alignItems: "center",
    gap: tokens.space.md
  },
  copy: {
    alignItems: "center",
    gap: tokens.space.md
  },
  slogan: {
    alignItems: "center"
  }
});
