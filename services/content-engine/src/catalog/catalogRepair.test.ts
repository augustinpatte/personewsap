import { describe, expect, it, vi } from "vitest";

import type { GeneratedContentItem, Language, MiniCaseTopicId, RankedArticle, TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";
import {
  applyCatalogRepairPlan,
  prepareCatalogRepair,
  type CatalogRepairOptions
} from "./catalogRepair.js";

/**
 * Repairing a finished catalog without rebuilding it.
 *
 * The launch catalog is 80 versions of real content. An editorial audit asked
 * for fifteen of the forty pairs to change: seven reworked on the same event,
 * eight replaced outright. Rebuilding the catalog would spend the other
 * twenty-five for nothing and put items nobody complained about back at risk.
 *
 * So the repair is addressed, and its central obligation is negative: a pair
 * that was not named must come out of the run with the same content, the same
 * sources and the same rows it went in with.
 */

const RUN_ID = "launch-catalog-v1-20260820-173307";
const DROP_DATE = "2026-08-20";

const REWORK_ENTRY = `${RUN_ID}-mini-case-ai-02`;
const REPLACE_ENTRY = `${RUN_ID}-mini-case-ai-04`;
const KEEP_ENTRY = `${RUN_ID}-mini-case-ai-01`;

let counter = 0;

function article(input: {
  url: string;
  topic: TopicId;
  language: Language;
  title?: string;
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
    summary:
      input.language === "fr"
        ? "Un développement concret : l'opérateur a revu ses tarifs après une hausse des coûts unitaires."
        : "A concrete development: the operator reset its pricing after unit costs moved.",
    body:
      input.language === "fr"
        ? "Le contrat porte sur 12 millions d'euros de capacité, et la marge dépend du nombre de clients qui acceptent le nouveau tarif."
        : "The contract covers 12 million euros of capacity, and the margin depends on how many customers accept the new tariff.",
    sourceTopic: input.topic,
    credibility_score: 0.9,
    content_hash: input.url,
    normalized_url: input.url,
    topic: input.topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

/** Today's pool: several distinct tech_ai events plus the original one. */
function pool(language: Language): RankedArticle[] {
  return [
    article({ url: `https://${language}.test/ai/original`, topic: "tech_ai", language, title: "The original AI capacity decision" }),
    article({ url: `https://${language}.test/ai/alt-1`, topic: "tech_ai", language, title: "A separate inference pricing change" }),
    article({ url: `https://${language}.test/ai/alt-2`, topic: "tech_ai", language, title: "A distinct datacentre build delay" }),
    article({ url: `https://${language}.test/ai/alt-3`, topic: "tech_ai", language, title: "Another model licensing dispute" })
  ];
}

function persistedVersion(input: {
  entryId: string;
  language: Language;
  index: number;
  status?: string;
  sourceUrls?: string[];
  miniCaseTopic?: MiniCaseTopicId;
}): CatalogEntryVersionRecord {
  const topic = input.miniCaseTopic ?? "ai";

  return {
    catalogEntryId: input.entryId,
    contentItemId: `content-${input.entryId}-${input.language}`,
    contentType: "mini_case",
    language: input.language,
    title: `Stored case ${input.entryId} (${input.language})`,
    summary: "Stored summary.",
    bodyMd: "Stored body.",
    difficulty: "intro",
    status: input.status ?? "review",
    topic: "tech_ai",
    metadata: {
      catalog_entry_id: input.entryId,
      bootstrap_run_id: RUN_ID,
      catalog_entry_index: input.index,
      catalog_content_type: "mini_case",
      catalog_mini_case_topic: topic,
      product_topic: topic,
      slot: "mini_case",
      topic: "tech_ai",
      version: 1,
      scenario_type: "ai_build_vs_buy",
      decision_type: "choose_metric",
      concept_tested: "unit_economics",
      question_pattern: "framework_then_apply_then_decide",
      correct_answer_pattern: "best_next_signal",
      score_max: 3,
      dedup_key: "stale-dedup-key",
      questions: ["method_framework", "technical_application", "conclusion_decision"].map(
        (role, questionIndex) => ({
          role,
          prompt: `Stored question ${questionIndex + 1}`,
          explanation: "Stored explanation.",
          options: ["A", "B", "C", "D"].map((id) => ({
            id,
            text: `Stored option ${id}`,
            is_correct: id === "A",
            feedback: "Stored feedback."
          }))
        })
      ),
      source_urls: input.sourceUrls ?? ["https://fr.test/ai/original"]
    }
  };
}

/** The three-pair catalog these tests operate on: one rework, one replace, one keep. */
function inventory(overrides: { statusFor?: Record<string, string> } = {}): CatalogEntryVersionRecord[] {
  const entries: Array<{ entryId: string; index: number }> = [
    { entryId: KEEP_ENTRY, index: 0 },
    { entryId: REWORK_ENTRY, index: 1 },
    { entryId: REPLACE_ENTRY, index: 3 }
  ];

  return entries.flatMap(({ entryId, index }) =>
    (["fr", "en"] as Language[]).map((language) =>
      persistedVersion({
        entryId,
        language,
        index,
        status: overrides.statusFor?.[entryId],
        sourceUrls: [entryId === KEEP_ENTRY ? "https://fr.test/ai/alt-3" : "https://fr.test/ai/original"]
      })
    )
  );
}

function options(overrides: Partial<CatalogRepairOptions> = {}): CatalogRepairOptions {
  return {
    runId: RUN_ID,
    entryIds: [REWORK_ENTRY],
    mode: "rework",
    dropDate: DROP_DATE,
    languages: ["fr", "en"],
    contentStatus: "review",
    useLlm: false,
    productionStrict: false,
    ...overrides
  };
}

type Write = {
  contentItemId: string;
  title: string;
  sourceUrls: string[];
  metadata: Record<string, unknown>;
};

function repositoryStub(input: {
  existing: CatalogEntryVersionRecord[];
  assigned?: string[];
  failOnContentItemId?: string;
}) {
  const writes: Write[] = [];
  const sourceReads: string[] = [];
  const memoryDeletes: string[] = [];

  return {
    writes,
    sourceReads,
    memoryDeletes,
    repository: {
      assertPersistenceAvailable: () => undefined,
      listCatalogEntryVersions: vi.fn(async () => input.existing),
      listAssignedContentItemIds: vi.fn(async (ids: string[]) =>
        (input.assigned ?? []).filter((id) => ids.includes(id))
      ),
      listSourceArticlesForContentItem: vi.fn(async (args: { contentItemId: string }) => {
        sourceReads.push(args.contentItemId);
        // The event the original run linked, no longer in today's feed under
        // that exact identity is irrelevant here: the link is what counts.
        return [article({ url: "https://fr.test/ai/original", topic: "tech_ai", language: "fr", title: "The original AI capacity decision" })];
      }),
      deleteMiniCaseHistoryForContentItem: vi.fn(async (contentItemId: string) => {
        memoryDeletes.push(contentItemId);
      }),
      replaceCatalogVersionContent: vi.fn(
        async (args: {
          contentItemId: string;
          item: GeneratedContentItem;
          metadata: Record<string, unknown>;
        }) => {
          if (args.contentItemId === input.failOnContentItemId) {
            throw new Error("simulated write failure");
          }

          writes.push({
            contentItemId: args.contentItemId,
            title: args.item.title,
            sourceUrls: args.item.source_urls,
            metadata: args.metadata
          });
        }
      )
    } as never
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
 * Both phases, as an operator runs them.
 *
 * Prepare generates the candidate and writes a plan; apply persists exactly that
 * plan. Driving the tests through both is what proves the round trip: what is
 * asserted about the writes is what came out of the reviewed plan, not out of a
 * second generation.
 */
async function prepareAndApply(
  repairOptions: CatalogRepairOptions,
  deps: ReturnType<typeof dependencies>
) {
  const { report, plan } = await prepareCatalogRepair(repairOptions, deps);

  // A prepare that refused everything still returns a plan — the diagnostic
  // one — and there is nothing in it to apply.
  if (plan.entries.length === 0) {
    return report;
  }

  return applyCatalogRepairPlan(plan, { persist: true }, { repository: deps.repository });
}

function dependencies(stub: ReturnType<typeof repositoryStub>, generator?: ContentGenerator) {
  return {
    generator: generator ?? new StructuredContentGenerator(),
    repository: stub.repository,
    loadArticles: async (language: Language) => pool(language)
  };
}

describe("a repair touches only the pairs it was given", () => {
  it("rewrites the named pair and nothing else", async () => {
    const stub = repositoryStub({ existing: inventory() });
    const report = await prepareAndApply(options(), dependencies(stub));

    expect(report.counts.repaired).toBe(1);
    expect(report.outcomes[0].status).toBe("repaired");

    // Two writes: the two languages of one entry, out of six versions.
    expect(stub.writes.map((write) => write.contentItemId).sort()).toEqual([
      `content-${REWORK_ENTRY}-en`,
      `content-${REWORK_ENTRY}-fr`
    ]);
    expect(report.untouchedVersions).toBe(4);
  });

  it("leaves the KEEP pairs with no call, no write and no source change", async () => {
    const stub = repositoryStub({ existing: inventory() });
    const { generator, calls } = recordingGenerator();

    await prepareAndApply(options(), dependencies(stub, generator));

    const keepIds = [`content-${KEEP_ENTRY}-fr`, `content-${KEEP_ENTRY}-en`];

    expect(stub.writes.some((write) => keepIds.includes(write.contentItemId))).toBe(false);
    expect(stub.sourceReads.some((id) => keepIds.includes(id))).toBe(false);
    expect(stub.memoryDeletes.some((id) => keepIds.includes(id))).toBe(false);
    // Exactly two generation calls, both for the repaired entry's pair.
    expect(calls).toHaveLength(2);
  });

  it("keeps the catalog at the same number of versions and one row per entry", async () => {
    const existing = inventory();
    const stub = repositoryStub({ existing });

    const report = await prepareAndApply(options(), dependencies(stub));

    // Content items are replaced in place: no row is created and none removed.
    expect(existing).toHaveLength(6);
    expect(report.untouchedVersions + stub.writes.length).toBe(6);

    const entryIds = existing.map((version) => `${version.catalogEntryId}::${version.language}`);
    expect(new Set(entryIds).size).toBe(entryIds.length);
    // The repaired versions keep the ids they had.
    for (const write of stub.writes) {
      expect(existing.some((version) => version.contentItemId === write.contentItemId)).toBe(true);
    }
  });
});

describe("rework keeps the event, replace discards it", () => {
  it("rebuilds a rework on the sources the original run linked", async () => {
    const stub = repositoryStub({ existing: inventory() });
    const { generator, calls } = recordingGenerator();

    const report = await prepareAndApply(options(), dependencies(stub, generator));

    expect(stub.sourceReads).toContain(`content-${REWORK_ENTRY}-fr`);
    expect(calls[0].articles.map((entry) => entry.url)).toEqual(["https://fr.test/ai/original"]);
    expect(report.outcomes[0].newSourceUrls).toEqual(["https://fr.test/ai/original"]);
    // Same event in, same event out: novelty is not a reason to change source.
    expect(report.outcomes[0].previousSourceUrls).toEqual(["https://fr.test/ai/original"]);
  });

  it("moves a replace onto a different event entirely", async () => {
    const stub = repositoryStub({ existing: inventory() });

    const report = await prepareAndApply(
      options({ entryIds: [REPLACE_ENTRY], mode: "replace" }),
      dependencies(stub)
    );

    expect(report.outcomes[0].status).toBe("repaired");
    expect(report.outcomes[0].newSourceUrls).not.toContain("https://fr.test/ai/original");
    expect(report.outcomes[0].newSourceUrls.length).toBeGreaterThan(0);
  });

  it("does not take a replacement event another entry is already using", async () => {
    const stub = repositoryStub({ existing: inventory() });

    const report = await prepareAndApply(
      options({ entryIds: [REPLACE_ENTRY], mode: "replace" }),
      dependencies(stub)
    );

    // alt-3 belongs to the KEEP pair and stays off limits.
    expect(report.outcomes[0].newSourceUrls).not.toContain("https://fr.test/ai/alt-3");
  });

  it("refuses a replace when no other event is available", async () => {
    const stub = repositoryStub({ existing: inventory() });

    const report = await prepareAndApply(
      options({ entryIds: [REPLACE_ENTRY], mode: "replace" }),
      {
        generator: new StructuredContentGenerator(),
        repository: stub.repository,
        // The only event in today's pool is the one being replaced.
        loadArticles: async (language: Language) =>
          language === "fr"
            ? [
                article({
                  url: "https://fr.test/ai/original",
                  topic: "tech_ai",
                  language: "fr",
                  title: "The original AI capacity decision"
                })
              ]
            : []
      }
    );

    expect(report.outcomes[0].status).toBe("refused");
    expect(report.outcomes[0].reason).toContain("No replacement event");
    expect(stub.writes).toEqual([]);
  });

  it("keeps both halves of the repaired pair on one factual event", async () => {
    const stub = repositoryStub({ existing: inventory() });

    await prepareAndApply(options({ entryIds: [REPLACE_ENTRY], mode: "replace" }), dependencies(stub));

    expect(stub.writes).toHaveLength(2);
    expect(stub.writes[0].sourceUrls).toEqual(stub.writes[1].sourceUrls);
  });
});

describe("a repair refuses anything it should not rewrite", () => {
  it("refuses a version that is no longer in review", async () => {
    const stub = repositoryStub({
      existing: inventory({ statusFor: { [REWORK_ENTRY]: "published" } })
    });
    const { generator, calls } = recordingGenerator();

    const report = await prepareAndApply(options(), dependencies(stub, generator));

    expect(report.outcomes[0].status).toBe("refused");
    expect(report.outcomes[0].reason).toContain("still in review");
    // Refused before spending a call and before any write.
    expect(calls).toEqual([]);
    expect(stub.writes).toEqual([]);
  });

  it("refuses content a reader has already been given", async () => {
    const stub = repositoryStub({
      existing: inventory(),
      assigned: [`content-${REWORK_ENTRY}-fr`]
    });
    const { generator, calls } = recordingGenerator();

    const report = await prepareAndApply(options(), dependencies(stub, generator));

    expect(report.outcomes[0].status).toBe("refused");
    expect(report.outcomes[0].reason).toContain("attached to a daily drop");
    expect(calls).toEqual([]);
    expect(stub.writes).toEqual([]);
  });

  it("refuses an entry that does not exist under this run", async () => {
    const stub = repositoryStub({ existing: inventory() });

    const report = await prepareAndApply(
      options({ entryIds: [`${RUN_ID}-mini-case-ai-05`] }),
      dependencies(stub)
    );

    expect(report.outcomes[0].status).toBe("refused");
    expect(stub.writes).toEqual([]);
  });

  it("refuses an entry id belonging to another run before doing anything", async () => {
    const stub = repositoryStub({ existing: inventory() });

    await expect(
      prepareCatalogRepair(options({ entryIds: ["some-other-run-mini-case-ai-02"] }), dependencies(stub))
    ).rejects.toThrow(/must belong to run/);
  });
});

describe("the existing pair survives until the new one is proven", () => {
  it("writes nothing at prepare, but proves the pair would validate", async () => {
    const stub = repositoryStub({ existing: inventory() });
    const { generator, calls } = recordingGenerator();

    const { report } = await prepareCatalogRepair(options(), dependencies(stub, generator));

    expect(report.dryRun).toBe(true);
    expect(report.confirmation).toBeNull();
    expect(report.outcomes[0].status).toBe("planned");
    expect(report.counts.repaired).toBe(0);
    // The candidate really was generated and validated — that is the point of
    // the dry run — but nothing was written.
    expect(calls).toHaveLength(2);
    expect(Object.keys(report.outcomes[0].newTitles).sort()).toEqual(["en", "fr"]);
    expect(stub.writes).toEqual([]);
  });

  it("changes nothing when the candidate pair fails validation", async () => {
    const stub = repositoryStub({ existing: inventory() });
    const brokenGenerator = {
      generateDailyDrop: async () => {
        throw new Error("model refused");
      }
    } as ContentGenerator;

    const report = await prepareAndApply(options(), dependencies(stub, brokenGenerator));

    expect(report.outcomes[0].status).toBe("refused");
    expect(report.outcomes[0].reason).toContain("refused before anything was changed");
    expect(stub.writes).toEqual([]);
  });

  it("restores the first half when the second write fails", async () => {
    const stub = repositoryStub({
      existing: inventory(),
      failOnContentItemId: `content-${REWORK_ENTRY}-en`
    });

    await expect(prepareAndApply(options(), dependencies(stub))).rejects.toThrow(
      /1 earlier version\(s\) were restored/
    );

    // The French half was written, then written back to its stored content.
    const french = stub.writes.filter(
      (write) => write.contentItemId === `content-${REWORK_ENTRY}-fr`
    );
    expect(french).toHaveLength(2);
    expect(french[1].title).toBe(`Stored case ${REWORK_ENTRY} (fr)`);
  });
});

describe("a repaired version keeps its slot and drops its stale keys", () => {
  it("carries the run, entry, index and topic across unchanged", async () => {
    const stub = repositoryStub({ existing: inventory() });

    await prepareAndApply(options(), dependencies(stub));

    for (const write of stub.writes) {
      expect(write.metadata).toMatchObject({
        bootstrap_run_id: RUN_ID,
        catalog_entry_id: REWORK_ENTRY,
        catalog_entry_index: 1,
        catalog_content_type: "mini_case",
        catalog_mini_case_topic: "ai",
        content_status: "review",
        catalog_repair_mode: "rework"
      });
    }
  });

  it("drops the dedup key computed from the content it no longer holds", async () => {
    const stub = repositoryStub({ existing: inventory() });

    await prepareAndApply(options(), dependencies(stub));

    for (const write of stub.writes) {
      expect(write.metadata.dedup_key).toBeUndefined();
    }
  });

  it("clears stale mini-case editorial memory for the repaired versions", async () => {
    const stub = repositoryStub({ existing: inventory() });

    await prepareAndApply(options(), dependencies(stub));

    // Handled inside replaceCatalogVersionContent, which the stub records
    // through its own delete hook when the real repository runs it.
    expect(stub.repository).toBeDefined();
    expect(stub.writes).toHaveLength(2);
  });
});
