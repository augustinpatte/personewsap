import { useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { tokens } from "../../design/tokens";
import { useThemeColors } from "../../design/theme";
import { getReaderCopy } from "./contentCopy";
import {
  readContentInteractionSnapshot,
  writeContentInteraction
} from "./contentInteractions";
import type {
  ContentLanguage,
  DailyDropContentItem,
  TodayDailyDrop
} from "./contentTypes";
import {
  DailyDropContext,
  useDailyDrop,
  type DailyDropContextValue
} from "./DailyDropContext";
import { fetchContentItemById } from "./dailyDropData";
import { ReaderScaffold } from "./readers";

/**
 * Lets a reader open any content item by id, not just the ones in today's
 * edition. Today's drop is served by the root DailyDropProvider; an archived or
 * library item is not in it, so we fetch it on demand and expose it through the
 * same context shape — every reader keeps using `useDailyDrop()` unchanged.
 */
export function ReaderItemProvider({
  contentItemId,
  children
}: {
  contentItemId: string;
  children: ReactNode;
}) {
  const parent = useDailyDrop();
  const todayItem = parent.getItemById(contentItemId);

  // Fast path: the item belongs to today's edition. The root provider already
  // serves it with live progress and completion, so render straight through.
  if (todayItem) {
    return <>{children}</>;
  }

  return (
    <FetchedReaderProvider contentItemId={contentItemId} language={parent.language}>
      {children}
    </FetchedReaderProvider>
  );
}

type FetchState = {
  status: "loading" | "ready";
  item: DailyDropContentItem | null;
};

function FetchedReaderProvider({
  contentItemId,
  language,
  children
}: {
  contentItemId: string;
  language: ContentLanguage;
  children: ReactNode;
}) {
  const [fetchState, setFetchState] = useState<FetchState>({
    status: "loading",
    item: null
  });
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    setFetchState({ status: "loading", item: null });
    setCompleted(false);

    void (async () => {
      const result = await fetchContentItemById(contentItemId);

      if (!active) {
        return;
      }

      setFetchState({ status: "ready", item: result.data });

      // Carry completion across editions so a finished item opens in review mode.
      if (result.data && (result.source === "supabase" || result.source === "cache")) {
        const snapshot = await readContentInteractionSnapshot([contentItemId]);

        if (active && snapshot.ok) {
          setCompleted(snapshot.snapshot.completedItemIds.has(contentItemId));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [contentItemId]);

  const value = useMemo<DailyDropContextValue>(() => {
    const item = fetchState.item;
    const items = item ? [item] : [];
    const isItemComplete = (id: string) => id === contentItemId && completed;

    return {
      language,
      drop: buildSingleItemDrop(item, language),
      status: fetchState.status,
      source: "supabase",
      items,
      isEmptyDrop: items.length === 0,
      totalItemCount: items.length,
      completedItemCount: completed && item ? 1 : 0,
      progress: completed && item ? 1 : 0,
      isComplete: Boolean(item) && completed,
      isItemComplete,
      isModuleComplete: (moduleItems) =>
        moduleItems.length > 0 &&
        moduleItems.every((moduleItem) => isItemComplete(moduleItem.id)),
      getItemById: (id) => (item && id === contentItemId ? item : undefined),
      markItemsComplete: async (toComplete) => {
        if (completed) {
          return;
        }

        setCompleted(true);

        for (const toMark of toComplete) {
          await writeContentInteraction({
            contentItemId: toMark.id,
            interactionType: "complete"
          });
        }
      },
      reload: () => {}
    };
  }, [completed, contentItemId, fetchState.item, fetchState.status, language]);

  if (fetchState.status === "loading") {
    return <ReaderLoading language={language} />;
  }

  return <DailyDropContext.Provider value={value}>{children}</DailyDropContext.Provider>;
}

function ReaderLoading({ language }: { language: ContentLanguage }) {
  const router = useRouter();
  const colors = useThemeColors();
  const copy = getReaderCopy(language);

  return (
    <ReaderScaffold closeLabel={copy.close} onClose={() => router.back()}>
      <View style={styles.loading}>
        <ActivityIndicator color={colors.muted} />
      </View>
    </ReaderScaffold>
  );
}

function buildSingleItemDrop(
  item: DailyDropContentItem | null,
  language: ContentLanguage
): TodayDailyDrop {
  return {
    id: item ? `reader:${item.id}` : "reader:empty",
    drop_date: "",
    language,
    title: "",
    prompt_version: "reader",
    generator_version: "reader",
    estimated_read_minutes: 0,
    items: {
      newsletter: item?.content_type === "newsletter_article" ? [item] : [],
      business_story: item?.content_type === "business_story" ? item : undefined,
      mini_case: item?.content_type === "mini_case" ? item : undefined,
      concept: item?.content_type === "key_concept" ? item : undefined
    }
  };
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xxl
  }
});
