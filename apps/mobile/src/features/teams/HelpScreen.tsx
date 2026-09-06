import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "../auth";
import { getReaderCopy } from "../today/contentCopy";
import { ReaderScaffold } from "../today/readers";
import { getHelpCopy } from "./helpCopy";

/**
 * A help page, rendered as a reading.
 *
 * Reuses ReaderScaffold so the back affordance, the safe area, the tab-bar inset
 * and the editorial type are the ones the rest of the app already has. A help
 * page built out of a second set of components would look like documentation
 * bolted onto a product; this looks like the product explaining itself.
 */
export function HelpScreen({ topic }: { topic: "scoring" | "teams" }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { profileLanguage } = useAuth();
  const language = profileLanguage ?? "en";
  const copy = getHelpCopy(language);

  const title = topic === "scoring" ? copy.scoringTitle : copy.teamsTitle;
  const intro = topic === "scoring" ? copy.scoringIntro : copy.teamsIntro;
  const points = topic === "scoring" ? copy.scoringPoints : copy.teamsPoints;

  return (
    <ReaderScaffold
      closeLabel={getReaderCopy(language).close}
      eyebrow={title}
      iconName="help-circle"
      onClose={() => router.back()}
    >
      <AppText style={styles.title} variant="title">
        {title}
      </AppText>

      <AppText style={styles.intro} variant="lede">
        {intro}
      </AppText>

      <View style={styles.points}>
        {points.map((point) => (
          <View key={point.heading} style={styles.point}>
            <AppText color="muted" variant="eyebrow">
              {point.heading}
            </AppText>
            <AppText color="inkSoft" variant="read">
              {point.body}
            </AppText>
          </View>
        ))}
      </View>
    </ReaderScaffold>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: {
      marginTop: tokens.space.md
    },
    intro: {
      marginTop: tokens.space.lg
    },
    points: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.xl,
      marginTop: tokens.space.xl,
      paddingTop: tokens.space.xl
    },
    point: {
      gap: tokens.space.sm
    }
  });
