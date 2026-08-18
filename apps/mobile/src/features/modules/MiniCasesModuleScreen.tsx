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
import {
  formatDropDate,
  getDifficultyLabel,
  getTopicLabel
} from "../today/contentCopy";
import { useDailyDrop } from "../today/DailyDropContext";
import {
  readAllMiniCaseResponses,
  writeLocalMiniCaseResponses,
  type MiniCaseResponseMap
} from "../today/miniCaseResponses";
import { syncMiniCaseResponses } from "../today/miniCaseSync";
import { stripMarkdownInline } from "../today/readers/markdown";
import { ItemArchiveList } from "./ItemArchiveList";
import { getModuleCopy } from "./moduleCopy";
import {
  ModuleError,
  ModuleHeader,
  ModuleLoading,
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
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <ModuleHeader
          eyebrow={formatDropDate(drop.drop_date, language)}
          language={language}
          title={copy.cases.title}
        />
        <ViewSwitch
          leftLabel={copy.common.todayView}
          onChange={setView}
          rightLabel={copy.common.archiveView}
          value={view}
        />
      </View>
      {view === "left" ? <MiniCaseToday /> : <MiniCaseArchive />}
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
        <TodayQuietState dropDate={drop.drop_date} language={language} onRefresh={reload} />
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
        <Card padding="lg" style={styles.caseCard} tone="accent">
          <View style={styles.kicker}>
            <AppText variant="eyebrow">{copy.cases.kicker}</AppText>
            <AppText color="muted" variant="eyebrow">
              {`${getTopicLabel(miniCase.topic, language)} · ${getDifficultyLabel(
                miniCase.difficulty,
                language
              )}`}
            </AppText>
          </View>
          <AppText variant="title">{miniCase.title}</AppText>

          <View style={styles.casePrompt}>
            <AppText color="muted" variant="eyebrow">
              {copy.cases.decision}
            </AppText>
            <AppText variant="lede">{stripMarkdownInline(miniCase.question)}</AppText>
          </View>

          <View style={styles.statusRow}>
            {completed ? <View style={styles.statusDot} /> : null}
            <AppText color="accentInk" variant="label">
              {completed ? copy.common.solved : `${copy.cases.decide} →`}
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
      gap: tokens.space.md
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
