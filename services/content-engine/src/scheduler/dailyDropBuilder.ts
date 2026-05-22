import { miniCaseTopicToContentTopics } from "../domain.js";
import type {
  DailyDropPayload,
  DailyDropSlot,
  GeneratedContentItem,
  MiniCaseTopicId,
  TopicId,
  UserDailyDropPreference
} from "../domain.js";

export type StoredContentSelection = {
  item: GeneratedContentItem;
  content_item_id: string;
};

export type UserDailyDropSelection = {
  userId: string;
  items: Array<{
    contentItemId: string;
    slot: DailyDropSlot;
    position: number;
  }>;
  diagnostics: {
    newsletter: NewsletterSelectionDiagnostic;
    miniCase: MiniCaseSelectionDiagnostic;
  };
};

export type NewsletterSelectionDiagnostic = {
  selectedTopicIds: TopicId[];
  assignedItems: Array<{
    contentItemId: string;
    topicId: TopicId;
  }>;
};

export type MiniCaseSelectionDiagnostic = {
  requestedTopicId: MiniCaseTopicId | null;
  allowedTopicIds: MiniCaseTopicId[];
  selectedTopicId: MiniCaseTopicId | null;
  fallbackReason:
    | "none"
    | "missing_mini_case_topic_preferences"
    | "selected_topic_content_missing"
    | "no_mini_case_for_allowed_topics";
};

export function assembleDailyDropPayload(payload: DailyDropPayload): DailyDropPayload {
  return {
    ...payload,
    items: [...payload.items].sort(compareGeneratedItemsForAssignment)
  };
}

export function selectDailyDropItemsForUser(
  preference: UserDailyDropPreference,
  storedItems: StoredContentSelection[]
): UserDailyDropSelection {
  const selected: UserDailyDropSelection["items"] = [];
  const sortedTopicPlan = [...preference.topics].sort(compareTopicPreferences);
  const sortedStoredItems = sortStoredItemsForAssignment(storedItems);
  const newsletterAssignedItems: NewsletterSelectionDiagnostic["assignedItems"] = [];
  let newsletterPosition = 0;

  for (const topic of sortedTopicPlan) {
    const matches = sortedStoredItems.filter(
      (stored) => stored.item.content_type === "newsletter_article" && stored.item.topic === topic.topic_id
    );

    for (const match of matches.slice(0, topic.articles_count)) {
      if (newsletterPosition >= preference.newsletter_article_count) {
        break;
      }

      selected.push({
        contentItemId: match.content_item_id,
        slot: "newsletter",
        position: newsletterPosition
      });
      newsletterAssignedItems.push({
        contentItemId: match.content_item_id,
        topicId: topic.topic_id
      });
      newsletterPosition += 1;
    }
  }

  addFirstSlot(selected, sortedStoredItems, "business_story");
  const miniCaseDiagnostic = addMiniCaseSlot(selected, sortedStoredItems, preference);
  addFirstSlot(selected, sortedStoredItems, "concept");

  return {
    userId: preference.user_id,
    items: selected,
    diagnostics: {
      newsletter: {
        selectedTopicIds: sortedTopicPlan.map((topic) => topic.topic_id),
        assignedItems: newsletterAssignedItems
      },
      miniCase: miniCaseDiagnostic
    }
  };
}

function addFirstSlot(
  selected: UserDailyDropSelection["items"],
  storedItems: StoredContentSelection[],
  slot: Exclude<DailyDropSlot, "newsletter">,
  preferredTopicIds: TopicId[] = []
): void {
  const preferredTopics = new Set(preferredTopicIds);
  const preferredMatch =
    slot === "mini_case"
      ? storedItems.find(
          (stored) =>
            stored.item.slot === slot &&
            stored.item.topic !== null &&
            preferredTopics.has(stored.item.topic)
        )
      : null;
  const fallbackMatch = storedItems.find((stored) => stored.item.slot === slot);
  const match = preferredMatch ?? fallbackMatch;

  if (!match) {
    return;
  }

  selected.push({
    contentItemId: match.content_item_id,
    slot,
    position: 0
  });
}

function addMiniCaseSlot(
  selected: UserDailyDropSelection["items"],
  storedItems: StoredContentSelection[],
  preference: UserDailyDropPreference
): MiniCaseSelectionDiagnostic {
  const allowedTopicIds = getMiniCaseTopicIds(preference);
  const requestedTopicId = allowedTopicIds[0] ?? null;
  let fallbackReason: MiniCaseSelectionDiagnostic["fallbackReason"] = "none";

  if (allowedTopicIds.length === 0) {
    fallbackReason = "missing_mini_case_topic_preferences";
  }

  for (const topicId of allowedTopicIds) {
    const contentTopicIds = miniCaseTopicToContentTopics(topicId);
    const match = storedItems.find(
      (stored) =>
        stored.item.slot === "mini_case" &&
        stored.item.topic !== null &&
        contentTopicIds.includes(stored.item.topic)
    );

    if (!match) {
      continue;
    }

    selected.push({
      contentItemId: match.content_item_id,
      slot: "mini_case",
      position: 0
    });

    return {
      requestedTopicId,
      allowedTopicIds,
      selectedTopicId: topicId,
      fallbackReason:
        fallbackReason === "none" && requestedTopicId !== topicId
          ? "selected_topic_content_missing"
          : fallbackReason
    };
  }

  return {
    requestedTopicId,
    allowedTopicIds,
    selectedTopicId: null,
    fallbackReason:
      fallbackReason === "none" ? "no_mini_case_for_allowed_topics" : fallbackReason
  };
}

function getMiniCaseTopicIds(preference: UserDailyDropPreference): MiniCaseTopicId[] {
  return uniqueMiniCaseTopicIds(
    [...preference.mini_case_topics]
      .sort(compareMiniCaseTopicPreferences)
      .map((topic) => topic.topic_id)
  );
}

function uniqueMiniCaseTopicIds(topicIds: MiniCaseTopicId[]): MiniCaseTopicId[] {
  return [...new Set(topicIds)];
}

function compareMiniCaseTopicPreferences(
  left: { topic_id: MiniCaseTopicId; position: number | null },
  right: { topic_id: MiniCaseTopicId; position: number | null }
): number {
  return (
    (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
    left.topic_id.localeCompare(right.topic_id)
  );
}

function sortStoredItemsForAssignment(storedItems: StoredContentSelection[]): StoredContentSelection[] {
  return [...storedItems].sort((left, right) => {
    const itemComparison = compareGeneratedItemsForAssignment(left.item, right.item);

    if (itemComparison !== 0) {
      return itemComparison;
    }

    return left.content_item_id.localeCompare(right.content_item_id);
  });
}

function compareGeneratedItemsForAssignment(
  left: GeneratedContentItem,
  right: GeneratedContentItem
): number {
  return (
    slotOrder(left.slot) - slotOrder(right.slot) ||
    String(left.topic ?? "").localeCompare(String(right.topic ?? "")) ||
    left.title.localeCompare(right.title) ||
    left.source_urls.join("|").localeCompare(right.source_urls.join("|"))
  );
}

function compareTopicPreferences(
  left: { topic_id: TopicId; position: number | null },
  right: { topic_id: TopicId; position: number | null }
): number {
  return (
    (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
    left.topic_id.localeCompare(right.topic_id)
  );
}

function slotOrder(slot: DailyDropSlot): number {
  const order: Record<DailyDropSlot, number> = {
    newsletter: 0,
    business_story: 1,
    mini_case: 2,
    concept: 3
  };

  return order[slot];
}
