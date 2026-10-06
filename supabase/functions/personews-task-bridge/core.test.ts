import { describe, expect, it } from "vitest";

import { getProductEditionDate } from "../../../services/content-engine/src/scheduler/editionCadence.ts";
import { editorialDate } from "../personews-scheduled-publisher/core.ts";
import {
  handleBridgeRequest,
  parisEditionDate,
  parseBridgeRequest,
  selectShardJobs,
  sha256Hex,
  type BridgeDeps,
  type ChunkKind,
  type IncomingRequest,
  type ManifestJob,
  type SubmitOutcome,
} from "./core.ts";

/**
 * The bridge's request contract and decisions, without a database. The SQL
 * half (leases, once-per-claim outputs) is proven by
 * supabase-staging/supabase/tests/bridge_job_leases.test.sql.
 */

const TOKEN = "bridge-secret-token-0123456789";
const BASE = "https://kukyotcgbnchsoeriqoz.supabase.co/functions/v1/personews-task-bridge";
const NOW = new Date("2030-07-01T10:00:00Z");
const DATE = "2030-07-01";

function jobId(n: number) {
  return `b1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function manifestJobs(statuses: string[]): ManifestJob[] {
  return statuses.map((status, index) => ({ job: { id: jobId(index + 1), status } }));
}

function b64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

type Fake = BridgeDeps & {
  logs: Array<Record<string, unknown>>;
  chunks: Map<string, { seq: number; total: number; payload: string; kind: ChunkKind }>;
  submitted: Array<{ jobId: string; workerId: string }>;
  claims: Array<{ jobIds: string[]; workerId: string }>;
};

function fakeDeps(options: {
  jobs?: ManifestJob[];
  claim?: "supported" | "unsupported" | ((ids: string[]) => string[]);
  submit?: (jobId: string) => SubmitOutcome;
} = {}): Fake {
  const chunks = new Map<string, { seq: number; total: number; payload: string; kind: ChunkKind }>();
  const fake: Fake = {
    logs: [],
    chunks,
    submitted: [],
    claims: [],
    async prepareManifest(date) {
      return { edition_date: date, edition_kind: "daily", batch_id: "batch-1", jobs: options.jobs ?? [] };
    },
    async claimJobs(jobIds, workerId) {
      fake.claims.push({ jobIds, workerId });
      if (options.claim === "unsupported") return { supported: false };
      const granted = typeof options.claim === "function" ? options.claim(jobIds) : jobIds;
      return { supported: true, claimed: granted.map((id) => ({ job_id: id, lease_expires_at: "2030-07-01T10:45:00Z" })) };
    },
    async questionContract() {
      return { available: true, required: true };
    },
    async pruneChunks() {},
    async storeChunk(chunk) {
      chunks.set(`${chunk.sid}:${chunk.seq}`, chunk);
    },
    async readChunks(sid, kind) {
      return [...chunks.entries()]
        .filter(([key, chunk]) => key.startsWith(`${sid}:`) && chunk.kind === kind)
        .map(([, chunk]) => chunk)
        .sort((a, b) => a.seq - b.seq);
    },
    async deleteChunks(sid) {
      for (const key of [...chunks.keys()]) if (key.startsWith(`${sid}:`)) chunks.delete(key);
    },
    async submitOutput(input) {
      fake.submitted.push({ jobId: input.jobId, workerId: input.workerId });
      return options.submit ? options.submit(input.jobId) : { status: "submitted", output_id: `out-${input.jobId.slice(-2)}` };
    },
    async submitReview(input) {
      return `review-${input.jobId.slice(-2)}`;
    },
    async readyBatch() {
      return { ready: false, reason: "awaiting_reviews" };
    },
    async editionKind() {
      return "daily";
    },
    async reviewQueue() {
      return [{ job: { id: jobId(1), content_type: "newsletter_article" }, output: { id: "out-01" } }];
    },
    async batchStatus() {
      return { batch: { id: "batch-1" }, job_counts: { queued: 1 } };
    },
    log(event) {
      fake.logs.push(event);
    },
  };
  return fake;
}

async function config() {
  return { expectedTokenHash: await sha256Hex(TOKEN), now: NOW };
}

function post(body: Record<string, unknown>, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }): IncomingRequest {
  return { method: "POST", url: BASE, headers, bodyText: JSON.stringify(body) };
}

function get(query: Record<string, string>): IncomingRequest {
  return { method: "GET", url: `${BASE}?${new URLSearchParams(query)}`, headers: {}, bodyText: null };
}

describe("F. header authentication (v2)", () => {
  it("accepts Authorization: Bearer", async () => {
    const response = await handleBridgeRequest(post({ action: "ping" }), fakeDeps(), await config());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, date: DATE, bridge: "personews-task-bridge-v2" });
    expect(response.headers.deprecation).toBeUndefined();
    expect(response.body.deprecations).toBeUndefined();
  });

  it("accepts x-personews-bridge-token", async () => {
    const response = await handleBridgeRequest(post({ action: "ping" }, { "x-personews-bridge-token": TOKEN }), fakeDeps(), await config());
    expect(response.status).toBe(200);
  });

  it("refuses a wrong, missing or empty token", async () => {
    const cfg = await config();
    const cases: Array<Record<string, string>> = [{ authorization: "Bearer nope" }, {}, { authorization: "Bearer " }];
    for (const headers of cases) {
      expect((await handleBridgeRequest(post({ action: "ping" }, headers), fakeDeps(), cfg)).status).toBe(401);
    }
  });

  it("refuses everything when no token hash is configured", async () => {
    const response = await handleBridgeRequest(post({ action: "ping" }), fakeDeps(), { expectedTokenHash: "", now: NOW });
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("bridge_token_not_configured");
  });

  it("refuses other methods and unknown actions", async () => {
    const cfg = await config();
    expect((await handleBridgeRequest({ ...post({}), method: "PUT" }, fakeDeps(), cfg)).status).toBe(405);
    expect((await handleBridgeRequest(post({ action: "publish" }), fakeDeps(), cfg)).status).toBe(404);
  });
});

describe("G. the legacy GET + ?token= contract still works, flagged deprecated", () => {
  it("accepts a query token and says so", async () => {
    const response = await handleBridgeRequest(get({ token: TOKEN, action: "ping" }), fakeDeps(), await config());
    expect(response.status).toBe(200);
    expect(response.headers.deprecation).toBe("true");
    expect(response.body.deprecations).toEqual([expect.stringMatching(/^token_in_query_string/)]);
  });

  it("serves a v1 jobs call unchanged in shape", async () => {
    const deps = fakeDeps({ jobs: manifestJobs(["queued", "queued", "queued", "queued"]) });
    const response = await handleBridgeRequest(get({ token: TOKEN, action: "jobs", worker: "a", date: DATE }), deps, await config());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ edition_date: DATE, worker: "a" });
    expect((response.body.jobs as ManifestJob[]).map((job) => job.job?.id)).toEqual([jobId(1), jobId(4)]);
  });

  it("flags chunk data carried in the URL", async () => {
    const response = await handleBridgeRequest(
      get({ token: TOKEN, action: "chunk", sid: "session-0001", kind: "outputs", seq: "0", total: "1", data: "abc" }),
      fakeDeps(),
      await config(),
    );
    expect(response.status).toBe(200);
    expect(response.body.deprecations).toHaveLength(2);
  });

  it("keeps v1's URL-sized chunk ceiling for GET", async () => {
    const response = await handleBridgeRequest(
      get({ token: TOKEN, action: "chunk", sid: "session-0001", kind: "outputs", seq: "0", total: "1", data: "a".repeat(6501) }),
      fakeDeps(),
      await config(),
    );
    expect(response.status).toBe(400);
  });

  it("a header token wins: no deprecation even when an old ?token= lingers in the URL", () => {
    const parsed = parseBridgeRequest({ ...get({ token: "stale", action: "ping" }), headers: { authorization: `Bearer ${TOKEN}` } }, NOW);
    expect(parsed).toMatchObject({ token: TOKEN, tokenSource: "header", deprecations: [] });
  });
});

describe("H. POST bodies: chunks and inline payloads", () => {
  const outputs = {
    edition_date: DATE,
    worker_id: "personews-generator-a",
    outputs: [{ job_id: jobId(1), output_json: { fr: {}, en: {} }, source_records: [], prompt_version: "v1" }],
  };

  it("accepts a large chunk in the body and commits it", async () => {
    const deps = fakeDeps();
    const cfg = await config();
    const encoded = b64url({ ...outputs, padding: "x".repeat(20_000) });
    expect(encoded.length).toBeGreaterThan(6500);

    const chunk = await handleBridgeRequest(post({ action: "chunk", sid: "session-0001", kind: "outputs", seq: 0, total: 1, data: encoded }), deps, cfg);
    expect(chunk.status).toBe(200);

    const commit = await handleBridgeRequest(post({ action: "commit", sid: "session-0001", kind: "outputs", date: DATE }), deps, cfg);
    expect(commit.status).toBe(200);
    expect(commit.body).toMatchObject({ ok: true, kind: "outputs" });
    expect(deps.submitted).toEqual([{ jobId: jobId(1), workerId: "personews-generator-a" }]);
    expect(deps.chunks.size).toBe(0);
  });

  it("commits an inline payload with no chunks at all", async () => {
    const deps = fakeDeps();
    const commit = await handleBridgeRequest(post({ action: "commit", kind: "outputs", date: DATE, payload: outputs }), deps, await config());
    expect(commit.status).toBe(200);
    expect(commit.body.results).toEqual([{ job_id: jobId(1), ok: true, status: "submitted", output_id: "out-01" }]);
  });

  it("refuses an incomplete chunk set and a payload for another date", async () => {
    const deps = fakeDeps();
    const cfg = await config();
    await handleBridgeRequest(post({ action: "chunk", sid: "session-0002", kind: "outputs", seq: 0, total: 2, data: "abc" }), deps, cfg);
    expect((await handleBridgeRequest(post({ action: "commit", sid: "session-0002", kind: "outputs", date: DATE }), deps, cfg)).status).toBe(409);

    const wrongDate = await handleBridgeRequest(
      post({ action: "commit", kind: "outputs", date: DATE, payload: { ...outputs, edition_date: "2030-06-30" } }),
      deps,
      cfg,
    );
    expect(wrongDate.status).toBe(400);
    expect(wrongDate.body.error).toBe("edition_date_mismatch");
  });

  it("rejects malformed JSON", async () => {
    const response = await handleBridgeRequest({ ...post({}), bodyText: "{nope" }, fakeDeps(), await config());
    expect(response.status).toBe(400);
  });

  it("reports duplicate and conflicting submissions per item, ok only when every item landed", async () => {
    const deps = fakeDeps({
      submit: (id) => (id === jobId(1) ? { status: "duplicate_identical", output_id: "out-01" } : { status: "duplicate_conflict", output_id: "out-02" }),
    });
    const payload = { ...outputs, outputs: [...outputs.outputs, { ...outputs.outputs[0], job_id: jobId(2) }] };
    const commit = await handleBridgeRequest(post({ action: "commit", kind: "outputs", date: DATE, payload }), deps, await config());
    expect(commit.body.ok).toBe(false);
    expect(commit.body.results).toEqual([
      { job_id: jobId(1), ok: true, status: "duplicate_identical", output_id: "out-01" },
      { job_id: jobId(2), ok: false, status: "duplicate_conflict", output_id: "out-02" },
    ]);
  });

  it("a review commit reports readiness but never publishes", async () => {
    const commit = await handleBridgeRequest(
      post({ action: "commit", kind: "reviews", date: DATE, payload: { edition_date: DATE, reviews: [{ job_id: jobId(1), verdict: "approve", score: 9, checks: {} }] } }),
      fakeDeps(),
      await config(),
    );
    expect(commit.body.publication).toMatchObject({ published: false, batch_ready: false, publisher: "personews-scheduled-publisher" });
  });
});

describe("leasing in the jobs action", () => {
  it("hands out only the jobs this worker now holds, with their lease", async () => {
    const deps = fakeDeps({
      jobs: manifestJobs(["queued", "queued", "queued", "revision_required", "queued", "queued", "approved"]),
      claim: (ids) => ids.filter((id) => id !== jobId(4)),
    });
    const response = await handleBridgeRequest(post({ action: "jobs", worker: "a" }), deps, await config());
    expect(deps.claims).toEqual([{ jobIds: [jobId(1), jobId(4)], workerId: "personews-generator-a" }]);
    expect(response.body.jobs).toEqual([{ job: { id: jobId(1), status: "queued" }, lease_expires_at: "2030-07-01T10:45:00Z" }]);
    expect(response.body.leasing).toEqual({ lease_seconds: 2700 });
    // The scored-question contract still travels in the manifest the generators read.
    expect(response.body.scored_question_contract).toEqual({ available: true, required: true });
  });

  it("falls back to the unleased v1 shard while the lease migration is not applied", async () => {
    const deps = fakeDeps({ jobs: manifestJobs(["queued", "queued", "queued", "queued"]), claim: "unsupported" });
    const response = await handleBridgeRequest(post({ action: "jobs", worker: "a" }), deps, await config());
    expect((response.body.jobs as ManifestJob[]).length).toBe(2);
    expect(response.body.leasing).toBe("unavailable");
  });

  it("never claims anything for a finished or foreign job, nor an invalid worker", async () => {
    expect(selectShardJobs(manifestJobs(["approved", "submitted", "failed"]), "a")).toEqual([]);
    expect(selectShardJobs(manifestJobs(["queued"]), "d")).toEqual([]);
    const response = await handleBridgeRequest(post({ action: "jobs", worker: "z" }), fakeDeps(), await config());
    expect(response.status).toBe(400);
  });
});

describe("I. no token and no content in logs", () => {
  it("logs only action, outcome and counts across every path", async () => {
    const deps = fakeDeps({ jobs: manifestJobs(["queued"]) });
    const cfg = await config();
    const secretContent = "CONFIDENTIAL-ARTICLE-BODY";
    const payload = {
      edition_date: DATE,
      worker_id: "personews-generator-a",
      outputs: [{ job_id: jobId(1), output_json: { fr: { body: secretContent } }, source_records: [], prompt_version: "v1" }],
    };

    await handleBridgeRequest(post({ action: "jobs", worker: "a" }), deps, cfg);
    await handleBridgeRequest(get({ token: TOKEN, action: "chunk", sid: "session-0003", kind: "outputs", seq: "0", total: "1", data: b64url(payload) }), deps, cfg);
    await handleBridgeRequest(get({ token: TOKEN, action: "commit", sid: "session-0003", kind: "outputs", date: DATE }), deps, cfg);
    await handleBridgeRequest(post({ action: "commit", kind: "outputs", date: DATE, payload }), deps, cfg);
    await handleBridgeRequest(post({ action: "ping" }, { authorization: "Bearer wrong-token-value" }), deps, cfg);
    await handleBridgeRequest(get({ token: "wrong-token-value", action: "ping" }), deps, cfg);

    const logged = JSON.stringify(deps.logs);
    expect(deps.logs.length).toBe(6);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("wrong-token-value");
    expect(logged).not.toContain(secretContent);
    expect(logged).not.toContain(b64url(payload).slice(0, 40));
  });

  it("does not echo the token in any response", async () => {
    const response = await handleBridgeRequest(get({ token: TOKEN, action: "ping" }), fakeDeps(), await config());
    expect(JSON.stringify(response)).not.toContain(TOKEN);
  });
});

describe("J. the default date is the Paris edition date, as everywhere else", () => {
  // Around both DST changes and both midnights that used to diverge from Chicago.
  const instants = [
    "2030-07-01T21:59:00Z",
    "2030-07-01T22:01:00Z",
    "2030-07-02T04:30:00Z",
    "2030-03-31T00:59:00Z",
    "2030-03-31T01:01:00Z",
    "2030-10-27T00:30:00Z",
    "2030-10-27T23:30:00Z",
    "2030-12-31T23:30:00Z",
  ];

  for (const iso of instants) {
    it(`agrees with the engine and the publisher at ${iso}`, () => {
      const now = new Date(iso);
      expect(parisEditionDate(now)).toBe(getProductEditionDate(now));
      expect(parisEditionDate(now)).toBe(editorialDate(now));
    });
  }

  it("a request without a date uses it (a 05:30 Paris run is today, not yesterday as with Chicago)", () => {
    const parsed = parseBridgeRequest(post({ action: "ping" }), new Date("2030-07-02T03:30:00Z"));
    expect(parsed).toMatchObject({ date: "2030-07-02" });
  });

  it("an explicit date (date or edition_date) wins, and an impossible one is refused", () => {
    expect(parseBridgeRequest(post({ action: "ping", edition_date: "2030-06-30" }), NOW)).toMatchObject({ date: "2030-06-30" });
    expect(parseBridgeRequest(post({ action: "ping", date: "2030-02-30" }), NOW)).toEqual({ error: "invalid_date", status: 400 });
  });
});
