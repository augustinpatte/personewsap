import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { Language } from "../../types/domain";
import { getLearningCopy } from "./learningCopy";
import { loadHistoricalLearningSession } from "./learningHistoricalSession";
import { useLearningPath } from "./LearningPathContext";
import {
  localizeLearningField,
  localizeSessionObjectives,
  localizeSessionSummary,
  localizeSessionTitle,
  type LearningSession
} from "./learningTypes";

type HistoricalSessionState =
  | { status: "loading"; session: null }
  | { status: "not_found"; session: null }
  | { status: "error"; session: null }
  | { status: "ready"; session: LearningSession };

export function LearningHistoricalSessionScreen({
  language
}: {
  language: Language | null | undefined;
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ pathId?: string; sessionId?: string }>();
  const pathId = Array.isArray(params.pathId) ? params.pathId[0] : params.pathId;
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const styles = useThemedStyles(createStyles);
  const { domains, learningPaths, loadSessionsForPath, objectives } = useLearningPath();
  const path = pathId ? learningPaths.find((candidate) => candidate.id === pathId) ?? null : null;
  const pathLanguage = path?.language ?? language ?? "en";
  const [state, setState] = useState<HistoricalSessionState>({
    status: "loading",
    session: null
  });
  const sessionLanguage = state.session?.language ?? pathLanguage;
  const copy = getLearningCopy(sessionLanguage).overview;
  const domain = path ? domains.find((candidate) => candidate.id === path.domain_id) ?? null : null;
  const objective = path
    ? objectives.find((candidate) => candidate.id === path.objective_id) ?? null
    : null;

  useEffect(() => {
    if (!pathId || !sessionId) {
      setState({ status: "not_found", session: null });
      return;
    }

    let cancelled = false;
    setState({ status: "loading", session: null });

    void loadHistoricalLearningSession({
      pathId,
      sessionId,
      loadSessionsForPath
    })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setState(
          result.status === "found"
            ? { status: "ready", session: result.session }
            : { status: "not_found", session: null }
        );
      })
      .catch((error) => {
        if (__DEV__) {
          console.warn("[LearningHistoricalSession] could not load session", error);
        }
        if (!cancelled) {
          setState({ status: "error", session: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadSessionsForPath, pathId, sessionId]);

  if (state.status === "loading") {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="title">{copy.loading}</AppText>
        </Card>
      </AppScreen>
    );
  }

  if (state.status === "not_found" || !path || !domain || !objective) {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="eyebrow">{copy.readOnly}</AppText>
          <AppText variant="title">{copy.sessionNotFound}</AppText>
          <PrimaryButton label={copy.pathHistory} onPress={() => router.replace("/(learning)/history")} />
        </Card>
      </AppScreen>
    );
  }

  if (state.status === "error") {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="eyebrow">{copy.readOnly}</AppText>
          <AppText variant="title">{copy.error}</AppText>
          <PrimaryButton label={copy.pathHistory} onPress={() => router.replace("/(learning)/history")} />
        </Card>
      </AppScreen>
    );
  }

  const session = state.session;
  const date = session.completed_at ?? session.started_at ?? session.opened_at ?? session.created_at;

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <AppText variant="eyebrow">{copy.readOnly}</AppText>
        <AppText color="muted" variant="caption">
          {`${localizeLearningField(domain, sessionLanguage)} · ${localizeLearningField(
            objective,
            sessionLanguage
          )}`}
        </AppText>
        <AppText color="muted" variant="eyebrow">
          {copy.sessionLabel(session.session_number)}
        </AppText>
        <AppText variant="title">{localizeSessionTitle(session, sessionLanguage)}</AppText>
        <AppText color="muted" variant="read">
          {localizeSessionSummary(session, sessionLanguage)}
        </AppText>
        {date ? (
          <AppText color="accentInk" variant="label">
            {formatDate(date, sessionLanguage)}
          </AppText>
        ) : null}
      </View>

      <Card padding="lg">
        <AppText variant="subtitle">{copy.history}</AppText>
        {localizeSessionObjectives(session, sessionLanguage).map((objectiveText) => (
          <View key={objectiveText} style={styles.objectiveRow}>
            <View style={styles.dot} />
            <AppText color="inkSoft" style={styles.objectiveCopy} variant="body">
              {objectiveText}
            </AppText>
          </View>
        ))}
      </Card>

      <Card padding="md" tone="muted">
        <AppText selectable color="inkSoft" variant="body">
          {session.prompt_text}
        </AppText>
      </Card>
    </AppScreen>
  );
}

function formatDate(date: string, language: Language | null | undefined) {
  return new Intl.DateTimeFormat(language === "fr" ? "fr" : "en", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(date));
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    dot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 7,
      marginTop: 9,
      width: 7
    },
    header: {
      gap: tokens.space.sm
    },
    objectiveCopy: {
      flex: 1
    },
    objectiveRow: {
      flexDirection: "row",
      gap: tokens.space.sm
    },
    screen: {
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl
    }
  });
