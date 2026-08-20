import { describe, expect, it } from "vitest";

import type { LibraryDropSummary, LibraryItemSummary } from "../library/libraryTypes";
import {
  matchesTitleOrDate,
  parseArchiveQuery,
  normalizeSearchText,
  searchArchiveItems,
  selectArchiveItems,
  selectNewsletterEditions
} from "./archiveSelectors";

function makeItem(overrides: Partial<LibraryItemSummary>): LibraryItemSummary {
  return {
    id: "item-1",
    drop_id: "drop-1",
    drop_date: "2026-08-14",
    hide_display_date: false,
    content_type: "newsletter_article",
    language: "en",
    title: "Untitled",
    topic: "business",
    source_count: 1,
    is_saved: false,
    is_completed: false,
    ...overrides
  };
}

function makeDrop(
  dropId: string,
  dropDate: string,
  items: LibraryItemSummary[]
): LibraryDropSummary {
  return {
    drop_id: dropId,
    drop_date: dropDate,
    hide_display_date: false,
    language: "en",
    title: "Daily drop",
    item_count: items.length,
    topics: ["business"],
    completed_item_count: items.filter((item) => item.is_completed).length,
    saved_item_count: 0,
    items
  };
}

describe("selectNewsletterEditions", () => {
  it("groups by edition date, most recent first, newsletter articles only", () => {
    const drops = [
      makeDrop("d1", "2026-08-10", [
        makeItem({ id: "a1", drop_id: "d1", drop_date: "2026-08-10" }),
        makeItem({
          id: "s1",
          drop_id: "d1",
          drop_date: "2026-08-10",
          hide_display_date: false,
          content_type: "business_story"
        })
      ]),
      makeDrop("d2", "2026-08-14", [
        makeItem({
          id: "a2",
          drop_id: "d2",
          drop_date: "2026-08-14",
          hide_display_date: false,
          is_completed: true
        }),
        makeItem({ id: "a3", drop_id: "d2", drop_date: "2026-08-14" })
      ])
    ];

    const editions = selectNewsletterEditions(drops);

    expect(editions.map((edition) => edition.drop_date)).toEqual([
      "2026-08-14",
      "2026-08-10"
    ]);
    expect(editions[0].articleCount).toBe(2);
    expect(editions[0].readCount).toBe(1);
    expect(editions[1].articles.map((item) => item.id)).toEqual(["a1"]);
  });

  it("identifies the Sunday edition as a weekly digest", () => {
    const editions = selectNewsletterEditions([
      makeDrop("d1", "2026-08-16", [
        makeItem({ id: "a1", drop_id: "d1", drop_date: "2026-08-16" })
      ]),
      makeDrop("d2", "2026-08-14", [
        makeItem({ id: "a2", drop_id: "d2", drop_date: "2026-08-14" })
      ])
    ]);

    expect(editions[0].editionType).toBe("weekly_digest");
    expect(editions[1].editionType).toBe("daily");
  });

  it("keeps legacy concepts readable as extras without making them a module", () => {
    const editions = selectNewsletterEditions([
      makeDrop("d1", "2026-08-10", [
        makeItem({ id: "a1", drop_id: "d1", drop_date: "2026-08-10" }),
        makeItem({
          id: "c1",
          drop_id: "d1",
          drop_date: "2026-08-10",
          hide_display_date: false,
          content_type: "key_concept"
        })
      ])
    ]);

    expect(editions[0].articles.map((item) => item.id)).toEqual(["a1"]);
    expect(editions[0].extras.map((item) => item.id)).toEqual(["c1"]);
  });
});

describe("selectArchiveItems", () => {
  it("flattens one content type across editions, most recent first", () => {
    const drops = [
      makeDrop("d1", "2026-08-10", [
        makeItem({
          id: "s1",
          drop_date: "2026-08-10",
          hide_display_date: false,
          content_type: "business_story",
          title: "Old story"
        })
      ]),
      makeDrop("d2", "2026-08-14", [
        makeItem({
          id: "s2",
          drop_date: "2026-08-14",
          hide_display_date: false,
          content_type: "business_story",
          title: "New story"
        }),
        makeItem({ id: "a1", drop_date: "2026-08-14" })
      ])
    ];

    const stories = selectArchiveItems(drops, "business_story");

    expect(stories.map((item) => item.id)).toEqual(["s2", "s1"]);

    const cases = selectArchiveItems(drops, "mini_case");
    expect(cases).toEqual([]);
  });
});

describe("title + date search", () => {
  const item = makeItem({
    title: "Renault mise sur l'électrique",
    drop_date: "2026-05-12"
  });

  it("matches by title, accent- and case-insensitive", () => {
    expect(matchesTitleOrDate(item, "renault", "fr")).toBe(true);
    expect(matchesTitleOrDate(item, "ÉLECTRIQUE", "fr")).toBe(true);
    expect(matchesTitleOrDate(item, "electrique", "fr")).toBe(true);
    expect(matchesTitleOrDate(item, "tesla", "fr")).toBe(false);
  });

  it("matches by localized date and by ISO date", () => {
    expect(matchesTitleOrDate(item, "12 mai", "fr")).toBe(true);
    expect(matchesTitleOrDate(item, "mai 2026", "fr")).toBe(true);
    expect(matchesTitleOrDate(item, "may 12", "en")).toBe(true);
    expect(matchesTitleOrDate(item, "2026-05-12", "fr")).toBe(true);
    expect(matchesTitleOrDate(item, "juin", "fr")).toBe(false);
  });

  it("requires every token to match (title + date combined)", () => {
    expect(matchesTitleOrDate(item, "renault mai", "fr")).toBe(true);
    expect(matchesTitleOrDate(item, "renault juin", "fr")).toBe(false);
  });

  it("returns everything for an empty query", () => {
    const items = [item, makeItem({ id: "x", title: "Other" })];

    expect(searchArchiveItems(items, "   ", "fr")).toHaveLength(2);
    expect(searchArchiveItems(items, "other", "fr").map((entry) => entry.id)).toEqual([
      "x"
    ]);
  });
});

describe("normalizeSearchText", () => {
  it("strips diacritics and lowercases", () => {
    expect(normalizeSearchText("Économie à Paris")).toBe("economie a paris");
  });
});

describe("parseArchiveQuery", () => {
  it("keeps a plain title query as text with no period", () => {
    expect(parseArchiveQuery("renault electrique", "fr")).toEqual({
      from: null,
      toExclusive: null,
      text: "renault electrique"
    });
  });

  it("turns a year into a one-year period", () => {
    expect(parseArchiveQuery("2026", "fr")).toEqual({
      from: "2026-01-01",
      toExclusive: "2027-01-01",
      text: ""
    });
  });

  it("understands an ISO month and an ISO day", () => {
    expect(parseArchiveQuery("2026-05", "en")).toEqual({
      from: "2026-05-01",
      toExclusive: "2026-06-01",
      text: ""
    });
    expect(parseArchiveQuery("2026-05-12", "en")).toEqual({
      from: "2026-05-12",
      toExclusive: "2026-05-13",
      text: ""
    });
  });

  it("understands month names in both languages, with a year", () => {
    expect(parseArchiveQuery("mai 2026", "fr")).toEqual({
      from: "2026-05-01",
      toExclusive: "2026-06-01",
      text: ""
    });
    expect(parseArchiveQuery("may 2026", "en")).toEqual({
      from: "2026-05-01",
      toExclusive: "2026-06-01",
      text: ""
    });
    // A reader whose app is in French can still type an English month.
    expect(parseArchiveQuery("august 2026", "fr").from).toBe("2026-08-01");
  });

  it("understands a day with a month name", () => {
    expect(parseArchiveQuery("12 mai 2026", "fr")).toEqual({
      from: "2026-05-12",
      toExclusive: "2026-05-13",
      text: ""
    });
  });

  it("handles a slashed date", () => {
    expect(parseArchiveQuery("12/05/2026", "fr")).toEqual({
      from: "2026-05-12",
      toExclusive: "2026-05-13",
      text: ""
    });
  });

  it("splits a combined title and period query", () => {
    const plan = parseArchiveQuery("renault mai 2026", "fr");

    expect(plan.from).toBe("2026-05-01");
    expect(plan.toExclusive).toBe("2026-06-01");
    expect(plan.text).toBe("renault");
  });

  it("rolls a December period into the next year", () => {
    expect(parseArchiveQuery("2026-12", "en")).toEqual({
      from: "2026-12-01",
      toExclusive: "2027-01-01",
      text: ""
    });
  });

  it("keeps a bare day number as text, since it names no period on its own", () => {
    expect(parseArchiveQuery("12", "fr")).toEqual({
      from: null,
      toExclusive: null,
      text: "12"
    });
  });
});
