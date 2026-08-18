import { ContentRepository, type CatalogReportItem } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";

export type CatalogReportOptions = {
  runId: string | null;
  limit: number;
};

export type CatalogReportOutput = {
  mode: "catalog-report";
  runId: string | null;
  limit: number;
  counts: {
    total: number;
    review: number;
    published: number;
    businessStories: number;
    miniCases: number;
  };
  items: CatalogReportItem[];
};

export async function runCatalogReport(options: CatalogReportOptions): Promise<CatalogReportOutput> {
  const repository = new ContentRepository(createServiceRoleSupabaseClient({ requireCredentials: true }));
  const items = await repository.listCatalogReportItems(options);

  return {
    mode: "catalog-report",
    runId: options.runId,
    limit: options.limit,
    counts: {
      total: items.length,
      review: items.filter((item) => item.status === "review").length,
      published: items.filter((item) => item.status === "published").length,
      businessStories: items.filter((item) => item.contentType === "business_story").length,
      miniCases: items.filter((item) => item.contentType === "mini_case").length
    },
    items
  };
}

export function parseCatalogReportOptions(args: string[]): CatalogReportOptions {
  const flags = readFlags(args);
  return {
    runId: flags.get("run-id") ?? process.env.CATALOG_RUN_ID ?? null,
    limit: parsePositiveInteger(flags.get("limit") ?? process.env.CATALOG_REPORT_LIMIT, 500, "limit")
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = args[index + 1];

    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
      continue;
    }

    if (!nextValue || nextValue.startsWith("--")) {
      values.set(rawKey, "true");
      continue;
    }

    values.set(rawKey, nextValue);
    index += 1;
  }

  return values;
}
