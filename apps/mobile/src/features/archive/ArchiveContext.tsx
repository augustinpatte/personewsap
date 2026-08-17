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

import type { DataFallbackReason, DataFetchSource } from "../../lib/dataState";
import { getAuthSession, type NormalizedSupabaseError } from "../../lib/supabase";
import type { Language } from "../../types/domain";
import { useAuth } from "../auth";
import { fetchLibraryDrops } from "../library/libraryData";
import { mergeArchivePages } from "./archiveSelectors";
import type { LibraryDropSummary, LibraryItemSummary } from "../library/libraryTypes";

/**
 * One shared archive for all module tabs.
 *
 * Newsletter, Business Stories and Mini Cases all read the same daily-drop
 * history; this provider loads it once (per language) instead of four
 * independent fetch systems. Selectors in archiveSelectors.ts slice it per
 * module.
 *
 * The archive is paginated with a keyset cursor on drop_date, so it supports a
 * history that grows for years without ever loading it whole — and without an
 * endless feed: older pages arrive only when the reader explicitly asks.
 * Everything the user has is openable; there is no tenure-based lock.
 */

const ARCHIVE_PAGE_SIZE = 25;

export type ArchiveContextValue = {
  language: Language;
  status: "loading" | "ready";
  /** True while an explicitly requested older page is being fetched. */
  loadingMore: boolean;
  hasMore: boolean;
  drops: LibraryDropSummary[];
  items: LibraryItemSummary[];
  error: NormalizedSupabaseError | null;
  fallbackReason: DataFallbackReason | "missing_auth_session" | null;
  source: DataFetchSource;
  loadMore: () => void;
  reload: () => void;
};

const ArchiveContext = createContext<ArchiveContextValue | null>(null);

type ArchiveState = {
  status: "loading" | "ready";
  loadingMore: boolean;
  hasMore: boolean;
  drops: LibraryDropSummary[];
  error: NormalizedSupabaseError | null;
  fallbackReason: DataFallbackReason | "missing_auth_session" | null;
  source: DataFetchSource;
};

const initialState: ArchiveState = {
  status: "loading",
  loadingMore: false,
  hasMore: false,
  drops: [],
  error: null,
  fallbackReason: null,
  source: "mock"
};

export function ArchiveProvider({ children }: PropsWithChildren) {
  const { profileLanguage, status: authStatus } = useAuth();
  const language: Language = profileLanguage ?? "en";
  const [state, setState] = useState<ArchiveState>(initialState);
  // Guards against a second page request while one is in flight (double tap)
  // and against a page landing after a language switch invalidated it.
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadFirstPage = useCallback(
    async (isActive: () => boolean = () => true) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      inFlightRef.current = true;
      setState({ ...initialState, status: "loading" });

      const sessionResult = await getAuthSession();
      const userId = sessionResult.data?.user.id;
      const stillCurrent = () => isActive() && requestIdRef.current === requestId;

      if (!userId) {
        inFlightRef.current = false;

        if (stillCurrent()) {
          setState({
            ...initialState,
            status: "ready",
            error: sessionResult.error,
            fallbackReason: "missing_auth_session"
          });
        }

        return;
      }

      const page = await fetchLibraryDrops(userId, {
        language,
        pageSize: ARCHIVE_PAGE_SIZE
      });

      inFlightRef.current = false;

      if (stillCurrent()) {
        setState({
          status: "ready",
          loadingMore: false,
          hasMore: page.hasMore,
          drops: page.data,
          error: page.error,
          fallbackReason: page.fallbackReason,
          source: page.source
        });
      }
    },
    [language]
  );

  const loadMore = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }

    const oldest = state.drops[state.drops.length - 1];

    if (!state.hasMore || !oldest) {
      return;
    }

    const requestId = requestIdRef.current;
    inFlightRef.current = true;
    setState((current) => ({ ...current, loadingMore: true }));

    const sessionResult = await getAuthSession();
    const userId = sessionResult.data?.user.id;

    if (!userId) {
      inFlightRef.current = false;
      setState((current) => ({ ...current, loadingMore: false }));
      return;
    }

    const page = await fetchLibraryDrops(userId, {
      language,
      pageSize: ARCHIVE_PAGE_SIZE,
      beforeDate: oldest.drop_date
    });

    inFlightRef.current = false;

    // A language switch (or reload) started a newer request: drop this page
    // rather than mixing editions from the previous language into the list.
    if (requestIdRef.current !== requestId) {
      return;
    }

    setState((current) => ({
      ...current,
      loadingMore: false,
      hasMore: page.hasMore,
      drops: mergeArchivePages(current.drops, page.data),
      error: page.error ?? current.error
    }));
  }, [language, state.drops, state.hasMore]);

  useEffect(() => {
    if (authStatus !== "ready") {
      return;
    }

    let isMounted = true;
    void loadFirstPage(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, [authStatus, loadFirstPage]);

  const value = useMemo<ArchiveContextValue>(
    () => ({
      language,
      status: state.status,
      loadingMore: state.loadingMore,
      hasMore: state.hasMore,
      drops: state.drops,
      items: state.drops.flatMap((drop) => drop.items ?? []),
      error: state.error,
      fallbackReason: state.fallbackReason,
      source: state.source,
      loadMore: () => {
        void loadMore();
      },
      reload: () => {
        void loadFirstPage();
      }
    }),
    [language, loadFirstPage, loadMore, state]
  );

  return <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>;
}

export function useArchive(): ArchiveContextValue {
  const value = useContext(ArchiveContext);

  if (!value) {
    throw new Error("useArchive must be used within an ArchiveProvider");
  }

  return value;
}
