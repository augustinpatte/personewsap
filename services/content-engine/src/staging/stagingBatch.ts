import type { GeneratedContentItem, Language, RankedArticle, RawArticle, TopicId } from "../domain.js";

/**
 * The ChatGPT staging project, as this repo sees it.
 *
 * Editorial generation no longer happens here. Three ChatGPT Scheduled Tasks
 * write into a separate Supabase project, an independent reviewer approves what
 * they wrote, and this engine reads the finished, approved edition and publishes
 * it through the pipeline that already existed.
 *
 * Two boundaries are load-bearing:
 *
 *  - ChatGPT never writes to production. It only ever fills the staging tables;
 *    everything that reaches `content_items` passes through `ContentRepository`
 *    exactly as LLM-generated content used to.
 *  - Nothing is trusted. The staging validator already checked these payloads,
 *    but they arrive here as `unknown` and are parsed field by field before they
 *    are allowed to become a `GeneratedContentItem`. There is no cast.
 *
 * The shapes below were read off the live staging project rather than assumed:
 * `output_json` is a `{ fr, en }` envelope whose halves are already the engine's
 * own item shape, and `source_records` is the metadata for every URL those
 * halves cite.
 */

/** Batch kinds staging distinguishes. `test` never reaches production. */
export type StagingEditionKind = "daily" | "weekly_digest" | "test";

export type StagingBatchRow = {
  id: string;
  edition_date: string;
  edition_kind: string;
  status: string;
  expected_jobs: number;
  completed_jobs: number;
  approved_jobs: number;
  prompt_bundle_version: string | null;
  target_project_ref: string | null;
  metadata: Record<string, unknown> | null;
};

export type StagingJobRow = {
  id: string;
  batch_id: string;
  content_type: string;
  topic: string | null;
  mini_case_topic: string | null;
  ordinal: number;
  status: string;
  prompt_key: string | null;
};

export type StagingOutputRow = {
  id: string;
  job_id: string;
  prompt_version: string | null;
  output_json: unknown;
  source_records: unknown;
};

export type StagingReviewRow = {
  id: string;
  job_id: string;
  output_id: string;
  reviewer_id: string | null;
  verdict: string;
  score: number | null;
  checks: Record<string, unknown> | null;
};

/** One approved job, parsed into the shapes the existing pipeline speaks. */
export type StagingApprovedItem = {
  jobId: string;
  outputId: string;
  contentType: "newsletter_article" | "business_story" | "mini_case";
  ordinal: number;
  promptVersion: string | null;
  reviewScore: number | null;
  reviewerId: string | null;
  /** Both language versions of one editorial concept. */
  items: Record<Language, GeneratedContentItem>;
  /** Every source those versions cite, with full metadata. */
  sources: RankedArticle[];
};

export type StagingApprovedBatch = {
  batchId: string;
  editionDate: string;
  editionKind: StagingEditionKind;
  /** `daily` or `weekly_digest`; a test batch still simulates one of the two. */
  editionType: "daily" | "weekly_digest";
  promptBundleVersion: string | null;
  targetProjectRef: string | null;
  expectedJobs: number;
  approvedJobs: number;
  items: StagingApprovedItem[];
};

/**
 * The reviewer bar, restated here rather than trusted.
 *
 * Staging enforces it before a batch becomes `ready`, and this checks it again
 * on the way out. Duplicating a rule is worth it when the cost of the rule
 * failing silently is a wrong edition in front of every reader.
 */
export const MINIMUM_REVIEW_SCORE = 90;
export const REQUIRED_REVIEW_CHECKS = [
  "source_grounding",
  "factual_accuracy",
  "safety",
  "schema",
  "fr_en_parity"
] as const;

/** A full scheduled edition: 16 newsletter articles, 1 story, 6 mini cases. */
export const EXPECTED_NEWSLETTER_JOBS = 16;
export const EXPECTED_BUSINESS_STORY_JOBS = 1;
export const EXPECTED_MINI_CASE_JOBS = 6;
export const EXPECTED_SCHEDULED_JOBS =
  EXPECTED_NEWSLETTER_JOBS + EXPECTED_BUSINESS_STORY_JOBS + EXPECTED_MINI_CASE_JOBS;

export class StagingBatchRejectedError extends Error {
  readonly reason: string;
  readonly details: string[];

  constructor(reason: string, details: string[]) {
    super(`Staging batch refused (${reason}): ${details.join(" | ")}`);
    this.name = "StagingBatchRejectedError";
    this.reason = reason;
    this.details = details;
  }
}

/**
 * Turn a staging source record into the article shape persistence expects.
 *
 * `sources` and `content_item_sources` are written by the existing mappers from
 * `RankedArticle`, so the record is widened into one rather than given a storage
 * path of its own. The ranking fields are marked for what they are: this article
 * was not ranked by an RSS pass, it was cited by content a reviewer approved.
 */
export function stagingSourceToRankedArticle(record: unknown, topic: TopicId): RankedArticle {
  if (typeof record !== "object" || record === null) {
    throw new StagingBatchRejectedError("source_record_malformed", ["a source record is not an object"]);
  }

  const value = record as Record<string, unknown>;
  const url = readString(value.url);

  if (!url) {
    throw new StagingBatchRejectedError("source_record_malformed", ["a source record has no url"]);
  }

  const language = value.language === "fr" ? "fr" : "en";
  const retrievedAt = readString(value.retrieved_at) ?? new Date().toISOString();

  const raw: RawArticle = {
    url,
    title: readString(value.title) ?? "",
    publisher: readString(value.publisher) ?? "",
    author: readString(value.author) ?? null,
    published_at: readString(value.published_at) ?? null,
    retrieved_at: retrievedAt,
    language,
    summary: readString(value.summary) ?? undefined,
    body: readString(value.body) ?? undefined,
    sourceTopic: topic
  };

  return {
    ...raw,
    content_hash: readString(value.content_hash) ?? url,
    normalized_url: readString(value.normalized_url) ?? url,
    topic,
    importance_score: 0,
    rank_reasons: ["chatgpt_staging_source"]
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
