/**
 * The publication decision, as pure logic.
 *
 * Every side effect is injected. That is not ceremony: this file decides whether
 * PersoNews has an edition tonight, and the only honest way to test "the
 * production RPC failed, so staging must not be marked published" is to make the
 * production RPC fail on purpose. Deno-specific imports would put that out of
 * reach of the repository's test runner, so there are none — this module is
 * plain TypeScript and is imported unchanged by both the Edge Function and the
 * vitest suite.
 *
 * The order of operations is the whole design:
 *
 *   gate  ->  publish  ->  verify in production  ->  only then, receipt
 *
 * Nothing is written to production before the gate passes, and nothing is
 * written to staging before production has been read back and found correct. A
 * receipt is a statement of fact about production, so it is never issued on the
 * strength of an RPC's own success message.
 */

export type GateVerdict = {
  ok: boolean;
  reason: string;
  already_published?: boolean;
  edition_date?: string;
  expected_edition_kind?: string | null;
  edition_kind?: string | null;
  batch_id?: string | null;
  batch_status?: string | null;
  approved_jobs?: number | null;
  expected_jobs?: number | null;
  blockers?: unknown[];
  blocking_jobs?: unknown[];
  receipt?: unknown;
  [key: string]: unknown;
};

export type PublishPlan = {
  gate: GateVerdict;
  ready_payload: unknown | null;
};

export type ProductionPublishResult = {
  published?: boolean;
  [key: string]: unknown;
};

export type ProductionVerification = {
  ok?: boolean;
  [key: string]: unknown;
};

export type RunRecord = {
  gate: GateVerdict;
  gatePassed: boolean;
  publicationAttempted: boolean;
  publicationSucceeded: boolean;
  productionVerified: boolean;
  receiptRecorded: boolean;
  alreadyPublished: boolean;
  reason: string;
  productionResult: ProductionPublishResult | null;
  verification: ProductionVerification | null;
  error: string | null;
};

export type PublisherDeps = {
  /** Hard gate + canonical payload, in one staging round trip. */
  plan(editionDate: string): Promise<PublishPlan>;
  /** Deterministic, idempotent run id derived from the edition and the batch. */
  runId(editionDate: string, batchId: string): string;
  /** Opens the audit row. Returns its id. */
  beginRun(runId: string, editionDate: string, triggerSource: string): Promise<number>;
  /** Cross-project call into the production publisher RPC. */
  publish(payload: unknown, runId: string): Promise<ProductionPublishResult>;
  /** Reads production back, from outside the publishing transaction. */
  verify(editionDate: string, batchId: string, runId: string): Promise<ProductionVerification>;
  /** `mark_batch_published` in staging. Called last, and only on real success. */
  markPublished(batchId: string, runId: string, productionResult: unknown): Promise<string>;
  /** Closes the audit row. Always called, including on every refusal. */
  finishRun(runRowId: number, record: RunRecord): Promise<void>;
};

export type PublishOutcome = {
  published: boolean;
  already_published: boolean;
  gate_passed: boolean;
  publication_attempted: boolean;
  publication_succeeded: boolean;
  production_verified: boolean;
  receipt_recorded: boolean;
  reason: string;
  edition_date: string;
  batch_id: string | null;
  run_id: string | null;
  run_row_id: number | null;
  approved_jobs: number | null;
  expected_jobs: number | null;
  blockers: unknown[];
  gate: GateVerdict;
  production_result: ProductionPublishResult | null;
  verification: ProductionVerification | null;
  error: string | null;
};

const PUBLISHER_VERSION = "scheduled-publisher-v1";

export { PUBLISHER_VERSION };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Run one publication attempt.
 *
 * Never throws for an editorial reason. A batch that is not ready is a normal
 * evening, and the caller gets an outcome describing exactly why rather than an
 * exception it would have to parse. It throws only if the audit trail itself
 * cannot be opened, because an attempt nobody can see afterwards is worse than
 * no attempt.
 */
export async function runScheduledPublication(input: {
  editionDate: string;
  triggerSource: string;
  deps: PublisherDeps;
}): Promise<PublishOutcome> {
  const { editionDate, triggerSource, deps } = input;
  const plan = await deps.plan(editionDate);
  const gate = plan.gate ?? { ok: false, reason: "gate_missing" };
  const batchId = typeof gate.batch_id === "string" ? gate.batch_id : null;
  const runId = batchId
    ? deps.runId(editionDate, batchId)
    : `personews-scheduled-publish:${PUBLISHER_VERSION}:${editionDate}:no-batch`;

  const runRowId = await deps.beginRun(runId, editionDate, triggerSource);

  const base = {
    edition_date: editionDate,
    batch_id: batchId,
    run_id: runId,
    run_row_id: runRowId,
    approved_jobs: typeof gate.approved_jobs === "number" ? gate.approved_jobs : null,
    expected_jobs: typeof gate.expected_jobs === "number" ? gate.expected_jobs : null,
    blockers: Array.isArray(gate.blockers) ? gate.blockers : [],
    gate,
  };

  const settle = async (
    record: RunRecord,
    outcome: Omit<PublishOutcome, keyof typeof base> & Partial<PublishOutcome>,
  ): Promise<PublishOutcome> => {
    await deps.finishRun(runRowId, record);
    return { ...base, ...outcome } as PublishOutcome;
  };

  // Idempotence, first line. A receipt already exists for this batch: the
  // edition went out, and the correct amount of work to do now is none.
  if (gate.already_published === true) {
    return settle(
      {
        gate,
        gatePassed: false,
        publicationAttempted: false,
        publicationSucceeded: false,
        productionVerified: false,
        receiptRecorded: false,
        alreadyPublished: true,
        reason: "already_published",
        productionResult: null,
        verification: null,
        error: null,
      },
      {
        published: false,
        already_published: true,
        gate_passed: false,
        publication_attempted: false,
        publication_succeeded: false,
        production_verified: false,
        receipt_recorded: false,
        reason: "already_published",
        production_result: null,
        verification: null,
        error: null,
      },
    );
  }

  if (gate.ok !== true) {
    return settle(
      {
        gate,
        gatePassed: false,
        publicationAttempted: false,
        publicationSucceeded: false,
        productionVerified: false,
        receiptRecorded: false,
        alreadyPublished: false,
        reason: gate.reason ?? "gate_failed",
        productionResult: null,
        verification: null,
        error: null,
      },
      {
        published: false,
        already_published: false,
        gate_passed: false,
        publication_attempted: false,
        publication_succeeded: false,
        production_verified: false,
        receipt_recorded: false,
        reason: gate.reason ?? "gate_failed",
        production_result: null,
        verification: null,
        error: null,
      },
    );
  }

  // The gate said yes but handed back nothing to publish. Refusing is the only
  // safe reading: the alternative is inventing a payload.
  if (!plan.ready_payload || !batchId) {
    const reason = batchId ? "ready_payload_missing" : "batch_id_missing";
    return settle(
      {
        gate,
        gatePassed: false,
        publicationAttempted: false,
        publicationSucceeded: false,
        productionVerified: false,
        receiptRecorded: false,
        alreadyPublished: false,
        reason,
        productionResult: null,
        verification: null,
        error: null,
      },
      {
        published: false,
        already_published: false,
        gate_passed: false,
        publication_attempted: false,
        publication_succeeded: false,
        production_verified: false,
        receipt_recorded: false,
        reason,
        production_result: null,
        verification: null,
        error: null,
      },
    );
  }

  let productionResult: ProductionPublishResult | null = null;

  try {
    productionResult = await deps.publish(plan.ready_payload, runId);
  } catch (error) {
    return settle(
      {
        gate,
        gatePassed: true,
        publicationAttempted: true,
        publicationSucceeded: false,
        productionVerified: false,
        receiptRecorded: false,
        alreadyPublished: false,
        reason: "production_publish_failed",
        productionResult: null,
        verification: null,
        error: errorMessage(error),
      },
      {
        published: false,
        already_published: false,
        gate_passed: true,
        publication_attempted: true,
        publication_succeeded: false,
        production_verified: false,
        receipt_recorded: false,
        reason: "production_publish_failed",
        production_result: null,
        verification: null,
        error: errorMessage(error),
      },
    );
  }

  if (productionResult?.published !== true) {
    return settle(
      {
        gate,
        gatePassed: true,
        publicationAttempted: true,
        publicationSucceeded: false,
        productionVerified: false,
        receiptRecorded: false,
        alreadyPublished: false,
        reason: "production_publish_refused",
        productionResult,
        verification: null,
        error: null,
      },
      {
        published: false,
        already_published: false,
        gate_passed: true,
        publication_attempted: true,
        publication_succeeded: false,
        production_verified: false,
        receipt_recorded: false,
        reason: "production_publish_refused",
        production_result: productionResult,
        verification: null,
        error: null,
      },
    );
  }

  // Production says it committed. Go and look.
  let verification: ProductionVerification | null = null;

  try {
    verification = await deps.verify(editionDate, batchId, runId);
  } catch (error) {
    return settle(
      {
        gate,
        gatePassed: true,
        publicationAttempted: true,
        publicationSucceeded: true,
        productionVerified: false,
        receiptRecorded: false,
        alreadyPublished: false,
        reason: "production_verification_unavailable",
        productionResult,
        verification: null,
        error: errorMessage(error),
      },
      {
        published: false,
        already_published: false,
        gate_passed: true,
        publication_attempted: true,
        publication_succeeded: true,
        production_verified: false,
        receipt_recorded: false,
        reason: "production_verification_unavailable",
        production_result: productionResult,
        verification: null,
        error: errorMessage(error),
      },
    );
  }

  if (verification?.ok !== true) {
    return settle(
      {
        gate,
        gatePassed: true,
        publicationAttempted: true,
        publicationSucceeded: true,
        productionVerified: false,
        receiptRecorded: false,
        alreadyPublished: false,
        reason: "production_verification_failed",
        productionResult,
        verification,
        error: null,
      },
      {
        published: false,
        already_published: false,
        gate_passed: true,
        publication_attempted: true,
        publication_succeeded: true,
        production_verified: false,
        receipt_recorded: false,
        reason: "production_verification_failed",
        production_result: productionResult,
        verification,
        error: null,
      },
    );
  }

  // Production has the edition and it is complete. Now, and only now.
  try {
    await deps.markPublished(batchId, runId, productionResult);
  } catch (error) {
    // The edition IS live. Say so loudly rather than pretending it is not: the
    // fix is to write the receipt by hand, not to publish anything again.
    return settle(
      {
        gate,
        gatePassed: true,
        publicationAttempted: true,
        publicationSucceeded: true,
        productionVerified: true,
        receiptRecorded: false,
        alreadyPublished: false,
        reason: "receipt_write_failed",
        productionResult,
        verification,
        error: errorMessage(error),
      },
      {
        published: true,
        already_published: false,
        gate_passed: true,
        publication_attempted: true,
        publication_succeeded: true,
        production_verified: true,
        receipt_recorded: false,
        reason: "receipt_write_failed",
        production_result: productionResult,
        verification,
        error: errorMessage(error),
      },
    );
  }

  return settle(
    {
      gate,
      gatePassed: true,
      publicationAttempted: true,
      publicationSucceeded: true,
      productionVerified: true,
      receiptRecorded: true,
      alreadyPublished: false,
      reason: "published",
      productionResult,
      verification,
      error: null,
    },
    {
      published: true,
      already_published: false,
      gate_passed: true,
      publication_attempted: true,
      publication_succeeded: true,
      production_verified: true,
      receipt_recorded: true,
      reason: "published",
      production_result: productionResult,
      verification,
      error: null,
    },
  );
}

/** Today's date in the editorial timezone. DST-correct: the offset is never named. */
export function editorialDate(now: Date = new Date(), timeZone = "Europe/Paris"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function isEditorialDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
