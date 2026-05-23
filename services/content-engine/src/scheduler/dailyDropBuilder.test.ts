import { describe, expect, it } from "vitest";
import type {
  GeneratedContentItem,
  MiniCaseTopicId,
  TopicId,
  UserDailyDropPreference
} from "../domain.js";
import {
  selectDailyDropItemsForUser,
  type StoredContentSelection
} from "./dailyDropBuilder.js";

describe("selectDailyDropItemsForUser mini-case personalization", () => {
  it("selects the explicit finance mini-case topic even when finance is not a newsletter topic", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["law"], "finance_economy"),
      [miniCase("law", "law-mini-case"), miniCase("finance", "finance-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("finance-mini-case");
    expect(selection.diagnostics.miniCase.allowedTopicIds).toEqual(["finance_economy"]);
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("none");
  });

  it("selects the explicit law mini-case topic even when law is not a newsletter topic", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["finance"], "law_compliance"),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("law-mini-case");
    expect(selection.diagnostics.miniCase.allowedTopicIds).toEqual(["law_compliance"]);
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("none");
  });

  it("falls back deterministically within mini-case topics when selected mini-case content is missing", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithMiniCaseTopics(["business"], ["health_pharma", "finance_economy", "law_compliance"]),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBe("finance-mini-case");
    expect(selection.diagnostics.miniCase.allowedTopicIds).toEqual(["health_pharma", "finance_economy", "law_compliance"]);
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("selected_topic_content_missing");
  });

  it("does not pick a mini-case from newsletter topics when no mini-case topic is selected", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["finance"], null),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBeUndefined();
    expect(selection.diagnostics.miniCase.allowedTopicIds).toEqual([]);
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("missing_mini_case_topic_preferences");
  });

  it("does not pick an unrelated mini-case outside the user's mini-case topics", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["business"], "health_pharma"),
      [miniCase("finance", "finance-mini-case"), miniCase("law", "law-mini-case")]
    );

    expect(selectedMiniCaseId(selection.items)).toBeUndefined();
    expect(selection.diagnostics.miniCase.allowedTopicIds).toEqual(["health_pharma"]);
    expect(selection.diagnostics.miniCase.fallbackReason).toBe("no_mini_case_for_allowed_topics");
  });
});

describe("selectDailyDropItemsForUser newsletter personalization", () => {
  it("only selects newsletter articles from newsletter topic preferences", () => {
    const selection = selectDailyDropItemsForUser(
      preferenceWithTopics(["sport_business", "finance", "tech_ai"], "law_compliance"),
      [
        newsletter("engineering", "engineering-newsletter"),
        newsletter("finance", "finance-newsletter"),
        newsletter("tech_ai", "ai-newsletter")
      ]
    );

    expect(selection.items.filter((item) => item.slot === "newsletter")).toEqual([
      { contentItemId: "finance-newsletter", slot: "newsletter", position: 0 },
      { contentItemId: "ai-newsletter", slot: "newsletter", position: 1 }
    ]);
    expect(selection.diagnostics.newsletter.selectedTopicIds).toEqual([
      "sport_business",
      "finance",
      "tech_ai"
    ]);
    expect(selection.diagnostics.newsletter.assignedItems.map((item) => item.topicId)).toEqual([
      "finance",
      "tech_ai"
    ]);
  });
});

function selectedMiniCaseId(selection: Array<{ contentItemId: string; slot: string }>) {
  return selection.find((item) => item.slot === "mini_case")?.contentItemId;
}

function preferenceWithTopics(
  topicIds: TopicId[],
  miniCaseTopicId: MiniCaseTopicId | null
): UserDailyDropPreference {
  return {
    user_id: "test-user",
    language: "en",
    goal: "understand_world",
    frequency: "daily",
    newsletter_article_count: topicIds.length,
    modules: {
      newsletter: true,
      business_story: true,
      mini_case: true
    },
    mini_case_topics: miniCaseTopicId
      ? [{ topic_id: miniCaseTopicId, position: 1 }]
      : [],
    topics: topicIds.map((topicId, index) => ({
      topic_id: topicId,
      articles_count: 1,
      position: index + 1
    }))
  };
}

function preferenceWithMiniCaseTopics(
  newsletterTopicIds: TopicId[],
  miniCaseTopicIds: MiniCaseTopicId[]
): UserDailyDropPreference {
  return {
    ...preferenceWithTopics(newsletterTopicIds, miniCaseTopicIds[0] ?? null),
    mini_case_topics: miniCaseTopicIds.map((topicId, index) => ({
      topic_id: topicId,
      position: index + 1
    }))
  };
}

function newsletter(topic: TopicId, contentItemId: string): StoredContentSelection {
  return {
    content_item_id: contentItemId,
    item: {
      content_type: "newsletter_article",
      slot: "newsletter",
      language: "en",
      title: `${topic} newsletter`,
      topic,
      source_urls: [],
      version: 1,
      published_date: "2026-05-21",
      summary: "Short useful summary.",
      why_it_matters: "It affects what ambitious students should watch.",
      body_md: "A short newsletter body."
    } satisfies GeneratedContentItem
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
