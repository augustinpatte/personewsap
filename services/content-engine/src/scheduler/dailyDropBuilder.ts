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
  let newsletterPosition = 0;

  for (const topic of topicPlan.sort((left, right) => (left.position ?? 99) - (right.position ?? 99))) {
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
  addFirstSlot(selected, storedItems, "mini_case");
  addFirstSlot(selected, storedItems, "concept");

  return {
    userId: preference.user_id,
    items: selected
  };
}

function addFirstSlot(
  selected: UserDailyDropSelection["items"],
  storedItems: StoredContentSelection[],
  slot: Exclude<DailyDropSlot, "newsletter">
): void {
  const match = storedItems.find((stored) => stored.item.slot === slot);
  if (!match) {
    return;
  }

  selected.push({
    contentItemId: match.content_item_id,
    slot,
    position: 0
  });
}

function defaultTopicPlan(): Array<{ topic_id: TopicId; articles_count: number; position: number }> {
  return [
    { topic_id: "business", articles_count: 1, position: 1 },
    { topic_id: "finance", articles_count: 1, position: 2 },
    { topic_id: "tech_ai", articles_count: 1, position: 3 }
  ];
}
