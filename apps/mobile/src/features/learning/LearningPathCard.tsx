import { Pressable, StyleSheet, View } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { Language } from "../../types/domain";
import { getLearningCopy } from "./learningCopy";
import type { LearningDomain, LearningObjective, LearningSession } from "./learningTypes";
import {
  localizeLearningField,
  localizeSessionSummary,
  localizeSessionTitle
} from "./learningTypes";

type LearningPathCardProps = {
  language: Language | null | undefined;
  domain: LearningDomain | null;
  objective: LearningObjective | null;
  session: LearningSession | null;
  hasPath: boolean;
  completed?: boolean;
  onCreate: () => void;
  onOpenSession: () => void;
  onOpenOverview: () => void;
};

export function LearningPathCard({
  completed = false,
  domain,
  hasPath,
  language,
  objective,
  onCreate,
  onOpenOverview,
  onOpenSession,
  session
}: LearningPathCardProps) {
  const styles = useThemedStyles(createStyles);
  // The reader's current language. A card must never be the one French thing
  // left on an English Today screen.
  const cardLanguage = language ?? "en";
  const copy = getLearningCopy(cardLanguage).card;
  const openLabel =
    session?.status === "opened" || session?.status === "started"
      ? copy.continue
      : copy.start;

  if (!hasPath) {
    return (
      <Card padding="lg" style={styles.card} tone="muted">
        <View style={styles.kicker}>
          <AppText variant="eyebrow">{copy.kicker}</AppText>
          <AppText color="accentInk" variant="eyebrow">
            {copy.duration}
          </AppText>
        </View>
        <AppText variant="title">{copy.createTitle}</AppText>
        <AppText color="muted" variant="read">
          {copy.createBody}
        </AppText>
        <PrimaryButton label={copy.createButton} onPress={onCreate} />
      </Card>
    );
  }

  if (!session) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onOpenOverview}
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Card padding="lg" style={styles.card} tone="muted">
          <View style={styles.kicker}>
            <AppText variant="eyebrow">{copy.kicker}</AppText>
            <AppText color="accentInk" variant="eyebrow">
              {copy.duration}
            </AppText>
          </View>
          {domain ? (
            <AppText color="muted" variant="caption">
              {localizeLearningField(domain, language)}
            </AppText>
          ) : null}
          <AppText variant="title">{copy.readyTitle}</AppText>
          <AppText color="muted" variant="read">
            {copy.readyBody}
          </AppText>
          <SecondaryButton label={copy.view} onPress={onOpenOverview} />
        </Card>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={completed ? onOpenOverview : onOpenSession}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <Card padding="lg" style={styles.card} tone="accent">
        <View style={styles.kicker}>
          <AppText variant="eyebrow">{copy.kicker}</AppText>
          <AppText color="accentInk" variant="eyebrow">
            {copy.duration}
          </AppText>
        </View>
        {domain ? (
          <AppText color="muted" variant="caption">
              {localizeLearningField(domain, cardLanguage)}
              {objective ? ` · ${localizeLearningField(objective, cardLanguage)}` : ""}
          </AppText>
        ) : null}
        <AppText color="muted" variant="eyebrow">
          {copy.sessionLabel(session.session_number)}
        </AppText>
        <AppText variant="title">{localizeSessionTitle(session, cardLanguage)}</AppText>
        <AppText color="inkSoft" variant="read">
          {localizeSessionSummary(session, cardLanguage)}
        </AppText>
        <View style={styles.footer}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, completed ? styles.statusDotDone : null]} />
            <AppText color="accentInk" variant="label">
              {completed ? copy.completed : copy.available}
            </AppText>
          </View>
          <AppText color="accentInk" variant="label">
            {completed ? copy.view : openLabel}
          </AppText>
        </View>
      </Card>
    </Pressable>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      gap: tokens.space.md
    },
    footer: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md,
      justifyContent: "space-between"
    },
    kicker: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md,
      justifyContent: "space-between"
    },
    pressed: {
      opacity: 0.72
    },
    statusDot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 8,
      width: 8
    },
    statusDotDone: {
      backgroundColor: c.success
    },
    statusRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm
    }
  });
