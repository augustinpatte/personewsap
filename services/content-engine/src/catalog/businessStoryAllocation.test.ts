import { describe, expect, it } from "vitest";

import { MINI_CASE_TOPIC_IDS, type Language, type RankedArticle, type TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import {
  allocateBusinessStorySourcePackets,
  countBusinessStoryEventsByTopic
} from "./businessStoryAllocation.js";
import {
  DEFAULT_BUSINESS_STORY_COUNT,
  DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
  runBootstrapCatalog,
  type BootstrapCatalogOptions
} from "./bootstrapCatalog.js";
import { assessBusinessStoryCapacity } from "./canonicalSourcePool.js";

/**
 * Ten Business Stories must be ten different stories.
 *
 * The capacity preflight proved a rich day was available — 38 French and 107
 * English articles, well over the ten distinct events required — and the run
 * still produced zero Business Stories. Proving that ten events EXIST does
 * nothing if all ten calls are then handed the same broad packet: the most
 * attractive story in it is still the most attractive story on the tenth call.
 *
 * So the allocation is made here, once, before generation: one distinct primary
 * event per entry, its own supporting coverage, and the pair built on that same
 * packet in both languages. `editorialIdentities` is unchanged and still runs
 * afterwards — this narrows what the model is offered, that refuses what the
 * model returns.
 */

const DROP_DATE = "2026-08-20";
const BUSINESS_TOPICS: TopicId[] = ["business", "finance", "tech_ai"];

let counter = 0;

function article(input: { url: string; language: Language; topic: TopicId; title?: string }): RankedArticle {
  counter += 1;

  return {
    url: input.url,
    title: input.title ?? `${input.topic} development number ${counter}`,
    publisher: `${input.language.toUpperCase()} desk ${counter}`,
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language: input.language,
    summary: "A concrete development with a mechanism and one measurable signal.",
    body: "Body.",
    sourceTopic: input.topic,
    canonicalTopic: input.topic,
    credibility_score: 0.9,
    content_hash: input.url,
    normalized_url: input.url,
    topic: input.topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

/** A day with plenty of genuinely different events. */
function richPool(count = 20, language: Language = "en"): RankedArticle[] {
  return Array.from({ length: count }, (_, index) =>
    article({
      url: `https://${language}.test/${counter}-${index}`,
      language,
      topic: BUSINESS_TOPICS[index % BUSINESS_TOPICS.length]
    })
  );
}

function options(overrides: Partial<BootstrapCatalogOptions> = {}): BootstrapCatalogOptions {
  return {
    dropDate: DROP_DATE,
    languages: ["fr", "en"],
    businessStoryCount: DEFAULT_BUSINESS_STORY_COUNT,
    miniCaseCountPerTopic: DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
    miniCaseTopics: [...MINI_CASE_TOPIC_IDS],
    persist: false,
    contentStatus: "review",
    runId: "allocation-test",
    useLlm: false,
    productionStrict: false,
    ...overrides
  };
}

function recordingGenerator(): { generator: ContentGenerator; calls: GenerationRequest[] } {
  const inner = new StructuredContentGenerator();
  const calls: GenerationRequest[] = [];

  return {
    calls,
    generator: {
      generateDailyDrop: async (request: GenerationRequest) => {
        calls.push(request);
        return inner.generateDailyDrop(request);
      }
    } as ContentGenerator
  };
}

describe("one distinct primary event per Business Story", () => {
  it("allocates ten different primary events when the pool holds ten", () => {
    const packets = allocateBusinessStorySourcePackets({
      articles: richPool(20),
      topics: BUSINESS_TOPICS,
      count: 10
    });

    expect(packets).toHaveLength(10);

    const primaries = packets.map((packet) => packet.primary.url);
    expect(new Set(primaries).size).toBe(10);
  });

  it("gives each entry its own packet, and both languages the same one", async () => {
    const { generator, calls } = recordingGenerator();

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 4, miniCaseCountPerTopic: 0 }),
      {
        generator,
        loadArticles: async (language: Language) => (language === "fr" ? [] : richPool(20))
      }
    );

    expect(output.rejected).toEqual([]);
    expect(output.counts.businessStoryEntries).toBe(4);

    // Four entries, each generated twice: reference then counterpart.
    const referenceCalls = calls.filter((call) => !call.languagePair);
    const counterpartCalls = calls.filter((call) => Boolean(call.languagePair));
    expect(referenceCalls).toHaveLength(4);
    expect(counterpartCalls).toHaveLength(4);

    const primaries = referenceCalls.map((call) => call.articles[0].url);
    expect(new Set(primaries).size).toBe(4);

    // Each pair stands on one factual packet: the counterpart is handed exactly
    // the sources its reference cited, and nothing besides.
    for (const entry of output.entries) {
      const [reference, counterpart] = entry.versions;
      expect(counterpart.item.source_urls).toEqual(reference.item.source_urls);
    }
  });

  it("never spends one event on two entries", async () => {
    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 6, miniCaseCountPerTopic: 0 }),
      {
        generator: new StructuredContentGenerator(),
        loadArticles: async (language: Language) => (language === "fr" ? [] : richPool(20))
      }
    );

    const primaries = output.entries.map((entry) => entry.versions[0].item.source_urls[0]);

    expect(primaries).toHaveLength(6);
    expect(new Set(primaries).size).toBe(6);
  });

  it("moves past an attractive source instead of picking it again", () => {
    // The same story syndicated to three outlets, then three real events. The
    // syndicated cluster is worth exactly one entry, not three.
    const syndicated = [1, 2, 3].map((index) =>
      article({
        url: `https://wire.test/syndicated-${index}`,
        language: "en",
        topic: "business",
        title: "Regulator blocks the Loctite adhesive merger"
      })
    );
    const distinct = [
      article({ url: "https://en.test/a", language: "en", topic: "finance", title: "Central bank holds rates steady" }),
      article({ url: "https://en.test/b", language: "en", topic: "tech_ai", title: "Chipmaker opens a new fab" })
    ];

    const packets = allocateBusinessStorySourcePackets({
      articles: [...syndicated, ...distinct],
      topics: BUSINESS_TOPICS
    });

    expect(packets).toHaveLength(3);
    expect(packets[0].primary.url).toBe("https://wire.test/syndicated-1");
    // The other two syndicated copies support the first entry; they never become
    // a primary of their own.
    expect(packets[0].supporting.map((entry) => entry.url)).toEqual([
      "https://wire.test/syndicated-2",
      "https://wire.test/syndicated-3"
    ]);
    expect(packets.slice(1).map((packet) => packet.primary.url)).toEqual([
      "https://en.test/a",
      "https://en.test/b"
    ]);
  });

  it("lets a supporting source serve two entries only when the events differ", () => {
    const first = article({
      url: "https://en.test/ftc-1",
      language: "en",
      topic: "business",
      title: "FTC blocks the Henkel adhesives merger"
    });
    const second = article({
      url: "https://en.test/ftc-2",
      language: "en",
      topic: "business",
      title: "FTC opens a Henkel pricing inquiry"
    });
    const context = article({
      url: "https://en.test/ftc-context",
      language: "en",
      topic: "business",
      title: "How FTC reviews reshaped Henkel deal terms"
    });

    const packets = allocateBusinessStorySourcePackets({
      articles: [first, second, context],
      topics: BUSINESS_TOPICS
    });

    // Three different events: no cluster merged them.
    expect(packets.map((packet) => packet.primary.url)).toEqual([first.url, second.url, context.url]);

    // The shared entities put them in each other's packets as supporting
    // material, which is the legitimate way a source appears twice.
    expect(packets[0].supporting.map((entry) => entry.url)).toContain(context.url);
    expect(packets[1].supporting.map((entry) => entry.url)).toContain(context.url);
  });

  it("keeps a packet bounded rather than handing over the whole pool", () => {
    const packets = allocateBusinessStorySourcePackets({
      articles: richPool(30),
      topics: BUSINESS_TOPICS,
      count: 3
    });

    for (const packet of packets) {
      expect(packet.articles[0]).toEqual(packet.primary);
      expect(packet.articles.length).toBeLessThanOrEqual(4);
    }
  });
});

describe("the preflight promises only what the allocator can deliver", () => {
  it("agrees with the allocator on how many stories are possible", () => {
    for (const pool of [richPool(7), richPool(12), richPool(20)]) {
      const capacity = assessBusinessStoryCapacity({
        articles: pool,
        topics: BUSINESS_TOPICS,
        requested: 10
      });
      const allocated = allocateBusinessStorySourcePackets({
        articles: pool,
        topics: BUSINESS_TOPICS
      });

      expect(capacity.availablePackets).toBe(allocated.length);

      if (capacity.sufficient) {
        expect(
          allocateBusinessStorySourcePackets({ articles: pool, topics: BUSINESS_TOPICS, count: 10 })
        ).toHaveLength(10);
      }
    }
  });

  it("counts a syndicated day for what it is, and refuses before any call", async () => {
    const { generator, calls } = recordingGenerator();
    const syndicated = [1, 2, 3, 4, 5].map((index) =>
      article({
        url: `https://wire.test/copy-${index}`,
        language: "en",
        topic: "business",
        title: "One and the same syndicated business story"
      })
    );

    await expect(
      runBootstrapCatalog(options({ businessStoryCount: 3, miniCaseCountPerTopic: 0 }), {
        generator,
        loadArticles: async () => syndicated
      })
    ).rejects.toThrow(/insufficient_distinct_source_material/);

    expect(calls).toHaveLength(0);
  });

  it("reports distinct events per topic", () => {
    const byTopic = countBusinessStoryEventsByTopic({
      articles: richPool(9),
      topics: BUSINESS_TOPICS
    });

    expect(byTopic).toEqual({ business: 3, finance: 3, tech_ai: 3 });
  });
});

describe("the second-line guards stay in place", () => {
  it("still refuses a repeated editorial identity after allocation", async () => {
    // Distinct events in, one identity out: the model ignored the material it
    // was given. Allocation cannot see this coming; the identity guard can.
    const inner = new StructuredContentGenerator();
    const generator = {
      generateDailyDrop: async (request: GenerationRequest) => {
        const payload = await inner.generateDailyDrop(request);

        return {
          ...payload,
          items: payload.items.map((item) =>
            item.content_type === "business_story" && item.editorial_memory
              ? {
                  ...item,
                  editorial_memory: {
                    ...item.editorial_memory,
                    main_company: "One Company",
                    key_mechanism: "one mechanism"
                  }
                }
              : item
          )
        };
      }
    } as ContentGenerator;

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 3, miniCaseCountPerTopic: 0 }),
      {
        generator,
        loadArticles: async (language: Language) => (language === "fr" ? [] : richPool(20))
      }
    );

    expect(output.counts.businessStoryEntries).toBe(1);
    expect(output.rejected.map((entry) => entry.reason)).toEqual([
      "duplicate_editorial_identity",
      "duplicate_editorial_identity"
    ]);
  });

  it("logs each rejection as it happens, with the reason", async () => {
    const progress: Array<{ message: string; details: Record<string, unknown> }> = [];
    const inner = new StructuredContentGenerator();
    const generator = {
      generateDailyDrop: async (request: GenerationRequest) => {
        const payload = await inner.generateDailyDrop(request);

        if (request.languagePair) {
          return payload;
        }

        // A URL the entry was never given: refused, and the refusal must be
        // visible even if the run later dies.
        return {
          ...payload,
          items: payload.items.map((item) => ({ ...item, source_urls: ["https://invented.test/story"] }))
        };
      }
    } as ContentGenerator;

    await runBootstrapCatalog(options({ businessStoryCount: 2, miniCaseCountPerTopic: 0 }), {
      generator,
      loadArticles: async (language: Language) => (language === "fr" ? [] : richPool(20)),
      onProgress: (message, details) => progress.push({ message, details })
    });

    const rejections = progress.filter((entry) => entry.message === "catalog entry rejected");

    expect(rejections).toHaveLength(2);
    expect(rejections[0].details).toMatchObject({
      content_type: "business_story",
      index: 0,
      reason: "validation_failed"
    });
    expect(String(rejections[0].details.entry_id)).toContain("business-story-01");
    expect(String(rejections[0].details.details)).toContain("outside the approved material");
  });

  it("persists an accepted Business Story straight away", async () => {
    const writes: Array<{ language: Language; entryId: string }> = [];

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 2, miniCaseCountPerTopic: 0, persist: true }),
      {
        generator: new StructuredContentGenerator(),
        repository: {
          assertPersistenceAvailable: () => undefined,
          listCatalogEntryVersions: async () => [],
          listBusinessStoryMemoryContext: async () => ({ recentStories: [] }),
          listMiniCaseMemoryContext: async () => ({ recentOverall: [] }),
          storeDailyPayload: async (input: {
            payload: { language: Language };
            metadata?: Record<string, unknown>;
          }) => {
            writes.push({
              language: input.payload.language,
              entryId: String(input.metadata?.catalog_entry_id ?? "unknown")
            });

            return [{ content_item_id: `written-${writes.length}`, reused_existing_content_item: false }];
          }
        } as never,
        loadArticles: async (language: Language) => (language === "fr" ? [] : richPool(20))
      }
    );

    expect(output.rejected).toEqual([]);
    expect(output.counts.businessStoryEntries).toBe(2);
    // Two entries, two languages each, written as they were accepted.
    expect(writes).toHaveLength(4);
    expect(new Set(writes.map((write) => write.entryId)).size).toBe(2);
  });
});
