import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Language, RankedArticle, TopicId } from "../domain.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator } from "../generation/types.js";
import type { CatalogEntryVersionRecord } from "../storage/contentRepository.js";
import {
  applyCatalogRepairPlan,
  prepareCatalogRepair,
  type CatalogRepairOptions
} from "./catalogRepair.js";
import { renderCatalogRepairReview } from "./catalogRepairReview.js";
import type { CatalogRepairPlan } from "./catalogRepairPlan.js";
import {
  CatalogRepairPartialPlanError,
  writeRepairArtifacts
} from "../cli/catalogRepair.js";
import type { CatalogRepairReport } from "./catalogRepair.js";

/**
 * A batch that prepares nothing still has to leave a record.
 *
 * Two real runs — Mini Case REWORK (2 requested, 0 prepared) and Mini Case
 * REPLACE (5 requested, 0 prepared) — logged "catalog repair prepared nothing",
 * exited non-zero, and wrote no plan and no review. The operator was left with
 * a failed command and nowhere to read why, which is the exact failure mode the
 * failedEntries work was supposed to end.
 *
 * The batch whose every entry was refused is the batch whose reasons matter
 * most. The artifact is a diagnosis first and an applyable plan second.
 */

const RUN_ID = "launch-catalog-v1-20260820-173307";
const DROP_DATE = "2026-08-20";

function article(url: string): RankedArticle {
  return {
    url,
    title: "The original AI capacity decision",
    publisher: "Desk",
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language: "fr",
    summary:
      "L'opérateur a revu ses tarifs après une hausse des coûts unitaires, et la marge dépend du taux d'acceptation.",
    body:
      "Le contrat porte sur 12 millions d'euros de capacité. La marge dépend du nombre de clients qui acceptent le nouveau tarif.",
    sourceTopic: "tech_ai" as TopicId,
    credibility_score: 0.9,
    content_hash: url,
    normalized_url: url,
    topic: "tech_ai" as TopicId,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

const SOURCE = () => article("https://fr.test/ai/original");

function version(entryId: string, language: Language, index: number): CatalogEntryVersionRecord {
  return {
    catalogEntryId: entryId,
    contentItemId: `content-${entryId}-${language}`,
    contentType: "mini_case",
    language,
    title: `Stored case ${entryId} (${language})`,
    summary: "Stored summary.",
    bodyMd: "Stored body.",
    difficulty: "intro",
    // Already published: every requested entry will be refused for this.
    status: "published",
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

function entryIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${RUN_ID}-mini-case-ai-0${index + 1}`);
}

function inventory(count: number): CatalogEntryVersionRecord[] {
  return entryIds(count).flatMap((entryId, index) => [
    version(entryId, "fr", index),
    version(entryId, "en", index)
  ]);
}

function options(count: number, mode: "rework" | "replace"): CatalogRepairOptions {
  return {
    runId: RUN_ID,
    entryIds: entryIds(count),
    mode,
    dropDate: DROP_DATE,
    languages: ["fr", "en"],
    contentStatus: "review",
    useLlm: false,
    productionStrict: false
  };
}

function repositoryStub(count: number) {
  const writes: string[] = [];

  return {
    writes,
    repository: {
      assertPersistenceAvailable: () => undefined,
      listCatalogEntryVersions: vi.fn(async () => inventory(count)),
      listAssignedContentItemIds: vi.fn(async () => []),
      listSourceArticlesForContentItem: vi.fn(async () => [SOURCE()]),
      deleteMiniCaseHistoryForContentItem: vi.fn(async () => undefined),
      replaceCatalogVersionContent: vi.fn(async (args: { contentItemId: string }) => {
        writes.push(args.contentItemId);
      })
    } as never
  };
}

async function prepareAllRefused(count: number, mode: "rework" | "replace") {
  const stub = repositoryStub(count);
  const generatorCalls: unknown[] = [];

  const { report, plan } = await prepareCatalogRepair(options(count, mode), {
    generator: {
      generateDailyDrop: async (request) => {
        generatorCalls.push(request);
        return new StructuredContentGenerator().generateDailyDrop(request);
      }
    } as ContentGenerator,
    repository: stub.repository,
    loadArticles: async () => [SOURCE()]
  });

  return { stub, report, plan, generatorCalls };
}

/**
 * The CLI's own artifact writer, against a temp directory.
 *
 * The real function, not a copy of it: a test that reimplemented the writing
 * would have passed happily while the CLI wrote nothing, which is the bug.
 */
function writeArtifacts(
  plan: CatalogRepairPlan,
  report: CatalogRepairReport,
  mode: "rework" | "replace",
  allowPartialPlan = true
): { planPath: string; reviewPath: string } {
  return writeRepairArtifacts({
    plan,
    report,
    mode,
    outDir: mkdtempSync(join(tmpdir(), "catalog-repair-")),
    allowPartialPlan,
    log: () => undefined
  });
}

describe("a fully refused batch still produces its diagnosis", () => {
  it("writes both artifacts for the real 2-requested / 0-prepared rework", async () => {
    const { report, plan, generatorCalls } = await prepareAllRefused(2, "rework");

    expect(report.requestedEntryIds).toHaveLength(2);
    expect(plan.preparedEntryIds).toEqual([]);
    expect(plan.entries).toEqual([]);
    expect(plan.failedEntries).toHaveLength(2);
    // Refused before generation: no model was asked anything to produce this.
    expect(generatorCalls).toEqual([]);

    const { planPath, reviewPath } = writeArtifacts(plan, report, "rework");

    expect(existsSync(planPath)).toBe(true);
    expect(existsSync(reviewPath)).toBe(true);

    const written = JSON.parse(readFileSync(planPath, "utf8")) as CatalogRepairPlan;
    expect(written.requestedEntryIds).toEqual(entryIds(2));
    expect(written.preparedEntryIds).toEqual([]);
    expect(written.failedEntries.map((entry) => entry.entryId)).toEqual(entryIds(2));
  });

  it("writes both artifacts for the real 5-requested / 0-prepared replace", async () => {
    const { report, plan } = await prepareAllRefused(5, "replace");

    expect(report.requestedEntryIds).toHaveLength(5);
    expect(plan.entries).toEqual([]);
    expect(plan.failedEntries).toHaveLength(5);

    const { planPath, reviewPath } = writeArtifacts(plan, report, "replace");
    const review = readFileSync(reviewPath, "utf8");

    expect(existsSync(planPath)).toBe(true);
    expect(review).toContain("- **Requested**: 5");
    expect(review).toContain("- **Prepared**: 0");
    expect(review).toContain("- **Failed**: 5");
    expect(review).toContain("Entries that produced no candidate");

    for (const entryId of entryIds(5)) {
      expect(review).toContain(entryId);
    }
  });

  it("preserves the exact refusal reason for every entry", async () => {
    const { plan } = await prepareAllRefused(2, "rework");
    const review = renderCatalogRepairReview(plan);

    for (const failure of plan.failedEntries) {
      expect(failure.details).toHaveLength(1);
      // The real reason, not a summary of it.
      expect(failure.details[0]).toContain("status published");
      expect(failure.details[0]).toContain("only ever touches content still in review");
      expect(review).toContain(failure.details[0]);
    }
  });

  it("still exits non-zero, after the artifacts are on disk", async () => {
    const { report, plan } = await prepareAllRefused(2, "rework");
    const outDir = mkdtempSync(join(tmpdir(), "catalog-repair-"));

    let thrown: unknown;
    try {
      writeRepairArtifacts({
        plan,
        report,
        mode: "rework",
        outDir,
        allowPartialPlan: false,
        log: () => undefined
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CatalogRepairPartialPlanError);
    const failure = thrown as CatalogRepairPartialPlanError;
    expect(failure.failedEntryIds).toEqual(entryIds(2));
    // The command fails, and the files it names exist.
    expect(failure.artifacts).not.toBeNull();
    expect(existsSync(failure.artifacts!.planPath)).toBe(true);
    expect(existsSync(failure.artifacts!.reviewPath)).toBe(true);
  });

  it("exits successfully with --allow-partial-plan, and still writes them", async () => {
    const { report, plan } = await prepareAllRefused(5, "replace");
    const { planPath, reviewPath } = writeArtifacts(plan, report, "replace", true);

    expect(existsSync(planPath)).toBe(true);
    expect(existsSync(reviewPath)).toBe(true);
    // Accepting the exit code does not conjure a candidate.
    expect(JSON.parse(readFileSync(planPath, "utf8")).entries).toEqual([]);
  });

  it("shows the counts even when the plan carries no candidate section", async () => {
    const { plan } = await prepareAllRefused(2, "rework");
    const review = renderCatalogRepairReview(plan);

    expect(review).toContain("- **Requested**: 2");
    expect(review).toContain("- **Prepared**: 0");
    expect(review).toContain("- **Failed**: 2");
    // Nothing to review as a candidate, so no candidate section is rendered.
    expect(review).not.toContain("What is being replaced");
  });
});

describe("an empty plan is a record, never something to apply", () => {
  it("is refused cleanly at apply, naming what was asked and refused", async () => {
    const { plan } = await prepareAllRefused(5, "replace");

    await expect(
      applyCatalogRepairPlan(plan, { persist: true }, { repository: repositoryStub(5).repository })
    ).rejects.toThrow(/contains no prepared candidates: 5 of 5 requested entries were refused/);
  });

  it("writes nothing to the database when refused", async () => {
    const { plan } = await prepareAllRefused(2, "rework");
    const applyStub = repositoryStub(2);

    await expect(
      applyCatalogRepairPlan(plan, { persist: true }, { repository: applyStub.repository })
    ).rejects.toThrow();

    expect(applyStub.writes).toEqual([]);
  });

  it("carries no applyable entry even when partial plans are allowed", async () => {
    // --allow-partial-plan changes the exit code, not the contents: there is
    // still nothing in the plan that could be written.
    const { plan } = await prepareAllRefused(5, "replace");

    expect(plan.entries).toEqual([]);
    expect(plan.preparedEntryIds).toEqual([]);
    expect(plan.failedEntries).toHaveLength(5);
  });
});
