import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { mergeArchivePages } from "./archiveSelectors";
import type { LibraryDropSummary } from "../library/libraryTypes";

function drop(dropId: string, dropDate: string): LibraryDropSummary {
  return {
    drop_id: dropId,
    drop_date: dropDate,
    language: "en",
    title: "Daily drop",
    item_count: 1,
    topics: ["business"],
    completed_item_count: 0,
    saved_item_count: 0,
    items: []
  };
}

describe("archive paging", () => {
  it("appends an older page after the first, newest first", () => {
    const page1 = [drop("d3", "2026-08-14"), drop("d2", "2026-08-12")];
    const page2 = [drop("d1", "2026-08-10")];

    expect(mergeArchivePages(page1, page2).map((entry) => entry.drop_id)).toEqual([
      "d3",
      "d2",
      "d1"
    ]);
  });

  it("never duplicates an edition when pages overlap", () => {
    const page1 = [drop("d3", "2026-08-14"), drop("d2", "2026-08-12")];
    const overlapping = [drop("d2", "2026-08-12"), drop("d1", "2026-08-10")];

    const merged = mergeArchivePages(page1, overlapping);

    expect(merged).toHaveLength(3);
    expect(new Set(merged.map((entry) => entry.drop_id)).size).toBe(3);
  });

  it("keeps the newest copy of an edition that was refetched", () => {
    const stale = [{ ...drop("d1", "2026-08-10"), completed_item_count: 0 }];
    const fresh = [{ ...drop("d1", "2026-08-10"), completed_item_count: 2 }];

    expect(mergeArchivePages(stale, fresh)[0].completed_item_count).toBe(2);
  });

  it("handles an empty page (end of history) without losing anything", () => {
    const page1 = [drop("d2", "2026-08-12")];

    expect(mergeArchivePages(page1, [])).toEqual(page1);
  });
});

describe("no tenure-based archive lock remains", () => {
  const featuresDir = join(__dirname, "..");

  it("the access policy module is gone", () => {
    expect(existsSync(join(featuresDir, "library", "accessPolicy.ts"))).toBe(false);
  });

  it.each([
    join(featuresDir, "archive", "ArchiveContext.tsx"),
    join(featuresDir, "modules", "NewsletterModuleScreen.tsx"),
    join(featuresDir, "modules", "ItemArchiveList.tsx")
  ])("%s no longer gates editions by account age", (file) => {
    const source = readFileSync(file, "utf8");

    expect(source).not.toMatch(/unlockedEditionCount|lockedDropIds|isEditionUnlocked/);
  });

  it("the archive no longer reads the account creation date", () => {
    const source = readFileSync(join(featuresDir, "library", "libraryData.ts"), "utf8");

    expect(source).not.toMatch(/fetchProfileCreatedAt/);
  });

  it("pages the archive instead of capping it at a fixed window", () => {
    const source = readFileSync(join(featuresDir, "library", "libraryData.ts"), "utf8");

    expect(source).toMatch(/beforeDate/);
    expect(source).toMatch(/hasMore/);
  });
});
