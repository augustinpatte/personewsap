import { isLanguage, LANGUAGES, type Language } from "../domain.js";
import { getProductEditionDate, resolveEditionType } from "../scheduler/editionCadence.js";
import {
  buildPayloadsFromBatch,
  persistBatchLanguage,
  readPublicationReceipt,
  recordPublicationReceipt,
  validateBatchPayload,
  type StagingPublishLanguageResult,
  type StagingPublishResult
} from "../staging/publishStagingBatch.js";
import { readApprovedStagingBatch } from "../staging/stagingBatchReader.js";
import { assignStoredDropToUsers } from "./dailyJobTest.js";
import { StagingBatchRejectedError, type StagingEditionKind } from "../staging/stagingBatch.js";
import { createStagingSupabaseClient } from "../staging/stagingClient.js";
import { ContentRepository } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";

/**
 * `staging-publish` — publish the edition ChatGPT already wrote and a reviewer
 * already approved.
 *
 * Editorial generation is no longer this command's job, and it makes no model
 * call of any kind. It reads an approved batch out of the staging project,
 * revalidates every item against the same validators the LLM path used, and
 * hands the result to `ContentRepository`.
 *
 * Three modes, in increasing order of consequence:
 *
 *   --preview     parse, map and validate a batch (including a `test` one) and
 *                 print what it holds. Touches nothing.
 *   --dry-run     the same, against the real scheduled batch, reporting exactly
 *                 what would be written. Touches nothing.
 *   (default)     writes production, then records the staging receipt.
 *
 * There is no fallback. If no approved batch exists the command is a clean
 * no-op: no edition is better than an edition nobody reviewed.
 */

export type StagingPublishCliOptions = {
  editionDate: string;
  editionKind: StagingEditionKind | null;
  languages: Language[];
  contentStatus: "draft" | "review" | "published";
  dryRun: boolean;
  preview: boolean;
  runId: string;
  productionStrict?: boolean;
};

export async function runStagingPublishCli(
  options: StagingPublishCliOptions
): Promise<StagingPublishResult> {
  const staging = createStagingSupabaseClient();

  logProgress("staging publish started", {
    edition_date: options.editionDate,
    edition_kind: options.editionKind ?? "auto",
    languages: options.languages,
    preview: options.preview,
    dry_run: options.dryRun,
    content_status: options.contentStatus,
    run_id: options.runId
  });

  // A preview may read a test batch, which is deliberately partial. Nothing
  // else may: a scheduled edition has a fixed composition.
  const batch = await readApprovedStagingBatch(staging, {
    editionDate: options.editionDate,
    editionKind: options.editionKind ?? undefined,
    allowPartialTestBatch: options.preview
  });

  if (batch.editionKind === "test" && !options.preview) {
    throw new StagingBatchRejectedError("test_batch_not_publishable", [
      `batch ${batch.batchId} is a test batch. Test batches are for --preview only and are never published.`
    ]);
  }

  const writesProduction = !options.preview && !options.dryRun;
  const receipt = await readPublicationReceipt(staging, batch.batchId);

  // Idempotency. A retried workflow, a duplicated schedule fire or a manual
  // replay all land here and stop.
  if (receipt.published && writesProduction) {
    logProgress("staging batch already published", {
      batch_id: batch.batchId,
      edition_date: batch.editionDate,
      receipt_id: receipt.receiptId
    });

    return {
      mode: "staging-publish",
      batchId: batch.batchId,
      editionDate: batch.editionDate,
      editionKind: batch.editionKind,
      editionType: batch.editionType,
      dryRun: false,
      published: false,
      alreadyPublished: true,
      jobsExpected: batch.expectedJobs,
      jobsApproved: batch.approvedJobs,
      languages: [],
      receiptRecorded: false,
      refusedReason: null
    };
  }

  const repository = writesProduction
    ? new ContentRepository(createServiceRoleSupabaseClient({ requireCredentials: true }))
    : null;
  const languages: StagingPublishLanguageResult[] = [];

  // Validate BOTH languages before writing either. An edition is one thing; it
  // does not go in half.
  for (const language of options.languages) {
    const { payload, articles } = buildPayloadsFromBatch(batch, language);
    const issues = validateBatchPayload({
      payload,
      articles,
      productionStrict: options.productionStrict
    });

    logProgress("staging language validated", {
      batch_id: batch.batchId,
      language,
      items: payload.items.length,
      sources: articles.length,
      validation: issues.length === 0 ? "passed" : "failed",
      issues: issues.slice(0, 5)
    });

    if (issues.length > 0) {
      throw new StagingBatchRejectedError("payload_validation_failed", issues);
    }
  }

  for (const language of options.languages) {
    languages.push(
      await persistBatchLanguage({
        // Only reached when a repository exists; the preview and dry-run paths
        // return before any write.
        repository: repository as ContentRepository,
        batch,
        language,
        assignStoredDrop: assignStoredDropToUsers,
        options: {
          editionDate: options.editionDate,
          contentStatus: options.contentStatus,
          dryRun: !writesProduction,
          productionProjectRef: process.env.SUPABASE_URL ?? null,
          runId: options.runId,
          productionStrict: options.productionStrict
        }
      })
    );
  }

  let receiptRecorded = false;

  if (writesProduction) {
    receiptRecorded = await recordPublicationReceipt({
      staging,
      batch,
      productionProjectRef: readProductionProjectRef(),
      runId: options.runId,
      result: {
        languages: languages.map((entry) => ({
          language: entry.language,
          items: entry.items,
          stored_content_items: entry.storedContentItems,
          reused_content_items: entry.reusedContentItems
        })),
        content_status: options.contentStatus
      }
    });
  }

  const result: StagingPublishResult = {
    mode: "staging-publish",
    batchId: batch.batchId,
    editionDate: batch.editionDate,
    editionKind: batch.editionKind,
    editionType: batch.editionType,
    dryRun: !writesProduction,
    published: writesProduction,
    alreadyPublished: false,
    jobsExpected: batch.expectedJobs,
    jobsApproved: batch.approvedJobs,
    languages,
    receiptRecorded,
    refusedReason: null
  };

  logProgress(writesProduction ? "staging batch published" : "staging batch would publish", {
    batch_id: batch.batchId,
    edition_date: batch.editionDate,
    edition_type: batch.editionType,
    jobs_expected: batch.expectedJobs,
    jobs_approved: batch.approvedJobs,
    fr_items: languages.find((entry) => entry.language === "fr")?.items ?? 0,
    en_items: languages.find((entry) => entry.language === "en")?.items ?? 0,
    sources: languages[0]?.sources ?? 0,
    receipt_recorded: receiptRecorded
  });

  return result;
}

export function parseStagingPublishOptions(args: string[]): StagingPublishCliOptions {
  const flags = readFlags(args);
  const editionDate = flags.get("date") ?? getProductEditionDate();
  const preview = flags.has("preview");
  const requestedKind = flags.get("edition-kind") ?? flags.get("edition-type");

  if (requestedKind && !["daily", "weekly_digest", "test"].includes(requestedKind)) {
    throw new Error("staging-publish --edition-kind must be daily, weekly_digest or test.");
  }

  // The cadence lives in editionCadence.ts and is not restated here. A quiet day
  // has no edition, so asking to publish one is a mistake worth naming.
  if (!preview && !requestedKind) {
    const kind = resolveEditionType(editionDate);

    if (!kind) {
      throw new Error(
        `staging-publish refused: ${editionDate} is not an edition day. The product publishes Monday, Wednesday, Friday and Sunday (Europe/Paris).`
      );
    }
  }

  return {
    editionDate,
    editionKind: (requestedKind as StagingEditionKind | undefined) ?? null,
    languages: parseLanguages(flags.get("languages") ?? process.env.LANGUAGES ?? "fr,en"),
    contentStatus: preview || flags.has("dry-run") ? "review" : "published",
    dryRun: flags.has("dry-run"),
    preview,
    runId: flags.get("run-id") ?? `staging-publish-${editionDate}-${Date.now().toString(36)}`
  };
}

function readProductionProjectRef(): string | null {
  const url = process.env.SUPABASE_URL;

  if (!url) {
    return null;
  }

  const match = /https:\/\/([a-z0-9]+)\.supabase\./i.exec(url);
  return match ? match[1] : null;
}

function parseLanguages(value: string): Language[] {
  const languages = value.split(",").map((entry) => entry.trim()).filter(Boolean);

  if (languages.length === 0 || languages.some((entry) => !isLanguage(entry))) {
    throw new Error(`LANGUAGES must be a comma-separated list of: ${LANGUAGES.join(", ")}.`);
  }

  return languages as Language[];
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

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ level: "info", scope: "staging-publish", message, ...details })}\n`
  );
}
