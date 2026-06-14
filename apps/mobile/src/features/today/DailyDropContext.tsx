import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

import { trackAnalyticsEvent } from "../../lib/analytics";
import type { DataFetchSource } from "../../lib/dataState";
import { getAuthSession } from "../../lib/supabase";
import { flattenDailyDropItems, mockTodayDailyDropsByLanguage } from "../../mocks";
import { useAuth } from "../auth";
import {
  createEmptyContentInteractionSnapshot,
  readContentInteractionSnapshot,
  writeContentInteraction,
  type ContentInteractionSnapshot
} from "./contentInteractions";
import type {
  ContentLanguage,
  DailyDropContentItem,
  TodayDailyDrop
} from "./contentTypes";
import { fetchTodayDrop } from "./dailyDropData";

type DailyDropContextValue = {
  language: ContentLanguage;
  drop: TodayDailyDrop;
  status: "loading" | "ready";
  source: DataFetchSource;
  items: DailyDropContentItem[];
  isEmptyDrop: boolean;
  totalItemCount: number;
  completedItemCount: number;
  progress: number;
  isComplete: boolean;
  isItemComplete: (itemId: string) => boolean;
  isModuleComplete: (items: DailyDropContentItem[]) => boolean;
  getItemById: (itemId: string) => DailyDropContentItem | undefined;
  markItemsComplete: (items: DailyDropContentItem[]) => Promise<void>;
  reload: () => void;
};

const DailyDropContext = createContext<DailyDropContextValue | null>(null);

type DailyDropState = {
  drop: TodayDailyDrop;
  source: DataFetchSource;
  status: "loading" | "ready";
};

export function DailyDropProvider({ children }: PropsWithChildren) {
  const { profileLanguage, status: authStatus } = useAuth();
  const language: ContentLanguage = profileLanguage ?? "en";
  const fallbackDrop = mockTodayDailyDropsByLanguage[language];

  const [state, setState] = useState<DailyDropState>({
    drop: fallbackDrop,
    source: "mock",
    status: "loading"
  });
  const [interactions, setInteractions] = useState<ContentInteractionSnapshot>(
    createEmptyContentInteractionSnapshot
  );

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      setState((current) => ({ ...current, status: "loading" }));

      const sessionResult = await getAuthSession();
      const userId = sessionResult.data?.user.id;

      if (!userId) {
        if (isActive()) {
          setState({ drop: fallbackDrop, source: "mock", status: "ready" });
          setInteractions(createEmptyContentInteractionSnapshot());
        }

        return;
      }

      const result = await fetchTodayDrop(userId, getLocalDropDate(new Date()), {
        language
      });

      if (isActive()) {
        setState({ drop: result.data, source: result.source, status: "ready" });
        trackAnalyticsEvent("daily_drop_loaded", {
          drop_date: result.data.drop_date,
          language: result.data.language
        });
      }

      if (result.source === "supabase" || result.source === "cache") {
        const snapshot = await readContentInteractionSnapshot(
          flattenDailyDropItems(result.data).map((item) => item.id)
        );

        if (isActive() && snapshot.ok) {
          setInteractions(snapshot.snapshot);
        }
      } else if (isActive()) {
        setInteractions(createEmptyContentInteractionSnapshot());
      }
    },
    [fallbackDrop, language]
  );

  useEffect(() => {
    if (authStatus !== "ready") {
      return;
    }

    let isMounted = true;
    void load(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, [authStatus, load]);

  const items = useMemo(() => flattenDailyDropItems(state.drop), [state.drop]);
  const totalItemCount = items.length;
  const completedItemCount = useMemo(
    () => items.filter((item) => interactions.completedItemIds.has(item.id)).length,
    [items, interactions.completedItemIds]
  );

  const markItemsComplete = useCallback(
    async (toComplete: DailyDropContentItem[]) => {
      const pending = toComplete.filter(
        (item) => !interactions.completedItemIds.has(item.id)
      );

      if (pending.length === 0) {
        return;
      }

      setInteractions((current) => {
        const next = new Set(current.completedItemIds);
        for (const item of pending) {
          next.add(item.id);
        }
        return { ...current, completedItemIds: next };
      });

      for (const item of pending) {
        trackAnalyticsEvent("content_item_completed", {
          content_type: item.content_type,
          drop_date: state.drop.drop_date,
          item_id: item.id,
          language: item.language
        });

        if (state.source === "supabase" || state.source === "cache") {
          await writeContentInteraction({
            contentItemId: item.id,
            interactionType: "complete"
          });
        }
      }
    },
    [interactions.completedItemIds, state.drop.drop_date, state.source]
  );

  const value = useMemo<DailyDropContextValue>(() => {
    const completedItemIds = interactions.completedItemIds;
    const isItemComplete = (itemId: string) => completedItemIds.has(itemId);

    return {
      language,
      drop: state.drop,
      status: state.status,
      source: state.source,
      items,
      isEmptyDrop: totalItemCount === 0,
      totalItemCount,
      completedItemCount,
      progress: totalItemCount > 0 ? completedItemCount / totalItemCount : 0,
      isComplete: totalItemCount > 0 && completedItemCount === totalItemCount,
      isItemComplete,
      isModuleComplete: (moduleItems) =>
        moduleItems.length > 0 && moduleItems.every((item) => isItemComplete(item.id)),
      getItemById: (itemId) => items.find((item) => item.id === itemId),
      markItemsComplete,
      reload: () => {
        void load();
      }
    };
  }, [
    completedItemCount,
    interactions.completedItemIds,
    items,
    language,
    load,
    markItemsComplete,
    state.drop,
    state.source,
    state.status,
    totalItemCount
  ]);

  return <DailyDropContext.Provider value={value}>{children}</DailyDropContext.Provider>;
}

export function useDailyDrop() {
  const value = useContext(DailyDropContext);

  if (!value) {
    throw new Error("useDailyDrop must be used within a DailyDropProvider");
  }

  return value;
}

function getLocalDropDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}
