import { describe, expect, it, vi } from "vitest";

import type { Language, MiniCaseTopicId, RankedArticle, TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import { mapArticlesToSourceUpserts, mapSourceRowToRankedArticle } from "../storage/mappers.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";
import {
  runBootstrapCatalog,
  type BootstrapCatalogOptions
} from "./bootstrapCatalog.js";

/**
 * Resuming a half-written pair whose source has aged out of the feed.
 *
 * The launch catalog reached 79/80. One version was missing — the English half
 * of `…-mini-case-health_pharma-01` — and every resume refused it:
 *
 *   …health_pharma-01.fr.source_urls: cited source URL(s) outside the approved
 *   material for this entry
 *
 * The French half was fine. Its source was fine: a Franceinfo article, in
 * `sources`, linked to the French content item through `content_item_sources`,
 * cited in its body, persisted days earlier by this same pipeline. It had simply
 * fallen out of the RSS window, because a feed only ever offers its most recent
 * items — and the resume was asking today's canonical pool whether yesterday's
 * approved source still existed.
 *
 * The catalog window moves. A persisted link does not. For an already-persisted
 * reference the approved set is the relation the previous run wrote, read back
 * from the database.
 *
 * This is not a validation bypass. The LINK is the approval: a URL sitting in
 * the item's generated metadata with no row behind it is refused exactly as an
 * invented URL is.
 */

const RUN_ID = "launch-catalog-v1-20260820-173307";
const DROP_DATE = "2026-08-20";
const ENTRY_ID = `${RUN_ID}-mini-case-health_pharma-01`;

/** The real source that stranded the entry, fragment and all. */
const FRANCEINFO_URL =
  "https://www.franceinfo.fr/sante/vaccins/premiere-mondiale-l-espoir-d-un-vaccin-contre-le-cancer_8155433.html#xtor=RSS-3-%5Bgeneral%5D";

const FRANCEINFO_ROW = {
  url: FRANCEINFO_URL,
  title: "Première mondiale : l'espoir d'un vaccin contre le cancer",
  publisher: "Franceinfo",
  author: null,
  published_at: "2026-08-18T07:00:00.000Z",
  retrieved_at: "2026-08-20T09:00:00.000Z",
  language: "fr",
  credibility_score: 0.9,
  content_hash: "franceinfo-vaccin-cancer"
};

function rankedArticle(topic: TopicId, language: Language, index: number): RankedArticle {
  return {
    url: `https://sources.test/${language}/${topic}/${index}`,
    title: `${topic} development ${index} (${language})`,
    publisher: `${topic} desk ${index}`,
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language,
    summary: `A concrete ${topic} development number ${index} a reader can reuse.`,
    body: `Body about ${topic} ${index}.`,
    sourceTopic: topic,
    credibility_score: 0.9,
    content_hash: `hash-${language}-${topic}-${index}`,
    normalized_url: `https://sources.test/${language}/${topic}/${index}`,
    topic,
    importance_score: 0.9 - index / 100,
    rank_reasons: ["test"]
  };
}

/**
 * Today's feed. Deliberately does NOT carry the Franceinfo article: that is the
 * whole situation being tested.
 */
function todaysPool(language: Language): RankedArticle[] {
  const topics: TopicId[] = ["business", "finance", "tech_ai", "law", "medicine", "engineering"];

  return topics.flatMap((topic) =>
    Array.from({ length: 6 }, (_, index) => rankedArticle(topic, language, index + 1))
  );
}

function persistedFrenchVersion(overrides: { sourceUrls?: string[] } = {}): CatalogEntryVersionRecord {
  return {
    catalogEntryId: ENTRY_ID,
    contentItemId: "2ee2f800-0000-4000-8000-00000000285c",
    contentType: "mini_case",
    language: "fr",
    title: "Vaccin anticancer : l'essai ne suffit pas encore",
    summary: "Résumé stocké.",
    bodyMd: "Corps stocké.",
    difficulty: "intro",
    status: "review",
    topic: "medicine",
    metadata: {
      catalog_entry_id: ENTRY_ID,
      bootstrap_run_id: RUN_ID,
      slot: "mini_case",
      product_topic: "health_pharma",
      topic: "medicine",
      version: 1,
      scenario_type: "clinical_trial_decision",
      decision_type: "interpret_result",
      concept_tested: "trial_endpoint",
      question_pattern: "risk_then_evidence_then_decision",
      correct_answer_pattern: "evidence_before_action",
      score_max: 3,
      questions: ["method_framework", "technical_application", "conclusion_decision"].map(
        (role, index) => ({
          role,
          prompt: `Question stockée ${index + 1}`,
          explanation: "Explication stockée.",
          options: ["A", "B", "C", "D"].map((id) => ({
            id,
            text: `Option stockée ${id}`,
            is_correct: id === "A",
            feedback: "Retour stocké."
          }))
        })
      ),
      source_urls: overrides.sourceUrls ?? [FRANCEINFO_URL]
    }
  };
}

function options(overrides: Partial<BootstrapCatalogOptions> = {}): BootstrapCatalogOptions {
  return {
    dropDate: DROP_DATE,
    languages: ["fr", "en"],
    businessStoryCount: 0,
    miniCaseCountPerTopic: 1,
    miniCaseTopics: ["health_pharma"],
    persist: true,
    contentStatus: "review",
    runId: RUN_ID,
    useLlm: false,
    productionStrict: false,
    resume: true,
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

/**
 * A repository whose `content_item_sources` relation carries the Franceinfo row,
 * and which records every write it is asked to make.
 */
function repositoryStub(input: {
  existing: CatalogEntryVersionRecord[];
  linkedSources?: RankedArticle[];
}) {
  const writes: Array<{
    language: Language;
    entryId: string;
    citedUrls: string[];
    articleUrls: string[];
  }> = [];
  const sourceReads: string[] = [];

  const linked =
    input.linkedSources ?? [mapSourceRowToRankedArticle(FRANCEINFO_ROW, "medicine")];

  return {
    writes,
    sourceReads,
    repository: {
      assertPersistenceAvailable: () => undefined,
      listCatalogEntryVersions: vi.fn(async () => input.existing),
      listBusinessStoryMemoryContext: async () => ({ recentStories: [] }),
      listMiniCaseMemoryContext: async () => ({ recentOverall: [] }),
      listSourceArticlesForContentItem: vi.fn(
        async (args: { contentItemId: string; topic: TopicId }) => {
          sourceReads.push(args.contentItemId);
          return linked;
        }
      ),
      storeDailyPayload: async (payloadInput: {
        payload: { language: Language; items: Array<{ source_urls: string[] }> };
        articles: RankedArticle[];
        metadata?: Record<string, unknown>;
      }) => {
        writes.push({
          language: payloadInput.payload.language,
          entryId: String(payloadInput.metadata?.catalog_entry_id ?? "unknown"),
          citedUrls: payloadInput.payload.items.flatMap((item) => item.source_urls),
          articleUrls: payloadInput.articles.map((article) => article.url)
        });

        return [{ content_item_id: `written-${writes.length}`, reused_existing_content_item: false }];
      }
    } as never
  };
}

describe("a persisted reference is grounded by its links, not by today's feed", () => {
  it("generates the missing English half when the source has left the RSS window", async () => {
    const { generator, calls } = recordingGenerator();
    const { repository, writes } = repositoryStub({ existing: [persistedFrenchVersion()] });

    const output = await runBootstrapCatalog(options(), {
      generator,
      repository,
      // Today's pool does not contain the Franceinfo article at all.
      loadArticles: async (language: Language) => todaysPool(language)
    });

    expect(output.rejected).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].language).toBe("en");
    expect(writes.map((write) => write.language)).toEqual(["en"]);
  });

  it("reads the source back through content_item_sources", async () => {
    const { generator } = recordingGenerator();
    const { repository, sourceReads } = repositoryStub({ existing: [persistedFrenchVersion()] });

    await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    // The relation was consulted, for exactly the persisted French content item.
    expect(sourceReads).toEqual(["2ee2f800-0000-4000-8000-00000000285c"]);
  });

  it("hands the English generator exactly the persisted source", async () => {
    const { generator, calls } = recordingGenerator();
    const { repository, writes } = repositoryStub({ existing: [persistedFrenchVersion()] });

    await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    expect(calls[0].articles.map((article) => article.url)).toEqual([FRANCEINFO_URL]);
    expect(calls[0].languagePair?.referenceItems[0].source_urls).toEqual([FRANCEINFO_URL]);

    // And the same article is what persistence upserts metadata for, so the two
    // language versions end up linked to one source row.
    const english = writes.find((write) => write.language === "en");
    expect(english?.citedUrls).toEqual([FRANCEINFO_URL]);
    expect(english?.articleUrls).toEqual([FRANCEINFO_URL]);
  });

  it("rebuilds a source row into the article it was written from", () => {
    const original = rankedArticle("medicine", "fr", 3);
    const [row] = mapArticlesToSourceUpserts([original]);
    const rebuilt = mapSourceRowToRankedArticle(row, "medicine");

    // Everything `sources` stores round-trips exactly.
    expect(rebuilt.url).toBe(original.url);
    expect(rebuilt.title).toBe(original.title);
    expect(rebuilt.publisher).toBe(original.publisher);
    expect(rebuilt.published_at).toBe(original.published_at);
    expect(rebuilt.retrieved_at).toBe(original.retrieved_at);
    expect(rebuilt.language).toBe(original.language);
    expect(rebuilt.content_hash).toBe(original.content_hash);
    expect(rebuilt.credibility_score).toBe(original.credibility_score);
    // Re-upserting it writes the same row back: resuming never edits a source.
    expect(mapArticlesToSourceUpserts([rebuilt])).toEqual([row]);
  });
});

describe("the link is the approval", () => {
  it("refuses a URL the stored metadata claims but no link supports", async () => {
    const { generator, calls } = recordingGenerator();
    const { repository, writes } = repositoryStub({
      // The item's generated metadata cites two URLs; only one is linked.
      existing: [
        persistedFrenchVersion({
          sourceUrls: [FRANCEINFO_URL, "https://unlinked.test/never-approved"]
        })
      ]
    });

    const output = await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    expect(output.rejected).toHaveLength(1);
    expect(output.rejected[0].reason).toBe("validation_failed");
    expect(output.rejected[0].details.join(" ")).toContain("not linked to the persisted content item");
    expect(output.rejected[0].details.join(" ")).toContain("https://unlinked.test/never-approved");
    // Refused before spending a call and before any write.
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("refuses a counterpart that reaches for a source of its own", async () => {
    const inner = new StructuredContentGenerator();
    const generator = {
      generateDailyDrop: async (request: GenerationRequest) => {
        const payload = await inner.generateDailyDrop(request);

        return {
          ...payload,
          items: payload.items.map((item) => ({
            ...item,
            source_urls: ["https://invented.test/the-model-made-this-up"]
          }))
        };
      }
    } as ContentGenerator;
    const { repository, writes } = repositoryStub({ existing: [persistedFrenchVersion()] });

    const output = await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    expect(output.rejected).toHaveLength(1);
    expect(output.rejected[0].reason).toBe("validation_failed");
    expect(output.rejected[0].details.join(" ")).toContain("outside the approved material");
    expect(writes).toEqual([]);
  });

  it("refuses an entry whose persisted version has no linked source at all", async () => {
    const { generator, calls } = recordingGenerator();
    const { repository, writes } = repositoryStub({
      existing: [persistedFrenchVersion()],
      linkedSources: []
    });

    const output = await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    expect(output.rejected).toHaveLength(1);
    expect(output.rejected[0].reason).toBe("no_source_material");
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("the version that already exists is left alone", () => {
  it("neither regenerates nor rewrites the French half", async () => {
    const { generator, calls } = recordingGenerator();
    const { repository, writes } = repositoryStub({ existing: [persistedFrenchVersion()] });

    const output = await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    // No French call, no French write.
    expect(calls.every((call) => call.language === "en")).toBe(true);
    expect(writes.every((write) => write.language === "en")).toBe(true);

    // It is reported as skipped, still pointing at its original row.
    expect(output.skipped).toEqual([
      {
        entryId: ENTRY_ID,
        language: "fr",
        contentItemId: "2ee2f800-0000-4000-8000-00000000285c"
      }
    ]);

    const entry = output.entries[0];
    const french = entry.versions.find((version) => version.language === "fr");
    expect(french?.reusedExistingContentItem).toBe(true);
    expect(french?.contentItemId).toBe("2ee2f800-0000-4000-8000-00000000285c");
    // The stored French item is handed to the pair untouched.
    expect(french?.item.source_urls).toEqual([FRANCEINFO_URL]);
    expect(french?.item.title).toBe("Vaccin anticancer : l'essai ne suffit pas encore");
  });

  it("persists the missing English version and nothing else", async () => {
    const { generator } = recordingGenerator();
    const { repository, writes } = repositoryStub({ existing: [persistedFrenchVersion()] });

    await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ language: "en", entryId: ENTRY_ID });
  });

  it("does nothing at all once both halves exist", async () => {
    const { generator, calls } = recordingGenerator();
    const { repository, writes, sourceReads } = repositoryStub({
      existing: [
        persistedFrenchVersion(),
        {
          ...persistedFrenchVersion(),
          contentItemId: "en-content-item",
          language: "en",
          title: "Cancer vaccine: the trial is not enough yet"
        }
      ]
    });

    const output = await runBootstrapCatalog(options(), {
      generator,
      repository,
      loadArticles: async (language: Language) => todaysPool(language)
    });

    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
    // A complete entry is skipped whole: the source relation is not even read.
    expect(sourceReads).toEqual([]);
    expect(output.skipped).toHaveLength(2);
    expect(output.entries).toEqual([]);
  });
});
