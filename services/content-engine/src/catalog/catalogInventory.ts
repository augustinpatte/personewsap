import { type DailyDropSlot, type MiniCaseTopicId, type UserDailyDropPreference } from "../domain.js";
import type { EditorialSection } from "../generation/modelRouting.js";
import { selectDailyDropItemsForUser, type StoredContentSelection } from "../scheduler/dailyDropBuilder.js";

/**
 * Using the editorial inventory in a daily edition.
 *
 * bootstrapCatalog builds an inventory of Business Stories and Mini Cases in FR
 * and EN ahead of time; the daily job used to assign only from what it had just
 * generated, so that inventory could never reach a reader. This module is the
 * bridge, and it enforces the three rules that make the reuse safe:
 *
 *  1. The newsletter is never reused. It is the part of an edition that must be
 *     about today, so it is generated on every run, whatever the inventory
 *     holds. Business Stories and Mini Cases are explanatory pieces whose value
 *     does not decay in days — those are the ones prepared in advance.
 *  2. A reader never sees the same content item twice. Reuse is only sound if
 *     the pool offered to a reader excludes everything already assigned to
 *     them, on any earlier date.
 *  3. Nothing is generated that the inventory already covers. That is where the
 *     API cost saving comes from: with stock on the shelf, the run asks the
 *     model for the newsletter only.
 *
 * Pure by design: the decisions are testable without a database, and the I/O
 * stays in the repository and the job.
 */

/** Slots an edition may fill from stock rather than from today's generation. */
export const REUSABLE_INVENTORY_SLOTS: DailyDropSlot[] = ["business_story", "mini_case"];

const SLOT_TO_SECTION: Record<string, EditorialSection> = {
  business_story: "business_story",
  mini_case: "mini_case"
};

/**
 * Reuse is on unless an operator turns it off. With an empty inventory this
 * changes nothing at all — the pool is just the freshly generated items, which
 * is exactly today's behaviour — so the default cannot break a run, and the
 * catalog cannot be generated and then silently forgotten.
 */
export function isCatalogReuseEnabled(
  value: string | undefined = process.env.REUSE_CATALOG_INVENTORY
): boolean {
  return value !== "false";
}

/**
 * Which sections this run has to generate.
 *
 * The newsletter always. A reusable slot only when the inventory cannot cover
 * it: `minimumPerSlot` is the headroom below which we top the stock back up,
 * so the shelf never empties mid-week.
 */
export function resolveDailyGenerationSections(input: {
  /** Inventory items available for this language, already filtered to unused. */
  inventory: StoredContentSelection[];
  /** Slots at least one reader actually wants today. */
  requestedSlots: DailyDropSlot[];
  minimumPerSlot?: number;
  reuseEnabled?: boolean;
}): EditorialSection[] {
  const sections: EditorialSection[] = ["newsletter_article"];
  const minimum = Math.max(1, input.minimumPerSlot ?? 1);
  const reuseEnabled = input.reuseEnabled ?? true;

  for (const slot of REUSABLE_INVENTORY_SLOTS) {
    const section = SLOT_TO_SECTION[slot];

    if (!section || !input.requestedSlots.includes(slot)) {
      continue;
    }

    if (!reuseEnabled) {
      sections.push(section);
      continue;
    }

    const available = input.inventory.filter((entry) => entry.item.slot === slot).length;

    if (available < minimum) {
      sections.push(section);
    }
  }

  return sections;
}

/**
 * The pool a reader may be assigned from: what was generated today, plus the
 * inventory that is eligible for reuse.
 *
 * De-duplicated by content item id, because an inventory item generated on an
 * earlier run and an item stored by this run are the same row when a section
 * was regenerated.
 */
export function buildAssignmentPool(input: {
  fresh: StoredContentSelection[];
  inventory: StoredContentSelection[];
  reuseEnabled?: boolean;
}): StoredContentSelection[] {
  if (input.reuseEnabled === false) {
    return input.fresh;
  }

  const pool: StoredContentSelection[] = [];
  const seen = new Set<string>();

  for (const entry of [...input.fresh, ...input.inventory]) {
    if (seen.has(entry.content_item_id)) {
      continue;
    }

    seen.add(entry.content_item_id);
    pool.push(entry);
  }

  return pool;
}

/**
 * The same pool, minus everything this reader has already received.
 *
 * This is what keeps reuse from becoming repetition: an inventory item is
 * reusable across readers, never across editions of the same reader.
 */
export function excludeAlreadyAssignedForUser(
  pool: StoredContentSelection[],
  alreadyAssignedContentItemIds: ReadonlySet<string>
): StoredContentSelection[] {
  if (alreadyAssignedContentItemIds.size === 0) {
    return pool;
  }

  return pool.filter((entry) => !alreadyAssignedContentItemIds.has(entry.content_item_id));
}

export type CatalogReuseDiagnostics = {
  reuseEnabled: boolean;
  inventoryAvailable: number;
  inventoryBySlot: Record<string, number>;
  sectionsGenerated: EditorialSection[];
  sectionsSkipped: EditorialSection[];
};

export type CatalogAwareGenerationPlan = {
  sections: EditorialSection[];
  miniCaseProductTopics: MiniCaseTopicId[];
  reusableInventory: StoredContentSelection[];
  usersServedByInventory: number;
  usersNeedingBusinessStory: number;
  usersNeedingMiniCase: number;
  usersNeedingMiniCaseByTopic: Record<string, number>;
  requestedReusableSlots: DailyDropSlot[];
};

/** What the run did with the inventory, for the operator log and job health. */
export function describeCatalogReuse(input: {
  inventory: StoredContentSelection[];
  sections: EditorialSection[];
  reuseEnabled: boolean;
}): CatalogReuseDiagnostics {
  const inventoryBySlot: Record<string, number> = {};

  for (const entry of input.inventory) {
    inventoryBySlot[entry.item.slot] = (inventoryBySlot[entry.item.slot] ?? 0) + 1;
  }

  const allSections: EditorialSection[] = [
    "newsletter_article",
    "business_story",
    "mini_case"
  ];

  return {
    reuseEnabled: input.reuseEnabled,
    inventoryAvailable: input.inventory.length,
    inventoryBySlot,
    sectionsGenerated: input.sections,
    sectionsSkipped: allSections.filter((section) => !input.sections.includes(section))
  };
}

/**
 * Plans generation for the real daily job from the users who will actually be
 * assigned today. Global inventory size is not enough: a full shelf can still
 * be exhausted for a reader who has already seen every item on it.
 */
export function planCatalogAwareGeneration(input: {
  preferences: UserDailyDropPreference[];
  inventory: StoredContentSelection[];
  assignedByUser: ReadonlyMap<string, ReadonlySet<string>>;
  dropDate: string;
  reuseEnabled?: boolean;
}): CatalogAwareGenerationPlan {
  const reuseEnabled = input.reuseEnabled ?? true;
  const requestedReusableSlots = requestedReusableSlotsFor(input.preferences);

  if (!reuseEnabled) {
    return {
      sections: resolveDailyGenerationSections({
        inventory: [],
        requestedSlots: ["newsletter", ...requestedReusableSlots],
        reuseEnabled: false
      }),
      miniCaseProductTopics: selectedMiniCaseTopics(input.preferences),
      reusableInventory: [],
      usersServedByInventory: 0,
      usersNeedingBusinessStory: input.preferences.filter((preference) => preference.modules.business_story).length,
      usersNeedingMiniCase: input.preferences.filter((preference) => preference.modules.mini_case).length,
      usersNeedingMiniCaseByTopic: countNeededMiniCaseTopics(input.preferences, input.dropDate),
      requestedReusableSlots
    };
  }

  const sections: EditorialSection[] = ["newsletter_article"];
  const neededMiniCaseTopics = new Set<MiniCaseTopicId>();
  let usersServedByInventory = 0;
  let usersNeedingBusinessStory = 0;
  let usersNeedingMiniCase = 0;
  const usersNeedingMiniCaseByTopic: Record<string, number> = {};

  for (const preference of input.preferences) {
    const unseenInventory = excludeAlreadyAssignedForUser(
      input.inventory,
      input.assignedByUser.get(preference.user_id) ?? new Set<string>()
    );
    let servedByInventory = true;

    if (preference.modules.business_story) {
      const hasUnseenStory = unseenInventory.some((entry) => entry.item.slot === "business_story");
      if (!hasUnseenStory) {
        usersNeedingBusinessStory += 1;
        servedByInventory = false;
      }
    }

    if (preference.modules.mini_case) {
      const selection = selectDailyDropItemsForUser(
        {
          ...preference,
          modules: {
            newsletter: false,
            business_story: false,
            mini_case: true
          },
          topics: [],
          newsletter_article_count: 0
        },
        unseenInventory,
        { dropDate: input.dropDate }
      );

      if (!selection.items.some((item) => item.slot === "mini_case")) {
        usersNeedingMiniCase += 1;
        servedByInventory = false;
        const topicToReplenish = selection.diagnostics.miniCase.requestedTopicId ?? preference.mini_case_topics[0]?.topic_id;
        if (topicToReplenish) {
          neededMiniCaseTopics.add(topicToReplenish);
          usersNeedingMiniCaseByTopic[topicToReplenish] = (usersNeedingMiniCaseByTopic[topicToReplenish] ?? 0) + 1;
        }
      }
    }

    if (servedByInventory) {
      usersServedByInventory += 1;
    }
  }

  if (usersNeedingBusinessStory > 0 && requestedReusableSlots.includes("business_story")) {
    sections.push("business_story");
  }

  if (neededMiniCaseTopics.size > 0 && requestedReusableSlots.includes("mini_case")) {
    sections.push("mini_case");
  }

  return {
    sections,
    miniCaseProductTopics: [...neededMiniCaseTopics],
    reusableInventory: input.inventory,
    usersServedByInventory,
    usersNeedingBusinessStory,
    usersNeedingMiniCase,
    usersNeedingMiniCaseByTopic,
    requestedReusableSlots
  };
}

function requestedReusableSlotsFor(preferences: UserDailyDropPreference[]): DailyDropSlot[] {
  const slots: DailyDropSlot[] = [];
  if (preferences.some((preference) => preference.modules.business_story)) {
    slots.push("business_story");
  }
  if (preferences.some((preference) => preference.modules.mini_case)) {
    slots.push("mini_case");
  }
  return slots;
}

function selectedMiniCaseTopics(preferences: UserDailyDropPreference[]): MiniCaseTopicId[] {
  return [
    ...new Set(
      preferences
        .filter((preference) => preference.modules.mini_case)
        .flatMap((preference) =>
          [...preference.mini_case_topics]
            .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER))
            .map((topic) => topic.topic_id)
        )
    )
  ];
}

function countNeededMiniCaseTopics(
  preferences: UserDailyDropPreference[],
  dropDate: string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const preference of preferences) {
    if (!preference.modules.mini_case) {
      continue;
    }
    const selection = selectDailyDropItemsForUser(
      {
        ...preference,
        modules: { newsletter: false, business_story: false, mini_case: true },
        topics: [],
        newsletter_article_count: 0
      },
      [],
      { dropDate }
    );
    const topic = selection.diagnostics.miniCase.requestedTopicId ?? preference.mini_case_topics[0]?.topic_id;
    if (topic) {
      counts[topic] = (counts[topic] ?? 0) + 1;
    }
  }
  return counts;
}
