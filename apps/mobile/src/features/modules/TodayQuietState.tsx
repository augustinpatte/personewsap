import { StyleSheet, View } from "react-native";

import {
  AppText,
  IconBadge,
  PrimaryButton,
  SecondaryButton,
  type IconBadgeName
} from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles } from "../../design/theme";
import type { Language } from "../../types/domain";
import { nextEditionWeekday } from "../today/todayEditionState";
import { getModuleCopy } from "./moduleCopy";

/**
 * The two honest "no edition" surfaces, shared by the content modules.
 *
 *   upcoming — today is a scheduled edition day and the drop has not landed
 *              yet. Framed as imminent, with a refresh alongside the archive.
 *   quiet    — today is an off-day in the 4x/week cadence. Framed as the
 *              rhythm working as intended; refreshing would change nothing, so
 *              the archive is the only action offered.
 *
 * Which of the two is shown is decided upstream by resolveTodayEditionState, so
 * this component never re-derives it and can never disagree with the screen
 * that rendered it. Never a sample edition, never an error tone.
 *
 * COMPOSITION. One block, read top to bottom in one breath: mark, title,
 * what the rhythm is, what to do meanwhile, when the next one lands, then the
 * action. It used to be five loosely spaced paragraphs at nearly equal weight —
 * the explanation set in the reading face, as large as the title — which read
 * as a stretched page rather than a composed state. The weights now descend,
 * the prose is held to a readable measure, and the action sits with the message
 * instead of floating away from it.
 */

/**
 * The measure the prose is held to: roughly 45–65 characters at this size,
 * which is where a paragraph stays comfortable to read. A width, never a
 * height — nothing here assumes a device.
 */
const PROSE_MAX_WIDTH = 420;

export function TodayQuietState({
  dropDate,
  iconName = "calendar",
  language,
  onOpenArchive,
  onRefresh,
  state
}: {
  dropDate: string;
  iconName?: IconBadgeName;
  language: Language;
  /** Opens the module's existing Archive view. */
  onOpenArchive: () => void;
  onRefresh: () => void;
  state: "upcoming" | "quiet";
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language).common;
  const upcoming = state === "upcoming";
  // Only meaningful on an off-day: on a scheduled day the next edition is the
  // one already on its way, and naming a weekday would contradict that.
  const nextWeekday = upcoming ? null : nextEditionWeekday(dropDate, language);

  return (
    <View style={styles.container}>
      <View style={styles.message}>
        <IconBadge name={iconName} tone="muted" />

        <AppText style={styles.title} variant="subtitle">
          {upcoming ? copy.onItsWayTitle : copy.quietDayTitle}
        </AppText>

        {/* Body, not the reading face: this explains the rhythm, it is not the
            thing being read today. */}
        <AppText color="inkSoft" style={styles.prose} variant="body">
          {upcoming ? copy.onItsWayBody : copy.quietDayBody}
        </AppText>

        <AppText color="muted" style={styles.prose} variant="caption">
          {upcoming ? copy.onItsWaySecondary : copy.quietDaySecondary}
        </AppText>

        {nextWeekday ? (
          // The one fact a reader on an off-day actually wants, so it carries
          // the accent rather than another line of grey.
          <AppText color="accentInk" style={styles.next} variant="label">
            {copy.nextEdition(nextWeekday)}
          </AppText>
        ) : null}
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={upcoming ? copy.browseArchive : copy.exploreArchive}
          onPress={onOpenArchive}
        />
        {/* The provider loads once per session, so on a scheduled day this is
            the only way to pick up an edition that lands while the app is
            open. On a quiet day there is nothing to pick up. */}
        {upcoming ? <SecondaryButton label={copy.retry} onPress={onRefresh} /> : null}
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      gap: tokens.space.xl
    },
    // Tight inside the message, generous between the message and the action:
    // the lines belong together, the button is the answer to them.
    message: {
      gap: tokens.space.sm
    },
    title: {
      marginTop: tokens.space.xs
    },
    prose: {
      maxWidth: PROSE_MAX_WIDTH
    },
    next: {
      marginTop: tokens.space.xs
    },
    actions: {
      alignItems: "stretch",
      gap: tokens.space.sm,
      maxWidth: PROSE_MAX_WIDTH
    }
  });
