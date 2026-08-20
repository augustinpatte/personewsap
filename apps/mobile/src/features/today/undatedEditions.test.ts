import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { LibraryDropSummary, LibraryItemSummary } from "../library/libraryTypes";
import { selectNewsletterEditions } from "../archive/archiveSelectors";
import { mergeArchivePages } from "../archive/archiveSelectors";
import { editionDisplayDate, formatDropDate } from "./contentCopy";
import { isEditionDay, resolveEditionType } from "./editionCadence";

/**
 * A handful of editions are seeded before launch and must read as evergreen, so
 * the app does not print their calendar date.
 *
 * The rule these tests defend is the one that is easy to lose later: hiding the
 * date is a display decision and nothing else. The edition still stores a real
 * drop_date, and ordering, cadence, weekly-digest detection and the source
 * footers all keep reading it.
 */

const PRELAUNCH_DATE = "2026-08-19"; // A Wednesday: a "daily" edition day.
const DIGEST_DATE = "2026-08-23"; // A Sunday: a weekly digest.

function item(overrides: Partial<LibraryItemSummary> = {}): LibraryItemSummary {
  return {
    id: "item-1",
    drop_id: "drop-1",
    drop_date: PRELAUNCH_DATE,
    hide_display_date: false,
    content_type: "newsletter_article",
    language: "en",
    title: "A sourced development",
    topic: "business",
    source_count: 1,
    is_saved: false,
    is_completed: false,
    ...overrides
  };
}

function drop(overrides: Partial<LibraryDropSummary> = {}): LibraryDropSummary {
  const dropDate = overrides.drop_date ?? PRELAUNCH_DATE;
  const hidden = overrides.hide_display_date ?? false;

  return {
    drop_id: `drop-${dropDate}`,
    drop_date: dropDate,
    hide_display_date: hidden,
    language: "en",
    title: "Edition",
    item_count: 1,
    topics: ["business"],
    completed_item_count: 0,
    saved_item_count: 0,
    items: [
      item({ drop_id: `drop-${dropDate}`, drop_date: dropDate, hide_display_date: hidden })
    ],
    ...overrides
  };
}

describe("a prelaunch edition is displayed without its date", () => {
  it("renders no calendar date", () => {
    expect(
      editionDisplayDate({ drop_date: PRELAUNCH_DATE, hide_display_date: true }, "en")
    ).toBeNull();
    expect(
      editionDisplayDate({ drop_date: PRELAUNCH_DATE, hide_display_date: true }, "fr")
    ).toBeNull();
  });

  it("returns null rather than an empty string, so no separator is left behind", () => {
    // MetaLine drops null entries; an empty string would leave "Edition · ".
    const shown = editionDisplayDate({ drop_date: PRELAUNCH_DATE, hide_display_date: true }, "en");

    expect(shown).not.toBe("");
    expect(shown).toBeNull();
  });
});

describe("a normal edition is unchanged", () => {
  it("still shows exactly the date it showed before", () => {
    expect(
      editionDisplayDate({ drop_date: PRELAUNCH_DATE, hide_display_date: false }, "en")
    ).toBe(formatDropDate(PRELAUNCH_DATE, "en"));
    expect(
      editionDisplayDate({ drop_date: PRELAUNCH_DATE, hide_display_date: false }, "fr")
    ).toBe(formatDropDate(PRELAUNCH_DATE, "fr"));
  });

  it("treats an old row without the field as a normal dated edition", () => {
    // Rows written before the column existed carry no flag at all.
    expect(editionDisplayDate({ drop_date: PRELAUNCH_DATE }, "en")).toBe(
      formatDropDate(PRELAUNCH_DATE, "en")
    );
  });
});

describe("internal edition logic still runs on drop_date", () => {
  it("orders a hidden-date edition by its real date", () => {
    const editions = selectNewsletterEditions([
      drop({ drop_date: "2026-08-17", hide_display_date: false }),
      drop({ drop_date: "2026-08-21", hide_display_date: true }),
      drop({ drop_date: "2026-08-19", hide_display_date: true })
    ]);

    expect(editions.map((edition) => edition.drop_date)).toEqual([
      "2026-08-21",
      "2026-08-19",
      "2026-08-17"
    ]);
  });

  it("keeps paging order stable when hidden-date editions are merged in", () => {
    const merged = mergeArchivePages(
      [drop({ drop_date: "2026-08-17" })],
      [drop({ drop_date: "2026-08-21", hide_display_date: true })]
    );

    expect(merged.map((entry) => entry.drop_date)).toEqual(["2026-08-21", "2026-08-17"]);
  });

  it("resolves the edition type from the date, hidden or not", () => {
    const hidden = selectNewsletterEditions([drop({ hide_display_date: true })])[0];
    const shown = selectNewsletterEditions([drop({ hide_display_date: false })])[0];

    expect(hidden.editionType).toBe("daily");
    expect(hidden.editionType).toBe(shown.editionType);
    expect(resolveEditionType(PRELAUNCH_DATE)).toBe("daily");
    expect(isEditionDay(PRELAUNCH_DATE)).toBe(true);
  });

  it("still detects a weekly digest on a hidden-date edition", () => {
    const digest = selectNewsletterEditions([
      drop({ drop_date: DIGEST_DATE, hide_display_date: true })
    ])[0];

    expect(digest.editionType).toBe("weekly_digest");
    // Its date is categorized internally and still hidden from the reader.
    expect(digest.hideDisplayDate).toBe(true);
    expect(
      editionDisplayDate(
        { drop_date: digest.drop_date, hide_display_date: digest.hideDisplayDate },
        "en"
      )
    ).toBeNull();
  });

  it("never loses the stored date", () => {
    const hidden = selectNewsletterEditions([drop({ hide_display_date: true })])[0];

    expect(hidden.drop_date).toBe(PRELAUNCH_DATE);
  });
});

describe("archive items inherit the edition's display rule", () => {
  it("hides the date on an item served by a hidden-date edition", () => {
    const archived = item({ hide_display_date: true });

    expect(editionDisplayDate(archived, "en")).toBeNull();
    // The item still knows which edition it came from, and when.
    expect(archived.drop_date).toBe(PRELAUNCH_DATE);
  });

  it("keeps the date on an item from a normal edition", () => {
    expect(editionDisplayDate(item(), "fr")).toBe(formatDropDate(PRELAUNCH_DATE, "fr"));
  });
});

describe("every edition date on screen goes through the display rule", () => {
  const featuresRoot = join(__dirname, "..");

  /**
   * A screen that formats `drop_date` itself would print the date of a
   * prelaunch edition again, and nothing would catch it. The only place allowed
   * to format an edition's own date is the helper that checks the flag first.
   */
  function collectScreens(root: string): string[] {
    const files: string[] = [];

    for (const entry of readdirSync(root)) {
      const path = join(root, entry);

      if (statSync(path).isDirectory()) {
        files.push(...collectScreens(path));
        continue;
      }

      if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
        files.push(path);
      }
    }

    return files;
  }

  it("finds no screen formatting an edition date directly", () => {
    const helper = join(featuresRoot, "today", "contentCopy.ts");
    const offenders = collectScreens(featuresRoot).filter((file) => {
      // contentCopy is the helper: it is the one place that formats an
      // edition's date, and it checks the flag before doing so.
      if (file === helper) {
        return false;
      }

      const source = readFileSync(file, "utf8");

      // `published_date` is the article's own factual date and stays formatted
      // directly — it is source metadata, not the edition's display date.
      return /formatDropDate\(\s*(\w+\.)?(drop_date|dropDate)/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it("still formats the article's own publication date directly", () => {
    const reader = readFileSync(
      join(featuresRoot, "today", "readers", "NewsletterReader.tsx"),
      "utf8"
    );

    expect(reader).toMatch(/formatDropDate\(item\.published_date/);
  });
});
