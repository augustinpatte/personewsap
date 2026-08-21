import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MINI_CASE_TOPIC_IDS,
  type Language,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import {
  DEFAULT_BUSINESS_STORY_COUNT,
  DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
  runBootstrapCatalog,
  type BootstrapCatalogOptions
} from "./bootstrapCatalog.js";
import {
  assessBusinessStoryCapacity,
  buildCanonicalCatalogPool,
  InsufficientCatalogSourceMaterialError
} from "./canonicalSourcePool.js";

/**
 * Source discovery is independent of output language.
 *
 * The bootstrap writes French first and English as its pair, and that used to
 * decide which events existed at all: the French version could only be built
 * from the French pool. A rich English day was fetched and then ignored. Ten
 * Business Stories were generated from a fifth of the available material and
 * all ten were rejected as the same handful of stories.
 *
 * A pair is one factual basis rendered twice. The basis is chosen from
 * everything the run fetched; the language it was written in is not part of the
 * decision. This is not "English content needs English sources" — it is the
 * opposite: quality and relevance decide, language does not.
 */

const DROP_DATE = "2026-08-20";

let articleCounter = 0;

function article(input: {
  url: string;
  language: Language;
  topic: TopicId;
  title?: string;
}): RankedArticle {
  articleCounter += 1;

  return {
    url: input.url,
    // Never derived from the URL: a title carrying one is refused as leaked
    // source text, which is the validator doing its job.
    title: input.title ?? `${input.topic} development number ${articleCounter}`,
    // URL-free: the deterministic generator builds its title from the
    // publisher, and a title carrying a URL is refused as leaked source text.
    publisher: `${input.language.toUpperCase()} desk ${articleCounter}`,
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

/** French pool with only a couple of usable events. */
function sparseFrenchPool(): RankedArticle[] {
  return [1, 2].map((index) =>
    article({ url: `https://fr.test/business/${index}`, language: "fr", topic: "business" })
  );
}

/** English pool with plenty. */
function richEnglishPool(count = 20): RankedArticle[] {
  const topics: TopicId[] = ["business", "finance", "tech_ai"];

  return Array.from({ length: count }, (_, index) =>
    article({
      url: `https://en.test/${index}`,
      language: "en",
      topic: topics[index % topics.length]
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
    runId: "canonical-pool-test",
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

describe("the canonical pool spans every requested language", () => {
  it("offers English events to a run whose first output language is French", () => {
    const pool = buildCanonicalCatalogPool(
      new Map<Language, RankedArticle[]>([
        ["fr", sparseFrenchPool()],
        ["en", richEnglishPool()]
      ])
    );

    expect(pool.diagnostics.byLanguage).toEqual({ fr: 2, en: 20 });
    expect(pool.articles).toHaveLength(22);
    expect(pool.articles.some((entry) => entry.language === "en")).toBe(true);
  });

  it("interleaves by rank so neither language is buried behind the other", () => {
    const pool = buildCanonicalCatalogPool(
      new Map<Language, RankedArticle[]>([
        ["fr", sparseFrenchPool()],
        ["en", richEnglishPool(3)]
      ])
    );

    expect(pool.articles.slice(0, 2).map((entry) => entry.language)).toEqual(["fr", "en"]);
  });

  it("counts one event once when it reaches both language pools", () => {
    const shared = article({ url: "https://shared.test/story", language: "en", topic: "business" });
    const pool = buildCanonicalCatalogPool(
      new Map<Language, RankedArticle[]>([
        ["fr", [shared, ...sparseFrenchPool()]],
        ["en", [shared]]
      ])
    );

    expect(pool.diagnostics.crossLanguageDuplicatesRemoved).toBe(1);
    expect(pool.articles.filter((entry) => entry.url === shared.url)).toHaveLength(1);
  });
});

describe("a pair is built from the best event, not the best French event", () => {
  it("lets an English source drive the French reference version", async () => {
    const { generator, calls } = recordingGenerator();

    await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0 }),
      {
        generator,
        // Nothing usable in French at all: without a combined pool this run
        // could not produce a single story.
        loadArticles: async (language: Language) =>
          language === "fr" ? [] : richEnglishPool()
      }
    );

    const [referenceCall] = calls;

    expect(referenceCall.language).toBe("fr");
    expect(referenceCall.articles.every((entry) => entry.language === "en")).toBe(true);
    expect(referenceCall.crossLanguageSources).toBe(true);
  });

  it("still lets a French source drive the pair", async () => {
    const { generator, calls } = recordingGenerator();

    await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0 }),
      {
        generator,
        loadArticles: async (language: Language) =>
          language === "fr"
            ? [1, 2, 3].map((index) =>
                article({ url: `https://fr.test/b/${index}`, language: "fr", topic: "business" })
              )
            : []
      }
    );

    expect(calls[0].articles.every((entry) => entry.language === "fr")).toBe(true);
  });

  it("gives the English half exactly the packet the French half cited", async () => {
    const { generator, calls } = recordingGenerator();

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0 }),
      {
        generator,
        loadArticles: async (language: Language) =>
          language === "fr" ? [] : richEnglishPool()
      }
    );

    const [reference] = output.entries[0].versions;
    const counterpartCall = calls[1];

    expect(counterpartCall.language).toBe("en");
    expect(counterpartCall.languagePair?.referenceItems[0].source_urls).toEqual(
      reference.item.source_urls
    );
  });

  it("does not send the counterpart back to the whole pool for a different story", async () => {
    const { generator, calls } = recordingGenerator();

    await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0 }),
      {
        generator,
        loadArticles: async (language: Language) =>
          language === "fr" ? [] : richEnglishPool()
      }
    );

    // The counterpart is not merely pinned by languagePair — it is handed
    // nothing else. Its packet IS the reference's sources, so there is no other
    // story in the room for it to drift onto.
    expect(calls[1].languagePair?.referenceItems).toHaveLength(1);
    expect(calls[1].articles.map((entry) => entry.url)).toEqual(
      calls[1].languagePair?.referenceItems[0].source_urls
    );
  });

  it("keeps both halves of the pair on one factual basis", async () => {
    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0 }),
      {
        generator: new StructuredContentGenerator(),
        loadArticles: async (language: Language) =>
          language === "fr" ? [] : richEnglishPool()
      }
    );

    const [fr, en] = output.entries[0].versions;

    expect(fr.language).toBe("fr");
    expect(en.language).toBe("en");
    expect(en.item.source_urls).toEqual(fr.item.source_urls);
  });
});

describe("Business Story capacity is checked before the first call", () => {
  it("counts distinct events, not articles", () => {
    const duplicated = article({ url: "https://en.test/x", language: "en", topic: "business" });
    const capacity = assessBusinessStoryCapacity({
      articles: [duplicated, duplicated, ...richEnglishPool(4)],
      topics: ["business", "finance", "tech_ai"],
      requested: 5
    });

    expect(capacity.availablePackets).toBe(5);
    expect(capacity.sufficient).toBe(true);
  });

  it("allows ten stories when French alone could not support them", async () => {
    const { generator, calls } = recordingGenerator();

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 10, miniCaseCountPerTopic: 0 }),
      {
        generator,
        loadArticles: async (language: Language) =>
          language === "fr" ? sparseFrenchPool() : richEnglishPool()
      }
    );

    // French alone offers two events; combined, the run is viable.
    expect(output.counts.businessStoryEntries).toBe(10);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("refuses before any Business Story call when even the widest window is short", async () => {
    const { generator, calls } = recordingGenerator();

    await expect(
      runBootstrapCatalog(options({ businessStoryCount: 10, miniCaseCountPerTopic: 0 }), {
        generator,
        loadArticles: async () => richEnglishPool(7)
      })
    ).rejects.toThrow(/insufficient_distinct_source_material/);

    // The point of the preflight: nothing was generated.
    expect(calls).toHaveLength(0);
  });

  it("reports the numbers an operator needs to act on", async () => {
    const error = await runBootstrapCatalog(
      options({ businessStoryCount: 10, miniCaseCountPerTopic: 0 }),
      {
        generator: new StructuredContentGenerator(),
        loadArticles: async () => richEnglishPool(7)
      }
    )
      .then(() => null)
      .catch((thrown: unknown) => thrown as InsufficientCatalogSourceMaterialError);

    expect(error).toBeInstanceOf(InsufficientCatalogSourceMaterialError);
    expect(error?.requestedBusinessStories).toBe(10);
    expect(error?.availableDistinctStoryPackets).toBe(7);
    expect(error?.catalogWindowDays).toBe(21);
    expect(error?.reason).toBe("insufficient_distinct_source_material");
  });

  it("widens the window only when the default week falls short", async () => {
    const requestedWindows: Array<number | undefined> = [];

    await runBootstrapCatalog(options({ businessStoryCount: 2, miniCaseCountPerTopic: 0 }), {
      generator: new StructuredContentGenerator(),
      loadArticles: async (language: Language, recencyDays) => {
        requestedWindows.push(recencyDays);
        return language === "fr" ? [] : richEnglishPool();
      }
    });

    // The rich pool satisfies the request at the default window, so the wider
    // one is never asked for.
    expect(requestedWindows.every((window) => window === undefined)).toBe(true);
  });

  it("asks for the wider window before giving up", async () => {
    const requestedWindows: Array<number | undefined> = [];

    await runBootstrapCatalog(options({ businessStoryCount: 10, miniCaseCountPerTopic: 0 }), {
      generator: new StructuredContentGenerator(),
      loadArticles: async (_language: Language, recencyDays) => {
        requestedWindows.push(recencyDays);
        return richEnglishPool(3);
      }
    }).catch(() => undefined);

    expect(requestedWindows).toContain(21);
  });

  it("does not run the preflight when no Business Story is requested", async () => {
    const output = await runBootstrapCatalog(
      options({
        businessStoryCount: 0,
        miniCaseCountPerTopic: 1,
        miniCaseTopics: ["finance_economy"]
      }),
      {
        generator: new StructuredContentGenerator(),
        loadArticles: async () => richEnglishPool(2)
      }
    );

    expect(output.counts.miniCaseEntries).toBe(1);
  });
});

describe("Mini Case diversity works over the combined pool", () => {
  it("spreads five cases across events from both languages", async () => {
    const output = await runBootstrapCatalog(
      options({
        businessStoryCount: 0,
        miniCaseCountPerTopic: 5,
        miniCaseTopics: ["finance_economy"]
      }),
      {
        generator: new StructuredContentGenerator(),
        loadArticles: async (language: Language) =>
          language === "fr"
            ? [article({ url: "https://fr.test/finance/1", language: "fr", topic: "finance" })]
            : [1, 2, 3, 4, 5, 6].map((index) =>
                article({ url: `https://en.test/finance/${index}`, language: "en", topic: "finance" })
              )
      }
    );

    expect(output.rejected).toEqual([]);
    expect(output.counts.miniCaseEntries).toBe(5);

    const usedSources = new Set(
      output.entries.flatMap((entry) =>
        entry.versions
          .filter((version) => version.language === "fr")
          .flatMap((version) => version.item.source_urls)
      )
    );

    // Five cases did not collapse onto the single French article.
    expect(usedSources.size).toBeGreaterThan(1);
  });
});

describe("the Newsletter keeps its own, language-specific selection", () => {
  const generator = readFileSync(join(__dirname, "..", "generation", "llmGenerator.ts"), "utf8");

  it("still restricts an ordinary generation to same-language sources", () => {
    expect(generator).toMatch(
      /request\.articles\.filter\(\(article\) => article\.language === request\.language\)/
    );
  });

  it("opens the packet only for a request that asks for it", () => {
    expect(generator).toMatch(/request\.crossLanguageSources === true/);
  });

  it("is never asked for by the daily job", () => {
    const dailyJob = readFileSync(join(__dirname, "..", "cli", "dailyJobTest.ts"), "utf8");

    expect(dailyJob).not.toMatch(/crossLanguageSources/);
    // And the Newsletter still asks the source layer for its own edition date.
    expect(dailyJob).toMatch(/since: options\.dropDate/);
  });

  it("keeps the J / J-1 / J-2 ladder untouched", () => {
    const fetcher = readFileSync(join(__dirname, "..", "sources", "rssFetcher.ts"), "utf8");

    expect(fetcher).toMatch(/FR_RECENCY_LADDER_DAYS = \[0, 1, 2\]/);
    expect(fetcher).not.toMatch(/crossLanguageSources|canonicalCatalogPool/);
  });
});
