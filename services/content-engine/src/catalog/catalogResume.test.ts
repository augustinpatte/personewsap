import { describe, expect, it, vi } from "vitest";

import {
  MINI_CASE_TOPIC_IDS,
  type Language,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";
import {
  DEFAULT_BUSINESS_STORY_COUNT,
  DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
  runBootstrapCatalog,
  type BootstrapCatalogOptions
} from "./bootstrapCatalog.js";

/**
 * Resuming the interrupted launch catalog.
 *
 * The run that prompted this died on a Supabase headers timeout with 39 of 80
 * versions written. Regenerating those 39 would cost 39 LLM calls to arrive at
 * different text for rows that already exist, so the rule is simple and worth
 * pinning down: an entry already stored under this runId is not generated, not
 * written, and not touched.
 */

const RUN_ID = "launch-catalog-v1-20260820-173307";
const DROP_DATE = "2026-08-20";
const SOURCE_TOPICS: TopicId[] = ["business", "finance", "tech_ai", "law", "medicine", "engineering"];

function rankedArticle(topic: TopicId, language: Language, index: number): RankedArticle {
  return {
    url: `https://sources.test/${language}/${topic}/${index}`,
    title: `${topic} development ${index} (${language})`,
    publisher: `${topic} desk ${index}`,
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language,
    // Written like real source material, not like a placeholder: the Business
    // Story allocator refuses a packet that carries no business mechanism, and a
    // fixture standing for "a rich day of business news" has to contain what
    // such a day contains — a mechanism and a number. Written in the article's
    // own language, because an item built from it is checked for being 100% in
    // its language.
    summary:
      language === "fr"
        ? `Un développement ${topic} concret numéro ${index} : l'opérateur a revu ses tarifs après une hausse des coûts unitaires.`
        : `A concrete ${topic} development number ${index}: the operator reset its pricing after unit costs moved.`,
    body:
      language === "fr"
        ? `Contexte ${topic} ${index}. Le contrat porte sur 12 millions d'euros de capacité, et la marge dépend du nombre de clients qui acceptent le nouveau tarif.`
        : `Context on ${topic} ${index}. The contract covers 12 million euros of capacity, and the margin depends on how many customers accept the new tariff.`,
    sourceTopic: topic,
    credibility_score: 0.9,
    content_hash: `hash-${language}-${topic}-${index}`,
    normalized_url: `https://sources.test/${language}/${topic}/${index}`,
    topic,
    importance_score: 0.9 - index / 100,
    rank_reasons: ["test"]
  };
}

function sourcePool(language: Language): RankedArticle[] {
  return SOURCE_TOPICS.flatMap((topic) =>
    Array.from({ length: 6 }, (_, index) => rankedArticle(topic, language, index + 1))
  );
}

function options(overrides: Partial<BootstrapCatalogOptions> = {}): BootstrapCatalogOptions {
  return {
    dropDate: DROP_DATE,
    languages: ["fr", "en"],
    businessStoryCount: DEFAULT_BUSINESS_STORY_COUNT,
    miniCaseCountPerTopic: DEFAULT_MINI_CASE_COUNT_PER_TOPIC,
    miniCaseTopics: [...MINI_CASE_TOPIC_IDS],
    persist: true,
    contentStatus: "review",
    runId: RUN_ID,
    useLlm: false,
    productionStrict: false,
    resume: true,
    ...overrides
  };
}

/** Counts generation calls so "zero LLM calls" can be asserted literally. */
function countingGenerator(): { generator: ContentGenerator; calls: GenerationRequest[] } {
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

function entryIdFor(kind: "business-story" | "mini-case", topic: MiniCaseTopicId | null, index: number): string {
  const position = String(index + 1).padStart(2, "0");
  return topic ? `${RUN_ID}-${kind}-${topic}-${position}` : `${RUN_ID}-${kind}-${position}`;
}

function persistedVersion(input: {
  entryId: string;
  language: Language;
  contentType: "business_story" | "mini_case";
  miniCaseTopic?: MiniCaseTopicId | null;
}): CatalogEntryVersionRecord {
  const topic = input.miniCaseTopic ?? null;

  return {
    catalogEntryId: input.entryId,
    contentItemId: `content-${input.entryId}-${input.language}`,
    contentType: input.contentType,
    language: input.language,
    title: `Stored ${input.contentType} ${input.entryId} (${input.language})`,
    summary: "Stored summary.",
    bodyMd: "Stored body.",
    difficulty: "intro",
    status: "review",
    topic: "business",
    // Shaped like a row this engine actually writes: mappers.ts stores every
    // structural mini-case field in metadata, which is what lets a resumed
    // counterpart be paired to the stored version instead of to a new case.
    metadata: {
      catalog_entry_id: input.entryId,
      bootstrap_run_id: RUN_ID,
      slot: input.contentType === "mini_case" ? "mini_case" : "business_story",
      product_topic: topic,
      topic: "business",
      version: 1,
      scenario_type: "acquisition_decision",
      decision_type: "choose_metric",
      concept_tested: "margin",
      question_pattern: "framework_then_apply_then_decide",
      correct_answer_pattern: "best_next_signal",
      score_max: 3,
      questions: ["method_framework", "technical_application", "conclusion_decision"].map(
        (role, questionIndex) => ({
          role,
          prompt: `Stored question ${questionIndex + 1}`,
          explanation: "Stored explanation.",
          options: ["A", "B", "C", "D"].map((id) => ({
            id,
            text: `Stored option ${id}`,
            // Matches what the deterministic generator marks correct, so the
            // pair validator compares a real agreement rather than a fixture
            // artefact. In production the counterpart is told to mirror the
            // reference's correct option.
            is_correct: id === "A",
            feedback: "Stored feedback."
          }))
        })
      ),
      source_urls: ["https://sources.test/fr/business/1"]
    }
  };
}

/** A repository stub that records every write attempt. */
function repositoryStub(existing: CatalogEntryVersionRecord[]) {
  const writes: Array<{ language: Language; entryId: string }> = [];

  return {
    writes,
    repository: {
      assertPersistenceAvailable: () => undefined,
      listCatalogEntryVersions: vi.fn(async () => existing),
      listBusinessStoryMemoryContext: async () => ({ recentStories: [] }),
      listMiniCaseMemoryContext: async () => ({ recentOverall: [] }),
      // What content_item_sources -> sources answers for a stored version: the
      // source the previous run linked to it, whether or not today's feed still
      // carries it.
      listSourceArticlesForContentItem: async () => [
        { ...rankedArticle("business", "fr", 1), url: "https://sources.test/fr/business/1" }
      ],
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
    } as never
  };
}

function dependencies(existing: CatalogEntryVersionRecord[]) {
  const { generator, calls } = countingGenerator();
  const { repository, writes } = repositoryStub(existing);

  return {
    calls,
    writes,
    dependencies: {
      generator,
      repository,
      loadArticles: async (language: Language) => sourcePool(language)
    }
  };
}

/** Every version of a full 40-entry / 80-version catalog. */
function completeInventory(): CatalogEntryVersionRecord[] {
  const records: CatalogEntryVersionRecord[] = [];

  for (let index = 0; index < DEFAULT_BUSINESS_STORY_COUNT; index += 1) {
    for (const language of ["fr", "en"] as Language[]) {
      records.push(
        persistedVersion({
          entryId: entryIdFor("business-story", null, index),
          language,
          contentType: "business_story"
        })
      );
    }
  }

  for (const topic of MINI_CASE_TOPIC_IDS) {
    for (let index = 0; index < DEFAULT_MINI_CASE_COUNT_PER_TOPIC; index += 1) {
      for (const language of ["fr", "en"] as Language[]) {
        records.push(
          persistedVersion({
            entryId: entryIdFor("mini-case", topic, index),
            language,
            contentType: "mini_case",
            miniCaseTopic: topic
          })
        );
      }
    }
  }

  return records;
}

describe("an entry already stored under this runId is left alone", () => {
  it("spends no LLM call and writes nothing for a complete pair", async () => {
    const entryId = entryIdFor("mini-case", "finance_economy", 0);
    const { calls, writes, dependencies: deps } = dependencies([
      persistedVersion({ entryId, language: "fr", contentType: "mini_case", miniCaseTopic: "finance_economy" }),
      persistedVersion({ entryId, language: "en", contentType: "mini_case", miniCaseTopic: "finance_economy" })
    ]);

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseCountPerTopic: 1, miniCaseTopics: ["finance_economy"] }),
      deps
    );

    expect(calls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(output.entries).toEqual([]);
    expect(output.skipped.map((version) => version.language).sort()).toEqual(["en", "fr"]);
  });

  it("skips a whole complete topic", async () => {
    const existing = MINI_CASE_TOPIC_IDS.flatMap((topic) =>
      Array.from({ length: DEFAULT_MINI_CASE_COUNT_PER_TOPIC }, (_, index) => index).flatMap((index) =>
        (["fr", "en"] as Language[]).map((language) =>
          persistedVersion({
            entryId: entryIdFor("mini-case", topic, index),
            language,
            contentType: "mini_case",
            miniCaseTopic: topic
          })
        )
      )
    ).filter((record) => record.metadata.product_topic === "finance_economy");

    const { calls, writes, dependencies: deps } = dependencies(existing);

    await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseTopics: ["finance_economy"] }),
      deps
    );

    expect(calls).toHaveLength(0);
    expect(writes).toEqual([]);
  });

  it("does nothing at all when the run is already complete", async () => {
    const { calls, writes, dependencies: deps } = dependencies(completeInventory());
    const output = await runBootstrapCatalog(options(), deps);

    expect(calls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(output.skipped).toHaveLength(80);
    expect(output.counts.persistedContentItems).toBe(0);
  });
});

describe("a missing entry is generated, and only that one", () => {
  it("generates just the missing pair inside an otherwise complete topic", async () => {
    const missingIndex = 2;
    const existing = Array.from({ length: DEFAULT_MINI_CASE_COUNT_PER_TOPIC }, (_, index) => index)
      .filter((index) => index !== missingIndex)
      .flatMap((index) =>
        (["fr", "en"] as Language[]).map((language) =>
          persistedVersion({
            entryId: entryIdFor("mini-case", "law_compliance", index),
            language,
            contentType: "mini_case",
            miniCaseTopic: "law_compliance"
          })
        )
      );

    const { calls, writes, dependencies: deps } = dependencies(existing);

    await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseTopics: ["law_compliance"] }),
      deps
    );

    // One FR reference plus its EN counterpart, and nothing else.
    expect(calls.map((call) => call.language)).toEqual(["fr", "en"]);
    expect(writes.map((write) => write.entryId)).toEqual([
      entryIdFor("mini-case", "law_compliance", missingIndex),
      entryIdFor("mini-case", "law_compliance", missingIndex)
    ]);
  });

  it("generates only the missing half of a half-written pair", async () => {
    const entryId = entryIdFor("mini-case", "health_pharma", 0);
    const { calls, writes, dependencies: deps } = dependencies([
      persistedVersion({ entryId, language: "fr", contentType: "mini_case", miniCaseTopic: "health_pharma" })
    ]);

    const output = await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseCountPerTopic: 1, miniCaseTopics: ["health_pharma"] }),
      deps
    );

    expect(calls.map((call) => call.language)).toEqual(["en"]);
    expect(output.rejected).toEqual([]);
    expect(writes).toEqual([{ language: "en", entryId }]);
  });

  it("pairs the resumed half to the stored one rather than to a new case", async () => {
    const entryId = entryIdFor("mini-case", "health_pharma", 0);
    const stored = persistedVersion({
      entryId,
      language: "fr",
      contentType: "mini_case",
      miniCaseTopic: "health_pharma"
    });
    const { calls, dependencies: deps } = dependencies([stored]);

    await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseCountPerTopic: 1, miniCaseTopics: ["health_pharma"] }),
      deps
    );

    const [enCall] = calls;

    // The English half is generated as the counterpart of the stored French
    // case, carrying its title and its cited source — not as a fresh scenario.
    expect(enCall.languagePair?.referenceLanguage).toBe("fr");
    expect(enCall.languagePair?.referenceItems[0].title).toBe(stored.title);
    expect(enCall.languagePair?.referenceItems[0].source_urls).toEqual(
      stored.metadata.source_urls
    );
  });

  it("never writes the version that already existed", async () => {
    const entryId = entryIdFor("mini-case", "health_pharma", 0);
    const { writes, dependencies: deps } = dependencies([
      persistedVersion({ entryId, language: "fr", contentType: "mini_case", miniCaseTopic: "health_pharma" })
    ]);

    await runBootstrapCatalog(
      options({ businessStoryCount: 0, miniCaseCountPerTopic: 1, miniCaseTopics: ["health_pharma"] }),
      deps
    );

    expect(writes.some((write) => write.language === "fr")).toBe(false);
  });
});

describe("the interrupted launch catalog reaches 80/80", () => {
  /** The exact inventory the interrupted run left behind: 39 of 80 versions. */
  function partialInventory(): CatalogEntryVersionRecord[] {
    const records: CatalogEntryVersionRecord[] = [];
    const complete: MiniCaseTopicId[] = ["finance_economy", "stock_market", "ai"];

    for (const topic of complete) {
      for (let index = 0; index < 5; index += 1) {
        for (const language of ["fr", "en"] as Language[]) {
          records.push(
            persistedVersion({
              entryId: entryIdFor("mini-case", topic, index),
              language,
              contentType: "mini_case",
              miniCaseTopic: topic
            })
          );
        }
      }
    }

    // law_compliance: pair 03 (index 2) never made it.
    for (const index of [0, 1, 3, 4]) {
      for (const language of ["fr", "en"] as Language[]) {
        records.push(
          persistedVersion({
            entryId: entryIdFor("mini-case", "law_compliance", index),
            language,
            contentType: "mini_case",
            miniCaseTopic: "law_compliance"
          })
        );
      }
    }

    // health_pharma: only the French half of pair 01 was written.
    records.push(
      persistedVersion({
        entryId: entryIdFor("mini-case", "health_pharma", 0),
        language: "fr",
        contentType: "mini_case",
        miniCaseTopic: "health_pharma"
      })
    );

    return records;
  }

  it("starts from exactly 39 stored versions", () => {
    expect(partialInventory()).toHaveLength(39);
  });

  it("skips 39, generates 41, and ends at 80", async () => {
    const existing = partialInventory();
    const { calls, writes, dependencies: deps } = dependencies(existing);

    const output = await runBootstrapCatalog(options(), deps);

    expect(output.rejected).toEqual([]);
    expect(output.skipped).toHaveLength(39);
    expect(calls).toHaveLength(41);
    expect(writes).toHaveLength(41);
    expect(output.skipped.length + writes.length).toBe(80);
  });

  it("generates no version of a topic that was already complete", async () => {
    const { writes, dependencies: deps } = dependencies(partialInventory());

    await runBootstrapCatalog(options(), deps);

    for (const complete of ["finance_economy", "stock_market", "ai"]) {
      expect(writes.filter((write) => write.entryId.includes(complete))).toEqual([]);
    }
  });

  it("produces every missing Business Story pair", async () => {
    const { writes, dependencies: deps } = dependencies(partialInventory());

    await runBootstrapCatalog(options(), deps);

    expect(writes.filter((write) => write.entryId.includes("business-story"))).toHaveLength(20);
  });

  it("assigns each written version a distinct entry/language slot", async () => {
    const { writes, dependencies: deps } = dependencies(partialInventory());

    await runBootstrapCatalog(options(), deps);

    const slots = writes.map((write) => `${write.entryId}::${write.language}`);
    expect(new Set(slots).size).toBe(slots.length);
  });
});

describe("resume is opt-in", () => {
  it("does not read the existing inventory unless asked", async () => {
    const { dependencies: deps } = dependencies(completeInventory());

    await runBootstrapCatalog(
      options({
        resume: false,
        businessStoryCount: 0,
        miniCaseCountPerTopic: 1,
        miniCaseTopics: ["finance_economy"]
      }),
      deps
    );

    expect(deps.repository.listCatalogEntryVersions).not.toHaveBeenCalled();
  });
});
