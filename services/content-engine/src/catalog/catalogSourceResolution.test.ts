import { describe, expect, it } from "vitest";

import { MINI_CASE_TOPIC_IDS, type Language, type RankedArticle, type TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import { assertDailyPayloadSourcesArePersistable, mapContentItemSourceInserts } from "../storage/mappers.js";
import {
  DEFAULT_BUSINESS_STORY_COUNT,
  DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
  runBootstrapCatalog,
  type BootstrapCatalogOptions
} from "./bootstrapCatalog.js";
import {
  canonicalizeItemSourceUrls,
  resolveCatalogSourceArticles,
  sourceUrlKey
} from "./catalogSourceResolution.js";

/**
 * A catalog entry has ONE source universe.
 *
 * Generation was widened to the canonical cross-language pool while validation
 * and persistence still built their own set out of
 * `articlesByLanguage[version] + articlesByLanguage[reference]` — French twice,
 * for a French reference version. So a French entry grounded in an English FTC
 * press release generated, paired, validated, and then died on the write:
 *
 *   Cannot persist daily drop because 1 generated source URL(s) are missing
 *   source metadata: https://www.ftc.gov/news-events/news/press-releases/...
 *
 * The URL was approved material. Persistence was simply looking in a different
 * set. These tests pin the contract that replaced it: one approved set per
 * entry, one resolution rule, three stages reading it.
 *
 * The set stays closed. Nothing here lets a model-invented URL through.
 */

const DROP_DATE = "2026-08-20";

const FTC_URL =
  "https://www.ftc.gov/news-events/news/press-releases/2026/08/statement-ftc-win-blocking-loctite-liquid-nails-construction-adhesive-merger";

let counter = 0;

function article(input: {
  url: string;
  language: Language;
  topic: TopicId;
  title?: string;
  normalizedUrl?: string;
}): RankedArticle {
  counter += 1;

  return {
    url: input.url,
    title: input.title ?? `${input.topic} development number ${counter}`,
    publisher: `${input.language.toUpperCase()} desk ${counter}`,
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language: input.language,
    // Rich enough for the Business Story allocator to judge: a terse packet is
    // now skipped rather than waved through, and these fixtures stand for real
    // source material.
    summary:
      input.language === "fr"
        ? "L'opérateur a revu ses tarifs après une hausse des coûts unitaires, et la marge dépend du taux d'acceptation."
        : "The operator reset its pricing after unit costs moved, and the margin now depends on the acceptance rate.",
    body:
      input.language === "fr"
        ? "Le contrat porte sur 12 millions d'euros de capacité. La marge dépend du nombre de clients qui acceptent le nouveau tarif."
        : "The contract covers 12 million euros of capacity. The margin depends on how many customers accept the new tariff.",
    sourceTopic: input.topic,
    canonicalTopic: input.topic,
    credibility_score: 0.9,
    content_hash: input.url,
    normalized_url: input.normalizedUrl ?? input.url,
    topic: input.topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

function businessStory(sourceUrls: string[]) {
  return {
    content_type: "business_story" as const,
    slot: "business_story" as const,
    topic: "business" as TopicId,
    language: "fr" as Language,
    title: "Une leçon business",
    company_or_market: "Henkel",
    story_date: DROP_DATE,
    setup: "Mise en place.",
    tension: "Tension.",
    decision: "Décision.",
    outcome: "Résultat.",
    lesson: "Leçon.",
    body_md: "Corps.",
    source_urls: sourceUrls,
    version: 1
  };
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
    runId: "source-resolution-test",
    useLlm: false,
    productionStrict: false,
    ...overrides
  };
}

/** Records exactly what persistence was handed, per language version. */
function repositoryStub() {
  const writes: Array<{
    language: Language;
    entryId: string;
    citedUrls: string[];
    articleUrls: string[];
  }> = [];

  return {
    writes,
    repository: {
      assertPersistenceAvailable: () => undefined,
      listCatalogEntryVersions: async () => [],
      listBusinessStoryMemoryContext: async () => ({ recentStories: [] }),
      listMiniCaseMemoryContext: async () => ({ recentOverall: [] }),
      storeDailyPayload: async (input: {
        payload: { language: Language; items: Array<{ source_urls: string[] }> };
        articles: RankedArticle[];
        metadata?: Record<string, unknown>;
      }) => {
        // The real repository refuses here. Running the same assertion in the
        // stub is the point of these tests: the write must be admissible.
        assertDailyPayloadSourcesArePersistable({
          payload: input.payload as never,
          articles: input.articles
        });

        writes.push({
          language: input.payload.language,
          entryId: String(input.metadata?.catalog_entry_id ?? "unknown"),
          citedUrls: input.payload.items.flatMap((item) => item.source_urls),
          articleUrls: input.articles.map((entry) => entry.url)
        });

        return [{ content_item_id: `written-${writes.length}`, reused_existing_content_item: false }];
      }
    } as never
  };
}

/** Forces the reference version to cite a chosen URL, as a model would. */
function citingGenerator(url: string): { generator: ContentGenerator; calls: GenerationRequest[] } {
  const inner = new StructuredContentGenerator();
  const calls: GenerationRequest[] = [];

  return {
    calls,
    generator: {
      generateDailyDrop: async (request: GenerationRequest) => {
        calls.push(request);
        const payload = await inner.generateDailyDrop(request);

        if (request.languagePair) {
          return payload;
        }

        return {
          ...payload,
          items: payload.items.map((item) => ({
            ...item,
            source_urls: [url],
            body_md: `${item.body_md}\n\nSource: ${url}`
          }))
        };
      }
    } as ContentGenerator
  };
}

describe("a catalog entry resolves its sources from one approved set", () => {
  it("persists a French reference version citing an English source", async () => {
    const ftc = article({ url: FTC_URL, language: "en", topic: "business", title: "FTC blocks Loctite merger" });
    const { generator } = citingGenerator(FTC_URL);
    const { repository, writes } = repositoryStub();

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0, persist: true }),
      {
        generator,
        repository,
        loadArticles: async (language: Language) => (language === "fr" ? [] : [ftc])
      }
    );

    expect(output.rejected).toEqual([]);

    const french = writes.find((write) => write.language === "fr");
    expect(french?.citedUrls).toEqual([FTC_URL]);
    // The metadata persistence was missing before: the English article itself.
    expect(french?.articleUrls).toEqual([FTC_URL]);
  });

  it("persists an English counterpart citing that same French-sourced entry", async () => {
    const french = article({
      url: "https://fr.test/business/1",
      language: "fr",
      topic: "business",
      title: "Fusion bloquée par le régulateur"
    });
    const { generator } = citingGenerator(french.url);
    const { repository, writes } = repositoryStub();

    await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0, persist: true }),
      {
        generator,
        repository,
        loadArticles: async (language: Language) => (language === "fr" ? [french] : [])
      }
    );

    const english = writes.find((write) => write.language === "en");
    expect(english?.citedUrls).toEqual([french.url]);
    expect(english?.articleUrls).toEqual([french.url]);
  });

  it("persists an entry whose approved packet mixes French and English sources", () => {
    const approved = [
      article({ url: FTC_URL, language: "en", topic: "business" }),
      article({ url: "https://fr.test/business/9", language: "fr", topic: "business" })
    ];
    const item = businessStory([FTC_URL, "https://fr.test/business/9"]);
    const resolved = resolveCatalogSourceArticles(item, approved);

    expect(resolved.unresolved).toEqual([]);
    expect(resolved.articles.map((entry) => entry.language)).toEqual(["en", "fr"]);
    expect(() =>
      assertDailyPayloadSourcesArePersistable({
        payload: { items: [item] } as never,
        articles: resolved.articles
      })
    ).not.toThrow();
  });

  it("hands persistence metadata for every approved URL the entry cites", async () => {
    const ftc = article({ url: FTC_URL, language: "en", topic: "business" });
    const { generator } = citingGenerator(FTC_URL);
    const { repository, writes } = repositoryStub();

    await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0, persist: true }),
      {
        generator,
        repository,
        loadArticles: async (language: Language) => (language === "fr" ? [] : [ftc])
      }
    );

    expect(writes).toHaveLength(2);
    for (const write of writes) {
      for (const url of write.citedUrls) {
        expect(write.articleUrls).toContain(url);
      }
    }
  });
});

describe("the approved set stays closed", () => {
  it("refuses a URL the entry was never given", async () => {
    const approved = article({ url: "https://en.test/business/1", language: "en", topic: "business" });
    const { generator } = citingGenerator("https://invented.test/story-the-model-made-up");
    const { repository, writes } = repositoryStub();

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0, persist: true }),
      {
        generator,
        repository,
        loadArticles: async (language: Language) => (language === "fr" ? [] : [approved])
      }
    );

    expect(output.rejected).toHaveLength(1);
    expect(output.rejected[0].reason).toBe("validation_failed");
    expect(output.rejected[0].details.join(" ")).toContain("outside the approved material");
    // Refused before the write, not after it.
    expect(writes).toEqual([]);
  });

  it("does not accept a different article on an approved domain", () => {
    const approved = [article({ url: FTC_URL, language: "en", topic: "business" })];
    const sameDomainOtherArticle =
      "https://www.ftc.gov/news-events/news/press-releases/2026/08/ftc-sues-different-company-entirely";

    const resolved = resolveCatalogSourceArticles(businessStory([sameDomainOtherArticle]), approved);

    expect(resolved.articles).toEqual([]);
    expect(resolved.unresolved).toEqual([sameDomainOtherArticle]);
  });

  it("resolves a safe URL variant only when it maps to exactly one approved source", () => {
    const approved = [article({ url: FTC_URL, language: "en", topic: "business" })];
    const variant = `${FTC_URL}/?utm_source=newsletter&utm_campaign=daily#summary`;

    expect(resolveCatalogSourceArticles(businessStory([variant]), approved).articles.map((a) => a.url)).toEqual([
      FTC_URL
    ]);

    // Two different approved articles that canonicalize alike: the key is
    // ambiguous, so it resolves to neither rather than guessing between them.
    const ambiguous = [
      article({ url: "https://amb.test/a/story", language: "en", topic: "business" }),
      article({ url: "http://www.amb.test/a/story/", language: "en", topic: "business" })
    ];

    expect(sourceUrlKey(ambiguous[0].url)).toBe(sourceUrlKey(ambiguous[1].url));
    expect(resolveCatalogSourceArticles(businessStory(["https://amb.test/a/story?x=1"]), ambiguous).articles).toEqual(
      []
    );
    // An exact URL still resolves: ambiguity only disables the fuzzy path.
    expect(
      resolveCatalogSourceArticles(businessStory([ambiguous[1].url]), ambiguous).articles.map((a) => a.url)
    ).toEqual([ambiguous[1].url]);
  });

  it("rewrites a cited variant to the exact approved URL before persistence", () => {
    const approved = [article({ url: FTC_URL, language: "en", topic: "business" })];
    const item = businessStory([`${FTC_URL}?utm_medium=email`]);

    const canonicalized = canonicalizeItemSourceUrls(item, approved);

    expect(canonicalized.source_urls).toEqual([FTC_URL]);
    expect(() =>
      assertDailyPayloadSourcesArePersistable({
        payload: { items: [canonicalized] } as never,
        articles: approved
      })
    ).not.toThrow();

    // Unresolvable URLs are left exactly as generated, so the caller still sees
    // them for what they are and refuses the entry.
    const invented = canonicalizeItemSourceUrls(businessStory(["https://nope.test/x"]), approved);
    expect(invented.source_urls).toEqual(["https://nope.test/x"]);
  });
});

describe("validation and persistence read the same universe", () => {
  it("accepts in validation exactly what it can then persist", async () => {
    const ftc = article({ url: FTC_URL, language: "en", topic: "business" });
    const { generator } = citingGenerator(FTC_URL);
    const { repository, writes } = repositoryStub();

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 1, miniCaseCountPerTopic: 0, persist: true }),
      {
        generator,
        repository,
        loadArticles: async (language: Language) => (language === "fr" ? [] : [ftc])
      }
    );

    // Validation passed (no rejection) AND persistence accepted the same item.
    expect(output.rejected).toEqual([]);
    expect(writes.map((write) => write.language)).toEqual(["fr", "en"]);
    expect(output.counts.persistedContentItems).toBe(2);
  });

  it("links the content item to the source rows those URLs resolved to", () => {
    const approved = [
      article({ url: FTC_URL, language: "en", topic: "business" }),
      article({ url: "https://fr.test/business/7", language: "fr", topic: "business" })
    ];
    const item = businessStory([FTC_URL, "https://fr.test/business/7"]);
    const resolved = resolveCatalogSourceArticles(item, approved);
    const sourceIdsByUrl = new Map(resolved.articles.map((entry, index) => [entry.url, `source-${index + 1}`]));

    const links = mapContentItemSourceInserts({
      contentItemId: "content-1",
      sourceUrls: item.source_urls,
      sourceIdsByUrl
    });

    expect(links.map((link) => link.source_id)).toEqual(["source-1", "source-2"]);
    expect(links.every((link) => link.content_item_id === "content-1")).toBe(true);
  });

  it("stays idempotent when the same run is resumed", async () => {
    const ftc = article({ url: FTC_URL, language: "en", topic: "business" });
    const stored = [
      { entryId: "resume-run-business-story-01", language: "fr" as Language, contentItemId: "existing-fr" },
      { entryId: "resume-run-business-story-01", language: "en" as Language, contentItemId: "existing-en" }
    ];
    const { generator, calls } = citingGenerator(FTC_URL);
    const writes: string[] = [];

    const output = await runBootstrapCatalog(
      options({
        businessStoryCount: 1,
        miniCaseCountPerTopic: 0,
        persist: true,
        resume: true,
        runId: "resume-run"
      }),
      {
        generator,
        repository: {
          assertPersistenceAvailable: () => undefined,
          listCatalogEntryVersions: async () =>
            stored.map((record) => ({
              catalogEntryId: record.entryId,
              contentItemId: record.contentItemId,
              contentType: "business_story" as const,
              language: record.language,
              title: "An already stored business story",
              summary: "Stored summary.",
              bodyMd: "Stored body.",
              difficulty: null,
              status: "review",
              metadata: { source_urls: [FTC_URL] }
            })),
          listBusinessStoryMemoryContext: async () => ({ recentStories: [] }),
          listMiniCaseMemoryContext: async () => ({ recentOverall: [] }),
          storeDailyPayload: async () => {
            writes.push("write");
            return [{ content_item_id: "unexpected", reused_existing_content_item: false }];
          }
        } as never,
        loadArticles: async (language: Language) => (language === "fr" ? [] : [ftc])
      }
    );

    // Both versions already exist: no call, no write, nothing touched.
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
    expect(output.skipped).toHaveLength(2);
  });
});
