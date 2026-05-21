import { describe, expect, it } from "vitest";
import type {
  GeneratedContentItem,
  TopicId,
  UserDailyDropPreference
} from "../domain.js";
import {
  selectDailyDropItemsForUser,
  type StoredContentSelection
} from "./dailyDropBuilder.js";

describe("selectDailyDropItemsForUser mini-case personalization", () => {
  it("selects the explicit finance mini-case topic when available", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["law", "finance"], "finance"),
      [miniCase("law", "law-mini-case"), miniCase("finance", "finance-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("finance-mini-case");
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("none");
  });

  it("falls back deterministically to the next enabled topic when selected mini-case content is missing", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["medicine", "finance", "law"], "medicine"),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("finance-mini-case");
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("selected_topic_content_missing");
  });

  it("does not pick an unrelated mini-case outside the user's enabled topics", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["medicine"], "medicine"),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBeUndefined();
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("no_mini_case_for_allowed_topics");
  });
});

function selectedMiniCaseId(selection: Array<{ contentItemId: string; slot: string }>) {
  return selection.find((item) => item.slot === "mini_case")?.contentItemId;
}

function preferenceWithTopics(
  topicIds: TopicId[],
  miniCaseTopicId: TopicId | null
): UserDailyDropPreference {
  return {
    user_id: "test-user",
    language: "en",
    goal: "understand_world",
    frequency: "daily",
    newsletter_article_count: 1,
    mini_case_topic_id: miniCaseTopicId,
    topics: topicIds.map((topicId, index) => ({
      topic_id: topicId,
      articles_count: 1,
      position: index + 1
    }))
  };
}

function miniCase(topic: TopicId, contentItemId: string): StoredContentSelection {
  return {
    content_item_id: contentItemId,
    item: {
      content_type: "mini_case",
      slot: "mini_case",
      language: "en",
      title: `${topic} mini-case`,
      topic,
      source_urls: [],
      version: 1,
      difficulty: "medium",
      context: "A focused case context.",
      challenge: "Choose the next move.",
      constraints: ["Use only the supplied facts."],
      question: "What should the team do?",
      expected_reasoning: ["Name the trade-off."],
      sample_answer: "Act after checking the strongest signal.",
      body_md: "A short mini-case body."
    } satisfies GeneratedContentItem
  };
}
