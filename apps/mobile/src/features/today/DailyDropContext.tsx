import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { AppState } from "react-native";

import { trackAnalyticsEvent } from "../../lib/analytics";
import type { DataFetchSource } from "../../lib/dataState";
import { clearMemoryCache } from "../../lib/memoryCache";
import { getAuthSession, type NormalizedSupabaseError } from "../../lib/supabase";
import { flattenDailyDropItems } from "../../mocks";
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
import {
  decideForegroundReload,
  fetchCurrentEditionDate,
  isNextEditionPending,
  resolveEditionKey,
  resolveTodayTargetDate
} from "./currentEdition";
import { fetchTodayDrop, getFallbackTodayDrop } from "./dailyDropData";
import { isEditionDay, resolveReaderEditionDate } from "./editionCadence";

/** Matches the content cache's own TTL (dailyDropData todayDropCacheTtlMs). */
export const TODAY_FOREGROUND_TTL_MS = 60_000;
/** Floor between two foreground re-reads while an edition is due but not out. */
export const TODAY_AWAITING_MIN_INTERVAL_MS = 15_000;

type LoadRequest = {
  /**
   * Show this edition instead of the open one. `null` returns to the open
   * edition; omitted keeps whatever is pinned now.
   */
  pinDate?: string | null;
  /** Bypass the in-memory content cache (a tap, a pull, a retry). */
  force?: boolean;
  /**
   * Keep what is on screen while re-reading (foreground checks, pull to
   * refresh). Without it the screen shows its loader, which is right when the
   * edition itself is changing and wrong for a routine re-check.
   */
  quiet?: boolean;
};

export type DailyDropContextValue = {
  language: ContentLanguage;
  drop: TodayDailyDrop;
  status: "loading" | "ready";
  source: DataFetchSource;
  /** Last fetch error, so screens can show an honest offline/error state. */
  error: NormalizedSupabaseError | null;
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
  /** Re-read Today from the server (bypassing the content cache). */
  reload: () => void;
  /** Pull to refresh: re-read from the server while keeping the content on screen. */
  refresh: () => Promise<void>;
  /** True while a quiet re-read (pull, foreground check) is running. */
  refreshing: boolean;
  /** The edition the backend says is open now, when it said so. */
  currentEditionDate: string | null;
  /**
   * Set when Today shows an edition the reader explicitly asked for (a
   * notification, a link) that is not the open one.
   */
  pinnedEditionDate: string | null;
  /** Show this edition (fresh from the server). Falls back to the open one if it is not available. */
  openEdition: (dropDate: string) => Promise<void>;
  /** Leave a pinned edition and show the open one again. */
  showCurrentEdition: () => Promise<void>;
};

export const DailyDropContext = createContext<DailyDropContextValue | null>(null);

type DailyDropState = {
  drop: TodayDailyDrop;
  source: DataFetchSource;
  status: "loading" | "ready";
  error: NormalizedSupabaseError | null;
  currentEditionDate: string | null;
  pinnedEditionDate: string | null;
};

export function DailyDropProvider({ children }: PropsWithChildren) {
  const { profileLanguage, status: authStatus } = useAuth();
  const language: ContentLanguage = profileLanguage ?? "en";
  // Mock only in dev/preview builds; production starts from an honest empty drop.
  const fallbackDrop = useMemo(
    () => getFallbackTodayDrop(language, resolveReaderEditionDate()),
    [language]
  );

  const [state, setState] = useState<DailyDropState>({
    drop: fallbackDrop,
    source: "mock",
    status: "loading",
    error: null,
    currentEditionDate: null,
    pinnedEditionDate: null
  });
  const [interactions, setInteractions] = useState<ContentInteractionSnapshot>(
    createEmptyContentInteractionSnapshot
  );
  const [refreshing, setRefreshing] = useState(false);
  // Load bookkeeping read by the foreground policy. Refs, because the AppState
  // listener must see the latest values without being re-subscribed.
  const loadSequenceRef = useRef(0);
  const loadingRef = useRef(false);
  const lastLoadedAtRef = useRef<number | null>(null);
  const editionKeyRef = useRef<string | null>(null);
  const awaitingPublicationRef = useRef(false);
  const pinnedDateRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (isActive: () => boolean = () => mountedRef.current, request: LoadRequest = {}) => {
      // The latest request wins: a notification tap that lands while the
      // initial load is still running must not be overwritten by it.
      const sequence = loadSequenceRef.current + 1;
      loadSequenceRef.current = sequence;
      const isCurrent = () => isActive() && loadSequenceRef.current === sequence;

      loadingRef.current = true;

      if (request.quiet) {
        setRefreshing(true);
      } else {
        setState((current) => ({ ...current, status: "loading" }));
      }

      try {
        const sessionResult = await getAuthSession();
        const userId = sessionResult.data?.user.id;

        if (!userId) {
          if (isCurrent()) {
            setState({
              drop: fallbackDrop,
              source: "mock",
              status: "ready",
              error: null,
              currentEditionDate: null,
              pinnedEditionDate: null
            });
            setInteractions(createEmptyContentInteractionSnapshot());
          }

          return;
        }

        if (request.force) {
          clearMemoryCache("today-drop");
        }

        const current = await fetchCurrentEditionDate();
        const openTarget = resolveTodayTargetDate({ currentEditionDate: current.editionDate });
        const requestedPin =
          request.pinDate === undefined ? pinnedDateRef.current : request.pinDate;
        // Asking for the open edition is not a pin: it is simply Today.
        let pinnedDate = requestedPin && requestedPin !== openTarget ? requestedPin : null;
        let targetDate = pinnedDate ?? openTarget;
        let result = await fetchTodayDrop(userId, targetDate, { language });

        // The edition a notification named is gone, or was never this reader's.
        // Show the open edition rather than an empty screen.
        if (pinnedDate && flattenDailyDropItems(result.data).length === 0) {
          pinnedDate = null;
          targetDate = openTarget;
          result = await fetchTodayDrop(userId, targetDate, { language });
        }

        if (!isCurrent()) {
          return;
        }

        pinnedDateRef.current = pinnedDate;
        lastLoadedAtRef.current = Date.now();
        editionKeyRef.current = resolveEditionKey();
        awaitingPublicationRef.current =
          !pinnedDate &&
          (isNextEditionPending({ currentEditionDate: current.editionDate }) ||
            (flattenDailyDropItems(result.data).length === 0 && isEditionDay(targetDate)));

        setState({
          drop: result.data,
          source: result.source,
          status: "ready",
          error: result.error,
          currentEditionDate: current.editionDate,
          pinnedEditionDate: pinnedDate
        });
        trackAnalyticsEvent("daily_drop_loaded", {
          drop_date: result.data.drop_date,
          language: result.data.language
        });

        if (result.source === "supabase" || result.source === "cache") {
          const snapshot = await readContentInteractionSnapshot(
            // Translations included. A Team article has no daily_drop_items row
            // to pin an id to, so the row on screen changes when the reader
            // switches language — and asking only about the current row would
            // report an article they read this morning in English as unread.
            flattenDailyDropItems(result.data).flatMap((item) => [
              item.id,
              ...(item.translation_ids ?? [])
            ])
          );

          if (isCurrent() && snapshot.ok) {
            setInteractions(snapshot.snapshot);
          }
        } else if (isCurrent()) {
          setInteractions(createEmptyContentInteractionSnapshot());
        }
      } finally {
        if (loadSequenceRef.current === sequence) {
          loadingRef.current = false;
          setRefreshing(false);
        }
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

  // Returning to the app is when the reader can see the screen again, and when
  // an edition may have published or the calendar moved underneath it. The
  // policy (decideForegroundReload) reloads only when that can change what is
  // shown, and throttles the "edition due" case, so foregrounding is cheap.
  useEffect(() => {
    if (authStatus !== "ready") {
      return;
    }

    let isMounted = true;

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState !== "active") {
        return;
      }

      const editionKey = resolveEditionKey();
      const editionKeyChanged =
        editionKeyRef.current !== null && editionKey !== editionKeyRef.current;

      const shouldReload = decideForegroundReload({
        now: Date.now(),
        lastLoadedAt: lastLoadedAtRef.current,
        loading: loadingRef.current,
        ttlMs: TODAY_FOREGROUND_TTL_MS,
        minIntervalMs: TODAY_AWAITING_MIN_INTERVAL_MS,
        editionKeyChanged,
        awaitingPublication: awaitingPublicationRef.current,
        pinned: pinnedDateRef.current !== null
      });

      if (shouldReload) {
        // A new day releases a pinned edition: the open one is what Today means.
        // Quiet: the reader keeps reading while Today is re-checked. A new day
        // releases a pinned edition, because the open one is what Today means.
        void load(() => isMounted, editionKeyChanged ? { pinDate: null, quiet: true } : { quiet: true });
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [authStatus, load]);

  const openEdition = useCallback(
    (dropDate: string) => load(undefined, { pinDate: dropDate, force: true }),
    [load]
  );

  const showCurrentEdition = useCallback(
    () => load(undefined, { pinDate: null, force: true }),
    [load]
  );

  const refresh = useCallback(() => load(undefined, { force: true, quiet: true }), [load]);

  const items = useMemo(() => flattenDailyDropItems(state.drop), [state.drop]);
  const visibleItems = useMemo(
    () =>
      items.filter((item) => !["key_concept", "concept"].includes(item.content_type as string)),
    [items]
  );
  const totalItemCount = visibleItems.length;
  const completedItemCount = useMemo(
    () =>
      visibleItems.filter(
        (item) =>
          interactions.completedItemIds.has(item.id) ||
          (item.translation_ids ?? []).some((translationId) =>
            interactions.completedItemIds.has(translationId)
          )
      ).length,
    [interactions.completedItemIds, visibleItems]
  );

  const markItemsComplete = useCallback(
    async (toComplete: DailyDropContentItem[]) => {
      const pending = toComplete.filter(
        (item) =>
          !interactions.completedItemIds.has(item.id) &&
          !(item.translation_ids ?? []).some((translationId) =>
            interactions.completedItemIds.has(translationId)
          )
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
    const isItemComplete = (itemId: string) =>
      completedItemIds.has(itemId) ||
      // One reading, whichever rendering of it is on screen (see above).
      (items
        .find((item) => item.id === itemId)
        ?.translation_ids?.some((translationId) => completedItemIds.has(translationId)) ??
        false);

    return {
      language,
      drop: state.drop,
      status: state.status,
      source: state.source,
      error: state.error,
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
        // An explicit retry or pull: ask the server, not the minute-old cache.
        void load(undefined, { force: true });
      },
      refresh,
      refreshing,
      currentEditionDate: state.currentEditionDate,
      pinnedEditionDate: state.pinnedEditionDate,
      openEdition,
      showCurrentEdition
    };
  }, [
    completedItemCount,
    interactions.completedItemIds,
    items,
    language,
    load,
    markItemsComplete,
    openEdition,
    refresh,
    refreshing,
    showCurrentEdition,
    state.currentEditionDate,
    state.drop,
    state.error,
    state.pinnedEditionDate,
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
