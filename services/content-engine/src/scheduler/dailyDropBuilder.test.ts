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
  it("selects a finance mini-case for a user with finance enabled when available", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["finance"]),
      [miniCase("law", "law-mini-case"), miniCase("finance", "finance-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("finance-mini-case");
  });

  it("selects a law mini-case for a user with law enabled when available", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["law"]),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("law-mini-case");
  });

  it("falls back to the first mini-case when no selected-topic mini-case exists", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["medicine"]),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("finance-mini-case");
  });
});

function selectedMiniCaseId(selection: Array<{ contentItemId: string; slot: string }>) {
  return selection.find((item) => item.slot === "mini_case")?.contentItemId;
}

function preferenceWithTopics(topicIds: TopicId[]): UserDailyDropPreference {
  return {
    user_id: "test-user",
    language: "en",
    goal: "understand_world",
    frequency: "daily",
    newsletter_article_count: 1,
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
