import { StyleSheet, View } from "react-native";

import { AppText, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles } from "../../design/theme";
import type { Language } from "../../types/domain";
import { isEditionDay, nextEditionDate } from "../today/editionCadence";
import { getModuleCopy } from "./moduleCopy";

/**
 * Honest "no edition" surface shared by the content modules. A quiet day in
 * the 4x/week cadence is framed as deliberate; an edition day whose drop has
 * not landed yet is "on its way". Never a sample, never an error tone.
 */
export function TodayQuietState({
  dropDate,
  language,
  onRefresh
}: {
  dropDate: string;
  language: Language;
  onRefresh: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language).common;
  const editionDay = isEditionDay(dropDate);
  const upcoming = nextEditionDate(dropDate);
  const nextLabel =
    !editionDay && upcoming
      ? copy.nextEdition(formatWeekday(upcoming.date, language))
      : null;

  return (
    <View style={styles.container}>
      <AppText variant="subtitle">
        {editionDay ? copy.onItsWayTitle : copy.quietDayTitle}
      </AppText>
      <AppText color="muted" variant="read">
        {editionDay ? copy.onItsWayBody : copy.quietDayBody}
      </AppText>
      {nextLabel ? (
        <AppText color="muted" variant="caption">
          {nextLabel}
        </AppText>
      ) : null}
      <View style={styles.action}>
        <SecondaryButton label={copy.retry} onPress={onRefresh} />
      </View>
    </View>
  );
}

function formatWeekday(dropDate: string, language: Language): string {
  return new Intl.DateTimeFormat(language, { weekday: "long" }).format(
    new Date(`${dropDate}T12:00:00Z`)
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      gap: tokens.space.md,
      paddingTop: tokens.space.lg
    },
    action: {
      alignSelf: "flex-start",
      marginTop: tokens.space.md
    }
  });
