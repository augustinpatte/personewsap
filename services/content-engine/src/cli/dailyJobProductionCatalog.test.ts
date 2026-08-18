import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import { runDailyJob, type DailyJobRunOptions } from "./dailyJobTest.js";
import { runBootstrapCatalogCli } from "./bootstrapCatalog.js";
import type { Language, MiniCaseTopicId, RawArticle, UserDailyDropPreference } from "../domain.js";
import type { StoredContentSelection } from "../scheduler/dailyDropBuilder.js";
import { buildBusinessStoryMemoryContext } from "../generation/editorialMemory.js";
import { emptyMiniCaseMemoryContext } from "../miniCase/editorialMemory.js";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...OLD_ENV,
    DRY_RUN: "false",
    PRODUCTION_DAILY_JOB: "true",
    OPENAI_API_KEY: "test-openai",
    ANTHROPIC_API_KEY: "test-anthropic",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    LIVE_RSS: "true",
    LIVE_RSS_ONLY: "true",
    USE_LLM: "true"
  };
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...OLD_ENV };
});

describe("production runDailyJob catalog reuse", () => {
  it("uses published catalog inventory in the exact daily-job implementation", async () => {
    const repository = new FakeRepository({
      preferences: [
        preference("user-a", { miniCaseTopics: ["finance_economy"] }),
        preference("user-b", { miniCaseTopics: ["finance_economy"] })
      ],
      inventory: [
        inventoryItem("story-1", "business_story"),
        inventoryItem("case-finance-1", "mini_case", "finance_economy")
      ]
    });
    const generator = new StructuredContentGenerator();

    const output = await runDailyJob(options(), {
      repository: repository as never,
      generator,
      sourceFetcher: { fetch: async () => articles("en") },
      sourceConnectors: []
    });

    expect(output.status).toBe("completed");
    expect(repository.storeCalls).toHaveLength(1);
    expect(repository.storeCalls[0].items.map((item) => item.content_type)).toEqual([
      "newsletter_article",
      "newsletter_article"
    ]);
    expect(repository.assignments).toHaveLength(2);
    expect(repository.assignments.map((assignment) => assignment.itemIds.map((item) => item.contentItemId))).toEqual([
      expect.arrayContaining(["story-1", "case-finance-1"]),
      expect.arrayContaining(["story-1", "case-finance-1"])
    ]);
    expect(output.languages[0].learning.learning_sessions_generated).toBe(0);
    expect(output.languages[0].learning.learning_api_calls).toBe(0);
  });

  it("replenishes a business story when a reader has seen the global inventory", async () => {
    const repository = new FakeRepository({
      preferences: [preference("user-a", { miniCaseTopics: ["finance_economy"] })],
      inventory: [
        inventoryItem("story-1", "business_story"),
        inventoryItem("case-finance-1", "mini_case", "finance_economy")
      ],
      assignedByUser: new Map([["user-a", new Set(["story-1"])]])
    });

    await runDailyJob(options(), {
      repository: repository as never,
      generator: new StructuredContentGenerator(),
      sourceFetcher: { fetch: async () => articles("en") },
      sourceConnectors: []
    });

    expect(repository.storeCalls[0].items.some((item) => item.content_type === "business_story")).toBe(true);
    expect(repository.assignments[0].itemIds.map((item) => item.contentItemId)).not.toContain("story-1");
  });

  it("replenishes mini cases only for missing selected product topics", async () => {
    const repository = new FakeRepository({
      preferences: [preference("user-a", { miniCaseTopics: ["law_compliance"] })],
      inventory: [
        inventoryItem("story-1", "business_story"),
        inventoryItem("case-finance-1", "mini_case", "finance_economy")
      ]
    });

    await runDailyJob(options(), {
      repository: repository as never,
      generator: new StructuredContentGenerator(),
      sourceFetcher: { fetch: async () => articles("en") },
      sourceConnectors: []
    });

    const miniCases = repository.storeCalls[0].items.filter((item) => item.content_type === "mini_case");
    expect(miniCases).toHaveLength(1);
    expect(miniCases[0]).toMatchObject({ product_topic: "law_compliance" });
  });

  it("handles 5,000 reusable items without a correctness cap", async () => {
    const inventory = Array.from({ length: 5000 }, (_, index) =>
      inventoryItem(`story-${index}`, "business_story")
    );
    const repository = new FakeRepository({
      preferences: [preference("user-a", { modules: { newsletter: true, business_story: true, mini_case: false } })],
      inventory,
      assignedByUser: new Map([["user-a", new Set(inventory.slice(0, 4999).map((item) => item.content_item_id))]])
    });

    await runDailyJob(options(), {
      repository: repository as never,
      generator: new StructuredContentGenerator(),
      sourceFetcher: { fetch: async () => articles("en") },
      sourceConnectors: []
    });

    expect(repository.storeCalls[0].items.some((item) => item.content_type === "business_story")).toBe(false);
    expect(repository.assignments[0].itemIds.map((item) => item.contentItemId)).toContain("story-4999");
  });

  it("re-running the same edition does not treat current-day items as repeats", async () => {
    const repository = new FakeRepository({
      preferences: [preference("user-a", { miniCaseTopics: ["finance_economy"] })],
      inventory: [
        inventoryItem("story-1", "business_story"),
        inventoryItem("case-finance-1", "mini_case", "finance_economy")
      ],
      existingDrops: new Map([["user-a", { id: "drop-existing", status: "published", language: "en" }]])
    });

    await runDailyJob(options(), {
      repository: repository as never,
      generator: new StructuredContentGenerator(),
      sourceFetcher: { fetch: async () => articles("en") },
      sourceConnectors: []
    });

    expect(repository.assignments[0]).toMatchObject({
      dailyDropId: "drop-existing",
      existingDropUpdated: true
    });
    expect(repository.assignments[0].itemIds.map((item) => item.contentItemId)).toEqual(
      expect.arrayContaining(["story-1", "case-finance-1"])
    );
  });

  it("refuses to persist bootstrap catalog inventory while sample content is enabled", async () => {
    await expect(
      runBootstrapCatalogCli({
        dropDate: "2026-08-17",
        languages: ["en"],
        businessStoryCount: 1,
        miniCaseCountPerTopic: 1,
        miniCaseTopics: ["finance_economy"],
        persist: true,
        contentStatus: "review",
        runId: "bootstrap-catalog-test",
        useLlm: false,
        liveRss: false,
        liveRssOnly: false,
        sourceLimitPerTopic: 1
      })
    ).rejects.toThrow(/sample_articles would be enabled/);
  });
});

function options(): DailyJobRunOptions {
  return {
    mode: "daily-job",
    dropDate: "2026-08-17",
    languages: ["en"],
    topics: ["business"],
    newsletterArticleCount: 2,
    liveRss: true,
    liveRssOnly: true,
    useLlm: true,
    userLimit: null,
    contentStatus: "published",
    dryRun: false,
    testMode: false,
    logPrefix: "daily-job-test",
    productionConfirmed: true,
    strictAllLanguages: true,
    runId: "daily-job-test-run"
  };
}

function preference(
  userId: string,
  overrides: {
    modules?: UserDailyDropPreference["modules"];
    miniCaseTopics?: MiniCaseTopicId[];
  } = {}
): UserDailyDropPreference {
  return {
    user_id: userId,
    language: "en",
    goal: "become_sharper_daily",
    frequency: "daily",
    newsletter_article_count: 2,
    modules: overrides.modules ?? { newsletter: true, business_story: true, mini_case: true },
    topics: [{ topic_id: "business", articles_count: 2, position: 0 }],
    mini_case_topics: (overrides.miniCaseTopics ?? ["finance_economy"]).map((topicId, index) => ({
      topic_id: topicId,
      position: index
    }))
  };
}

function inventoryItem(
  id: string,
  slot: "business_story" | "mini_case",
  productTopic: MiniCaseTopicId = "finance_economy"
): StoredContentSelection {
  return {
    content_item_id: id,
    item: {
      content_type: slot,
      slot,
      language: "en",
      title: `Inventory ${id}`,
      topic: slot === "mini_case" ? "finance" : "business",
      source_urls: [`https://sources.example.test/${id}`],
      product_topic: slot === "mini_case" ? productTopic : null
    }
  };
}

function articles(language: Language): RawArticle[] {
  return [
    rawArticle("business", language, 1),
    rawArticle("business", language, 2),
    rawArticle("finance", language, 3),
    rawArticle("law", language, 4)
  ];
}

function rawArticle(topic: RawArticle["sourceTopic"], language: Language, index: number): RawArticle {
  return {
    url: `https://news.test/${language}/${topic}/${index}`,
    title: `${topic} source ${index}`,
    publisher: "News Test",
    author: null,
    published_at: "2026-08-17T06:00:00.000Z",
    retrieved_at: "2026-08-17T06:10:00.000Z",
    language,
    sourceTopic: topic,
    summary: `Useful source summary for ${topic} ${index}.`,
    body: `Useful source body for ${topic} ${index}.`
  };
}

class FakeRepository {
  readonly storeCalls: Array<{ items: Array<StoredContentSelection["item"]> }> = [];
  readonly assignments: Array<{
    dailyDropId: string;
    existingDropUpdated: boolean;
    itemIds: Array<{ contentItemId: string; slot: string; position: number }>;
  }> = [];

  constructor(
    private readonly fixtures: {
      preferences: UserDailyDropPreference[];
      inventory: StoredContentSelection[];
      assignedByUser?: Map<string, Set<string>>;
      existingDrops?: Map<string, { id: string; status: string; language: Language }>;
    }
  ) {}

  async startJobRun(): Promise<void> {}
  async completeJobRun(): Promise<void> {}
  async assertPersistTestSchemaReady(): Promise<void> {}
  async listBusinessStoryMemoryContext(): Promise<ReturnType<typeof buildBusinessStoryMemoryContext>> {
    return buildBusinessStoryMemoryContext({
      entries: [],
      dropDate: "2026-08-17",
      language: "en"
    });
  }
  async listMiniCaseMemoryContext(): Promise<ReturnType<typeof emptyMiniCaseMemoryContext>> {
    return emptyMiniCaseMemoryContext();
  }
  async listUserDailyDropPreferenceSelection(): Promise<{
    preferences: UserDailyDropPreference[];
    skippedUsers: [];
    profilesRead: number;
    userPreferencesRead: number;
    userTopicPreferencesRead: number;
    userMiniCasePreferencesRead: number;
  }> {
    return {
      preferences: this.fixtures.preferences,
      skippedUsers: [],
      profilesRead: this.fixtures.preferences.length,
      userPreferencesRead: this.fixtures.preferences.length,
      userTopicPreferencesRead: this.fixtures.preferences.length,
      userMiniCasePreferencesRead: this.fixtures.preferences.length
    };
  }
  async listReusableCatalogItems(): Promise<StoredContentSelection[]> {
    return this.fixtures.inventory;
  }
  async listAssignedContentItemIdsByUser(): Promise<Map<string, Set<string>>> {
    return this.fixtures.assignedByUser ?? new Map();
  }
  async storeDailyPayload(input: { payload: { items: Array<StoredContentSelection["item"]> } }): Promise<Array<StoredContentSelection & { reused_existing_content_item: boolean; dedup_key: null }>> {
    this.storeCalls.push({ items: input.payload.items as never });
    return input.payload.items.map((item, index) => ({
      item,
      content_item_id: `${item.content_type}-${item.topic ?? item.slot}-${index}`,
      reused_existing_content_item: false,
      dedup_key: null
    }));
  }
  async listDailyDropsForUsersOnDate(): Promise<Map<string, { id: string; status: string; language: Language }>> {
    return this.fixtures.existingDrops ?? new Map();
  }
  async createDailyDropForUserWithResult(input: {
    userId: string;
    itemIds: Array<{ contentItemId: string; slot: string; position: number }>;
  }): Promise<{
    dailyDropId: string;
    existingDropUpdated: boolean;
    linkedItems: number;
    staleItemsRemoved: number;
    duplicateInputItemsSkipped: number;
  }> {
    const existingDrop = this.fixtures.existingDrops?.get(input.userId);
    const dailyDropId = existingDrop?.id ?? `drop-${input.userId}`;
    this.assignments.push({
      dailyDropId,
      existingDropUpdated: Boolean(existingDrop),
      itemIds: input.itemIds
    });
    return {
      dailyDropId,
      existingDropUpdated: Boolean(existingDrop),
      linkedItems: input.itemIds.length,
      staleItemsRemoved: 0,
      duplicateInputItemsSkipped: 0
    };
  }
}
