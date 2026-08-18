import { useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AppText,
  Card,
  EmptyState,
  IconBadge,
  PrimaryButton,
  SecondaryButton
} from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { useLearningPath } from "../learning";
import { localizeLearningField, localizeSessionTitle } from "../learning/learningTypes";
import { useDailyDrop } from "../today/DailyDropContext";
import { getModuleCopy } from "./moduleCopy";
import { ModuleHeader, ModuleLoading, ModuleScroll, ViewSwitch } from "./ModuleChrome";

/**
 * The Parcours tab is the existing Learning Path product — sessions generated
 * for the reader's own objective. It is unrelated to the retired "concept"
 * content type and never lists concepts.
 *
 * It is deliberately self-paced: nothing here reads the edition calendar. A
 * session becomes available because the reader asked for it, so several
 * sessions can be done back to back — but only ever on an explicit tap, never
 * by auto-advancing.
 */
export function PathModuleScreen() {
  const [view, setView] = useState<"left" | "right">("left");
  // Only the reading language is taken from the edition context: the header
  // deliberately carries no edition date, because the path does not advance
  // with the calendar.
  const { language } = useDailyDrop();
  const learningPath = useLearningPath();
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <ModuleHeader
          eyebrow={copy.path.eyebrow}
          iconName="compass"
          language={language}
          metaItems={[
            copy.path.headerMeta,
            learningPath.displayDomain
              ? localizeLearningField(learningPath.displayDomain, language)
              : null,
            copy.path.sessionsCompletedCount(
              learningPath.sessions.filter(
                (session) => Boolean(session.completed_at) || session.status === "completed"
              ).length
            )
          ]}
          title={copy.path.title}
        />
        <ViewSwitch
          leftLabel={copy.common.currentView}
          onChange={setView}
          rightLabel={copy.common.historyView}
          value={view}
        />
      </View>
      {view === "left" ? <PathCurrent /> : <PathHistory />}
    </SafeAreaView>
  );
}

function PathCurrent() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language } = useDailyDrop();
  const learningPath = useLearningPath();
  const copy = getModuleCopy(language);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const completedSessions = useMemo(
    () =>
      learningPath.sessions.filter(
        (session) => Boolean(session.completed_at) || session.status === "completed"
      ),
    [learningPath.sessions]
  );

  if (learningPath.status === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  const path = learningPath.activePath;
  const completedPath = learningPath.latestCompletedPath;

  // No path yet: the only thing to do is create one.
  if (!path) {
    if (completedPath) {
      return (
        <ModuleScroll>
          <EmptyState
            actionLabel={copy.path.newPath}
            description={copy.path.completedBody}
            iconName="check-circle"
            onActionPress={() => router.push("/(learning)/setup" as Href)}
            title={copy.path.completedTitle}
          />
        </ModuleScroll>
      );
    }

    return (
      <ModuleScroll>
        <PathIntroCard onCreate={() => router.push("/(learning)/setup" as Href)} />
      </ModuleScroll>
    );
  }

  // The session waiting to be done, whatever edition it came from. There is no
  // date test here by design: the calendar never gates the path.
  const pendingSession =
    learningPath.availableSession &&
    !learningPath.availableSession.completed_at &&
    learningPath.availableSession.status !== "completed"
      ? learningPath.availableSession
      : null;
  const isFirstSession = learningPath.sessions.length === 0;

  const openSession = (sessionId: string) => {
    router.push({
      pathname: "/(learning)/session/[id]",
      params: { id: sessionId }
    } as unknown as Href);
  };

  const onAdvance = async () => {
    setAdvanceError(null);
    const result = await learningPath.advanceLearningPath();

    if (result.pathCompleted) {
      return;
    }

    if (!result.ok || !result.session) {
      setAdvanceError(copy.path.advanceFailed);
      return;
    }

    openSession(result.session.id);
  };

  // The first session is prepared with the path itself, so the reader arrives
  // here with Session 1 already waiting: the CTA names it for what it is.
  const ctaLabel = pendingSession
    ? pendingSession.status === "opened" || pendingSession.status === "started"
      ? copy.path.resume
      : pendingSession.session_number <= 1
        ? copy.path.startFirst
        : copy.path.nextSession
    : isFirstSession
      ? copy.path.startFirst
      : copy.path.continuePath;

  return (
    <ModuleScroll>
      <Card padding="lg" style={styles.sessionCard} tone="accent">
        <AppText color="muted" variant="eyebrow">
          {learningPath.displayDomain
            ? localizeLearningField(learningPath.displayDomain, language)
            : copy.path.title}
        </AppText>

        {pendingSession ? (
          <>
            <AppText color="muted" variant="eyebrow">
              {copy.path.sessionLabel(pendingSession.session_number)}
            </AppText>
            <AppText variant="title">
              {localizeSessionTitle(pendingSession, pendingSession.language ?? language)}
            </AppText>
          </>
        ) : (
          <AppText variant="title">
            {isFirstSession ? copy.path.startFirst : copy.path.continuePath}
          </AppText>
        )}

        <AppText color="inkSoft" variant="read">
          {copy.path.selfPacedHint}
        </AppText>

        <PrimaryButton
          disabled={learningPath.advancing}
          label={learningPath.advancing ? copy.path.preparing : ctaLabel}
          loading={learningPath.advancing}
          onPress={() =>
            pendingSession ? openSession(pendingSession.id) : void onAdvance()
          }
        />

        {advanceError ? (
          <AppText color="danger" variant="body">
            {advanceError}
          </AppText>
        ) : null}
      </Card>

      <Card padding="lg" tone="muted">
        {/* A quiet trail of where the path stands: completed sessions behind,
            the current one, nothing ahead that has not been asked for. It is a
            record, not a score — no streak, no points, no daily target. */}
        <SessionTrail
          completedCount={completedSessions.length}
          currentLabel={
            pendingSession
              ? copy.path.sessionLabel(pendingSession.session_number)
              : null
          }
          label={copy.path.sessionsCompleted}
        />

        {learningPath.displayObjective ? (
          <View style={styles.infoRow}>
            <AppText color="muted" variant="caption">
              {localizeLearningField(learningPath.displayObjective, language)}
            </AppText>
          </View>
        ) : null}
        <SecondaryButton
          label={copy.path.pastPaths}
          onPress={() => router.push("/(learning)/overview" as Href)}
        />
      </Card>
    </ModuleScroll>
  );
}

/**
 * The progression marker.
 *
 * Deliberately restrained: filled marks for what is done, a hollow one for what
 * is open, and a count. It shows the shape of the path without turning it into
 * a game — no streak, no XP, no leaderboard, no daily goal. The marks are
 * decorative; the count beside them is what a screen reader announces.
 */
function SessionTrail({
  completedCount,
  currentLabel,
  label
}: {
  completedCount: number;
  currentLabel: string | null;
  label: string;
}) {
  const styles = useThemedStyles(createStyles);
  // Long paths stay one line: past a point the count is the information, not
  // the number of dots.
  const shownMarks = Math.min(completedCount, 8);

  return (
    <View style={styles.trail}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={styles.trailMarks}
      >
        {Array.from({ length: shownMarks }, (_, index) => (
          <View key={`done-${index}`} style={styles.trailMarkDone} />
        ))}
        {completedCount > shownMarks ? <View style={styles.trailMore} /> : null}
        {currentLabel ? <View style={styles.trailMarkCurrent} /> : null}
      </View>

      <View style={styles.trailCopy}>
        <AppText color="muted" variant="caption">
          {label}
        </AppText>
        <AppText variant="bodyStrong">
          {currentLabel ? `${completedCount}  ·  ${currentLabel}` : String(completedCount)}
        </AppText>
      </View>
    </View>
  );
}

function PathIntroCard({ onCreate }: { onCreate: () => void }) {
  const styles = useThemedStyles(createStyles);
  const { language } = useDailyDrop();
  const copy = getModuleCopy(language);

  return (
    <Card padding="lg" style={styles.sessionCard} tone="muted">
      <IconBadge name="compass" tone="accent" />
      <AppText variant="eyebrow">{copy.path.title}</AppText>
      <AppText variant="title">{copy.path.startFirst}</AppText>
      <AppText color="muted" variant="read">
        {copy.path.selfPacedHint}
      </AppText>
      <PrimaryButton label={copy.path.newPath} onPress={onCreate} />
    </Card>
  );
}

function PathHistory() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language } = useDailyDrop();
  const learningPath = useLearningPath();
  const copy = getModuleCopy(language);

  const completedSessions = useMemo(
    () =>
      learningPath.sessions
        .filter(
          (session) => Boolean(session.completed_at) || session.status === "completed"
        )
        .sort((left, right) => right.session_number - left.session_number),
    [learningPath.sessions]
  );

  if (learningPath.status === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  return (
    <ModuleScroll>
      {completedSessions.length === 0 ? (
        <EmptyState
          description={copy.path.historyEmptyBody}
          iconName="archive"
          title={copy.path.historyEmptyTitle}
        />
      ) : (
        <View style={styles.historyList}>
          <AppText color="muted" variant="eyebrow">
            {copy.path.historyTitle}
          </AppText>
          {completedSessions.map((session) => (
            <Pressable
              accessibilityRole="button"
              key={session.id}
              onPress={() =>
                router.push(
                  {
                    pathname: "/(learning)/history-session",
                    params: {
                      pathId: learningPath.displayPath?.id ?? "",
                      sessionId: session.id
                    }
                  } as unknown as Href
                )
              }
              style={({ pressed }) => [
                styles.historyRow,
                pressed ? styles.pressed : null
              ]}
            >
              <AppText color="muted" variant="caption">
                {copy.path.sessionLabel(session.session_number)}
              </AppText>
              <AppText variant="bodyStrong">
                {/* A past session keeps the language it was written in. */}
                {localizeSessionTitle(session, session.language ?? language)}
              </AppText>
            </Pressable>
          ))}
        </View>
      )}

      <SecondaryButton
        label={copy.path.pastPaths}
        onPress={() => router.push("/(learning)/history" as Href)}
      />
    </ModuleScroll>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: c.background,
      flex: 1
    },
    chrome: {
      gap: tokens.space.lg,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.md
    },
    sessionCard: {
      gap: tokens.space.md
    },
    infoRow: {
      gap: tokens.space.xs
    },
    trail: {
      gap: tokens.space.sm
    },
    trailMarks: {
      alignItems: "center",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.space.xs
    },
    trailMarkDone: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 6,
      width: 18
    },
    trailMarkCurrent: {
      borderColor: c.accent,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 6,
      width: 26
    },
    trailMore: {
      backgroundColor: c.mutedSoft,
      borderRadius: tokens.radius.pill,
      height: 6,
      width: 6
    },
    trailCopy: {
      gap: tokens.space.xs
    },
    historyList: {
      gap: tokens.space.lg
    },
    historyRow: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.xs,
      minHeight: 44,
      paddingTop: tokens.space.md
    },
    pressed: {
      opacity: 0.6
    }
  });
