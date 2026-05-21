import type {
  DailyDropPayload,
  DailyDropSlot,
  GeneratedContentItem,
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
    miniCase: MiniCaseSelectionDiagnostic;
  };
};

export type MiniCaseSelectionDiagnostic = {
  requestedTopicId: TopicId | null;
  selectedTopicId: TopicId | null;
  fallbackReason:
    | "none"
    | "missing_mini_case_topic_id"
    | "invalid_mini_case_topic_id"
    | "selected_topic_content_missing"
    | "no_mini_case_for_allowed_topics";
};

export function assembleDailyDropPayload(payload: DailyDropPayload): DailyDropPayload {
  const slotOrder: Record<DailyDropSlot, number> = {
    newsletter: 0,
    business_story: 1,
    mini_case: 2,
    concept: 3
  };

  return {
    ...payload,
    items: [...payload.items].sort((left, right) => slotOrder[left.slot] - slotOrder[right.slot])
  };
}

export function selectDailyDropItemsForUser(
  preference: UserDailyDropPreference,
  storedItems: StoredContentSelection[]
): UserDailyDropSelection {
  const selected: UserDailyDropSelection["items"] = [];
  const topicPlan = preference.topics.length > 0 ? preference.topics : defaultTopicPlan();
  const sortedTopicPlan = [...topicPlan].sort((left, right) => (left.position ?? 99) - (right.position ?? 99));
  let newsletterPosition = 0;

  for (const topic of sortedTopicPlan) {
    const matches = storedItems.filter(
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
      newsletterPosition += 1;
    }
  }

  addFirstSlot(selected, storedItems, "business_story");
  const miniCaseDiagnostic = addMiniCaseSlot(selected, storedItems, preference, sortedTopicPlan);
  addFirstSlot(selected, storedItems, "concept");

  return {
    userId: preference.user_id,
    items: selected,
    diagnostics: {
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
  preference: UserDailyDropPreference,
  sortedTopicPlan: Array<{ topic_id: TopicId; articles_count: number; position: number | null }>
): MiniCaseSelectionDiagnostic {
  const enabledTopicIds = sortedTopicPlan.map((topic) => topic.topic_id);
  const allowedTopicIds = buildMiniCaseTopicOrder(preference.mini_case_topic_id, enabledTopicIds);
  const requestedTopicId = preference.mini_case_topic_id;
  let fallbackReason: MiniCaseSelectionDiagnostic["fallbackReason"] = "none";

  if (!requestedTopicId) {
    fallbackReason = "missing_mini_case_topic_id";
  } else if (!enabledTopicIds.includes(requestedTopicId)) {
    fallbackReason = "invalid_mini_case_topic_id";
  }

  for (const topicId of allowedTopicIds) {
    const match = storedItems.find(
      (stored) => stored.item.slot === "mini_case" && stored.item.topic === topicId
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
      selectedTopicId: topicId,
      fallbackReason:
        fallbackReason === "none" && requestedTopicId !== topicId
          ? "selected_topic_content_missing"
          : fallbackReason
    };
  }

  return {
    requestedTopicId,
    selectedTopicId: null,
    fallbackReason:
      fallbackReason === "none" ? "no_mini_case_for_allowed_topics" : fallbackReason
  };
}

function buildMiniCaseTopicOrder(
  miniCaseTopicId: TopicId | null,
  enabledTopicIds: TopicId[]
): TopicId[] {
  if (miniCaseTopicId && enabledTopicIds.includes(miniCaseTopicId)) {
    return [
      miniCaseTopicId,
      ...enabledTopicIds.filter((topicId) => topicId !== miniCaseTopicId)
    ];
  }

  return enabledTopicIds;
}

function defaultTopicPlan(): Array<{ topic_id: TopicId; articles_count: number; position: number }> {
  return [
    { topic_id: "business", articles_count: 1, position: 1 },
    { topic_id: "finance", articles_count: 1, position: 2 },
    { topic_id: "tech_ai", articles_count: 1, position: 3 }
  ];
}
