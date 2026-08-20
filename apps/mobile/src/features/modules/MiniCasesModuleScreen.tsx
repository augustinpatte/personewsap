import { useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText, Card } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { selectArchiveItems, useArchiveData } from "../archive";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { useModulePreferenceState } from "../preferences";
import {
  editionDisplayDate,
  getDifficultyLabel,
  getTopicLabel
} from "../today/contentCopy";
import { useDailyDrop } from "../today/DailyDropContext";
import {
  readAllMiniCaseResponses,
  readMiniCaseResponse,
  writeLocalMiniCaseResponses,
  type MiniCaseResponseMap,
  type MiniCaseResponseRecord
} from "../today/miniCaseResponses";
import { readMiniCaseResponseAnywhere, syncMiniCaseResponses } from "../today/miniCaseSync";
import { stripMarkdownInline } from "../today/readers/markdown";
import { ItemArchiveList } from "./ItemArchiveList";
import { getModuleCopy } from "./moduleCopy";
import {
  ModuleError,
  ModuleHeader,
  ModuleDisabledState,
  ModuleLoading,
  MetaLine,
  ModuleScroll,
  ViewSwitch
} from "./ModuleChrome";
import { TodayQuietState } from "./TodayQuietState";

function caseHref(id: string): Href {
  return { pathname: "/(reader)/mini-case/[id]", params: { id } } as unknown as Href;
}

export function MiniCasesModuleScreen() {
  const [view, setView] = useState<"left" | "right">("left");
  const { language, drop } = useDailyDrop();
  const modulePreference = useModulePreferenceState("mini_case");
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language);
  const disabled = modulePreference.status === "ready" && !modulePreference.enabled;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <ModuleHeader
          eyebrow={editionDisplayDate(drop, language) ?? copy.common.undatedEdition}
          iconName="check-square"
          metaItems={[
            copy.common.editionRhythm,
            copy.cases.headerMeta,
            drop.items.mini_case ? getTopicLabel(drop.items.mini_case.topic, language) : null
          ]}
          title={copy.cases.title}
        />
        {disabled ? null : (
          <ViewSwitch
            leftLabel={copy.common.todayView}
            onChange={setView}
            rightLabel={copy.common.archiveView}
            value={view}
          />
        )}
      </View>
      {disabled ? (
        <ModuleScroll>
          <ModuleDisabledState language={language} moduleId="mini_case" />
        </ModuleScroll>
      ) : view === "left" ? (
        <MiniCaseToday />
      ) : (
        <MiniCaseArchive />
      )}
    </SafeAreaView>
  );
}

function MiniCaseToday() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, drop, status, error, isEmptyDrop, isItemComplete, reload } =
    useDailyDrop();
  const copy = getModuleCopy(language);
  const miniCase = drop.items.mini_case;
  // A solved case shows its result here too, so the card is a record of what
  // you decided rather than just a "done" mark.
  const [todayScore, setTodayScore] = useState<MiniCaseResponseRecord | null>(null);
  const caseId = miniCase?.id ?? null;
  const caseCompleted = caseId ? isItemComplete(caseId) : false;

  useEffect(() => {
    if (!caseId || !caseCompleted) {
      setTodayScore(null);
      return;
    }

    let active = true;

    void (async () => {
      const local = await readMiniCaseResponse(caseId);
      const record = await readMiniCaseResponseAnywhere(caseId, local);

      if (active) {
        setTodayScore(record);
      }
    })().catch(() => {
      if (active) {
        setTodayScore(null);
      }
    });

    return () => {
      active = false;
    };
  }, [caseCompleted, caseId]);

  if (status === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  if (isEmptyDrop && error) {
    return (
      <ModuleScroll>
        <ModuleError language={language} onRetry={reload} />
      </ModuleScroll>
    );
  }

  if (isEmptyDrop) {
    return (
      <ModuleScroll>
        <TodayQuietState
          dropDate={drop.drop_date}
          iconName="check-square"
          language={language}
          onRefresh={reload}
        />
      </ModuleScroll>
    );
  }

  if (!miniCase) {
    return (
      <ModuleScroll>
        <AppText color="muted" variant="read">
          {copy.cases.noModuleToday}
        </AppText>
      </ModuleScroll>
    );
  }

  const completed = isItemComplete(miniCase.id);

  return (
    <ModuleScroll>
      <Pressable
        accessibilityHint={copy.common.openHint}
        accessibilityRole="button"
        onPress={() => router.push(caseHref(miniCase.id))}
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        {/* Built to announce a decision, not an article: the framing sits on
            top, the question is the centre of the card, and the call sits at
            the bottom where the eye ends. */}
        <Card padding="lg" style={styles.caseCard} tone="accent">
          <View style={styles.kicker}>
            <AppText variant="eyebrow">{copy.cases.kicker}</AppText>
            <View style={styles.difficultyChip}>
              <AppText color="accentInk" variant="eyebrow">
                {getDifficultyLabel(miniCase.difficulty, language)}
              </AppText>
            </View>
          </View>

          <MetaLine
            items={[
              getTopicLabel(miniCase.topic, language),
              getDifficultyLabel(miniCase.difficulty, language),
              miniCase.questions?.length
                ? copy.cases.questionCount(miniCase.questions.length)
                : null
            ]}
          />
          <AppText variant="title">{miniCase.title}</AppText>

          {/* The accent rail is what makes the question read as the thing being
              asked of you, rather than as a subtitle. */}
          <View style={styles.decisionBlock}>
            <View style={styles.decisionRail} />
            <View style={styles.decisionCopy}>
              <AppText color="muted" variant="eyebrow">
                {copy.cases.decision}
              </AppText>
              <AppText variant="lede">{stripMarkdownInline(miniCase.question)}</AppText>
            </View>
          </View>

          <View style={styles.statusRow}>
            {completed ? <View style={styles.statusDot} /> : null}
            <AppText color="accentInk" variant="label">
              {completed
                ? todayScore
                  ? `${copy.common.solved}  ·  ${copy.cases.score(
                      todayScore.score,
                      todayScore.total
                    )}`
                  : copy.common.solved
                : `${copy.cases.decide} →`}
            </AppText>
          </View>
        </Card>
      </Pressable>
    </ModuleScroll>
  );
}

function MiniCaseArchive() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  // Rendering the Archive view is what loads the archive (see useArchiveData).
  const archive = useArchiveData();
  const copy = getModuleCopy(archive.language);
  const [responses, setResponses] = useState<MiniCaseResponseMap>({});
  const cases = useMemo(
    () => selectArchiveItems(archive.drops, "mini_case"),
    [archive.drops]
  );

  // Scores come from the device cache first (instant, works offline), then from
  // Supabase so a case solved on another device shows its result here too. Any
  // result that only existed locally is pushed up by the same sync.
  useEffect(() => {
    let active = true;

    void (async () => {
      const local = await readAllMiniCaseResponses();

      if (!active) {
        return;
      }

      setResponses(local);

      const synced = await syncMiniCaseResponses(local);

      if (!active || synced.offline) {
        return;
      }

      // Server-sourced: a stale local result for a case the server already
      // holds differently is replaced, not kept.
      await writeLocalMiniCaseResponses(synced.merged, { origin: "server" });

      if (active) {
        setResponses(synced.merged);
      }
    })();

    return () => {
      active = false;
    };
  }, [archive.drops]);

  const openCase = (item: LibraryItemSummary) => {
    trackAnalyticsEvent("content_item_opened", {
      content_type: item.content_type,
      drop_date: item.drop_date,
      item_id: item.id
    });
    router.push(caseHref(item.id));
  };

  return (
    <ItemArchiveList
      emptyBody={copy.cases.archiveEmptyBody}
      emptyTitle={copy.cases.archiveEmptyTitle}
      contentType="mini_case"
      items={cases}
      onOpen={openCase}
      renderMeta={(item) => {
        const response = responses[item.id];

        if (!item.is_completed && !response) {
          return null;
        }

        return (
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <AppText color="accentInk" variant="caption">
              {response && response.total > 0
                ? `${copy.common.solved} · ${copy.cases.score(
                    response.score,
                    response.total
                  )}`
                : copy.common.solved}
            </AppText>
          </View>
        );
      }}
      searchAccessibilityLabel={copy.cases.searchAccessibility}
      searchPlaceholder={copy.cases.searchPlaceholder}
    />
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
    pressed: {
      opacity: 0.7
    },
    caseCard: {
      gap: tokens.space.sm
    },
    difficultyChip: {
      backgroundColor: c.surface,
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.xs,
      borderWidth: 1,
      paddingHorizontal: tokens.space.sm,
      paddingVertical: 2
    },
    decisionBlock: {
      flexDirection: "row",
      gap: tokens.space.md,
      marginTop: tokens.space.sm
    },
    decisionRail: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      width: 3
    },
    decisionCopy: {
      flex: 1,
      gap: tokens.space.xs
    },
    kicker: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm,
      justifyContent: "space-between"
    },
    casePrompt: {
      gap: tokens.space.xs
    },
    statusRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm,
      marginTop: tokens.space.sm,
      minHeight: 32
    },
    statusDot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 8,
      width: 8
    }
  });
