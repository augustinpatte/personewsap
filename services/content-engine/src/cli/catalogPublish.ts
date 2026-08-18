import { ContentRepository } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";

export type CatalogPublishOptions = {
  runId: string;
  confirmed: boolean;
};

export type CatalogPublishOutput = {
  mode: "catalog-publish";
  runId: string;
  published: number;
  refused: false;
};

export async function runCatalogPublish(options: CatalogPublishOptions): Promise<CatalogPublishOutput> {
  if (!options.confirmed) {
    throw new Error(
      "catalog-publish refused to write. Set CONFIRM_CATALOG_PUBLISH=true and pass --run-id <catalog run id> after reviewing content:catalog-report."
    );
  }

  const repository = new ContentRepository(createServiceRoleSupabaseClient({ requireCredentials: true }));
  const result = await repository.publishReviewedCatalogItems({ runId: options.runId });

  return {
    mode: "catalog-publish",
    runId: options.runId,
    published: result.published,
    refused: false
  };
}

export function parseCatalogPublishOptions(args: string[]): CatalogPublishOptions {
  const flags = readFlags(args);
  const runId = flags.get("run-id") ?? process.env.CATALOG_RUN_ID;
  if (!runId) {
    throw new Error("catalog-publish requires --run-id or CATALOG_RUN_ID.");
  }

  return {
    runId,
    confirmed: process.env.CONFIRM_CATALOG_PUBLISH === "true"
  };
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
