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
 * NAMES, THEN A COUNT. A reader in two Teams that were both assigned an article
 * is told which two — "Loyola Finance · Tennis Team" — because that is the
 * information: it says the article counts twice, and where. Past two the names
 * stop being information and start being a paragraph in the middle of a
 * headline, so the rest are counted instead. That is the whole rule, and it is
 * the reason this never grows to a stack of chips.
 */

/** Names shown before the rest become a count. Two lines is a badge; four is a list. */
const NAMED_TEAM_LIMIT = 2;

export function TeamBadge({
  language,
  teams,
  compact = false
}: {
  language: ContentLanguage;
  teams: TeamRef[];
  /** Row context: one line, names only. */
  compact?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getQuizCopy(language);

  if (teams.length === 0) {
    return null;
  }

  // A moderated name is hidden, never blanked: the row still has to say the
  // content is a Team item, so the neutral label stands in for the name.
  const names = teams.map((team) => team.name ?? copy.teamHidden);
  const named = names.slice(0, NAMED_TEAM_LIMIT);
  const overflow = names.length - named.length;
  const label = overflow > 0 ? [...named, copy.teamMore(overflow)] : named;
  // One string for assistive tech, whatever the layout does with it — and the
  // overflow spelled out, because "plus two" is not a sentence.
  const accessibilityLabel = [
    copy.teamBadge,
    ...named,
    ...(overflow > 0 ? [copy.teamMoreSpoken(overflow)] : [])
  ].join(", ");

  if (compact) {
    return (
      <View accessibilityLabel={accessibilityLabel} accessible style={styles.compact}>
        <View style={styles.dot} />
        <AppText color="accentInk" numberOfLines={1} style={styles.compactText} variant="caption">
          {label.join(" · ")}
        </AppText>
      </View>
    );
  }

  return (
    <View accessibilityLabel={accessibilityLabel} accessible style={styles.badge}>
      <AppText color="accentInk" variant="eyebrow">
        {copy.teamBadge}
      </AppText>
      {named.map((name) => (
        <AppText color="inkSoft" key={name} numberOfLines={2} variant="label">
          {name}
        </AppText>
      ))}
      {overflow > 0 ? (
        <AppText color="muted" variant="caption">
          {copy.teamMore(overflow)}
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
    // The name line yields before the headline does: a long Team name
    // truncates rather than pushing the article title off its row.
    compactText: {
      flexShrink: 1
    },
    dot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 6,
      width: 6
    }
  });
