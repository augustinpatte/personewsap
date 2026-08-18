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
 *
 * It is also loaded lazily. Opening the app on Newsletter -> Today needs no
 * archive at all, so the first page is fetched when an Archive/Editions view is
 * first rendered (useArchiveData) rather than at boot, where it was one more
 * request competing with auth, the daily drop and the learning path on a cold
 * connection. Once loaded it stays in this single shared provider, so every
 * module tab reads the same pages.
 */

const ARCHIVE_PAGE_SIZE = 25;

export type ArchiveContextValue = {
  language: Language;
  /** "idle" until an archive view asks for the data (see useArchiveData). */
  status: "idle" | "loading" | "ready";
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
  /**
   * Load the first page if it has not been loaded for the current language.
   * Idempotent: safe to call from every archive view on every render pass.
   */
  ensureLoaded: () => void;
};

const ArchiveContext = createContext<ArchiveContextValue | null>(null);

type ArchiveState = {
  status: "idle" | "loading" | "ready";
  loadingMore: boolean;
  hasMore: boolean;
  drops: LibraryDropSummary[];
  error: NormalizedSupabaseError | null;
  fallbackReason: DataFallbackReason | "missing_auth_session" | null;
  source: DataFetchSource;
};

const initialState: ArchiveState = {
  status: "idle",
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
  // The language the first page was requested for, so ensureLoaded fetches
  // once per language and a language switch re-fetches on its own.
  const loadedLanguageRef = useRef<Language | null>(null);

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

  const ensureLoaded = useCallback(() => {
    if (authStatus !== "ready" || loadedLanguageRef.current === language) {
      return;
    }

    loadedLanguageRef.current = language;
    // loadFirstPage normalises every failure into state; the catch keeps a
    // cold-start network error from escaping as an unhandled rejection.
    void loadFirstPage().catch(() => {
      loadedLanguageRef.current = null;
    });
  }, [authStatus, language, loadFirstPage]);

  // A language switch invalidates whatever is loaded. Reset the marker so the
  // next archive view (or the one currently mounted) re-requests the first page
  // in the new language instead of showing the previous one.
  useEffect(() => {
    if (loadedLanguageRef.current !== null && loadedLanguageRef.current !== language) {
      loadedLanguageRef.current = null;
      setState(initialState);
    }
  }, [language]);

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
        // Unexpected failure must release the control, not leave a spinner and
        // an unhandled rejection behind.
        void loadMore().catch(() => {
          inFlightRef.current = false;
          setState((current) => ({ ...current, loadingMore: false }));
        });
      },
      reload: () => {
        loadedLanguageRef.current = language;
        void loadFirstPage().catch(() => {
          loadedLanguageRef.current = null;
        });
      },
      ensureLoaded
    }),
    [ensureLoaded, language, loadFirstPage, loadMore, state]
  );

  return <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>;
}

/**
 * Read the shared archive without requesting it. For chrome that only needs the
 * language, the paging flags or the reload action.
 */
export function useArchive(): ArchiveContextValue {
  const value = useContext(ArchiveContext);

  if (!value) {
    throw new Error("useArchive must be used within an ArchiveProvider");
  }

  return value;
}

/**
 * Read the shared archive and make sure it is loaded. This is what an
 * Archive/Editions view uses: the first page is fetched on first render of such
 * a view, not at app start.
 */
export function useArchiveData(): ArchiveContextValue {
  const archive = useArchive();
  const { ensureLoaded } = archive;

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  return archive;
}
