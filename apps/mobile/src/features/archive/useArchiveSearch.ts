import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getAuthSession, type NormalizedSupabaseError } from "../../lib/supabase";
import { searchLibraryItems } from "../library/libraryData";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { parseArchiveQuery, searchArchiveItems } from "./archiveSelectors";
import {
  buildArchiveSearchKey,
  mergeArchiveSearchPages,
  type ArchiveSearchCursor
} from "./archiveSearchPaging";
import { useArchive } from "./ArchiveContext";

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export type ArchiveSearchState = {
  /** Rows to render: the loaded page window, or the search results. */
  results: LibraryItemSummary[];
  searching: boolean;
  /** True while an explicitly requested further page of results is loading. */
  loadingMore: boolean;
  /** True when more results exist beyond the ones already listed. */
  hasMore: boolean;
  /** True when `results` come from a query rather than the browse list. */
  isSearchActive: boolean;
  /** True when the server search failed and loaded pages were used instead. */
  isLocalFallback: boolean;
  /** Set when a further page failed; the pages already shown are kept. */
  loadMoreError: NormalizedSupabaseError | null;
  /** Ask for the next page. Ignored while one is in flight or at the end. */
  loadMore: () => void;
};

type SearchState = {
  results: LibraryItemSummary[];
  cursor: ArchiveSearchCursor | null;
  hasMore: boolean;
  searching: boolean;
  loadingMore: boolean;
  isLocalFallback: boolean;
  loadMoreError: NormalizedSupabaseError | null;
};

const idleState: SearchState = {
  results: [],
  cursor: null,
  hasMore: false,
  searching: false,
  loadingMore: false,
  isLocalFallback: false,
  loadMoreError: null
};

/**
 * Title + date search over the WHOLE archive, paginated.
 *
 * The archive itself is paginated, so filtering only the loaded pages would
 * silently hide older matches. The query is split into a period and free text
 * (parseArchiveQuery) and sent to Supabase, which searches the full history and
 * answers one keyset page at a time — further pages arrive only when the reader
 * asks, never on scroll. There is no result cap: a match from years back is
 * reachable by loading pages.
 *
 * If the server cannot be reached at all, we degrade to filtering what is
 * already loaded and say so, rather than pretending the archive is empty. If a
 * *further* page fails, the pages already shown stay on screen and the reader
 * can retry.
 *
 * This cursor is entirely separate from the ArchiveProvider's browse paging:
 * the two never share state, so searching cannot disturb the edition list.
 */
export function useArchiveSearch(
  query: string,
  items: LibraryItemSummary[],
  contentType: "business_story" | "mini_case"
): ArchiveSearchState {
  const archive = useArchive();
  const trimmed = query.trim();
  const isSearchActive = trimmed.length >= MIN_QUERY_LENGTH;
  const [state, setState] = useState<SearchState>(idleState);

  const plan = useMemo(
    () => parseArchiveQuery(trimmed, archive.language),
    [archive.language, trimmed]
  );

  // Identity of the search currently displayed. Every response is checked
  // against it before being applied, so a page from a previous query — or from
  // the previous language — can never land in the list.
  const requestKeyRef = useRef<string>("");
  // Rejects a second page while one is in flight: a double tap on "load more"
  // must not fire two requests, nor apply the same page twice.
  const inFlightRef = useRef(false);

  const requestKey = useMemo(
    () =>
      buildArchiveSearchKey({
        language: archive.language,
        contentType,
        text: plan.text,
        from: plan.from,
        toExclusive: plan.toExclusive
      }),
    [archive.language, contentType, plan.from, plan.text, plan.toExclusive]
  );

  // Inputs of the offline fallback only. Held in a ref so a browse page landing
  // in the archive never restarts the search from page 1.
  const fallbackRef = useRef({ items, trimmed, language: archive.language });
  fallbackRef.current = { items, trimmed, language: archive.language };

  const runSearch = useCallback(
    async (cursor: ArchiveSearchCursor | null) => {
      const sessionResult = await getAuthSession();
      const userId = sessionResult.data?.user.id ?? null;

      // The query or the language changed while the session was being read.
      if (requestKeyRef.current !== requestKey) {
        return;
      }

      const result = await searchLibraryItems(userId, {
        contentType,
        text: plan.text,
        from: plan.from,
        toExclusive: plan.toExclusive,
        language: archive.language,
        cursor
      });

      // Same guard after the round trip: this is what keeps a slow response to
      // an abandoned search out of the current results — and out of the
      // in-flight flag, which now belongs to the newer request.
      if (requestKeyRef.current !== requestKey) {
        return;
      }

      inFlightRef.current = false;

      if (result.source === "mock") {
        const fallback = fallbackRef.current;

        setState((current) =>
          cursor
            ? // A further page failed: keep everything already listed, report
              // the failure so the reader can retry, and keep the cursor so the
              // retry resumes at the same place.
              { ...current, loadingMore: false, loadMoreError: result.error }
            : {
                ...idleState,
                results: searchArchiveItems(
                  fallback.items,
                  fallback.trimmed,
                  fallback.language
                ),
                isLocalFallback: true
              }
        );
        return;
      }

      setState((current) => ({
        results: cursor
          ? mergeArchiveSearchPages(current.results, result.data.items)
          : result.data.items,
        cursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
        searching: false,
        loadingMore: false,
        isLocalFallback: false,
        loadMoreError: null
      }));
    },
    [archive.language, contentType, plan.from, plan.text, plan.toExclusive, requestKey]
  );

  useEffect(() => {
    if (!isSearchActive) {
      // Leaving search: invalidate anything in flight and drop the results.
      requestKeyRef.current = "";
      inFlightRef.current = false;
      setState(idleState);
      return;
    }

    // A new query (or language) starts a new listing from page 1: previous
    // results, cursor and paging state are all discarded, and any response
    // still in flight for the previous key is now ignored on arrival.
    requestKeyRef.current = requestKey;
    inFlightRef.current = true;
    setState({ ...idleState, searching: true });

    const timer = setTimeout(() => {
      void runSearch(null).catch(() => {
        inFlightRef.current = false;
        setState((current) => ({ ...current, searching: false }));
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [isSearchActive, requestKey, runSearch]);

  const loadMore = useCallback(() => {
    if (!isSearchActive || inFlightRef.current || !state.hasMore || !state.cursor) {
      return;
    }

    inFlightRef.current = true;
    setState((current) => ({ ...current, loadingMore: true, loadMoreError: null }));

    void runSearch(state.cursor).catch(() => {
      inFlightRef.current = false;
      setState((current) => ({ ...current, loadingMore: false }));
    });
  }, [isSearchActive, runSearch, state.cursor, state.hasMore]);

  return {
    results: isSearchActive ? state.results : items,
    searching: isSearchActive && state.searching,
    loadingMore: isSearchActive && state.loadingMore,
    hasMore: isSearchActive && state.hasMore,
    isSearchActive,
    isLocalFallback: isSearchActive && state.isLocalFallback,
    loadMoreError: isSearchActive ? state.loadMoreError : null,
    loadMore
  };
}
