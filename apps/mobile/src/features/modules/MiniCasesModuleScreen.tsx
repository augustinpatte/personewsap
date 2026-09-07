import { useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText, Card, PressableSurface } from "../../components";
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
import { resolveTodayEditionState } from "../today/todayEditionState";
import {
  readAllMiniCaseResponses,
  readMiniCaseResponse,
  writeLocalMiniCaseResponses,
  type MiniCaseResponseMap,
  type MiniCaseResponseRecord
} from "../today/miniCaseResponses";
import { readMiniCaseResponseAnywhere, syncMiniCaseResponses } from "../today/miniCaseSync";
import type { MiniCaseChallenge } from "../today/contentTypes";
import { stripMarkdownInline } from "../today/readers/markdown";
import { TeamBadge } from "../quiz/TeamBadge";
import { ItemArchiveList } from "./ItemArchiveList";
import { getModuleCopy } from "./moduleCopy";
import {
  ModuleError,
  EditionProgress,
  ModuleHeader,
  ModuleDisabledState,
  ModuleLoading,
  MetaLine,
  ModuleScroll,
  ViewSwitch
} from "./ModuleChrome";
import { useEditionProgress } from "./useEditionProgress";
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
  const editionProgress = useEditionProgress();
  const disabled = modulePreference.status === "ready" && !modulePreference.enabled;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <ModuleHeader
          accountLabel={copy.common.accountLabel}
          eyebrow={editionDisplayDate(drop, language) ?? copy.common.undatedEdition}
          iconName="check-square"
          metaItems={[
            copy.common.editionRhythm,
            copy.cases.headerMeta,
            drop.items.mini_cases.length > 0
              ? copy.cases.caseCount(drop.items.mini_cases.length)
              : null
          ]}
          title={copy.cases.title}
        />
        {disabled ? null : (
          <>
            {view === "left" ? (
              <EditionProgress language={language} state={editionProgress} />
            ) : null}
            <ViewSwitch
              leftLabel={copy.common.todayView}
              onChange={setView}
              rightLabel={copy.common.archiveView}
              value={view}
            />
          </>
        )}
      </View>
      {disabled ? (
        <ModuleScroll>
          <ModuleDisabledState language={language} moduleId="mini_case" />
        </ModuleScroll>
      ) : view === "left" ? (
        <MiniCaseToday onOpenArchive={() => setView("right")} />
      ) : (
        <MiniCaseArchive />
      )}
    </SafeAreaView>
  );
}

function MiniCaseToday({ onOpenArchive }: { onOpenArchive: () => void }) {
  const styles = useThemedStyles(createStyles);
  const { language, drop, status, error, isEmptyDrop, isItemComplete, reload } =
    useDailyDrop();
  const copy = getModuleCopy(language);
  // PLURAL, AND ALREADY TEAM-FIRST. One reader can be handed a Finance case by
  // one Team, an AI case by another and their own Law case the same morning.
  // The list arrives merged and deduplicated from the data layer (see
  // orderEditionItems), so a case two of their Teams chose is one card here.
  const miniCases = drop.items.mini_cases;
  // A solved case shows its result on its card, so the card is a record of what
  // you decided rather than just a "done" mark. One lookup for the whole list,
  // not one per card.
  const [scores, setScores] = useState<MiniCaseResponseMap>({});
  const solvedIds = miniCases
    .filter((miniCase) => isItemComplete(miniCase.id))
    .map((miniCase) => miniCase.id);
  const solvedKey = solvedIds.join(",");

  useEffect(() => {
    if (solvedIds.length === 0) {
      setScores({});
      return;
    }

    let active = true;

    void (async () => {
      const resolved: MiniCaseResponseMap = {};

      for (const solvedId of solvedIds) {
        const local = await readMiniCaseResponse(solvedId);
        const record = await readMiniCaseResponseAnywhere(solvedId, local);

        if (record) {
          resolved[solvedId] = record;
        }
      }

      if (active) {
        setScores(resolved);
      }
    })().catch(() => {
      if (active) {
        setScores({});
      }
    });

    return () => {
      active = false;
    };
    // Keyed on the solved set rather than the array identity: re-rendering the
    // list must not re-run the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solvedKey]);

  const editionState = resolveTodayEditionState({
    dropDate: drop.drop_date,
    error,
    isEmptyDrop,
    status
  });

  if (editionState === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  if (editionState === "error") {
    return (
      <ModuleScroll>
        <ModuleError language={language} onRetry={reload} />
      </ModuleScroll>
    );
  }

  if (editionState === "upcoming" || editionState === "quiet") {
    return (
      <ModuleScroll>
        <TodayQuietState
          dropDate={drop.drop_date}
          iconName="check-square"
          language={language}
          onOpenArchive={onOpenArchive}
          onRefresh={reload}
          state={editionState}
        />
      </ModuleScroll>
    );
  }

  if (miniCases.length === 0) {
    return (
      <ModuleScroll>
        <AppText color="muted" variant="read">
          {copy.cases.noModuleToday}
        </AppText>
      </ModuleScroll>
    );
  }

  const solvedCount = solvedIds.length;

  return (
    <ModuleScroll contentStyle={styles.todayContent} reveal>
      {/* Only when there is more than one: a single case needs no tally, and a
          "1 of 1 solved" line over one card is furniture. */}
      {miniCases.length > 1 ? (
        <MetaLine items={[copy.cases.progress(solvedCount, miniCases.length)]} />
      ) : null}

      {miniCases.map((miniCase) => (
        <MiniCaseCard
          key={miniCase.id}
          challenge={miniCase}
          completed={isItemComplete(miniCase.id)}
          score={scores[miniCase.id] ?? null}
        />
      ))}
    </ModuleScroll>
  );
}

/**
 * One case, as a decision to be made.
 *
 * Built to announce a decision, not an article: the framing sits on top, the
 * question is the centre of the card, and the call sits at the bottom where the
 * eye ends. The Team badge sits in the kicker beside "Mini case" — the same
 * quiet line the Newsletter uses — so a Team case reads as a case that happens
 * to be shared, never as a different kind of object.
 */
function MiniCaseCard({
  challenge,
  completed,
  score
}: {
  challenge: MiniCaseChallenge;
  completed: boolean;
  score: MiniCaseResponseRecord | null;
}) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language } = useDailyDrop();
  const copy = getModuleCopy(language);
  const teams = challenge.teams ?? [];

  const open = () => {
    if (teams.length > 0) {
      // Which content is being reached through a Team, and nothing else: no
      // team id, no title, no score.
      trackAnalyticsEvent("team_content_opened", {
        content_type: "mini_case",
        is_team: true
      });
    }

    router.push(caseHref(challenge.id));
  };

  return (
    <PressableSurface
      accessibilityHint={copy.common.openHint}
      onPress={open}
      style={styles.casePress}
      // The Card paints its own accent surface over the tint, so the
      // compression is what answers the finger here.
      pressedStyle={styles.casePressed}
    >
      <Card padding="lg" style={styles.caseCard} tone="accent">
        <View style={styles.kicker}>
          <AppText variant="eyebrow">{copy.cases.kicker}</AppText>
          <View style={styles.difficultyChip}>
            <AppText color="accentInk" variant="eyebrow">
              {getDifficultyLabel(challenge.difficulty, language)}
            </AppText>
          </View>
        </View>

        <TeamBadge compact language={language} teams={teams} />

        <MetaLine
          items={[
            getTopicLabel(challenge.topic, language),
            getDifficultyLabel(challenge.difficulty, language),
            challenge.questions?.length
              ? copy.cases.questionCount(challenge.questions.length)
              : null
          ]}
        />
        <AppText variant="title">{challenge.title}</AppText>

        {/* The accent rail is what makes the question read as the thing being
            asked of you, rather than as a subtitle. */}
        <View style={styles.decisionBlock}>
          <View style={styles.decisionRail} />
          <View style={styles.decisionCopy}>
            <AppText color="muted" variant="eyebrow">
              {copy.cases.decision}
            </AppText>
            <AppText variant="lede">{stripMarkdownInline(challenge.question)}</AppText>
          </View>
        </View>

        <View style={styles.statusRow}>
          {completed ? <View style={styles.statusDot} /> : null}
          <AppText color="accentInk" variant="label">
            {completed
              ? score
                ? `${copy.common.solved}  ·  ${copy.cases.score(score.score, score.total)}`
                : copy.common.solved
              : `${copy.cases.decide} →`}
          </AppText>
        </View>
      </Card>
    </PressableSurface>
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
    todayContent: {
      gap: tokens.space.lg
    },
    casePress: {
      borderRadius: tokens.radius.lg
    },
    casePressed: {
      backgroundColor: "transparent"
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
