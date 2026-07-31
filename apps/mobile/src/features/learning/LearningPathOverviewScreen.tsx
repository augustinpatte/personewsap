import { StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles } from "../../design/theme";
import type { Language } from "../../types/domain";
import { nextEditionDate } from "../today/editionCadence";
import { getCurrentLevelLabel, getTargetLevelLabel } from "./learningLevels";
import { getLearningCopy } from "./learningCopy";
import { useLearningPath } from "./LearningPathContext";
import {
  localizeLearningDescription,
  localizeLearningField,
  localizeSessionTitle
} from "./learningTypes";

export function LearningPathOverviewScreen({
  language
}: {
  language: Language | null | undefined;
}) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language).overview;
  const {
    activeDomain,
    activeObjective,
    activePath,
    completedSessions,
    nextAvailableAt,
    sessions,
    status
  } = useLearningPath();

  if (status === "loading") {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="title">{copy.loading}</AppText>
        </Card>
      </AppScreen>
    );
  }

  if (!activePath || !activeDomain || !activeObjective) {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="eyebrow">{copy.eyebrow}</AppText>
          <AppText variant="title">{copy.emptyTitle}</AppText>
          <AppText color="muted" variant="body">
            {copy.emptyBody}
          </AppText>
          <PrimaryButton
            label={copy.replace}
            onPress={() => router.push("/(learning)/setup" as unknown as Href)}
          />
        </Card>
      </AppScreen>
    );
  }

  const nextDate = nextAvailableAt ?? nextEditionDate(new Date().toISOString().slice(0, 10))?.date ?? null;

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <AppText variant="eyebrow">{copy.eyebrow}</AppText>
        <AppText variant="title">{copy.title}</AppText>
        <AppText color="muted" variant="body">
          {localizeLearningDescription(activeObjective, language)}
        </AppText>
      </View>

      <Card padding="lg">
        <InfoRow label={copy.domain} value={localizeLearningField(activeDomain, language)} />
        <InfoRow label={copy.orientation} value={localizeLearningField(activeObjective, language)} />
        <InfoRow label={copy.status} value={copy.pathInProgress} />
        <InfoRow
          label={copy.sessionsCompleted}
          value={String(completedSessions.length)}
        />
        <InfoRow label={copy.conceptsStudied} value={String(completedSessions.length)} />
        <InfoRow
          label={copy.nextEdition}
          value={nextDate ? formatDate(nextDate, language) : copy.nextUnknown}
        />
        <InfoRow
          label={copy.currentLevel}
          value={getCurrentLevelLabel(activePath.current_level, language)}
        />
        <InfoRow
          label={copy.targetLevel}
          value={getTargetLevelLabel(activePath.target_level, language)}
        />
      </Card>

      <Card padding="lg" tone="muted">
        <AppText variant="subtitle">{copy.history}</AppText>
        {completedSessions.length === 0 ? (
          <AppText color="muted" variant="body">
            {copy.noHistory}
          </AppText>
        ) : (
          completedSessions.map((session) => (
            <View key={session.id} style={styles.historyRow}>
              <AppText color="muted" variant="caption">
                {copy.sessionLabel(session.session_number)}
              </AppText>
              <AppText variant="bodyStrong">{localizeSessionTitle(session, language)}</AppText>
            </View>
          ))
        )}
        {sessions.length > completedSessions.length ? (
          <AppText color="muted" variant="caption">
            {copy.remainingSessions(sessions.length - completedSessions.length)}
          </AppText>
        ) : null}
      </Card>

      <SecondaryButton
        label={copy.replace}
        onPress={() =>
          router.push(
            { pathname: "/(learning)/setup", params: { replace: "1" } } as unknown as Href
          )
        }
      />
    </AppScreen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.infoRow}>
      <AppText color="muted" variant="caption">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function formatDate(date: string, language: Language | null | undefined) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr" : "en", {
    day: "numeric",
    month: "long"
  }).format(new Date(`${date}T12:00:00Z`));
}

const createStyles = () =>
  StyleSheet.create({
    header: {
      gap: tokens.space.sm
    },
    historyRow: {
      gap: tokens.space.xs
    },
    infoRow: {
      gap: tokens.space.xs
    },
    screen: {
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl
    }
  });
