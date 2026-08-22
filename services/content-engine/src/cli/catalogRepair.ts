import { isLanguage, LANGUAGES, type Language, type RankedArticle, type TopicId } from "../domain.js";
import { LlmContentGenerator } from "../generation/llmGenerator.js";
import { StructuredContentGenerator } from "../generation/structuredGenerator.js";
import type { ContentGenerator } from "../generation/types.js";
import { processArticles } from "../processing/pipeline.js";
import { getProductEditionDate } from "../scheduler/editionCadence.js";
import { CURATED_SOURCES } from "../sources/curatedSources.js";
import { RssFeedConnector } from "../sources/rssFetcher.js";
import { SourceFetcher } from "../sources/sourceFetcher.js";
import { ContentRepository } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  applyCatalogRepairPlan,
  prepareCatalogRepair,
  type CatalogRepairMode,
  type CatalogRepairReport
} from "../catalog/catalogRepair.js";
import { renderCatalogRepairReview } from "../catalog/catalogRepairReview.js";
import { createLunaMiniCaseEditorialJudge } from "../miniCase/miniCaseEditorialJudge.js";
import { createLunaBusinessStoryEditorialJudge } from "../generation/businessStoryEditorialJudge.js";
import type { CatalogRepairPlan } from "../catalog/catalogRepairPlan.js";
import { catalogSourceSince } from "../catalog/catalogRecency.js";
import {
  clampCatalogRecencyDays,
  DEFAULT_CATALOG_SOURCE_RECENCY_DAYS
} from "../catalog/catalogRecency.js";

/**
 * `catalog-repair` — replace named catalog pairs, and nothing else.
 *
 * Two phases, because an editorial repair is reviewed by a human in between:
 *
 *   PREPARE  --run-id --entry-id... --mode rework|replace
 *            Generates and validates the candidates ONCE, writes a plan and a
 *            readable review file. Never touches the database.
 *
 *   APPLY    --apply-plan <path> --persist
 *            Writes exactly the candidates in the plan. No generator, no feed:
 *            what was reviewed is what is written.
 *
 * Writing is gated twice, as in `bootstrap-catalog` and `catalog-publish`:
 * `--persist` states the intent, `CONFIRM_CATALOG_REPAIR=true` confirms it.
 */

export type CatalogRepairCliOptions = {
  /** Set when applying a prepared plan instead of preparing a new one. */
  applyPlanPath: string | null;
  /** Apply only these entries from the plan. Empty means all of them. */
  onlyEntryIds: string[];
  /** Where prepare writes its artifacts. */
  outDir: string;
  /** Accept a plan that covers fewer entries than were requested. */
  allowPartialPlan: boolean;
  runId: string;
  entryIds: string[];
  mode: CatalogRepairMode;
  dropDate: string;
  languages: Language[];
  persist: boolean;
  contentStatus: "draft" | "review" | "published";
  useLlm: boolean;
  liveRss: boolean;
  liveRssOnly: boolean;
  sourceLimitPerTopic: number;
  catalogRecencyDays: number;
};

export async function runCatalogRepairCli(
  options: CatalogRepairCliOptions
): Promise<CatalogRepairReport> {
  if (options.applyPlanPath) {
    return applyPreparedPlan(options);
  }

  return prepareCandidates(options);
}

/**
 * PHASE 2. Read the reviewed plan and write exactly it.
 *
 * No generator is constructed and no source fetcher exists in this function.
 * `applyCatalogRepairPlan` takes only a repository, so there is nothing here
 * that could regenerate a candidate even by mistake.
 */
async function applyPreparedPlan(options: CatalogRepairCliOptions): Promise<CatalogRepairReport> {
  const planPath = resolve(options.applyPlanPath as string);
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as CatalogRepairPlan;

  logProgress("catalog repair apply started", {
    plan_path: planPath,
    repair_id: plan.repairId,
    run_id: plan.runId,
    mode: plan.mode,
    plan_entries: Array.isArray(plan.entries) ? plan.entries.length : 0,
    only_entry_ids: options.onlyEntryIds,
    persist: options.persist,
    dry_run: !options.persist
  });

  return applyCatalogRepairPlan(
    plan,
    { persist: options.persist, onlyEntryIds: options.onlyEntryIds },
    {
      repository: new ContentRepository(createServiceRoleSupabaseClient({ requireCredentials: true })),
      onProgress: (message, details) => logProgress(message, details)
    }
  );
}

/** PHASE 1. Generate once, validate, write the plan and the review file. */
async function prepareCandidates(options: CatalogRepairCliOptions): Promise<CatalogRepairReport> {
  if (options.persist && !options.liveRssOnly) {
    throw new Error(
      "catalog-repair refused to persist because sample_articles would be enabled. Repaired catalog content requires LIVE_RSS_ONLY=true."
    );
  }

  const sourceFetcher = new SourceFetcher(
    options.liveRss ? [new RssFeedConnector(CURATED_SOURCES)] : []
  );
  const repository = new ContentRepository(createServiceRoleSupabaseClient({ requireCredentials: true }));
  const articleCache = new Map<string, RankedArticle[]>();

  logProgress("catalog repair started", {
    dry_run: !options.persist,
    persist: options.persist,
    run_id: options.runId,
    mode: options.mode,
    entry_ids: options.entryIds,
    languages: options.languages,
    generator: options.useLlm ? "llm" : "deterministic",
    mini_case_editorial_qa: options.useLlm ? "gpt-5.6-luna" : "disabled",
    business_story_editorial_qa: options.useLlm ? "gpt-5.6-luna" : "disabled",
    live_rss_only: options.liveRssOnly,
    catalog_recency_days: options.catalogRecencyDays
  });

  const { report, plan } = await prepareCatalogRepair(
    {
      runId: options.runId,
      entryIds: options.entryIds,
      mode: options.mode,
      dropDate: options.dropDate,
      languages: options.languages,
      contentStatus: options.contentStatus,
      useLlm: options.useLlm,
      catalogRecencyDays: options.catalogRecencyDays
    },
    {
      generator: createGenerator(options.useLlm),
      // Semantic QA on every generated Mini Case pair, on the LLM path only.
      // One call per pair — the guard lives in prepareOneEntry, which runs it
      // once on the finished FR/EN pair and never for a Business Story. The
      // deterministic generator gets no judge: its output is fixed, so there is
      // nothing for a model to have an opinion about, and the tests must not
      // need network access.
      miniCaseJudge: options.useLlm ? createLunaMiniCaseEditorialJudge() : undefined,
      businessStoryJudge: options.useLlm ? createLunaBusinessStoryEditorialJudge() : undefined,
      repository,
      onProgress: (message, details) => logProgress(message, details),
      loadArticles: async (language, recencyDays) => {
        const windowDays = recencyDays ?? options.catalogRecencyDays;
        const cacheKey = `${language}:${windowDays}`;
        const cached = articleCache.get(cacheKey);

        if (cached) {
          return cached;
        }

        const since = catalogSourceSince(options.dropDate, windowDays);
        const raw = await sourceFetcher.fetch({
          topics: SOURCE_TOPICS,
          languages: [language],
          since,
          limitPerTopic: options.sourceLimitPerTopic
        });
        const ranked = processArticles(raw).filter((article) => article.language === language);
        articleCache.set(cacheKey, ranked);

        logProgress("source pool ready", {
          language,
          since,
          fetched_articles: raw.length,
          ranked_articles: ranked.length
        });

        return ranked;
      }
    }
  );

  writeRepairArtifacts({
    plan,
    report,
    mode: options.mode,
    outDir: options.outDir,
    allowPartialPlan: options.allowPartialPlan
  });

  return report;
}

/**
 * Write the plan and the review, then decide whether the command failed.
 *
 * Both files are written FIRST, unconditionally, including when nothing was
 * prepared. Two real batches — 2 requested / 0 prepared, and 5 requested / 0
 * prepared — logged "prepared nothing", exited non-zero, and left no record at
 * all, because the earlier version threw before it got here. The batch that
 * refused everything is the one whose reasons the operator most needs.
 *
 * Exported so the tests exercise this exact function rather than a copy of it.
 */
export function writeRepairArtifacts(input: {
  plan: CatalogRepairPlan;
  report: CatalogRepairReport;
  mode: CatalogRepairMode;
  outDir: string;
  allowPartialPlan: boolean;
  log?: (message: string, details: Record<string, unknown>) => void;
}): { planPath: string; reviewPath: string } {
  const { plan, report } = input;
  const log = input.log ?? logProgress;
  const planDir = join(resolve(input.outDir), report.repairId);
  const planPath = join(planDir, `repair-${input.mode}-plan.json`);
  const reviewPath = join(planDir, `repair-${input.mode}-review.md`);

  mkdirSync(dirname(planPath), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(reviewPath, renderCatalogRepairReview(plan), "utf8");

  const prepared = plan.preparedEntryIds.length;

  log(prepared === 0 ? "catalog repair prepared nothing" : "catalog repair plan written", {
    plan_path: planPath,
    review_path: reviewPath,
    repair_id: report.repairId,
    requested: report.requestedEntryIds.length,
    prepared,
    failed: report.counts.failed,
    failed_entries: report.failedEntries,
    next_step:
      prepared === 0
        ? `Nothing to apply. Read ${reviewPath}, fix what it names, and prepare again.`
        : `npm run content:catalog-repair -- --apply-plan ${planPath} --persist`
  });

  // A batch that produced fewer candidates than were requested is not a
  // success, whether it produced five of eight or none of five. The artifacts
  // exist either way; the exit code is what stops a script treating it as done.
  // `--allow-partial-plan` is the explicit way to accept it.
  if (report.counts.failed > 0 && !input.allowPartialPlan) {
    throw new CatalogRepairPartialPlanError(
      report.failedEntries.map((entry) => entry.entryId),
      report,
      { planPath, reviewPath }
    );
  }

  return { planPath, reviewPath };
}

/**
 * Thrown when prepare produced fewer candidates than were requested.
 *
 * Carries the report so the caller can still print what WAS prepared, and names
 * every failed entry with its reason: the first real batch lost three requests
 * into a plan that reported success, and that must not be possible again.
 */
export class CatalogRepairPartialPlanError extends Error {
  readonly reason = "catalog_repair_partial_plan";
  readonly failedEntryIds: string[];
  readonly report: CatalogRepairReport;
  readonly artifacts: { planPath: string; reviewPath: string } | null;

  constructor(
    failedEntryIds: string[],
    report: CatalogRepairReport,
    artifacts: { planPath: string; reviewPath: string } | null = null
  ) {
    super(
      `catalog-repair prepared ${report.requestedEntryIds.length - failedEntryIds.length} of ${report.requestedEntryIds.length} requested entries. Failed: ${report.failedEntries
        .map((entry) => `${entry.entryId} (${entry.reason})`)
        .join("; ")}. Re-run the failed entries, or pass --allow-partial-plan to accept this plan as it is.`
    );
    this.name = "CatalogRepairPartialPlanError";
    this.failedEntryIds = failedEntryIds;
    this.report = report;
    this.artifacts = artifacts;
  }
}

/** Artifacts land beside the repo by default, never inside src. */
const DEFAULT_OUT_DIR = "runs/catalog-repair";

const SOURCE_TOPICS: TopicId[] = [
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering"
];

export function parseCatalogRepairOptions(args: string[]): CatalogRepairCliOptions {
  const flags = readFlags(args);
  const entryIds = readRepeatedFlag(args, "entry-id");
  const persistRequested = flags.has("persist") || envFlag("PERSIST_CATALOG_REPAIR");
  const confirmed = process.env.CONFIRM_CATALOG_REPAIR === "true";

  if (persistRequested && !confirmed) {
    throw new Error(
      "catalog-repair refused to persist. Writes require CONFIRM_CATALOG_REPAIR=true together with --persist. Run without --persist for the default no-write dry run."
    );
  }

  const applyPlanPath = flags.get("apply-plan") ?? null;
  const liveRssOnly = flags.has("live-rss-only") || envFlag("LIVE_RSS_ONLY");
  const outDir = flags.get("out-dir") ?? process.env.CATALOG_REPAIR_OUT_DIR ?? DEFAULT_OUT_DIR;
  const allowPartialPlan = flags.has("allow-partial-plan");

  // Applying a reviewed plan needs the plan and nothing else: the run id, the
  // entries, the mode and the source window are all recorded in it.
  if (applyPlanPath) {
    return {
      applyPlanPath,
      onlyEntryIds: entryIds,
      outDir,
      allowPartialPlan,
      runId: flags.get("run-id") ?? process.env.CATALOG_RUN_ID ?? "",
      entryIds,
      mode: "rework",
      dropDate: flags.get("date") ?? getProductEditionDate(),
      languages: parseLanguages(flags.get("languages") ?? process.env.LANGUAGES ?? "fr,en"),
      persist: persistRequested && confirmed,
      contentStatus: "review",
      useLlm: false,
      liveRss: false,
      liveRssOnly,
      sourceLimitPerTopic: 0,
      catalogRecencyDays: DEFAULT_CATALOG_SOURCE_RECENCY_DAYS
    };
  }

  const runId = flags.get("run-id") ?? process.env.CATALOG_RUN_ID;
  if (!runId) {
    throw new Error("catalog-repair requires --run-id or CATALOG_RUN_ID.");
  }

  if (entryIds.length === 0) {
    throw new Error("catalog-repair requires at least one --entry-id <catalog entry id>.");
  }

  const mode = flags.get("mode");
  if (mode !== "rework" && mode !== "replace") {
    throw new Error("catalog-repair requires --mode rework or --mode replace.");
  }

  if (persistRequested) {
    // Prepare exists so a human reads the candidate before it is written.
    // Letting it also write would put the review back where it was.
    throw new Error(
      "catalog-repair prepare never writes. Run it without --persist to produce a plan, review the generated repair-*-review.md, then apply it with --apply-plan <plan.json> --persist."
    );
  }

  return {
    applyPlanPath: null,
    onlyEntryIds: [],
    outDir,
    allowPartialPlan,
    runId,
    entryIds,
    mode,
    dropDate: flags.get("date") ?? getProductEditionDate(),
    languages: parseLanguages(flags.get("languages") ?? process.env.LANGUAGES ?? "fr,en"),
    persist: false,
    contentStatus: "review",
    useLlm: envFlag("USE_LLM") || flags.has("llm"),
    liveRss: liveRssOnly || envFlag("LIVE_RSS") || flags.has("live-rss"),
    liveRssOnly,
    sourceLimitPerTopic: parseCount(
      flags.get("limit-per-topic") ?? process.env.RSS_ARTICLES_PER_SOURCE,
      10
    ),
    catalogRecencyDays: clampCatalogRecencyDays(
      parseCount(
        flags.get("source-recency-days") ?? process.env.CATALOG_SOURCE_RECENCY_DAYS,
        DEFAULT_CATALOG_SOURCE_RECENCY_DAYS
      )
    )
  };
}

function createGenerator(useLlm: boolean): ContentGenerator {
  if (!useLlm) {
    return new StructuredContentGenerator();
  }

  return new LlmContentGenerator({
    onProgress: (message, details) => logProgress(message, details)
  });
}

function parseLanguages(value: string): Language[] {
  const languages = value.split(",").map((language) => language.trim()).filter(Boolean);

  if (languages.length === 0 || languages.some((language) => !isLanguage(language))) {
    throw new Error(`LANGUAGES must be a comma-separated list of: ${LANGUAGES.join(", ")}.`);
  }

  return languages as Language[];
}

function parseCount(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received "${value}".`);
  }

  return parsed;
}

/** Every occurrence of a repeatable flag, so several entries repair in one run. */
function readRepeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === `--${name}` && args[index + 1] && !args[index + 1].startsWith("--")) {
      values.push(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3));
    }
  }

  return values;
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [name, inlineValue] = arg.slice(2).split("=");

    if (inlineValue !== undefined) {
      values.set(name, inlineValue);
      continue;
    }

    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      values.set(name, next);
      index += 1;
      continue;
    }

    values.set(name, "true");
  }

  return values;
}

function envFlag(name: string): boolean {
  return process.env[name]?.toLowerCase() === "true";
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ level: "info", scope: "catalog-repair", message, ...details })}\n`
  );
}
