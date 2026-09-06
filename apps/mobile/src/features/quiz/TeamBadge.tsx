import { StyleSheet, View } from "react-native";

import { AppText } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { ContentLanguage } from "../today/contentTypes";
import { getQuizCopy } from "./quizCopy";
import type { TeamRef } from "./teamMerge";

/**
 * "This one is for your Team."
 *
 * Sober on purpose. A Team article is still a newsletter article and sits in
 * the same editorial column as the rest; the badge marks it without turning the
 * row into a card, and without any of the colour that would make the Newsletter
 * tab look like a game board.
 *
 * The eyebrow reads TEAM and the name reads underneath it in the same muted
 * caption the rest of the masthead uses. When a reader belongs to several Teams
 * that were all assigned the same article, the extra ones are counted rather
 * than listed: two names is a stack, four is a paragraph, and the reader only
 * needs to know it counts for more than one.
 */
export function TeamBadge({
  language,
  teams,
  compact = false
}: {
  language: ContentLanguage;
  teams: TeamRef[];
  /** Row context: one line, name only. */
  compact?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getQuizCopy(language);

  if (teams.length === 0) {
    return null;
  }

  const [primary, ...extra] = teams;
  // A moderated name is hidden, never blanked: the row still has to say the
  // content is a Team item.
  const name = primary.name ?? copy.teamHidden;

  if (compact) {
    return (
      <View style={styles.compact}>
        <View style={styles.dot} />
        <AppText color="accentInk" numberOfLines={1} variant="caption">
          {extra.length > 0 ? `${name} ${copy.teamMore(extra.length)}` : name}
        </AppText>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={[copy.teamBadge, name, ...extra.map((team) => team.name ?? copy.teamHidden)].join(
        ", "
      )}
      accessible
      style={styles.badge}
    >
      <AppText color="accentInk" variant="eyebrow">
        {copy.teamBadge}
      </AppText>
      <AppText color="inkSoft" numberOfLines={2} variant="label">
        {name}
      </AppText>
      {extra.length > 0 ? (
        <AppText color="muted" variant="caption">
          {copy.teamMore(extra.length)}
        </AppText>
      ) : null}
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    badge: {
      alignSelf: "flex-start",
      backgroundColor: c.accentSoft,
      borderRadius: tokens.radius.sm,
      gap: tokens.space.xs,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.sm
    },
    compact: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm
    },
    dot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 6,
      width: 6
    }
  });
