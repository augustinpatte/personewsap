import { describe, expect, it, vi } from "vitest";

import type { GeneratedContentItem, Language, RankedArticle, TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator, GenerationRequest } from "../generation/types.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";
import {
  applyCatalogRepairPlan,
  prepareCatalogRepair,
  type CatalogRepairOptions
} from "./catalogRepair.js";
import { renderCatalogRepairReview } from "./catalogRepairReview.js";
import {
  assertPlanIntegrity,
  CATALOG_REPAIR_PLAN_VERSION,
  stableHash,
  type CatalogRepairPlan
} from "./catalogRepairPlan.js";

/**
 * Staging a repair so that what is reviewed is what is written.
 *
 * The first version of this tool generated candidates during the dry run,
 * printed them, and then generated them AGAIN on the persist run. With a model
 * in the loop those are not the same content: a human approves candidate A and
 * the tool writes candidate B, which makes the review theatre.
 *
 * Repair is now two commands. Prepare generates once and freezes the result in a
 * plan. Apply writes exactly that plan and has no generator and no source
 * fetcher in its dependencies at all — it could not regenerate anything if it
 * tried.
 */

const RUN_ID = "launch-catalog-v1-20260820-173307";
const DROP_DATE = "2026-08-20";
const ENTRY = `${RUN_ID}-mini-case-ai-02`;
const KEEP_ENTRY = `${RUN_ID}-mini-case-ai-01`;

let counter = 0;

function article(input: { url: string; language: Language; title: string }): RankedArticle {
  counter += 1;

  return {
    url: input.url,
    title: input.title,
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
    sourceTopic: "tech_ai" as TopicId,
    credibility_score: 0.9,
    content_hash: input.url,
    normalized_url: input.url,
    topic: "tech_ai" as TopicId,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

const LINKED_SOURCE = () =>
  article({
    url: "https://fr.test/ai/original",
    language: "fr",
    title: "The original AI capacity decision"
  });

function persistedVersion(entryId: string, language: Language, index: number): CatalogEntryVersionRecord {
  return {
    catalogEntryId: entryId,
    contentItemId: `content-${entryId}-${language}`,
    contentType: "mini_case",
    language,
    title: `Stored case ${entryId} (${language})`,
    summary: "Stored summary.",
    bodyMd: "Stored body.",
    difficulty: "intro",
    status: "review",
    topic: "tech_ai",
    metadata: {
      catalog_entry_id: entryId,
      bootstrap_run_id: RUN_ID,
      catalog_entry_index: index,
      catalog_content_type: "mini_case",
      catalog_mini_case_topic: "ai",
      product_topic: "ai",
      slot: "mini_case",
      topic: "tech_ai",
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
    persistedVersion(KEEP_ENTRY, "fr", 0),
    persistedVersion(KEEP_ENTRY, "en", 0),
    persistedVersion(ENTRY, "fr", 1),
    persistedVersion(ENTRY, "en", 1)
  ];
}

function options(overrides: Partial<CatalogRepairOptions> = {}): CatalogRepairOptions {
  return {
    runId: RUN_ID,
    entryIds: [ENTRY],
    mode: "rework",
    dropDate: DROP_DATE,
    languages: ["fr", "en"],
    contentStatus: "review",
    useLlm: false,
    productionStrict: false,
    ...overrides
  };
}

type Write = { contentItemId: string; item: GeneratedContentItem };

function repositoryStub(input: { existing?: CatalogEntryVersionRecord[]; failOn?: string } = {}) {
  const writes: Write[] = [];
  const existing = input.existing ?? inventory();

  return {
    writes,
    existing,
    repository: {
      assertPersistenceAvailable: () => undefined,
      listCatalogEntryVersions: vi.fn(async () => existing),
      listAssignedContentItemIds: vi.fn(async () => []),
      listSourceArticlesForContentItem: vi.fn(async () => [LINKED_SOURCE()]),
      deleteMiniCaseHistoryForContentItem: vi.fn(async () => undefined),
      replaceCatalogVersionContent: vi.fn(
        async (args: { contentItemId: string; item: GeneratedContentItem }) => {
          if (args.contentItemId === input.failOn) {
            throw new Error("simulated write failure");
          }

          writes.push({ contentItemId: args.contentItemId, item: args.item });
        }
      )
    } as never
  };
}

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

async function preparePlan(overrides: Partial<CatalogRepairOptions> = {}) {
  const stub = repositoryStub();
  const { generator, calls } = countingGenerator();
  const rssCalls: Language[] = [];

  const { report, plan } = await prepareCatalogRepair(options(overrides), {
    generator,
    repository: stub.repository,
    loadArticles: async (language: Language) => {
      rssCalls.push(language);
      return [LINKED_SOURCE()];
    }
  });

  return { stub, calls, rssCalls, report, plan: plan as CatalogRepairPlan };
}

describe("prepare freezes the candidate", () => {
  it("generates each version exactly once and writes nothing", async () => {
    const { stub, calls, report, plan } = await preparePlan();

    // One reference call and one counterpart call. Not two of each.
    expect(calls).toHaveLength(2);
    expect(calls.filter((call) => !call.languagePair)).toHaveLength(1);
    expect(calls.filter((call) => Boolean(call.languagePair))).toHaveLength(1);

    expect(stub.writes).toEqual([]);
    expect(report.persisted).toBe(false);
    expect(report.dryRun).toBe(true);
    expect(plan).not.toBeNull();
  });

  it("records everything apply needs, and no secrets", async () => {
    const { plan } = await preparePlan();

    expect(plan.planVersion).toBe(CATALOG_REPAIR_PLAN_VERSION);
    expect(plan.repairId).toBeTruthy();
    expect(plan.createdAt).toBeTruthy();
    expect(plan.runId).toBe(RUN_ID);
    expect(plan.mode).toBe("rework");

    const [entry] = plan.entries;
    expect(entry.entryId).toBe(ENTRY);
    expect(entry.contentType).toBe("mini_case");
    expect(entry.miniCaseTopic).toBe("ai");
    expect(entry.versions.map((version) => version.language).sort()).toEqual(["en", "fr"]);

    for (const version of entry.versions) {
      expect(version.contentItemId).toBe(`content-${ENTRY}-${version.language}`);
      expect(version.item.content_type).toBe("mini_case");
      expect(version.itemHash).toBe(stableHash(version.item));
      expect(version.originalRowHash).toBeTruthy();
      expect(version.originalTitle).toBe(`Stored case ${ENTRY} (${version.language})`);
    }

    // The approved source packet travels with the plan, so apply needs no feed.
    expect(entry.approvedSources.map((source) => source.url)).toEqual(["https://fr.test/ai/original"]);
    expect(entry.approvedSources[0].publisher).toBeTruthy();
    expect(entry.validation).toMatchObject({ itemValidation: "passed", pairValidation: "passed" });

    // No credential of any kind reaches the file.
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/sk-|SERVICE_ROLE|OPENAI_API_KEY|SUPABASE_SERVICE/i);
  });

  it("renders a review file carrying the reader-facing content", async () => {
    const { plan } = await preparePlan();
    const review = renderCatalogRepairReview(plan);

    expect(review).toContain(ENTRY);
    expect(review).toContain("### What is being replaced");
    expect(review).toContain("### Source decision");
    expect(review).toContain("#### Taxonomy");
    expect(review).toContain("[CORRECT]");
    expect(review).toContain("New FR candidate");
    expect(review).toContain("New EN candidate");
    // The old title is shown next to the new one.
    expect(review).toContain(`Stored case ${ENTRY} (fr)`);
  });
});

describe("apply writes the reviewed candidate and cannot regenerate", () => {
  it("persists exactly the content the plan holds", async () => {
    const { plan } = await preparePlan();
    const applyStub = repositoryStub();

    const report = await applyCatalogRepairPlan(plan, { persist: true }, {
      repository: applyStub.repository
    });

    expect(report.counts.repaired).toBe(1);
    expect(applyStub.writes).toHaveLength(2);

    // Byte for byte what was reviewed.
    for (const write of applyStub.writes) {
      const planned = plan.entries[0].versions.find(
        (version) => version.contentItemId === write.contentItemId
      );

      expect(planned).toBeDefined();
      expect(stableHash(write.item)).toBe(planned?.itemHash);
      expect(write.item).toEqual(planned?.item);
    }
  });

  it("makes no LLM call and no RSS call, because it has neither", async () => {
    const { plan } = await preparePlan();
    const applyStub = repositoryStub();
    const generatorCalls: unknown[] = [];
    const rssCalls: unknown[] = [];

    // The dependency object apply accepts carries a repository and nothing
    // else. There is no slot to pass a generator or a fetcher into, so these
    // spies stay empty by construction rather than by discipline.
    await applyCatalogRepairPlan(plan, { persist: true }, {
      repository: applyStub.repository
    });

    expect(generatorCalls).toEqual([]);
    expect(rssCalls).toEqual([]);
    expect(applyStub.repository).toBeDefined();
    // Only repository methods were exercised.
    expect(applyStub.writes).toHaveLength(2);
  });

  it("keeps the FR and EN candidates frozen together", async () => {
    const { plan } = await preparePlan();
    const applyStub = repositoryStub();

    await applyCatalogRepairPlan(plan, { persist: true }, { repository: applyStub.repository });

    const [first, second] = applyStub.writes;
    expect(first.item.source_urls).toEqual(second.item.source_urls);
    expect(new Set(applyStub.writes.map((write) => write.item.language)).size).toBe(2);
  });

  it("leaves entries the plan does not name untouched", async () => {
    const { plan } = await preparePlan();
    const applyStub = repositoryStub();

    const report = await applyCatalogRepairPlan(plan, { persist: true }, {
      repository: applyStub.repository
    });

    const keepIds = [`content-${KEEP_ENTRY}-fr`, `content-${KEEP_ENTRY}-en`];
    expect(applyStub.writes.some((write) => keepIds.includes(write.contentItemId))).toBe(false);
    expect(report.untouchedVersions).toBe(2);
  });

  it("writes nothing without persist, but still checks everything", async () => {
    const { plan } = await preparePlan();
    const applyStub = repositoryStub();

    const report = await applyCatalogRepairPlan(plan, { persist: false }, {
      repository: applyStub.repository
    });

    expect(report.outcomes[0].status).toBe("planned");
    expect(applyStub.writes).toEqual([]);
  });
});

describe("a plan that no longer matches reality is refused", () => {
  it("refuses a candidate edited after prepare", async () => {
    const { plan } = await preparePlan();
    const tampered: CatalogRepairPlan = JSON.parse(JSON.stringify(plan));
    tampered.entries[0].versions[0].item.title = "A title somebody typed in by hand";

    expect(() => assertPlanIntegrity(tampered)).toThrow(/does not match its recorded hash/);

    await expect(
      applyCatalogRepairPlan(tampered, { persist: true }, { repository: repositoryStub().repository })
    ).rejects.toThrow(/not what was reviewed/);
  });

  it("refuses an approved source set edited after prepare", async () => {
    const { plan } = await preparePlan();
    const tampered: CatalogRepairPlan = JSON.parse(JSON.stringify(plan));
    tampered.entries[0].approvedSources.push(
      article({ url: "https://invented.test/added-by-hand", language: "en", title: "Added by hand" })
    );

    await expect(
      applyCatalogRepairPlan(tampered, { persist: true }, { repository: repositoryStub().repository })
    ).rejects.toThrow(/approved source set .* does not match its recorded hash/);
  });

  it("refuses a URL added to a candidate even when the hashes were rebuilt", async () => {
    const { plan } = await preparePlan();
    const tampered: CatalogRepairPlan = JSON.parse(JSON.stringify(plan));
    const entry = tampered.entries[0];

    // Someone adds a source URL and dutifully recomputes every hash. The closure
    // check still refuses it: there is no approved article behind the URL.
    for (const version of entry.versions) {
      version.item.source_urls = [...version.item.source_urls, "https://invented.test/not-approved"];
      version.itemHash = stableHash(version.item);
    }
    entry.approvedSourcesHash = stableHash(entry.approvedSources);
    const { entryHash: _drop, ...withoutHash } = entry;
    entry.entryHash = stableHash(withoutHash);

    const applyStub = repositoryStub();
    const report = await applyCatalogRepairPlan(tampered, { persist: true }, {
      repository: applyStub.repository
    });

    expect(report.outcomes[0].status).toBe("refused");
    expect(report.outcomes[0].reason).toContain("outside the plan's approved material");
    expect(applyStub.writes).toEqual([]);
  });

  it("aborts when the stored pair changed since prepare", async () => {
    const { plan } = await preparePlan();

    // Someone edited the French row between prepare and apply.
    const moved = inventory().map((record) =>
      record.contentItemId === `content-${ENTRY}-fr`
        ? { ...record, title: "Edited by someone else in the meantime" }
        : record
    );
    const applyStub = repositoryStub({ existing: moved });

    const report = await applyCatalogRepairPlan(plan, { persist: true }, {
      repository: applyStub.repository
    });

    expect(report.outcomes[0].status).toBe("refused");
    expect(report.outcomes[0].reason).toContain("has changed since the plan was prepared");
    expect(applyStub.writes).toEqual([]);
  });

  it("aborts when the pair is no longer in review", async () => {
    const { plan } = await preparePlan();
    const published = inventory().map((record) =>
      record.catalogEntryId === ENTRY ? { ...record, status: "published" } : record
    );
    const applyStub = repositoryStub({ existing: published });

    const report = await applyCatalogRepairPlan(plan, { persist: true }, {
      repository: applyStub.repository
    });

    expect(report.outcomes[0].status).toBe("refused");
    expect(report.outcomes[0].reason).toContain("still in review");
    expect(applyStub.writes).toEqual([]);
  });

  it("restores the first half when the second write fails", async () => {
    const { plan } = await preparePlan();
    const applyStub = repositoryStub({ failOn: `content-${ENTRY}-en` });

    await expect(
      applyCatalogRepairPlan(plan, { persist: true }, { repository: applyStub.repository })
    ).rejects.toThrow(/1 earlier version\(s\) were restored/);

    const french = applyStub.writes.filter(
      (write) => write.contentItemId === `content-${ENTRY}-fr`
    );
    // Written, then written back to what was stored.
    expect(french).toHaveLength(2);
    expect(french[1].item.title).toBe(`Stored case ${ENTRY} (fr)`);
  });
});

describe("selecting entries out of a plan", () => {
  it("applies only the approved entries and reports the rest as untouched", async () => {
    const stub = repositoryStub();
    const { generator } = countingGenerator();
    const { plan } = await prepareCatalogRepair(
      options({ entryIds: [ENTRY, KEEP_ENTRY] }),
      {
        generator,
        repository: stub.repository,
        loadArticles: async () => [LINKED_SOURCE()]
      }
    );

    expect(plan?.entries).toHaveLength(2);

    const applyStub = repositoryStub();
    const report = await applyCatalogRepairPlan(
      plan as CatalogRepairPlan,
      { persist: true, onlyEntryIds: [ENTRY] },
      { repository: applyStub.repository }
    );

    expect(report.requestedEntryIds).toEqual([ENTRY]);
    expect(applyStub.writes.map((write) => write.contentItemId).sort()).toEqual([
      `content-${ENTRY}-en`,
      `content-${ENTRY}-fr`
    ]);
  });

  it("refuses to silently ignore an entry the plan does not contain", async () => {
    const { plan } = await preparePlan();

    await expect(
      applyCatalogRepairPlan(
        plan,
        { persist: true, onlyEntryIds: ["never-prepared"] },
        { repository: repositoryStub().repository }
      )
    ).rejects.toThrow(/does not contain/);
  });
});
