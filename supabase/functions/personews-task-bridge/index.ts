/* eslint-disable @typescript-eslint/no-explicit-any */
// Supabase RPC payloads in this staging bridge are dynamic JSON and are runtime-validated.
/**
 * personews-task-bridge — STAGING project (kukyotcgbnchsoeriqoz).
 *
 * The door the ChatGPT Scheduled Tasks knock on: claim jobs, upload outputs and
 * reviews, read the review queue, read batch status. The request contract and
 * every decision live in core.ts (tested under vitest); this file only wires the
 * database in. See core.ts for the v2 contract (POST + Authorization header)
 * and the deprecated v1 one (GET + ?token=), which is still accepted.
 *
 * It is also the ONLY place the generators can be told what to produce. A prompt
 * file in the repository is not reachable from a Scheduled Task, so the scored
 * question contract travels in the `jobs` manifest (and, on its own, through
 * `action=question_contract`), served from `scored_question_contract()` so the
 * generators, the reviewer and the gate read one definition.
 *
 * It does NOT publish. Publication is the sole business of
 * `personews-scheduled-publisher`, which runs on a fixed schedule against a
 * deterministic SQL gate. The workers generate and review; they never decide.
 *
 * Deploy:
 *   supabase functions deploy personews-task-bridge \
 *     --project-ref kukyotcgbnchsoeriqoz --no-verify-jwt
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { handleBridgeRequest, type BridgeDeps, type SubmitOutcome } from "./core.ts";

const STAGING_REF = "kukyotcgbnchsoeriqoz";

/** A bridge that woke up in the wrong project must fail, not improvise. */
function assertStagingProject() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url.includes(STAGING_REF)) throw new Error(`personews-task-bridge must run in ${STAGING_REF}`);
}

/** PostgREST / Postgres "this function does not exist" — the migration has not landed yet. */
function isMissingFunction(error: any) {
  return error?.code === "PGRST202" || error?.code === "42883";
}

function makeDeps(supabase: any): BridgeDeps {
  return {
    async prepareManifest(date) {
      const { data, error } = await supabase.rpc("chatgpt_bridge_prepare_manifest", { p_edition_date: date });
      if (error) throw error;
      return data ?? {};
    },

    async claimJobs(jobIds, workerId, leaseSeconds) {
      const { data, error } = await supabase.rpc("bridge_claim_generation_jobs", {
        p_job_ids: jobIds,
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      });
      // Before 20261005150000 is applied the bridge behaves as v1 did:
      // the whole shard, unleased. Reported as `leasing: "unavailable"`.
      if (error && isMissingFunction(error)) return { supported: false };
      if (error) throw error;
      return {
        supported: true,
        claimed: (data ?? []).map((row: any) => ({ job_id: row.job_id, lease_expires_at: row.lease_expires_at })),
      };
    },

    /**
     * Degrades rather than throws: losing an edition because a contract could
     * not be read would be worse than the failure the contract prevents.
     */
    async questionContract(date) {
      try {
        const { data: contract, error } = await supabase.rpc("scored_question_contract");
        if (error) throw error;
        const { data: gate } = await supabase.rpc("assert_edition_questions_publishable", { p_edition_date: date });
        return { available: true, required: gate?.required ?? null, cutover_edition: gate?.cutover_edition ?? null, contract };
      } catch (error) {
        return { available: false, required: null, cutover_edition: null, contract: null, error: String((error as any)?.message ?? error) };
      }
    },

    async pruneChunks(olderThanIso) {
      await supabase.from("task_bridge_chunks").delete().lt("created_at", olderThanIso);
    },

    async storeChunk(chunk) {
      const { error } = await supabase
        .from("task_bridge_chunks")
        .upsert({ ...chunk, created_at: new Date().toISOString() }, { onConflict: "sid,seq" });
      if (error) throw error;
    },

    async readChunks(sid, kind) {
      const { data, error } = await supabase
        .from("task_bridge_chunks")
        .select("seq,total,payload")
        .eq("sid", sid)
        .eq("kind", kind)
        .order("seq", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },

    async deleteChunks(sid, kind) {
      await supabase.from("task_bridge_chunks").delete().eq("sid", sid).eq("kind", kind);
    },

    async submitOutput(input): Promise<SubmitOutcome> {
      const args = {
        p_job_id: input.jobId,
        p_worker_id: input.workerId,
        p_output_json: input.outputJson,
        p_source_records: input.sourceRecords,
        p_prompt_version: input.promptVersion,
        p_edition_date: input.date,
      };
      const { data, error } = await supabase.rpc("bridge_submit_output_once", args);
      if (!error) return data as SubmitOutcome;
      if (!isMissingFunction(error)) throw error;

      // Fallback until the idempotency migration is applied: v1 behaviour.
      const legacy = await supabase.rpc("chatgpt_bridge_submit_output", args);
      if (legacy.error) throw legacy.error;
      return { status: "submitted_without_ledger", output_id: legacy.data };
    },

    async submitReview(input) {
      const { data, error } = await supabase.rpc("chatgpt_bridge_submit_review", {
        p_job_id: input.jobId,
        p_reviewer_id: input.reviewerId,
        p_verdict: input.verdict,
        p_score: input.score,
        p_checks: input.checks,
        p_feedback: input.feedback,
      });
      if (error) throw error;
      return data ?? null;
    },

    async readyBatch(date) {
      const { data } = await supabase.rpc("get_ready_batch_payload", { p_edition_date: date });
      return data ?? null;
    },

    async editionKind(date) {
      const { data, error } = await supabase.rpc("resolve_staging_edition_kind", { p_date: date });
      if (error) throw error;
      return data ?? null;
    },

    async reviewQueue(kind, date) {
      const { data, error } = await supabase.rpc("get_generation_review_queue_v4", {
        p_limit: 100,
        p_edition_kind: kind,
        p_edition_date: date,
      });
      if (error) throw error;
      return data ?? [];
    },

    async batchStatus(date, kind) {
      const { data: batch, error: batchError } = await supabase
        .from("automation_batches")
        .select("id,status,expected_jobs,completed_jobs,approved_jobs,updated_at")
        .eq("edition_date", date)
        .eq("edition_kind", kind)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (batchError) throw batchError;

      const jobCounts: Record<string, number> = {};
      if (batch?.id) {
        const { data: jobs, error } = await supabase.from("generation_jobs").select("status").eq("batch_id", batch.id);
        if (error) throw error;
        for (const row of jobs ?? []) jobCounts[row.status] = (jobCounts[row.status] ?? 0) + 1;
      }

      const { data: receipt } = batch?.id
        ? await supabase.from("publication_receipts").select("id,production_run_id,published_at").eq("batch_id", batch.id).maybeSingle()
        : { data: null };

      return { batch, job_counts: jobCounts, publication_receipt: receipt ?? null };
    },

    log(event) {
      console.log(JSON.stringify(event));
    },
  };
}

Deno.serve(async (req: Request) => {
  try {
    assertStagingProject();
  } catch (error) {
    return new Response(JSON.stringify({ error: String((error as any)?.message ?? error) }), { status: 500 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const response = await handleBridgeRequest(
    {
      method: req.method,
      url: req.url,
      headers,
      bodyText: req.method === "POST" ? await req.text() : null,
    },
    makeDeps(supabase),
    { expectedTokenHash: Deno.env.get("TASK_BRIDGE_TOKEN_SHA256") ?? "" },
  );

  return new Response(JSON.stringify(response.body), { status: response.status, headers: response.headers });
});
