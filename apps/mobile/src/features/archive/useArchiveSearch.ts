import { useEffect, useMemo, useRef, useState } from "react";

import { getAuthSession } from "../../lib/supabase";
import { searchLibraryItems } from "../library/libraryData";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { parseArchiveQuery, searchArchiveItems } from "./archiveSelectors";
import { useArchive } from "./ArchiveContext";

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export type ArchiveSearchState = {
  /** Rows to render: the loaded page window, or the search results. */
  results: LibraryItemSummary[];
  searching: boolean;
  /** True when `results` come from a query rather than the browse list. */
  isSearchActive: boolean;
  /** True when the server search failed and loaded pages were used instead. */
  isLocalFallback: boolean;
};

/**
 * Title + date search over the WHOLE archive.
 *
 * The archive itself is paginated, so filtering only the loaded pages would
 * silently hide older matches. The query is split into a period and free text
 * (parseArchiveQuery) and sent to Supabase, which searches the full history.
 * If that request fails, we degrade to filtering what is already loaded and
 * say so, rather than pretending the archive is empty.
 */
export function useArchiveSearch(
  query: string,
  items: LibraryItemSummary[],
  contentType: "business_story" | "mini_case"
): ArchiveSearchState {
  const archive = useArchive();
  const trimmed = query.trim();
  const isSearchActive = trimmed.length >= MIN_QUERY_LENGTH;
  const [state, setState] = useState<{
    results: LibraryItemSummary[];
    searching: boolean;
    isLocalFallback: boolean;
  }>({ results: [], searching: false, isLocalFallback: false });
  const requestIdRef = useRef(0);

  const plan = useMemo(
    () => parseArchiveQuery(trimmed, archive.language),
    [archive.language, trimmed]
  );

  useEffect(() => {
    if (!isSearchActive) {
      requestIdRef.current += 1;
      setState({ results: [], searching: false, isLocalFallback: false });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, searching: true }));

    const timer = setTimeout(() => {
      void (async () => {
        const sessionResult = await getAuthSession();
        const userId = sessionResult.data?.user.id ?? null;
        const result = await searchLibraryItems(userId, {
          contentType,
          text: plan.text,
          from: plan.from,
          toExclusive: plan.toExclusive,
          language: archive.language
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        if (result.source === "supabase") {
          setState({ results: result.data, searching: false, isLocalFallback: false });
          return;
        }

        setState({
          results: searchArchiveItems(items, trimmed, archive.language),
          searching: false,
          isLocalFallback: true
        });
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    archive.language,
    contentType,
    isSearchActive,
    items,
    plan.from,
    plan.text,
    plan.toExclusive,
    trimmed
  ]);

  return {
    results: isSearchActive ? state.results : items,
    searching: isSearchActive && state.searching,
    isSearchActive,
    isLocalFallback: isSearchActive && state.isLocalFallback
  };
}
