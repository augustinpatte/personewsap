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
 */
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
      <IconBadge name={iconName} tone="muted" />
      <AppText variant="subtitle">
        {upcoming ? copy.onItsWayTitle : copy.quietDayTitle}
      </AppText>
      <AppText color="muted" variant="read">
        {upcoming ? copy.onItsWayBody : copy.quietDayBody}
      </AppText>
      <AppText color="muted" variant="caption">
        {upcoming ? copy.onItsWaySecondary : copy.quietDaySecondary}
      </AppText>
      {nextWeekday ? (
        <AppText color="muted" variant="caption">
          {copy.nextEdition(nextWeekday)}
        </AppText>
      ) : null}
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
      gap: tokens.space.md,
      paddingTop: tokens.space.lg
    },
    actions: {
      gap: tokens.space.sm,
      marginTop: tokens.space.md
    }
  });
