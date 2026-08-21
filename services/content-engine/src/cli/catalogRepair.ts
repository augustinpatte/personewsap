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

  if (!plan) {
    logProgress("catalog repair prepared nothing", {
      run_id: options.runId,
      refused: report.counts.refused
    });

    return report;
  }

  const planDir = join(resolve(options.outDir), report.repairId);
  const planPath = join(planDir, `repair-${options.mode}-plan.json`);
  const reviewPath = join(planDir, `repair-${options.mode}-review.md`);

  mkdirSync(dirname(planPath), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(reviewPath, renderCatalogRepairReview(plan), "utf8");

  logProgress("catalog repair plan written", {
    plan_path: planPath,
    review_path: reviewPath,
    repair_id: report.repairId,
    prepared_entries: plan.entries.length,
    refused: report.counts.refused,
    next_step: `npm run content:catalog-repair -- --apply-plan ${planPath} --persist`
  });

  return report;
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

  // Applying a reviewed plan needs the plan and nothing else: the run id, the
  // entries, the mode and the source window are all recorded in it.
  if (applyPlanPath) {
    return {
      applyPlanPath,
      onlyEntryIds: entryIds,
      outDir,
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
