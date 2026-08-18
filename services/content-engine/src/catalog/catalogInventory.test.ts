import { describe, expect, it } from "vitest";

import type { StoredContentSelection } from "../scheduler/dailyDropBuilder.js";
import { selectDailyDropItemsForUser } from "../scheduler/dailyDropBuilder.js";
import {
  buildAssignmentPool,
  describeCatalogReuse,
  excludeAlreadyAssignedForUser,
  isCatalogReuseEnabled,
  resolveDailyGenerationSections
} from "./catalogInventory.js";

/**
 * The bridge between the prepared catalog and a reader's edition.
 *
 * bootstrap-catalog builds inventory but never creates daily drops, and the
 * daily job used to assign only from what it had just generated — so 10
 * Business Stories and 30 Mini Cases in FR and EN would have sat unreachable.
 * These tests are the proof that the stock is actually consumable, that a
 * reader never gets the same item twice, and that having stock removes the
 * model call instead of adding one.
 */

function inventoryItem(
  id: string,
  slot: "business_story" | "mini_case",
  overrides: Partial<StoredContentSelection["item"]> = {}
): StoredContentSelection {
  return {
    content_item_id: id,
    item: {
      content_type: slot,
      slot,
      language: "fr",
      title: `Item ${id}`,
      topic: "business",
      source_urls: [`https://example.test/${id}`],
      product_topic: slot === "mini_case" ? "finance_economy" : null,
      ...overrides
    }
  };
}

describe("which sections a run has to generate", () => {
  it("always generates the newsletter, whatever the inventory holds", () => {
    const sections = resolveDailyGenerationSections({
      inventory: [inventoryItem("bs-1", "business_story"), inventoryItem("mc-1", "mini_case")],
      requestedSlots: ["newsletter", "business_story", "mini_case"]
    });

    // The newsletter is the part of an edition that has to be about today.
    expect(sections).toEqual(["newsletter_article"]);
  });

  it("generates a reusable section only when the shelf is empty", () => {
    const sections = resolveDailyGenerationSections({
      inventory: [inventoryItem("bs-1", "business_story")],
      requestedSlots: ["newsletter", "business_story", "mini_case"]
    });

    expect(sections).toEqual(["newsletter_article", "mini_case"]);
  });

  it("generates everything when there is no inventory at all", () => {
    // Today's behaviour, unchanged, which is what makes this safe to enable
    // before the catalog exists.
    expect(
      resolveDailyGenerationSections({
        inventory: [],
        requestedSlots: ["newsletter", "business_story", "mini_case"]
      })
    ).toEqual(["newsletter_article", "business_story", "mini_case"]);
  });

  it("tops the shelf back up below the configured headroom", () => {
    expect(
      resolveDailyGenerationSections({
        inventory: [inventoryItem("bs-1", "business_story")],
        requestedSlots: ["newsletter", "business_story"],
        minimumPerSlot: 3
      })
    ).toEqual(["newsletter_article", "business_story"]);
  });

  it("generates everything when reuse is switched off", () => {
    expect(
      resolveDailyGenerationSections({
        inventory: [inventoryItem("bs-1", "business_story"), inventoryItem("mc-1", "mini_case")],
        requestedSlots: ["newsletter", "business_story", "mini_case"],
        reuseEnabled: false
      })
    ).toEqual(["newsletter_article", "business_story", "mini_case"]);
  });

  it("never generates a section nobody wants", () => {
    expect(
      resolveDailyGenerationSections({ inventory: [], requestedSlots: ["newsletter"] })
    ).toEqual(["newsletter_article"]);
  });
});

describe("the pool a reader is assigned from", () => {
  it("holds both this run's items and the inventory", () => {
    const pool = buildAssignmentPool({
      fresh: [inventoryItem("fresh-1", "business_story")],
      inventory: [inventoryItem("stock-1", "mini_case")]
    });

    expect(pool.map((entry) => entry.content_item_id)).toEqual(["fresh-1", "stock-1"]);
  });

  it("lists an item once even when it is in both", () => {
    const pool = buildAssignmentPool({
      fresh: [inventoryItem("shared-1", "business_story")],
      inventory: [inventoryItem("shared-1", "business_story")]
    });

    expect(pool).toHaveLength(1);
  });

  it("is just the fresh items when reuse is off", () => {
    const pool = buildAssignmentPool({
      fresh: [inventoryItem("fresh-1", "business_story")],
      inventory: [inventoryItem("stock-1", "mini_case")],
      reuseEnabled: false
    });

    expect(pool.map((entry) => entry.content_item_id)).toEqual(["fresh-1"]);
  });
});

describe("a reader never receives the same item twice", () => {
  it("removes everything already assigned to them", () => {
    const pool = [
      inventoryItem("bs-1", "business_story"),
      inventoryItem("bs-2", "business_story"),
      inventoryItem("mc-1", "mini_case")
    ];

    expect(
      excludeAlreadyAssignedForUser(pool, new Set(["bs-1"])).map((e) => e.content_item_id)
    ).toEqual(["bs-2", "mc-1"]);
  });

  it("leaves the pool alone for a reader with no history", () => {
    const pool = [inventoryItem("bs-1", "business_story")];

    expect(excludeAlreadyAssignedForUser(pool, new Set())).toBe(pool);
  });

  it("is what stops a repeat when the inventory is reused across editions", () => {
    const preference = {
      user_id: "user-1",
      language: "fr" as const,
      modules: { newsletter: false, business_story: true, mini_case: false },
      topics: [],
      mini_case_topics: [],
      newsletter_article_count: 0
    };
    const pool = [
      inventoryItem("bs-1", "business_story"),
      inventoryItem("bs-2", "business_story")
    ];

    const firstEdition = selectDailyDropItemsForUser(preference, pool, {
      dropDate: "2026-08-17"
    });
    const assigned = new Set(firstEdition.items.map((item) => item.contentItemId));

    const secondEdition = selectDailyDropItemsForUser(
      preference,
      excludeAlreadyAssignedForUser(pool, assigned),
      { dropDate: "2026-08-19" }
    );

    expect(firstEdition.items).toHaveLength(1);
    expect(secondEdition.items).toHaveLength(1);
    expect(secondEdition.items[0].contentItemId).not.toBe(
      firstEdition.items[0].contentItemId
    );
  });
});

describe("inventory items are assignable exactly like generated ones", () => {
  it("fills a business story slot from stock", () => {
    const selection = selectDailyDropItemsForUser(
      {
        user_id: "user-1",
        language: "fr",
        modules: { newsletter: false, business_story: true, mini_case: false },
        topics: [],
        mini_case_topics: [],
        newsletter_article_count: 0
      },
      [inventoryItem("stock-bs", "business_story")],
      { dropDate: "2026-08-17" }
    );

    expect(selection.items).toEqual([
      { contentItemId: "stock-bs", slot: "business_story", position: 0 }
    ]);
  });

  it("fills a mini case slot from stock, matching the reader's product topic", () => {
    const selection = selectDailyDropItemsForUser(
      {
        user_id: "user-1",
        language: "fr",
        modules: { newsletter: false, business_story: false, mini_case: true },
        topics: [],
        mini_case_topics: [{ topic_id: "finance_economy", position: 0 }],
        newsletter_article_count: 0
      },
      [inventoryItem("stock-mc", "mini_case")],
      { dropDate: "2026-08-17" }
    );

    expect(selection.items).toEqual([
      { contentItemId: "stock-mc", slot: "mini_case", position: 0 }
    ]);
    expect(selection.diagnostics.miniCase.selectedTopicId).toBe("finance_economy");
  });

  it("serves the same stock item to different readers", () => {
    const pool = [inventoryItem("stock-bs", "business_story")];
    const preference = (userId: string) => ({
      user_id: userId,
      language: "fr" as const,
      modules: { newsletter: false, business_story: true, mini_case: false },
      topics: [],
      mini_case_topics: [],
      newsletter_article_count: 0
    });

    // Reuse across readers is the whole point of an inventory.
    for (const userId of ["user-1", "user-2", "user-3"]) {
      const selection = selectDailyDropItemsForUser(preference(userId), pool, {
        dropDate: "2026-08-17"
      });

      expect(selection.items[0].contentItemId).toBe("stock-bs");
    }
  });
});

describe("the reuse switch", () => {
  it("is on unless explicitly disabled", () => {
    expect(isCatalogReuseEnabled(undefined)).toBe(true);
    expect(isCatalogReuseEnabled("true")).toBe(true);
    expect(isCatalogReuseEnabled("false")).toBe(false);
  });
});

describe("what the run reports", () => {
  it("says what was reused and what was generated", () => {
    const inventory = [
      inventoryItem("bs-1", "business_story"),
      inventoryItem("mc-1", "mini_case"),
      inventoryItem("mc-2", "mini_case")
    ];

    expect(
      describeCatalogReuse({
        inventory,
        sections: ["newsletter_article"],
        reuseEnabled: true
      })
    ).toEqual({
      reuseEnabled: true,
      inventoryAvailable: 3,
      inventoryBySlot: { business_story: 1, mini_case: 2 },
      sectionsGenerated: ["newsletter_article"],
      sectionsSkipped: ["business_story", "mini_case"]
    });
  });
});

describe("the future catalog is genuinely consumable", () => {
  it("covers 10 stories and 30 cases across FR and EN without generating either", () => {
    // The exact shape of the catalog about to be produced.
    const stories = Array.from({ length: 10 }, (_, index) =>
      inventoryItem(`bs-${index}`, "business_story")
    );
    const cases = Array.from({ length: 30 }, (_, index) =>
      inventoryItem(`mc-${index}`, "mini_case")
    );
    const inventory = [...stories, ...cases];

    expect(
      resolveDailyGenerationSections({
        inventory,
        requestedSlots: ["newsletter", "business_story", "mini_case"]
      })
    ).toEqual(["newsletter_article"]);

    // And a reader can be served 10 consecutive editions from that stock
    // without ever repeating a story.
    const preference = {
      user_id: "user-1",
      language: "fr" as const,
      modules: { newsletter: false, business_story: true, mini_case: false },
      topics: [],
      mini_case_topics: [],
      newsletter_article_count: 0
    };
    const assigned = new Set<string>();

    for (let edition = 0; edition < 10; edition += 1) {
      const selection = selectDailyDropItemsForUser(
        preference,
        excludeAlreadyAssignedForUser(inventory, assigned),
        { dropDate: `2026-09-${String(edition + 1).padStart(2, "0")}` }
      );

      expect(selection.items).toHaveLength(1);
      assigned.add(selection.items[0].contentItemId);
    }

    expect(assigned.size).toBe(10);
  });
});
