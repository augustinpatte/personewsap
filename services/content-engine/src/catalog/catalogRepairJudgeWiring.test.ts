import { describe, expect, it, vi } from "vitest";

import type { GeneratedContentItem, Language, RankedArticle, TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";
import type {
  MiniCaseEditorialJudge,
  MiniCaseJudgeRequest
} from "../miniCase/miniCaseEditorialJudge.js";
import {
  applyCatalogRepairPlan,
  prepareCatalogRepair,
  type CatalogRepairOptions
} from "./catalogRepair.js";
import type { CatalogRepairPlan } from "./catalogRepairPlan.js";
import type {
  BusinessStoryEditorialJudge,
  BusinessStoryJudgeRequest
} from "../generation/businessStoryEditorialJudge.js";

/**
 * How often the semantic judge runs, and on what.
 *
 * One call per Mini Case PAIR — not per language, not per question, never for a
 * Business Story, and never on the apply path. Those are cost and correctness
 * properties at once, so they are asserted by counting real calls rather than
 * trusted to the shape of the code.
 */

const RUN_ID = "launch-catalog-v1-20260820-173307";
const DROP_DATE = "2026-08-20";
const MINI_CASE_ENTRY = `${RUN_ID}-mini-case-ai-02`;
const SECOND_MINI_CASE = `${RUN_ID}-mini-case-ai-04`;
const BUSINESS_ENTRY = `${RUN_ID}-business-story-01`;

let counter = 0;

function article(url: string, title: string): RankedArticle {
  counter += 1;

  return {
    url,
    title,
    publisher: `Desk ${counter}`,
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language: "fr",
    summary:
      "L'opérateur a revu ses tarifs après une hausse des coûts unitaires, et la marge dépend du taux d'acceptation.",
    body:
      "Le contrat porte sur 12 millions d'euros de capacité. La marge dépend du nombre de clients qui acceptent le nouveau tarif, et le concurrent n'a pas suivi.",
    sourceTopic: "tech_ai" as TopicId,
    credibility_score: 0.9,
    content_hash: url,
    normalized_url: url,
    topic: "tech_ai" as TopicId,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

// Deliberately free of English words that read as unaccented French: the
// deterministic generator embeds the source headline in the French title, and
// a word like "decision" would trip the accent validator before the judge is
// ever reached.
const SOURCE = () => article("https://fr.test/ai/original", "Un opérateur réajuste ses tarifs de capacité");

function version(
  entryId: string,
  language: Language,
  contentType: "mini_case" | "business_story",
  index: number
): CatalogEntryVersionRecord {
  return {
    catalogEntryId: entryId,
    contentItemId: `content-${entryId}-${language}`,
    contentType,
    language,
    title: `Stored ${contentType} ${entryId} (${language})`,
    summary: "Stored summary.",
    bodyMd: "Stored body.",
    difficulty: "intro",
    status: "review",
    topic: contentType === "mini_case" ? "tech_ai" : "business",
    metadata: {
      catalog_entry_id: entryId,
      bootstrap_run_id: RUN_ID,
      catalog_entry_index: index,
      catalog_content_type: contentType,
      catalog_mini_case_topic: contentType === "mini_case" ? "ai" : null,
      product_topic: contentType === "mini_case" ? "ai" : null,
      slot: contentType,
      topic: contentType === "mini_case" ? "tech_ai" : "business",
      version: 1,
      scenario_type: "ai_build_vs_buy",
      decision_type: "choose_metric",
      concept_tested: "unit_economics",
      question_pattern: "framework_then_apply_then_decide",
      correct_answer_pattern: "best_next_signal",
      score_max: 3,
      source_urls: ["https://fr.test/ai/original"]
    }
  };
}

function inventory(): CatalogEntryVersionRecord[] {
  return [
    version(MINI_CASE_ENTRY, "fr", "mini_case", 1),
    version(MINI_CASE_ENTRY, "en", "mini_case", 1),
    version(SECOND_MINI_CASE, "fr", "mini_case", 3),
    version(SECOND_MINI_CASE, "en", "mini_case", 3),
    version(BUSINESS_ENTRY, "fr", "business_story", 0),
    version(BUSINESS_ENTRY, "en", "business_story", 0)
  ];
}

function options(overrides: Partial<CatalogRepairOptions> = {}): CatalogRepairOptions {
  return {
    runId: RUN_ID,
    entryIds: [MINI_CASE_ENTRY],
    mode: "rework",
    dropDate: DROP_DATE,
    languages: ["fr", "en"],
    contentStatus: "review",
    useLlm: false,
    productionStrict: false,
    ...overrides
  };
}

function repositoryStub() {
  const writes: Array<{ contentItemId: string; item: GeneratedContentItem }> = [];

  return {
    writes,
    repository: {
      assertPersistenceAvailable: () => undefined,
      listCatalogEntryVersions: vi.fn(async () => inventory()),
      listAssignedContentItemIds: vi.fn(async () => []),
      listSourceArticlesForContentItem: vi.fn(async () => [SOURCE()]),
      deleteMiniCaseHistoryForContentItem: vi.fn(async () => undefined),
      replaceCatalogVersionContent: vi.fn(
        async (args: { contentItemId: string; item: GeneratedContentItem }) => {
          writes.push({ contentItemId: args.contentItemId, item: args.item });
        }
      )
    } as never
  };
}

/** Records every judge call so the count can be asserted, not assumed. */
function countingJudge(pass = true): { judge: MiniCaseEditorialJudge; calls: MiniCaseJudgeRequest[] } {
  const calls: MiniCaseJudgeRequest[] = [];

  return {
    calls,
    judge: {
      model: "gpt-5.6-luna",
      judge: async (request) => {
        calls.push(request);

        return {
          verdict: {
            pass,
            questions: [
              {
                id: "q1",
                plausible_wrong_options: pass ? 3 : 1,
                obviously_irrelevant_options: pass ? [] : ["C"],
                correct_answer_too_obvious: false
              }
            ],
            pair_semantic_parity: true,
            taxonomy_semantic_fit: true,
            topic_promise_fit: pass,
            topic_promise_reason: pass ? "Turns on a real mechanism." : "Teaches capacity planning.",
            tested_domain_mechanism: pass ? "unit economics" : "capacity planning",
            reasons: []
          },
          inputTokens: 900,
          outputTokens: 60,
          costUsd: 0.0001,
          costVerified: false
        };
      }
    }
  };
}

function deps(stub: ReturnType<typeof repositoryStub>, judge?: MiniCaseEditorialJudge) {
  return {
    generator: new StructuredContentGenerator() as ContentGenerator,
    repository: stub.repository,
    loadArticles: async () => [SOURCE()],
    miniCaseJudge: judge
  };
}

describe("the judge runs once per Mini Case pair", () => {
  it("makes exactly one call for a pair generated in two languages", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingJudge();
    const generatorCalls: GenerationRequest[] = [];

    const { plan } = await prepareCatalogRepair(options(), {
      ...deps(stub, judge),
      generator: {
        generateDailyDrop: async (request: GenerationRequest) => {
          generatorCalls.push(request);
          return new StructuredContentGenerator().generateDailyDrop(request);
        }
      } as ContentGenerator
    });

    // Two generation calls — FR then EN — and ONE judge call over the pair.
    expect(generatorCalls).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(plan.entries).toHaveLength(1);
  });

  it("hands the judge both languages in a single request", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingJudge();

    await prepareCatalogRepair(options(), deps(stub, judge));

    expect(calls[0].reference.language).toBe("fr");
    expect(calls[0].counterpart.language).toBe("en");
    // FR/EN parity cannot be judged one side at a time, so both travel together.
    expect(calls[0].reference.item.content_type).toBe("mini_case");
    expect(calls[0].counterpart.item.content_type).toBe("mini_case");
  });

  it("makes one call per entry, not per question", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingJudge();

    await prepareCatalogRepair(
      options({ entryIds: [MINI_CASE_ENTRY, SECOND_MINI_CASE] }),
      deps(stub, judge)
    );

    // Two entries, each with three questions and two languages: two calls.
    expect(calls).toHaveLength(2);
    const questionCount = calls[0].reference.item.questions.length;
    expect(questionCount).toBeGreaterThan(1);
  });

  it("records a rejection as a failed entry with the judge's reason", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingJudge(false);

    const { report, plan } = await prepareCatalogRepair(options(), deps(stub, judge));

    expect(calls).toHaveLength(1);
    expect(plan.entries).toEqual([]);
    expect(report.counts.failed).toBe(1);
    expect(report.failedEntries[0].entryId).toBe(MINI_CASE_ENTRY);
    expect(report.failedEntries[0].details.join(" ")).toContain("failed editorial QA");
    expect(report.failedEntries[0].details.join(" ")).toContain("capacity planning");
  });

  it("keeps partial-plan reporting intact when the judge rejects one of two", async () => {
    const stub = repositoryStub();
    const calls: MiniCaseJudgeRequest[] = [];
    let seen = 0;
    const judge: MiniCaseEditorialJudge = {
      model: "gpt-5.6-luna",
      judge: async (request) => {
        calls.push(request);
        seen += 1;
        const pass = seen === 1;

        return {
          verdict: {
            pass,
            questions: [
              {
                id: "q1",
                plausible_wrong_options: pass ? 3 : 1,
                obviously_irrelevant_options: pass ? [] : ["D"],
                correct_answer_too_obvious: false
              }
            ],
            pair_semantic_parity: true,
            taxonomy_semantic_fit: true,
            topic_promise_fit: true,
            topic_promise_reason: "ok",
            tested_domain_mechanism: "unit economics",
            reasons: []
          },
          inputTokens: 900,
          outputTokens: 60,
          costUsd: 0.0001,
          costVerified: false
        };
      }
    };

    const { report, plan } = await prepareCatalogRepair(
      options({ entryIds: [MINI_CASE_ENTRY, SECOND_MINI_CASE] }),
      deps(stub, judge)
    );

    expect(calls).toHaveLength(2);
    expect(report.requestedEntryIds).toHaveLength(2);
    expect(plan.preparedEntryIds).toEqual([MINI_CASE_ENTRY]);
    expect(plan.failedEntries.map((entry) => entry.entryId)).toEqual([SECOND_MINI_CASE]);
    expect(report.counts.failed).toBe(1);
  });
});

describe("the judge never runs where it should not", () => {
  it("makes zero calls for a Business Story repair", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingJudge();

    await prepareCatalogRepair(
      options({ entryIds: [BUSINESS_ENTRY], mode: "rework" }),
      deps(stub, judge)
    );

    // Business Stories are gated by substance and richness, not by this judge.
    expect(calls).toEqual([]);
  });

  it("makes zero calls when applying a prepared plan", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingJudge();
    const { plan } = await prepareCatalogRepair(options(), deps(stub, judge));

    expect(calls).toHaveLength(1);

    const applyStub = repositoryStub();
    await applyCatalogRepairPlan(plan as CatalogRepairPlan, { persist: true }, {
      repository: applyStub.repository
    });

    // Apply takes a repository and nothing else: there is no judge to call and
    // no slot to pass one into.
    expect(calls).toHaveLength(1);
    expect(applyStub.writes).toHaveLength(2);
  });

  it("runs the deterministic path with no judge at all", async () => {
    const stub = repositoryStub();

    // USE_LLM=false wires no judge, so a fixture run needs no model access.
    const { plan } = await prepareCatalogRepair(options(), deps(stub, undefined));

    expect(plan.entries).toHaveLength(1);
  });
});

/**
 * The Business Story judge, on the same terms: one call per FR/EN pair, none on
 * apply, and a refusal on failure. BS-02 (a tariff war) and BS-04 (a note asking
 * for more evidence) both passed every deterministic gate, so this is the only
 * thing standing between them and a review file.
 */
function countingBusinessStoryJudge(
  outcome: "pass" | "political" | "no-evidence" | "throw" = "pass"
): { judge: BusinessStoryEditorialJudge; calls: BusinessStoryJudgeRequest[] } {
  const calls: BusinessStoryJudgeRequest[] = [];

  return {
    calls,
    judge: {
      model: "gpt-5.6-luna",
      judge: async (request) => {
        calls.push(request);

        if (outcome === "throw") {
          throw new Error("judge unavailable");
        }

        return {
          verdict: {
            pass: outcome === "pass",
            business_mechanism_substantive: true,
            source_support_sufficient: outcome !== "no-evidence",
            editorial_self_refusal: outcome === "no-evidence",
            fr_en_semantic_parity: true,
            political_geopolitical_exclusion_pass: outcome !== "political",
            topic_promise_fit: true,
            reasons: []
          },
          inputTokens: 800,
          outputTokens: 50,
          costUsd: 0.0001,
          costVerified: false
        };
      }
    }
  };
}

describe("the Business Story judge runs once per pair", () => {
  it("makes exactly one call for a pair generated in two languages", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingBusinessStoryJudge();

    const { plan } = await prepareCatalogRepair(options({ entryIds: [BUSINESS_ENTRY] }), {
      ...deps(stub),
      businessStoryJudge: judge
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].reference.language).toBe("fr");
    expect(calls[0].counterpart?.language).toBe("en");
    expect(plan.entries).toHaveLength(1);
  });

  it("refuses a tariff-war story on the political exclusion", async () => {
    const stub = repositoryStub();
    const { judge } = countingBusinessStoryJudge("political");

    const { report, plan } = await prepareCatalogRepair(options({ entryIds: [BUSINESS_ENTRY] }), {
      ...deps(stub),
      businessStoryJudge: judge
    });

    expect(plan.entries).toEqual([]);
    expect(report.failedEntries[0].details.join(" ")).toContain("political or geopolitical");
  });

  it("refuses a story whose sources cannot establish its trade-off", async () => {
    const stub = repositoryStub();
    const { judge } = countingBusinessStoryJudge("no-evidence");

    const { report } = await prepareCatalogRepair(options({ entryIds: [BUSINESS_ENTRY] }), {
      ...deps(stub),
      businessStoryJudge: judge
    });

    expect(report.failedEntries[0].details.join(" ")).toContain("note asking for more evidence");
  });

  it("fails closed when the judge cannot answer", async () => {
    const stub = repositoryStub();
    const { judge } = countingBusinessStoryJudge("throw");

    const { report, plan } = await prepareCatalogRepair(options({ entryIds: [BUSINESS_ENTRY] }), {
      ...deps(stub),
      businessStoryJudge: judge
    });

    expect(plan.entries).toEqual([]);
    expect(report.failedEntries[0].details.join(" ")).toContain("could not be checked by editorial QA");
  });

  it("makes zero calls for a Mini Case repair", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingBusinessStoryJudge();

    await prepareCatalogRepair(options(), { ...deps(stub), businessStoryJudge: judge });

    expect(calls).toEqual([]);
  });

  it("makes zero calls when applying a prepared plan", async () => {
    const stub = repositoryStub();
    const { judge, calls } = countingBusinessStoryJudge();
    const { plan } = await prepareCatalogRepair(options({ entryIds: [BUSINESS_ENTRY] }), {
      ...deps(stub),
      businessStoryJudge: judge
    });

    expect(calls).toHaveLength(1);

    const applyStub = repositoryStub();
    await applyCatalogRepairPlan(plan, { persist: true }, { repository: applyStub.repository });

    // Apply takes a repository and nothing else: no judge, no slot for one.
    expect(calls).toHaveLength(1);
    expect(applyStub.writes).toHaveLength(2);
  });
});
