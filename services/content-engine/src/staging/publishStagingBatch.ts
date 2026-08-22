import type { SupabaseClient } from "@supabase/supabase-js";

import type { DailyDropPayload, GeneratedContentItem, Language, RankedArticle } from "../domain.js";
import { readProductionContentStrict, validateDailyDropQuality, validateDailyDropPayload } from "../generation/validation.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import type { ContentRepository } from "../storage/contentRepository.js";
import { StagingBatchRejectedError, type StagingApprovedBatch } from "./stagingBatch.js";

/**
 * Publish one approved staging edition into production.
 *
 * Everything after the content arrives is the pipeline that already existed.
 * `ContentRepository.storeDailyPayload` still does the deduplication, the source
 * upserts, the `content_item_sources` links, the Business Story and Mini Case
 * histories. This module's whole job is to hand it the same shapes the LLM path
 * used to, and to refuse rather than improvise when it cannot.
 *
 * Order matters and is deliberate:
 *
 *  1. validate everything, both languages, before writing anything;
 *  2. write production;
 *  3. only then record the receipt in staging.
 *
 * A batch is never marked published on the strength of an intention. If
 * production write fails halfway, staging still says ready, and the next run
 * finds the same batch and the dedup key makes the retry harmless.
 */

export const STAGING_GENERATOR_VERSION = "chatgpt_scheduled";
export const STAGING_PROMPT_VERSION_PREFIX = "chatgpt_staging";

/** The production assignment step, as this module needs to call it. */
export type AssignStoredDrop = (input: {
  repository: ContentRepository;
  storedItems: Awaited<ReturnType<ContentRepository["storeDailyPayload"]>>;
  dropDate: string;
  language: Language;
  userLimit: number | null;
  logPrefix: string;
  useLlm: boolean;
  hideDisplayDate: boolean;
}) => Promise<{ usersAssigned: number; assignmentSkippedReason?: string | null }>;

export type StagingPublishOptions = {
  editionDate: string;
  userLimit?: number | null;
  contentStatus: "draft" | "review" | "published";
  dryRun: boolean;
  productionProjectRef: string | null;
  runId: string;
  productionStrict?: boolean;
};

export type StagingPublishLanguageResult = {
  language: Language;
  items: number;
  sources: number;
  storedContentItems: number;
  reusedContentItems: number;
  usersAssigned: number;
  assignmentSkippedReason: string | null;
};

export type StagingPublishResult = {
  mode: "staging-publish";
  batchId: string;
  editionDate: string;
  editionKind: string;
  editionType: "daily" | "weekly_digest";
  dryRun: boolean;
  published: boolean;
  alreadyPublished: boolean;
  jobsExpected: number;
  jobsApproved: number;
  languages: StagingPublishLanguageResult[];
  receiptRecorded: boolean;
  refusedReason: string | null;
};

/**
 * Build one payload per language out of the approved batch.
 *
 * The two payloads are two renderings of one edition, so they are assembled from
 * the same jobs in the same order. `assembleDailyDropPayload` then applies the
 * ordering the rest of the product expects, including the deterministic Mini
 * Case option order.
 */
export function buildPayloadsFromBatch(
  batch: StagingApprovedBatch,
  language: Language
): { payload: DailyDropPayload; articles: RankedArticle[] } {
  const items: GeneratedContentItem[] = [];
  const articles = new Map<string, RankedArticle>();

  for (const entry of batch.items) {
    const item = entry.items[language];

    if (!item) {
      throw new StagingBatchRejectedError("output_pair_incomplete", [
        `${entry.jobId}: no ${language} version`
      ]);
    }

    items.push(item);

    for (const source of entry.sources) {
      if (!articles.has(source.url)) {
        articles.set(source.url, source);
      }
    }
  }

  const payload = assembleDailyDropPayload({
    drop_date: batch.editionDate,
    language,
    prompt_version: `${STAGING_PROMPT_VERSION_PREFIX}:${batch.promptBundleVersion ?? "unknown"}`,
    generator_version: STAGING_GENERATOR_VERSION,
    items
  });

  return { payload, articles: [...articles.values()] };
}

/**
 * Every validator the LLM path ran, run again on what ChatGPT produced.
 *
 * Structural first, then editorial quality against the batch's own source
 * records — the same closed set the items were allowed to cite. A failure here
 * refuses the whole edition: publishing sixteen good articles and one broken one
 * is not a partial success, it is a broken edition.
 */
export function validateBatchPayload(input: {
  payload: DailyDropPayload;
  articles: RankedArticle[];
  productionStrict?: boolean;
}): string[] {
  const strict = input.productionStrict ?? readProductionContentStrict();
  const quality = validateDailyDropQuality(input.payload, {
    articles: input.articles,
    productionStrict: strict
  });

  return [
    ...validateDailyDropPayload(input.payload),
    ...quality.issues.filter((issue) => issue.severity === "error")
  ].map((issue) => `${issue.path}: ${issue.message}`);
}

/**
 * Metadata that makes a published item traceable back to the batch that made it.
 *
 * `model_name` is deliberately absent rather than invented: the exact ChatGPT
 * model behind a Scheduled Task is not exposed to us, and recording a guess
 * would put a false fact in the provenance of every item.
 */
export function buildStagingContentMetadata(input: {
  batch: StagingApprovedBatch;
  runId: string;
  contentStatus: string;
}): Record<string, unknown> {
  return {
    is_test_data: false,
    scheduler_mode: "staging-publish",
    scheduler_run_id: input.runId,
    content_status: input.contentStatus,
    generator: STAGING_GENERATOR_VERSION,
    model_name: null,
    staging_batch_id: input.batch.batchId,
    staging_edition_kind: input.batch.editionKind,
    staging_edition_type: input.batch.editionType,
    staging_prompt_bundle_version: input.batch.promptBundleVersion,
    persisted_by: "services/content-engine npm run staging-publish"
  };
}

/** Per-item provenance, merged over the edition-level metadata. */
export function buildStagingItemMetadata(input: {
  jobId: string;
  outputId: string;
  promptVersion: string | null;
  reviewScore: number | null;
  reviewerId: string | null;
}): Record<string, unknown> {
  return {
    staging_job_id: input.jobId,
    staging_output_id: input.outputId,
    staging_prompt_version: input.promptVersion,
    staging_review_score: input.reviewScore,
    staging_reviewer_id: input.reviewerId
  };
}

/**
 * Has this batch already been published?
 *
 * Idempotency's first line. A rerun of the workflow — a retry, a manual replay,
 * a duplicate schedule fire — must find the receipt and stop, rather than write
 * a second edition for the same day.
 */
export async function readPublicationReceipt(
  staging: SupabaseClient,
  batchId: string
): Promise<{ published: boolean; receiptId: string | null }> {
  const { data, error } = await staging
    .from("publication_receipts")
    .select("id,batch_id")
    .eq("batch_id", batchId)
    .limit(1);

  if (error) {
    throw new StagingBatchRejectedError("staging_unreachable", [error.message]);
  }

  const row = (data ?? [])[0] as { id: string } | undefined;

  return { published: Boolean(row), receiptId: row?.id ?? null };
}

/**
 * Record that production accepted the edition.
 *
 * Called last, and only on complete success. Marking staging published before
 * production has the content would strand the edition: staging would refuse to
 * serve it again and production would never have had it.
 */
export async function recordPublicationReceipt(input: {
  staging: SupabaseClient;
  batch: StagingApprovedBatch;
  productionProjectRef: string | null;
  runId: string;
  result: Record<string, unknown>;
}): Promise<boolean> {
  const { error } = await input.staging.rpc("mark_batch_published", {
    p_batch_id: input.batch.batchId,
    p_production_project_ref: input.productionProjectRef,
    p_production_result: input.result,
    p_production_run_id: input.runId
  });

  if (error) {
    // The edition IS published; only the receipt failed. Say so loudly rather
    // than rolling anything back — production content is correct and a missing
    // receipt is recoverable by hand.
    throw new Error(
      `Production publish succeeded for batch ${input.batch.batchId} but the staging receipt could not be written: ${error.message}. Production content is correct; record the receipt manually before the next scheduled run.`
    );
  }

  return true;
}

/**
 * Persist one language of an approved edition.
 *
 * Straight through `ContentRepository`: no bespoke inserts, so deduplication,
 * source linking and the two editorial-memory histories all behave exactly as
 * they did for LLM-generated content.
 */
export async function persistBatchLanguage(input: {
  repository: ContentRepository;
  batch: StagingApprovedBatch;
  language: Language;
  options: StagingPublishOptions;
  /** Production assignment, injected so this module never imports the CLI. */
  assignStoredDrop: AssignStoredDrop;
}): Promise<StagingPublishLanguageResult> {
  const { payload, articles } = buildPayloadsFromBatch(input.batch, input.language);
  const issues = validateBatchPayload({
    payload,
    articles,
    productionStrict: input.options.productionStrict
  });

  if (issues.length > 0) {
    throw new StagingBatchRejectedError("payload_validation_failed", issues);
  }

  if (input.options.dryRun) {
    return {
      language: input.language,
      items: payload.items.length,
      sources: articles.length,
      storedContentItems: 0,
      reusedContentItems: 0,
      usersAssigned: 0,
      assignmentSkippedReason: "dry_run"
    };
  }

  const stored = await input.repository.storeDailyPayload({
    payload,
    articles,
    contentStatus: input.options.contentStatus,
    metadata: buildStagingContentMetadata({
      batch: input.batch,
      runId: input.options.runId,
      contentStatus: input.options.contentStatus
    })
  });

  // Assignment is the production path's own, imported rather than reimplemented:
  // personalisation, daily-drop construction and the one-drop-per-user rule did
  // not change when generation moved to ChatGPT.
  const assignment =
    input.options.contentStatus === "published"
      ? await input.assignStoredDrop({
          repository: input.repository,
          storedItems: stored,
          dropDate: payload.drop_date,
          language: input.language,
          userLimit: input.options.userLimit ?? null,
          logPrefix: "[content-engine]",
          useLlm: false,
          hideDisplayDate: false
        })
      : { usersAssigned: 0, assignmentSkippedReason: `content_status_${input.options.contentStatus}` };

  return {
    language: input.language,
    items: payload.items.length,
    sources: articles.length,
    storedContentItems: stored.length,
    reusedContentItems: stored.filter((record) => record.reused_existing_content_item).length,
    usersAssigned: assignment.usersAssigned,
    assignmentSkippedReason: assignment.assignmentSkippedReason ?? null
  };
}
