import { describe, expect, it } from "vitest";

import { MINI_CASE_TOPIC_IDS, TOPIC_IDS, type RankedArticle, type TopicId } from "../domain.js";
import { StructuredContentGenerator } from "./structuredGenerator.js";
import { parseDailyJobOptions } from "../cli/dailyJobTest.js";

// Builds one ranked article per topic so the generator has source material; the
// point of these tests is that GENERATION coverage is edition-driven, not driven
// by any user or by which topics happen to have sources.
function rankedArticle(topic: TopicId): RankedArticle {
  return {
    url: `https://example.com/${topic}/story`,
    title: `Story about ${topic}`,
    publisher: "Test Desk",
    author: null,
    published_at: "2026-06-24T08:00:00.000Z",
    retrieved_at: "2026-06-25T08:00:00.000Z",
    language: "en",
    summary: `A concrete development in ${topic} that a reader can reuse.`,
    body: `Body about ${topic}.`,
    sourceTopic: topic,
    credibility_score: 0.85,
    content_hash: `hash-${topic}`,
    normalized_url: `https://example.com/${topic}/story`,
    topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

const ALL_NEWSLETTER_TOPICS = [...TOPIC_IDS];

// The GenerationRequest type intentionally has no user field: the master catalog
// is produced purely from edition configuration. There is no way to pass user
// preferences into generation.
function catalogRequest(overrides: Partial<Parameters<StructuredContentGenerator["generateDailyDrop"]>[0]> = {}) {
  return {
    dropDate: "2026-06-25",
    language: "en" as const,
    articles: ALL_NEWSLETTER_TOPICS.map(rankedArticle),
    newsletterTopics: ALL_NEWSLETTER_TOPICS,
    newsletterArticleCount: ALL_NEWSLETTER_TOPICS.length,
    miniCaseProductTopics: [...MINI_CASE_TOPIC_IDS],
    ...overrides
  };
}

describe("master catalog generation (generation is edition-driven, not user-driven)", () => {
  it("generates one mini-case for every one of the 6 product topics, no user required", async () => {
    const payload = await new StructuredContentGenerator().generateDailyDrop(catalogRequest());
    const miniCaseTopics = payload.items
      .filter((item) => item.content_type === "mini_case")
      .map((item) => (item as Extract<typeof item, { content_type: "mini_case" }>).product_topic)
      .sort();

    expect(miniCaseTopics).toEqual([...MINI_CASE_TOPIC_IDS].sort());
  });

  it("generates a health_pharma mini-case even though no health_pharma user exists", async () => {
    // Only one product topic requested by the edition; still generated with zero users.
    const payload = await new StructuredContentGenerator().generateDailyDrop(
      catalogRequest({ miniCaseProductTopics: ["health_pharma"] })
    );
    const miniCases = payload.items.filter((item) => item.content_type === "mini_case");

    expect(miniCases).toHaveLength(1);
    expect((miniCases[0] as Extract<(typeof miniCases)[number], { content_type: "mini_case" }>).product_topic).toBe("health_pharma");
  });

  it("generates a mini-case for a product topic that has no matching source (engineering_operations)", async () => {
    const payload = await new StructuredContentGenerator().generateDailyDrop(
      // Only finance sources available; engineering_operations still produced via fallback.
      catalogRequest({ articles: [rankedArticle("finance")], miniCaseProductTopics: ["engineering_operations"] })
    );
    const miniCases = payload.items.filter((item) => item.content_type === "mini_case");

    expect(miniCases).toHaveLength(1);
    expect((miniCases[0] as Extract<(typeof miniCases)[number], { content_type: "mini_case" }>).product_topic).toBe("engineering_operations");
  });

  it("generates one newsletter article per editorial topic (complete catalog)", async () => {
    const payload = await new StructuredContentGenerator().generateDailyDrop(catalogRequest());
    const newsletterTopics = payload.items
      .filter((item) => item.content_type === "newsletter_article")
      .map((item) => item.topic);

    expect(newsletterTopics).toHaveLength(ALL_NEWSLETTER_TOPICS.length);
    expect(new Set(newsletterTopics)).toEqual(new Set(ALL_NEWSLETTER_TOPICS));
  });

  it("produces the full catalog regardless of how many users will be assigned (0 users is valid)", async () => {
    // The generator never receives users or a USER_LIMIT; assignment happens later.
    const payload = await new StructuredContentGenerator().generateDailyDrop(catalogRequest());

    expect(payload.items.filter((item) => item.content_type === "newsletter_article")).toHaveLength(8);
    expect(payload.items.filter((item) => item.content_type === "mini_case")).toHaveLength(6);
    expect(payload.items.filter((item) => item.content_type === "business_story")).toHaveLength(1);
    expect(payload.items.filter((item) => item.content_type === "concept")).toHaveLength(1);
  });
});

describe("daily-job catalog sizing is user-independent (USER_LIMIT only limits assignment)", () => {
  it("newsletterArticleCount defaults to one per editorial topic", () => {
    const options = parseDailyJobOptions([]);
    expect(options.newsletterArticleCount).toBe(options.topics.length);
    expect(options.topics.length).toBe(TOPIC_IDS.length);
  });

  it("USER_LIMIT does not change the generated newsletter count", () => {
    const previous = process.env.USER_LIMIT;
    try {
      process.env.USER_LIMIT = "1";
      const limited = parseDailyJobOptions([]);
      process.env.USER_LIMIT = "25";
      const wide = parseDailyJobOptions([]);
      expect(limited.newsletterArticleCount).toBe(limited.topics.length);
      expect(wide.newsletterArticleCount).toBe(limited.newsletterArticleCount);
    } finally {
      if (previous === undefined) {
        delete process.env.USER_LIMIT;
      } else {
        process.env.USER_LIMIT = previous;
      }
    }
  });
});
