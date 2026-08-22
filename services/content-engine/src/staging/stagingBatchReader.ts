import type { SupabaseClient } from "@supabase/supabase-js";

import { isTopicId, type TopicId } from "../domain.js";
import {
  EXPECTED_BUSINESS_STORY_JOBS,
  EXPECTED_MINI_CASE_JOBS,
  EXPECTED_NEWSLETTER_JOBS,
  EXPECTED_SCHEDULED_JOBS,
  MINIMUM_REVIEW_SCORE,
  REQUIRED_REVIEW_CHECKS,
  StagingBatchRejectedError,
  stagingSourceToRankedArticle,
  type StagingApprovedBatch,
  type StagingApprovedItem,
  type StagingBatchRow,
  type StagingEditionKind,
  type StagingJobRow,
  type StagingOutputRow,
  type StagingReviewRow
} from "./stagingBatch.js";
import { assertPairSourcesAreCovered, parseStagingPair } from "./stagingItemParser.js";

/**
 * Read one approved edition out of the staging project.
 *
 * The tables are read directly rather than through `get_ready_batch_payload`.
 * That RPC is the intended door for scheduled editions, but it answers
 * `batch_not_found` for `edition_kind = 'test'` — verified against the live
 * project — and the preview path has to work on test batches, which is the whole
 * point of being able to inspect quality before switching production over. One
 * code path that works for both beats two that diverge.
 *
 * Reading the tables also means the readiness rules live here, in code that is
 * tested, rather than being taken on trust from the other project. Staging
 * enforces them too; agreeing twice is cheap and disagreeing loudly is the
 * point.
 *
 * Every refusal is total. There is no partial edition: a batch either yields
 * every job it promised, approved and parseable, or it yields nothing.
 */

export type StagingReadOptions = {
  editionDate: string;
  /** Restrict to one kind. Omit to accept whichever batch exists for the date. */
  editionKind?: StagingEditionKind;
  /**
   * Skip the "every scheduled job is present" count.
   *
   * Only for `test` batches, which are deliberately partial — the sample scope
   * commissions three jobs, not twenty-three.
   */
  allowPartialTestBatch?: boolean;
};

export async function readApprovedStagingBatch(
  client: SupabaseClient,
  options: StagingReadOptions
): Promise<StagingApprovedBatch> {
  const batch = await readBatchRow(client, options);
  const editionKind = normalizeEditionKind(batch.edition_kind);
  const editionType = readEditionType(batch);

  if (batch.status !== "ready") {
    throw new StagingBatchRejectedError("batch_not_ready", [
      `batch ${batch.id} for ${batch.edition_date} is ${batch.status}, not ready`
    ]);
  }

  if (batch.approved_jobs !== batch.expected_jobs) {
    throw new StagingBatchRejectedError("batch_incomplete", [
      `batch ${batch.id} has ${batch.approved_jobs} approved of ${batch.expected_jobs} expected jobs`
    ]);
  }

  const jobs = await readJobs(client, batch.id);

  if (jobs.length !== batch.expected_jobs) {
    throw new StagingBatchRejectedError("batch_incomplete", [
      `batch ${batch.id} declares ${batch.expected_jobs} jobs but holds ${jobs.length}`
    ]);
  }

  // A scheduled edition has a fixed shape. A test batch is allowed to be a
  // sample, and is never published.
  if (editionKind !== "test" && !options.allowPartialTestBatch) {
    assertScheduledComposition(batch.id, jobs);
  }

  const notApproved = jobs.filter((job) => job.status !== "approved");

  if (notApproved.length > 0) {
    throw new StagingBatchRejectedError("job_not_approved", [
      `${notApproved.length} job(s) are not approved: ${notApproved
        .map((job) => `${job.content_type}#${job.ordinal}=${job.status}`)
        .join(", ")}`
    ]);
  }

  const outputs = await readOutputs(client, jobs.map((job) => job.id));
  const reviews = await readReviews(client, jobs.map((job) => job.id));
  const items: StagingApprovedItem[] = [];

  for (const job of jobs) {
    items.push(parseJob({ job, outputs, reviews }));
  }

  return {
    batchId: batch.id,
    editionDate: batch.edition_date,
    editionKind,
    editionType,
    promptBundleVersion: batch.prompt_bundle_version,
    targetProjectRef: batch.target_project_ref,
    expectedJobs: batch.expected_jobs,
    approvedJobs: batch.approved_jobs,
    items
  };
}

function parseJob(input: {
  job: StagingJobRow;
  outputs: Map<string, StagingOutputRow>;
  reviews: Map<string, StagingReviewRow>;
}): StagingApprovedItem {
  const { job } = input;
  const output = input.outputs.get(job.id);
  const review = input.reviews.get(job.id);

  if (!output) {
    throw new StagingBatchRejectedError("output_missing", [`job ${job.id} is approved but has no output`]);
  }

  if (!review) {
    throw new StagingBatchRejectedError("review_missing", [`job ${job.id} is approved but has no review`]);
  }

  assertReviewPasses(job, review);

  const contentType = normalizeContentType(job);
  const topic = job.topic && isTopicId(job.topic) ? job.topic : null;
  const items = parseStagingPair({
    jobId: job.id,
    contentType,
    expectedTopic: topic,
    expectedMiniCaseTopic: job.mini_case_topic,
    outputJson: output.output_json
  });

  const sourceTopic: TopicId = topic ?? inferTopicFromItems(items.fr.topic, items.en.topic);
  const records = Array.isArray(output.source_records) ? output.source_records : [];

  if (records.length === 0) {
    throw new StagingBatchRejectedError("source_record_missing", [`job ${job.id} carries no source records`]);
  }

  const sources = records.map((record) => stagingSourceToRankedArticle(record, sourceTopic));

  assertPairSourcesAreCovered({
    jobId: job.id,
    items,
    sourceUrls: new Set(sources.map((source) => source.url))
  });

  return {
    jobId: job.id,
    outputId: output.id,
    contentType,
    ordinal: job.ordinal,
    promptVersion: output.prompt_version,
    reviewScore: review.score,
    reviewerId: review.reviewer_id,
    items,
    sources
  };
}

/**
 * The reviewer bar, re-checked.
 *
 * A verdict of `approved` is not enough on its own: the score and the five
 * critical checks are what the editorial policy actually requires, and a review
 * row that says approved while a check is false is a contradiction that must
 * stop the edition rather than pass it.
 */
function assertReviewPasses(job: StagingJobRow, review: StagingReviewRow): void {
  const failures: string[] = [];

  if (review.verdict !== "approved") {
    failures.push(`job ${job.id} verdict is ${review.verdict}`);
  }

  if (typeof review.score !== "number" || review.score < MINIMUM_REVIEW_SCORE) {
    failures.push(`job ${job.id} scored ${String(review.score)}, below the ${MINIMUM_REVIEW_SCORE} bar`);
  }

  const checks = review.checks ?? {};

  for (const check of REQUIRED_REVIEW_CHECKS) {
    if (checks[check] !== true) {
      failures.push(`job ${job.id} failed the ${check} check`);
    }
  }

  if (failures.length > 0) {
    throw new StagingBatchRejectedError("review_below_bar", failures);
  }
}

/** 16 newsletter articles, 1 business story, 6 mini cases — no more, no fewer. */
function assertScheduledComposition(batchId: string, jobs: StagingJobRow[]): void {
  const counts = {
    newsletter_article: jobs.filter((job) => job.content_type === "newsletter_article").length,
    business_story: jobs.filter((job) => job.content_type === "business_story").length,
    mini_case: jobs.filter((job) => job.content_type === "mini_case").length
  };
  const failures: string[] = [];

  if (jobs.length !== EXPECTED_SCHEDULED_JOBS) {
    failures.push(`batch ${batchId} holds ${jobs.length} jobs, expected ${EXPECTED_SCHEDULED_JOBS}`);
  }

  if (counts.newsletter_article !== EXPECTED_NEWSLETTER_JOBS) {
    failures.push(`newsletter jobs: ${counts.newsletter_article}, expected ${EXPECTED_NEWSLETTER_JOBS}`);
  }

  if (counts.business_story !== EXPECTED_BUSINESS_STORY_JOBS) {
    failures.push(`business story jobs: ${counts.business_story}, expected ${EXPECTED_BUSINESS_STORY_JOBS}`);
  }

  if (counts.mini_case !== EXPECTED_MINI_CASE_JOBS) {
    failures.push(`mini case jobs: ${counts.mini_case}, expected ${EXPECTED_MINI_CASE_JOBS}`);
  }

  const miniCaseTopics = jobs
    .filter((job) => job.content_type === "mini_case")
    .map((job) => job.mini_case_topic);

  if (new Set(miniCaseTopics).size !== miniCaseTopics.length) {
    failures.push(`mini case topics repeat: ${miniCaseTopics.join(", ")}`);
  }

  if (failures.length > 0) {
    throw new StagingBatchRejectedError("batch_composition_invalid", failures);
  }
}

function normalizeContentType(job: StagingJobRow): StagingApprovedItem["contentType"] {
  if (
    job.content_type === "newsletter_article" ||
    job.content_type === "business_story" ||
    job.content_type === "mini_case"
  ) {
    return job.content_type;
  }

  throw new StagingBatchRejectedError("content_type_unsupported", [
    `job ${job.id} has content type ${job.content_type}`
  ]);
}

function normalizeEditionKind(value: string): StagingEditionKind {
  if (value === "daily" || value === "weekly_digest" || value === "test") {
    return value;
  }

  throw new StagingBatchRejectedError("edition_kind_unsupported", [`edition kind ${value} is not supported`]);
}

/**
 * What the edition IS, as opposed to how the batch was created.
 *
 * A test batch still simulates a daily or a weekly digest, and the metadata says
 * which. Newsletter generation already understands both.
 */
function readEditionType(batch: StagingBatchRow): "daily" | "weekly_digest" {
  const declared = batch.metadata?.edition_type;

  if (declared === "daily" || declared === "weekly_digest") {
    return declared;
  }

  if (batch.edition_kind === "daily" || batch.edition_kind === "weekly_digest") {
    return batch.edition_kind;
  }

  throw new StagingBatchRejectedError("edition_type_unknown", [
    `batch ${batch.id} does not declare whether it is a daily or a weekly digest`
  ]);
}

function inferTopicFromItems(french: TopicId | null, english: TopicId | null): TopicId {
  const topic = french ?? english;

  if (!topic) {
    throw new StagingBatchRejectedError("topic_missing", ["a job produced items with no topic"]);
  }

  return topic;
}

async function readBatchRow(
  client: SupabaseClient,
  options: StagingReadOptions
): Promise<StagingBatchRow> {
  let query = client
    .from("automation_batches")
    .select(
      "id,edition_date,edition_kind,status,expected_jobs,completed_jobs,approved_jobs,prompt_bundle_version,target_project_ref,metadata"
    )
    .eq("edition_date", options.editionDate);

  if (options.editionKind) {
    query = query.eq("edition_kind", options.editionKind);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(1);

  if (error) {
    throw new StagingBatchRejectedError("staging_unreachable", [error.message]);
  }

  const row = (data ?? [])[0] as StagingBatchRow | undefined;

  if (!row) {
    throw new StagingBatchRejectedError("batch_not_found", [
      `no ${options.editionKind ?? "any"} batch exists in staging for ${options.editionDate}`
    ]);
  }

  return row;
}

async function readJobs(client: SupabaseClient, batchId: string): Promise<StagingJobRow[]> {
  const { data, error } = await client
    .from("generation_jobs")
    .select("id,batch_id,content_type,topic,mini_case_topic,ordinal,status,prompt_key")
    .eq("batch_id", batchId)
    .order("content_type", { ascending: true })
    .order("ordinal", { ascending: true });

  if (error) {
    throw new StagingBatchRejectedError("staging_unreachable", [error.message]);
  }

  return (data ?? []) as StagingJobRow[];
}

async function readOutputs(
  client: SupabaseClient,
  jobIds: string[]
): Promise<Map<string, StagingOutputRow>> {
  const { data, error } = await client
    .from("generation_outputs")
    .select("id,job_id,prompt_version,output_json,source_records,attempt")
    .in("job_id", jobIds)
    .order("attempt", { ascending: true });

  if (error) {
    throw new StagingBatchRejectedError("staging_unreachable", [error.message]);
  }

  // Later attempts win: a job that was resubmitted after review feedback is
  // published as what the reviewer finally approved.
  const byJob = new Map<string, StagingOutputRow>();

  for (const row of (data ?? []) as StagingOutputRow[]) {
    byJob.set(row.job_id, row);
  }

  return byJob;
}

async function readReviews(
  client: SupabaseClient,
  jobIds: string[]
): Promise<Map<string, StagingReviewRow>> {
  const { data, error } = await client
    .from("generation_reviews")
    .select("id,job_id,output_id,reviewer_id,verdict,score,checks,reviewed_at")
    .in("job_id", jobIds)
    .order("reviewed_at", { ascending: true });

  if (error) {
    throw new StagingBatchRejectedError("staging_unreachable", [error.message]);
  }

  const byJob = new Map<string, StagingReviewRow>();

  for (const row of (data ?? []) as StagingReviewRow[]) {
    byJob.set(row.job_id, row);
  }

  return byJob;
}
