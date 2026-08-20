// react / react-dom resolve to apps/mobile/node_modules (React 19), the copy
// the hook itself uses. See learningFirstSession.test.tsx for why the root
// testing-library render is not used here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryItemSummary } from "../library/libraryTypes";
import type { ArchiveSearchCursor, ArchiveSearchPage } from "./archiveSearchPaging";

/**
 * The asynchronous behaviour of search: what happens when the reader retypes,
 * switches language, double-taps "load more", or loses the network halfway
 * through a listing. Every one of these produced a wrong list in a naive
 * implementation — a page from an abandoned query landing in the results, two
 * concurrent requests, or the results already on screen being wiped by a
 * failure.
 */

type SearchCall = {
  cursor: ArchiveSearchCursor | null;
  language?: string;
  text: string;
  resolve: (page: ArchiveSearchPage) => void;
  fail: (message?: string) => void;
};

const calls: SearchCall[] = [];
let language = "fr";

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../../lib/supabase", () => ({
  getAuthSession: () =>
    Promise.resolve({ data: { user: { id: "44444444-4444-4444-8444-444444444444" } }, error: null })
}));

vi.mock("./ArchiveContext", () => ({
  useArchive: () => ({ language })
}));

vi.mock("../library/libraryData", () => ({
  searchLibraryItems: (
    _userId: string | null,
    options: { cursor?: ArchiveSearchCursor | null; language?: string; text: string }
  ) =>
    new Promise((resolve) => {
      calls.push({
        cursor: options.cursor ?? null,
        language: options.language,
        text: options.text,
        resolve: (page) => resolve({ data: page, error: null, fallbackReason: null, source: "supabase", state: { data: page, error: null, message: null, status: "ready" } }),
        fail: (message = "Network request failed") =>
          resolve({
            data: { items: [], nextCursor: null, hasMore: false },
            error: { message },
            fallbackReason: "network_unavailable",
            source: "mock",
            state: { data: null, error: { message }, message, status: "error" }
          })
      });
    })
}));

const { useArchiveSearch } = await import("./useArchiveSearch");

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function item(index: number, title = `Story ${index}`): LibraryItemSummary {
  return {
    id: uuid(index),
    content_type: "business_story",
    drop_date: "2026-08-17",
    hide_display_date: false,
    drop_id: uuid(900000 + index),
    is_completed: false,
    is_saved: false,
    language: "fr",
    source_count: 2,
    title,
    topic: "business"
  };
}

function page(indexes: number[], hasMore: boolean): ArchiveSearchPage {
  const items = indexes.map((index) => item(index));
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? { dropDate: last.drop_date, contentItemId: last.id } : null
  };
}

type Probe = ReturnType<typeof useArchiveSearch> | null;

let probe: Probe = null;
let root: Root | null = null;

function Harness({ query, items }: { query: string; items: LibraryItemSummary[] }) {
  probe = useArchiveSearch(query, items, "business_story");
  return null;
}

async function render(query: string, items: LibraryItemSummary[] = []) {
  const container = document.createElement("div");
  document.body.append(container);

  await act(async () => {
    root = createRoot(container);
    root.render(<Harness items={items} query={query} />);
  });
}

async function rerender(query: string, items: LibraryItemSummary[] = []) {
  await act(async () => {
    root?.render(<Harness items={items} query={query} />);
  });
}

/** Let the debounce fire and any resolved promise settle. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  language = "fr";
  probe = null;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
    root = null;
  }
  vi.useRealTimers();
});

describe("first page", () => {
  it("does not search below the minimum query length", async () => {
    await render("o");
    await settle();

    expect(calls).toHaveLength(0);
    expect(probe?.isSearchActive).toBe(false);
  });

  it("loads page 1 and reports that more exist", async () => {
    await render("openai");
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].cursor).toBeNull();

    await act(async () => {
      calls[0].resolve(page([1, 2, 3], true));
    });

    expect(probe?.results.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(probe?.hasMore).toBe(true);
    expect(probe?.searching).toBe(false);
  });
});

describe("loading further pages", () => {
  async function loadFirstPage() {
    await render("openai");
    await settle();
    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });
  }

  it("appends the next page with no duplicate", async () => {
    await loadFirstPage();

    await act(async () => {
      probe?.loadMore();
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].cursor).toEqual({ dropDate: "2026-08-17", contentItemId: uuid(2) });

    await act(async () => {
      // The server repeats the boundary row; it must not be listed twice.
      calls[1].resolve(page([2, 3, 4], false));
    });

    expect(probe?.results.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
    expect(probe?.hasMore).toBe(false);
  });

  it("fires one request for a double tap", async () => {
    await loadFirstPage();

    await act(async () => {
      probe?.loadMore();
      probe?.loadMore();
      probe?.loadMore();
    });

    expect(calls).toHaveLength(2);
  });

  it("does nothing once the end is reached", async () => {
    await render("openai");
    await settle();
    await act(async () => {
      calls[0].resolve(page([1, 2], false));
    });

    await act(async () => {
      probe?.loadMore();
    });

    expect(calls).toHaveLength(1);
    expect(probe?.hasMore).toBe(false);
  });
});

describe("a failing page", () => {
  it("keeps the results already shown and offers a retry", async () => {
    await render("openai");
    await settle();
    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });

    await act(async () => {
      probe?.loadMore();
    });
    await act(async () => {
      calls[1].fail();
    });

    // Page 1 is still on screen: a network error is not "no results".
    expect(probe?.results.map((row) => row.id)).toEqual([uuid(1), uuid(2)]);
    expect(probe?.loadMoreError?.message).toBe("Network request failed");
    expect(probe?.loadingMore).toBe(false);
    expect(probe?.hasMore).toBe(true);
  });

  it("resumes at the same cursor on retry, without duplicating", async () => {
    await render("openai");
    await settle();
    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });
    await act(async () => {
      probe?.loadMore();
    });
    await act(async () => {
      calls[1].fail();
    });

    await act(async () => {
      probe?.loadMore();
    });

    expect(calls[2].cursor).toEqual(calls[1].cursor);

    await act(async () => {
      calls[2].resolve(page([3, 4], false));
    });

    expect(probe?.results.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
    expect(probe?.loadMoreError).toBeNull();
  });

  it("falls back to the loaded pages when the first page cannot be fetched", async () => {
    await render("openai", [item(1, "OpenAI et la capacité"), item(2, "Nvidia")]);
    await settle();
    await act(async () => {
      calls[0].fail();
    });

    expect(probe?.isLocalFallback).toBe(true);
    expect(probe?.results.map((row) => row.id)).toEqual([uuid(1)]);
    expect(probe?.hasMore).toBe(false);
  });
});

describe("invalidation", () => {
  it("ignores a page that arrives after the query changed", async () => {
    await render("openai");
    await settle();

    await rerender("nvidia");
    await settle();

    expect(calls).toHaveLength(2);

    // The abandoned first query answers late.
    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });

    expect(probe?.results).toEqual([]);

    await act(async () => {
      calls[1].resolve(page([3], false));
    });

    expect(probe?.results.map((row) => row.id)).toEqual([uuid(3)]);
  });

  it("ignores a page that arrives after the language changed", async () => {
    await render("openai");
    await settle();

    language = "en";
    await rerender("openai");
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[0].language).toBe("fr");
    expect(calls[1].language).toBe("en");

    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });

    // Nothing from the FR listing survives the switch.
    expect(probe?.results).toEqual([]);

    await act(async () => {
      calls[1].resolve(page([3], false));
    });

    expect(probe?.results.map((row) => row.id)).toEqual([uuid(3)]);
  });

  it("restarts from page 1 when the query changes mid-listing", async () => {
    await render("openai");
    await settle();
    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });

    await rerender("nvidia");
    await settle();

    expect(probe?.results).toEqual([]);
    expect(calls[calls.length - 1].cursor).toBeNull();
  });

  it("drops the results when the query falls below the minimum", async () => {
    await render("openai");
    await settle();
    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });

    await rerender("o");

    expect(probe?.isSearchActive).toBe(false);
    expect(probe?.hasMore).toBe(false);
  });

  it("does not restart the listing when a browse page lands in the archive", async () => {
    await render("openai", [item(50)]);
    await settle();
    await act(async () => {
      calls[0].resolve(page([1, 2], true));
    });

    // The ArchiveProvider loaded another page of editions: the search must not
    // re-run, and its results must stay as they are.
    await rerender("openai", [item(50), item(51)]);
    await settle();

    expect(calls).toHaveLength(1);
    expect(probe?.results.map((row) => row.id)).toEqual([uuid(1), uuid(2)]);
  });
});
