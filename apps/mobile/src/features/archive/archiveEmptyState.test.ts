import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveArchiveEmptyState } from "./archiveEmptyState";

/**
 * The case that made a full archive look empty: the last 25 editions carry no
 * Business Story, older ones do, and the module said "nothing here" with no way
 * to look further back.
 */
describe("resolveArchiveEmptyState", () => {
  const base = { itemCount: 0, isSearchActive: false, hasError: false, hasMore: false };

  it("lists rows whenever there are any", () => {
    expect(resolveArchiveEmptyState({ ...base, itemCount: 3 })).toBe("list");
    expect(resolveArchiveEmptyState({ ...base, itemCount: 3, hasMore: true })).toBe("list");
    // An error alongside loaded rows must not hide them.
    expect(resolveArchiveEmptyState({ ...base, itemCount: 3, hasError: true })).toBe("list");
  });

  it("offers the earlier editions when the loaded ones carry none", () => {
    expect(resolveArchiveEmptyState({ ...base, hasMore: true })).toBe("load-earlier");
  });

  it("declares a real empty archive only when nothing is left to load", () => {
    expect(resolveArchiveEmptyState(base)).toBe("empty");
  });

  it("prefers a retry over an empty state when the archive failed", () => {
    expect(resolveArchiveEmptyState({ ...base, hasError: true })).toBe("error");
    expect(resolveArchiveEmptyState({ ...base, hasError: true, hasMore: true })).toBe(
      "error"
    );
  });

  it("leaves an active search to its own empty state", () => {
    // Search already covers the whole history server-side: paging the browse
    // archive would answer a question nobody asked.
    expect(resolveArchiveEmptyState({ ...base, isSearchActive: true })).toBe("list");
    expect(
      resolveArchiveEmptyState({ ...base, isSearchActive: true, hasMore: true })
    ).toBe("list");
  });
});

describe("the modules use it", () => {
  it.each([
    ["mini cases and stories", "ItemArchiveList.tsx"],
    ["newsletter editions", "NewsletterModuleScreen.tsx"]
  ])("the %s list resolves its empty state through the shared rule", (_name, file) => {
    const source = readFileSync(
      join(__dirname, "..", "modules", file),
      "utf8"
    );

    expect(source).toMatch(/resolveArchiveEmptyState/);
    expect(source).toMatch(/seeEarlierEditions/);
    // One page per tap, from the shared provider — never a loop.
    expect(source).toMatch(/archive\.loadMore/);
    expect(source).not.toMatch(/onEndReached/);
    expect(source).not.toMatch(/while \(/);
  });
});
