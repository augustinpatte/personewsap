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
import {
  runCatalogRepair,
  type CatalogRepairMode,
  type CatalogRepairReport
} from "../catalog/catalogRepair.js";
import { catalogSourceSince } from "../catalog/catalogRecency.js";
import {
  clampCatalogRecencyDays,
  DEFAULT_CATALOG_SOURCE_RECENCY_DAYS
} from "../catalog/catalogRecency.js";

/**
 * `catalog-repair` — replace named catalog pairs, and nothing else.
 *
 * Writing is gated twice, the same way `bootstrap-catalog` and `catalog-publish`
 * are: `--persist` states the intent, `CONFIRM_CATALOG_REPAIR=true` confirms it.
 * Without both, the command generates the candidate pairs, runs every validator
 * over them, reports exactly what it would change — and writes nothing. That
 * dry run is the default because a repair rewrites content that already exists.
 */

export type CatalogRepairCliOptions = {
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

  return runCatalogRepair(
    {
      runId: options.runId,
      entryIds: options.entryIds,
      mode: options.mode,
      dropDate: options.dropDate,
      languages: options.languages,
      contentStatus: options.contentStatus,
      persist: options.persist,
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
}

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

  const liveRssOnly = flags.has("live-rss-only") || envFlag("LIVE_RSS_ONLY");

  return {
    runId,
    entryIds,
    mode,
    dropDate: flags.get("date") ?? getProductEditionDate(),
    languages: parseLanguages(flags.get("languages") ?? process.env.LANGUAGES ?? "fr,en"),
    persist: persistRequested && confirmed,
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
