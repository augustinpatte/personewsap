import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles } from "../../design/theme";
import type { Language } from "../../types/domain";
import { getCurrentLevelLabel, getTargetLevelLabel } from "./learningLevels";
import { getLearningCopy } from "./learningCopy";
import { useLearningPath } from "./LearningPathContext";
import {
  getLearningPathDateInfo,
  getLearningPathStatusCopyKey
} from "./learningPathState";
import {
  localizeLearningDescription,
  localizeLearningField,
  localizeSessionTitle,
  type LearningSession
} from "./learningTypes";

export function LearningPathOverviewScreen({
  language
}: {
  language: Language | null | undefined;
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ pathId?: string }>();
  const pathId = Array.isArray(params.pathId) ? params.pathId[0] : params.pathId;
  const styles = useThemedStyles(createStyles);
  const {
    displayPath,
    domains,
    learningPaths,
    loadSessionsForPath,
    objectives,
    sessions,
    status
  } = useLearningPath();
  const selectedPath = pathId ? learningPaths.find((path) => path.id === pathId) ?? null : displayPath;
  const pathLanguage = selectedPath?.language ?? language ?? "en";
  const copy = getLearningCopy(pathLanguage).overview;
  const selectedDomain = selectedPath
    ? domains.find((domain) => domain.id === selectedPath.domain_id) ?? null
    : null;
  const selectedObjective = selectedPath
    ? objectives.find((objective) => objective.id === selectedPath.objective_id) ?? null
    : null;
  const isDefaultPath = !pathId || pathId === displayPath?.id;
  const [loadedSessions, setLoadedSessions] = useState<LearningSession[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const selectedSessions = isDefaultPath ? sessions : loadedSessions ?? [];
  const completedSessions = useMemo(
    () =>
      selectedSessions.filter((session) => Boolean(session.completed_at) || session.status === "completed"),
    [selectedSessions]
  );

  useEffect(() => {
    if (isDefaultPath || !selectedPath) {
      return;
    }

    let cancelled = false;
    setLoadedSessions(null);
    setLoadError(false);

    void loadSessionsForPath(selectedPath.id)
      .then((pathSessions) => {
        if (!cancelled) {
          setLoadedSessions(pathSessions);
        }
      })
      .catch((error) => {
        if (__DEV__) {
          console.warn("[LearningPathOverview] could not load path sessions", error);
        }
        if (!cancelled) {
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isDefaultPath, loadSessionsForPath, selectedPath]);

  if (status === "loading") {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="title">{copy.loading}</AppText>
        </Card>
      </AppScreen>
    );
  }

  if (!selectedPath || !selectedDomain || !selectedObjective) {
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

  const pathDateInfo = getLearningPathDateInfo(selectedPath);

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <AppText variant="eyebrow">{copy.eyebrow}</AppText>
        <AppText variant="title">{copy.title}</AppText>
        <AppText color="muted" variant="body">
          {localizeLearningDescription(selectedObjective, pathLanguage)}
        </AppText>
      </View>

      <Card padding="lg">
        <InfoRow label={copy.domain} value={localizeLearningField(selectedDomain, pathLanguage)} />
        <InfoRow label={copy.orientation} value={localizeLearningField(selectedObjective, pathLanguage)} />
        <InfoRow
          label={copy.status}
          value={copy[getLearningPathStatusCopyKey(selectedPath)]}
        />
        <InfoRow
          label={copy.sessionsCompleted}
          value={String(completedSessions.length)}
        />
        <InfoRow label={copy.conceptsStudied} value={String(completedSessions.length)} />
        {/* The path is self-paced: there is no "next edition" date to show, the
            reader decides when the next session happens. */}
        <InfoRow
          label={copy[pathDateInfo.labelKey]}
          value={
            pathDateInfo.value
              ? formatDateTime(pathDateInfo.value, pathLanguage)
              : copy.nextUnknown
          }
        />
        <InfoRow
          label={copy.currentLevel}
          value={getCurrentLevelLabel(selectedPath.current_level, pathLanguage)}
        />
        <InfoRow
          label={copy.targetLevel}
          value={getTargetLevelLabel(selectedPath.target_level, pathLanguage)}
        />
      </Card>

      <Card padding="lg" tone="muted">
        <AppText variant="subtitle">{copy.history}</AppText>
        {loadError ? (
          <AppText color="danger" variant="body">
            {copy.error}
          </AppText>
        ) : !isDefaultPath && loadedSessions === null ? (
          <AppText color="muted" variant="body">
            {copy.loading}
          </AppText>
        ) : completedSessions.length === 0 ? (
          <AppText color="muted" variant="body">
            {copy.noHistory}
          </AppText>
        ) : (
          completedSessions.map((session) => (
            <Pressable
              accessibilityRole="button"
              key={session.id}
              onPress={() =>
                router.push(
                  {
                    pathname: "/(learning)/history-session",
                    params: { pathId: selectedPath.id, sessionId: session.id }
                  } as unknown as Href
                )
              }
              style={({ pressed }) => [styles.historyRow, pressed ? styles.pressed : null]}
            >
              <AppText color="muted" variant="caption">
                {copy.sessionLabel(session.session_number)}
              </AppText>
              <AppText variant="bodyStrong">
                {localizeSessionTitle(session, session.language ?? pathLanguage)}
              </AppText>
            </Pressable>
          ))
        )}
        {selectedSessions.length > completedSessions.length ? (
          <AppText color="muted" variant="caption">
            {copy.remainingSessions(selectedSessions.length - completedSessions.length)}
          </AppText>
        ) : null}
      </Card>

      {isDefaultPath ? (
        <SecondaryButton
          label={copy.replace}
          onPress={() =>
            router.push(
              { pathname: "/(learning)/setup", params: { replace: "1" } } as unknown as Href
            )
          }
        />
      ) : null}
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


function formatDateTime(date: string, language: Language | null | undefined) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr" : "en", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(date));
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
    pressed: {
      opacity: 0.72
    },
    screen: {
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl
    }
  });
