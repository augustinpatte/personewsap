/**
 * personews-task-bridge — the request contract and every decision, free of any
 * Deno or Supabase import, so it runs under vitest exactly as in the Edge
 * runtime. index.ts only wires the database calls in.
 *
 * WHO CALLS IT. The ChatGPT Scheduled Tasks: generators a/b/c and the reviewer.
 *
 * THE CONTRACT
 *
 *   Preferred (v2):
 *     POST, JSON body { action, date?, worker?, payload?, sid?, kind?, seq?, total?, data?, job_id? }
 *     Authorization: Bearer <token>   (or x-personews-bridge-token: <token>)
 *     commit may carry the whole payload inline in `payload` — no chunks needed.
 *
 *   Legacy (v1, still accepted while the Scheduled Tasks are migrated):
 *     GET ?token=…&action=…&date=…&worker=…&sid=…&kind=…&seq=…&total=…&data=…
 *     Every legacy use is reported back in `deprecations` and in a
 *     `Deprecation: true` response header. Remove it once the tasks are moved.
 *
 *   Date: `date` (or `edition_date`) when given; otherwise the canonical
 *   Europe/Paris edition date — the same calendar the publisher uses. It was
 *   America/Chicago, which put a task running before 07:00 Paris on yesterday's
 *   batch.
 *
 * WHAT IS NEVER LOGGED: the token, chunk data, payloads, article text. Log lines
 * carry the action, the outcome and counts only.
 */

export type BridgeAction =
  | "ping"
  | "jobs"
  | "question_contract"
  | "chunk"
  | "commit"
  | "review_index"
  | "review_item"
  | "status";

const ACTIONS: ReadonlySet<string> = new Set([
  "ping",
  "jobs",
  "question_contract",
  "chunk",
  "commit",
  "review_index",
  "review_item",
  "status",
]);

export type IncomingRequest = {
  method: string;
  url: string;
  /** Header names lower-cased. */
  headers: Record<string, string | undefined>;
  bodyText: string | null;
};

export type BridgeResponse = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

export type ManifestJob = {
  job?: { id?: string; status?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type Manifest = {
  edition_date?: string;
  edition_kind?: string | null;
  batch_id?: string | null;
  batch_metadata?: unknown;
  prompt_bundle_version?: string | null;
  canonical_output_contract?: unknown;
  source_record_contract?: unknown;
  common_runtime_contract?: unknown;
  review_policy?: unknown;
  editorial_memory?: unknown;
  jobs?: ManifestJob[];
};

export type ClaimResult =
  | { supported: true; claimed: Array<{ job_id: string; lease_expires_at: string }> }
  | { supported: false };

export type SubmitOutcome = {
  status:
    | "submitted"
    | "duplicate_identical"
    | "duplicate_conflict"
    | "lease_held_by_other_worker"
    | "not_submittable"
    | "job_not_found"
    | "submitted_without_ledger";
  output_id?: string | null;
  [key: string]: unknown;
};

export type ReviewQueueEntry = {
  job?: { id?: string; content_type?: string; topic?: string; mini_case_topic?: string; ordinal?: number };
  output?: { id?: string };
  deterministic_preflight?: unknown;
  [key: string]: unknown;
};

export type BridgeDeps = {
  prepareManifest(date: string): Promise<Manifest>;
  claimJobs(jobIds: string[], workerId: string, leaseSeconds: number): Promise<ClaimResult>;
  questionContract(date: string): Promise<unknown>;
  pruneChunks(olderThanIso: string): Promise<void>;
  storeChunk(chunk: { sid: string; seq: number; total: number; kind: ChunkKind; payload: string }): Promise<void>;
  readChunks(sid: string, kind: ChunkKind): Promise<Array<{ seq: number; total: number; payload: string }>>;
  deleteChunks(sid: string, kind: ChunkKind): Promise<void>;
  submitOutput(input: {
    jobId: string;
    workerId: string;
    outputJson: unknown;
    sourceRecords: unknown;
    promptVersion: unknown;
    date: string;
  }): Promise<SubmitOutcome>;
  submitReview(input: {
    jobId: string;
    reviewerId: string;
    verdict: unknown;
    score: unknown;
    checks: unknown;
    feedback: unknown;
  }): Promise<string | null>;
  readyBatch(date: string): Promise<{ ready?: boolean; reason?: string | null } | null>;
  editionKind(date: string): Promise<string | null>;
  reviewQueue(kind: string | null, date: string): Promise<ReviewQueueEntry[]>;
  batchStatus(date: string, kind: string | null): Promise<Record<string, unknown>>;
  /** Structured, content-free log line. */
  log(event: Record<string, unknown>): void;
};

export type BridgeConfig = {
  expectedTokenHash: string;
  now?: Date;
  /** Generator lease length. 45 minutes covers a full generation run. */
  leaseSeconds?: number;
};

export type ChunkKind = "outputs" | "reviews";

export const DEFAULT_LEASE_SECONDS = 2700;
const CHUNK_TTL_MS = 6 * 60 * 60 * 1000;
const WORKER_SHARDS: Readonly<Record<string, number>> = { a: 0, b: 1, c: 2 };
const SHARD_COUNT = 3;
const CLAIMABLE_STATUSES: ReadonlySet<string> = new Set(["queued", "revision_required"]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** The canonical edition date: the Europe/Paris calendar day. DST-correct. */
export function parisEditionDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Equal-length comparison that does not stop at the first difference. */
export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

/** The jobs of one worker's shard that are still waiting for a generator. */
export function selectShardJobs(jobs: ManifestJob[], worker: string): ManifestJob[] {
  const shard = WORKER_SHARDS[worker.toLowerCase()];
  if (shard === undefined) return [];
  return jobs.filter(
    (job, index) => index % SHARD_COUNT === shard && CLAIMABLE_STATUSES.has(String(job?.job?.status ?? "")),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

// ---------------------------------------------------------------------------
// Request parsing and authentication
// ---------------------------------------------------------------------------

export type ParsedRequest = {
  action: BridgeAction;
  date: string;
  params: Record<string, unknown>;
  token: string;
  tokenSource: "header" | "query";
  deprecations: string[];
};

export function parseBridgeRequest(
  request: IncomingRequest,
  now: Date = new Date(),
): ParsedRequest | { error: string; status: number } {
  const method = request.method.toUpperCase();

  if (method !== "GET" && method !== "POST") {
    return { error: "method_not_allowed", status: 405 };
  }

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  let body: Record<string, unknown> = {};

  if (method === "POST" && request.bodyText) {
    try {
      body = asRecord(JSON.parse(request.bodyText));
    } catch {
      return { error: "invalid_json_body", status: 400 };
    }
  }

  // Body wins over the query string for the same field.
  const params: Record<string, unknown> = { ...query, ...body };
  delete params.token;

  const deprecations: string[] = [];
  const authorization = request.headers["authorization"] ?? "";
  const headerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : (request.headers["x-personews-bridge-token"] ?? "").trim();
  let token = headerToken;
  let tokenSource: "header" | "query" = "header";

  if (!token && query.token) {
    token = query.token;
    tokenSource = "query";
    deprecations.push("token_in_query_string: send Authorization: Bearer <token> instead");
  }

  if (method === "GET" && typeof query.data === "string" && query.data.length > 0) {
    deprecations.push("chunk_data_in_query_string: POST the chunk (or the whole payload) in the JSON body instead");
  }

  const action = text(params.action || "ping");

  if (!ACTIONS.has(action)) {
    return { error: "unknown_action", status: 404 };
  }

  const requestedDate = text(params.date || params.edition_date);
  const date = requestedDate || parisEditionDate(now);

  if (!isValidDate(date)) {
    return { error: "invalid_date", status: 400 };
  }

  return { action: action as BridgeAction, date, params, token, tokenSource, deprecations };
}

export async function isAuthorized(token: string, expectedTokenHash: string): Promise<boolean> {
  if (!token || !expectedTokenHash) return false;
  return constantTimeEqual(await sha256Hex(token), expectedTokenHash.toLowerCase());
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

function respond(
  status: number,
  body: Record<string, unknown>,
  deprecations: string[] = [],
): BridgeResponse {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  if (deprecations.length > 0) {
    headers["deprecation"] = "true";
    body = { ...body, deprecations };
  }

  return { status, body, headers };
}

export async function handleBridgeRequest(
  request: IncomingRequest,
  deps: BridgeDeps,
  config: BridgeConfig,
): Promise<BridgeResponse> {
  const now = config.now ?? new Date();

  if (!config.expectedTokenHash) {
    return respond(500, { error: "bridge_token_not_configured" });
  }

  const parsed = parseBridgeRequest(request, now);

  if ("error" in parsed) {
    deps.log({ event: "bridge_request_rejected", reason: parsed.error });
    return respond(parsed.status, { error: parsed.error });
  }

  if (!(await isAuthorized(parsed.token, config.expectedTokenHash))) {
    deps.log({ event: "bridge_request_rejected", reason: "unauthorized", token_source: parsed.tokenSource });
    return respond(401, { error: "unauthorized" });
  }

  const { action, date, params, deprecations } = parsed;
  const done = (status: number, body: Record<string, unknown>, outcome: Record<string, unknown> = {}) => {
    deps.log({
      event: "bridge_request",
      action,
      date,
      status,
      token_source: parsed.tokenSource,
      deprecated: deprecations.length > 0,
      ...outcome,
    });
    return respond(status, body, deprecations);
  };

  try {
    switch (action) {
      case "ping":
        return done(200, { ok: true, date, bridge: "personews-task-bridge-v2" });

      case "jobs":
        return await jobsAction();

      case "question_contract":
        return done(200, asRecord(await deps.questionContract(date)));

      case "chunk":
        return await chunkAction();

      case "commit":
        return await commitAction();

      case "review_index":
      case "review_item":
        return await reviewAction();

      case "status": {
        const kind = await deps.editionKind(date);
        return done(200, { edition_date: date, edition_kind: kind, ...(await deps.batchStatus(date, kind)) });
      }
    }
  } catch (error) {
    // The message of a database error, never a payload.
    const message = error instanceof Error ? error.message : String(error);
    return done(500, { error: message.slice(0, 300) }, { failed: true });
  }

  return done(404, { error: "unknown_action" });

  async function jobsAction(): Promise<BridgeResponse> {
    const worker = text(params.worker).toLowerCase();

    if (WORKER_SHARDS[worker] === undefined) {
      return done(400, { error: "invalid_worker" });
    }

    const manifest = await deps.prepareManifest(date);
    const shardJobs = selectShardJobs(Array.isArray(manifest?.jobs) ? manifest.jobs : [], worker);
    const ids = shardJobs.map((job) => text(job?.job?.id)).filter(Boolean);
    const leaseSeconds = config.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    const workerId = `personews-generator-${worker}`;
    const claim = ids.length > 0 ? await deps.claimJobs(ids, workerId, leaseSeconds) : ({ supported: true, claimed: [] } as ClaimResult);

    // Only the jobs this worker now holds. A second run of the same task while
    // the first is still working gets nothing from another shard holder, and
    // its own jobs back (same lease) rather than a second copy of the work.
    const leases = new Map(claim.supported ? claim.claimed.map((entry) => [entry.job_id, entry.lease_expires_at]) : []);
    const jobs = claim.supported
      ? shardJobs
          .filter((job) => leases.has(text(job?.job?.id)))
          .map((job) => ({ ...job, lease_expires_at: leases.get(text(job?.job?.id)) }))
      : shardJobs;

    return done(
      200,
      {
        bridge_version: "v2",
        edition_date: manifest?.edition_date ?? date,
        edition_kind: manifest?.edition_kind ?? null,
        batch_id: manifest?.batch_id ?? null,
        batch_metadata: manifest?.batch_metadata ?? null,
        prompt_bundle_version: manifest?.prompt_bundle_version ?? null,
        canonical_output_contract: manifest?.canonical_output_contract ?? null,
        source_record_contract: manifest?.source_record_contract ?? null,
        common_runtime_contract: manifest?.common_runtime_contract ?? null,
        review_policy: manifest?.review_policy ?? null,
        scored_question_contract: await deps.questionContract(date),
        editorial_memory: manifest?.editorial_memory ?? null,
        worker,
        worker_id: workerId,
        leasing: claim.supported ? { lease_seconds: leaseSeconds } : "unavailable",
        jobs,
      },
      { shard_jobs: shardJobs.length, jobs_handed_out: jobs.length, leasing: claim.supported },
    );
  }

  async function chunkAction(): Promise<BridgeResponse> {
    const sid = text(params.sid);
    const kind = text(params.kind);
    const seq = Number(params.seq);
    const total = Number(params.total);
    const data = text(params.data);

    if (
      !/^[A-Za-z0-9_-]{8,100}$/.test(sid) ||
      (kind !== "outputs" && kind !== "reviews") ||
      !Number.isInteger(seq) ||
      !Number.isInteger(total) ||
      seq < 0 ||
      total < 1 ||
      total > 100 ||
      seq >= total ||
      !/^[A-Za-z0-9_-]+$/.test(data) ||
      // GET keeps v1's 6.5 KB ceiling (URL length); a POST body may carry more.
      data.length > (request.method.toUpperCase() === "POST" ? 262_144 : 6_500)
    ) {
      return done(400, { error: "invalid_chunk" });
    }

    await deps.pruneChunks(new Date(now.getTime() - CHUNK_TTL_MS).toISOString());
    await deps.storeChunk({ sid, seq, total, kind, payload: data });
    return done(200, { ok: true, sid, seq, total, kind }, { kind });
  }

  async function commitAction(): Promise<BridgeResponse> {
    const kind = text(params.kind);

    if (kind !== "outputs" && kind !== "reviews") {
      return done(400, { error: "invalid_commit" });
    }

    let payload: Record<string, unknown>;
    let sid: string | null = null;

    if (params.payload && typeof params.payload === "object") {
      // v2: the whole payload in the POST body, no chunks.
      payload = asRecord(params.payload);
    } else {
      sid = text(params.sid);
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(sid)) {
        return done(400, { error: "invalid_commit" });
      }

      const chunks = await deps.readChunks(sid, kind);
      if (chunks.length === 0) return done(404, { error: "chunks_not_found" });

      const expectedTotal = chunks[0].total;
      if (chunks.length !== expectedTotal || chunks.some((chunk, index) => chunk.total !== expectedTotal || chunk.seq !== index)) {
        return done(409, { error: "chunks_incomplete", received: chunks.length, expected: expectedTotal });
      }

      try {
        payload = asRecord(JSON.parse(decodeBase64Url(chunks.map((chunk) => chunk.payload).join(""))));
      } catch {
        return done(400, { error: "payload_decode_failed" });
      }
    }

    if (payload.edition_date !== date) {
      return done(400, { error: "edition_date_mismatch" });
    }

    const results: Array<Record<string, unknown>> = [];

    if (kind === "outputs") {
      const workerId = text(payload.worker_id);
      if (!/^personews-generator-[abc]$/.test(workerId) || !Array.isArray(payload.outputs)) {
        return done(400, { error: "invalid_outputs_payload" });
      }

      for (const raw of payload.outputs) {
        const item = asRecord(raw);
        const jobId = text(item.job_id);
        try {
          const outcome = await deps.submitOutput({
            jobId,
            workerId,
            outputJson: item.output_json,
            sourceRecords: item.source_records,
            promptVersion: item.prompt_version,
            date,
          });
          results.push({
            job_id: jobId,
            ok: outcome.status === "submitted" || outcome.status === "duplicate_identical" || outcome.status === "submitted_without_ledger",
            status: outcome.status,
            output_id: outcome.output_id ?? null,
          });
        } catch (error) {
          results.push({ job_id: jobId || null, ok: false, status: "error", error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
        }
      }
    } else {
      const reviewerId = text(payload.reviewer_id || "personews-reviewer");
      if (reviewerId !== "personews-reviewer" || !Array.isArray(payload.reviews)) {
        return done(400, { error: "invalid_reviews_payload" });
      }

      for (const raw of payload.reviews) {
        const item = asRecord(raw);
        const jobId = text(item.job_id);
        try {
          const reviewId = await deps.submitReview({
            jobId,
            reviewerId,
            verdict: item.verdict,
            score: item.score,
            checks: item.checks,
            feedback: item.feedback ?? null,
          });
          results.push({ job_id: jobId, ok: true, review_id: reviewId, verdict: item.verdict });
        } catch (error) {
          results.push({ job_id: jobId || null, ok: false, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
        }
      }
    }

    if (sid) {
      await deps.deleteChunks(sid, kind);
    }

    // Publication never happens here: the scheduled publisher decides at
    // 19:00–21:00 Europe/Paris against the SQL gate.
    let publication: Record<string, unknown> = {
      published: false,
      reason: "publication_is_scheduled_and_deterministic",
    };

    if (kind === "reviews") {
      const ready = await deps.readyBatch(date);
      publication = {
        ...publication,
        publisher: "personews-scheduled-publisher",
        scheduled_for: "19:00 Europe/Paris (catch-up until 21:00)",
        batch_ready: ready?.ready === true,
        batch_reason: ready?.reason ?? null,
      };
    }

    const ok = results.every((result) => result.ok === true);
    return done(200, { ok, kind, results, publication }, {
      kind,
      items: results.length,
      accepted: results.filter((result) => result.ok === true).length,
    });
  }

  async function reviewAction(): Promise<BridgeResponse> {
    const kind = await deps.editionKind(date);

    if (action === "review_index") {
      if (!kind) return done(200, { edition_date: date, edition_kind: null, jobs: [] });
      const queue = await deps.reviewQueue(kind, date);
      const jobs = queue.map((entry) => ({
        job_id: entry?.job?.id,
        content_type: entry?.job?.content_type,
        topic: entry?.job?.topic,
        mini_case_topic: entry?.job?.mini_case_topic,
        ordinal: entry?.job?.ordinal,
        output_id: entry?.output?.id,
        deterministic_preflight: entry?.deterministic_preflight,
      }));
      return done(200, { edition_date: date, edition_kind: kind, count: jobs.length, jobs }, { jobs: jobs.length });
    }

    const jobId = text(params.job_id);
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return done(400, { error: "invalid_job_id" });

    const queue = await deps.reviewQueue(kind, date);
    const item = queue.find((entry) => entry?.job?.id === jobId);
    if (!item) return done(404, { error: "review_item_not_found" });
    return done(200, item as Record<string, unknown>);
  }
}
