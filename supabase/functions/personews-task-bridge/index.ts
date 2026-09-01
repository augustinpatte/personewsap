/**
 * personews-task-bridge — STAGING project (kukyotcgbnchsoeriqoz).
 *
 * The door the ChatGPT Scheduled Tasks knock on: claim jobs, upload chunked
 * outputs and reviews, read the review queue, read batch status.
 *
 * It does NOT publish, and that is the point of this version. Until now,
 * `action=commit` with reviews would notice the batch had become ready and push
 * the edition to production on the spot — which put the final go/no-go inside
 * whichever agent happened to submit the last review. Publication is now the
 * sole business of `personews-scheduled-publisher`, which runs on a fixed
 * schedule against a deterministic SQL gate. The workers generate and review;
 * they no longer decide.
 *
 * The production publish token that used to be hardcoded in this file is gone
 * along with the code that used it.
 *
 * Deploy:
 *   supabase functions deploy personews-task-bridge \
 *     --project-ref kukyotcgbnchsoeriqoz --no-verify-jwt
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const STAGING_REF = "kukyotcgbnchsoeriqoz";

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A bridge that woke up in the wrong project must fail, not improvise. */
function assertStagingProject() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url.includes(STAGING_REF)) throw new Error(`personews-task-bridge must run in ${STAGING_REF}, not ${url}`);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function todayChicago() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    assertStagingProject();
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const url = new URL(req.url);
    const expectedTokenHash = Deno.env.get("TASK_BRIDGE_TOKEN_SHA256") ?? "";
    if (!expectedTokenHash) return json({ error: "bridge_token_not_configured" }, 500);
    const token = url.searchParams.get("token") ?? "";
    if (!token || (await sha256Hex(token)) !== expectedTokenHash) return json({ error: "unauthorized" }, 401);

    const action = url.searchParams.get("action") ?? "ping";
    const date = url.searchParams.get("date") ?? todayChicago();
    if (!validDate(date)) return json({ error: "invalid_date" }, 400);

    if (action === "ping") return json({ ok: true, date, bridge: "personews-task-bridge-v1" });

    if (action === "jobs") {
      const worker = url.searchParams.get("worker") ?? "";
      const shardMap: Record<string, number> = { a: 0, b: 1, c: 2 };
      const shard = shardMap[worker.toLowerCase()];
      if (shard === undefined) return json({ error: "invalid_worker" }, 400);
      const { data: manifest, error } = await supabase.rpc("chatgpt_bridge_prepare_manifest", { p_edition_date: date });
      if (error) throw error;
      const fullJobs = Array.isArray(manifest?.jobs) ? manifest.jobs : [];
      const jobs = fullJobs.filter((ctx: any, index: number) => index % 3 === shard && ["queued", "revision_required"].includes(ctx?.job?.status));
      return json({
        bridge_version: "v1",
        edition_date: manifest?.edition_date ?? date,
        edition_kind: manifest?.edition_kind ?? null,
        batch_id: manifest?.batch_id ?? null,
        batch_metadata: manifest?.batch_metadata ?? null,
        prompt_bundle_version: manifest?.prompt_bundle_version ?? null,
        canonical_output_contract: manifest?.canonical_output_contract ?? null,
        source_record_contract: manifest?.source_record_contract ?? null,
        common_runtime_contract: manifest?.common_runtime_contract ?? null,
        review_policy: manifest?.review_policy ?? null,
        editorial_memory: manifest?.editorial_memory ?? null,
        worker,
        jobs,
      });
    }

    if (action === "chunk") {
      const sid = url.searchParams.get("sid") ?? "";
      const kind = url.searchParams.get("kind") ?? "";
      const seq = Number(url.searchParams.get("seq"));
      const total = Number(url.searchParams.get("total"));
      const data = url.searchParams.get("data") ?? "";
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(sid) || !["outputs", "reviews"].includes(kind) || !Number.isInteger(seq) || !Number.isInteger(total) || seq < 0 || total < 1 || total > 100 || seq >= total || !/^[A-Za-z0-9_-]+$/.test(data) || data.length > 6500) {
        return json({ error: "invalid_chunk" }, 400);
      }
      await supabase.from("task_bridge_chunks").delete().lt("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());
      const { error } = await supabase.from("task_bridge_chunks").upsert({ sid, seq, total, kind, payload: data, created_at: new Date().toISOString() }, { onConflict: "sid,seq" });
      if (error) throw error;
      return json({ ok: true, sid, seq, total, kind });
    }

    if (action === "commit") {
      const sid = url.searchParams.get("sid") ?? "";
      const kind = url.searchParams.get("kind") ?? "";
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(sid) || !["outputs", "reviews"].includes(kind)) return json({ error: "invalid_commit" }, 400);
      const { data: chunks, error: chunkError } = await supabase.from("task_bridge_chunks").select("seq,total,payload").eq("sid", sid).eq("kind", kind).order("seq", { ascending: true });
      if (chunkError) throw chunkError;
      if (!chunks?.length) return json({ error: "chunks_not_found" }, 404);
      const expectedTotal = chunks[0].total;
      if (chunks.length !== expectedTotal || chunks.some((c: any, i: number) => c.total !== expectedTotal || c.seq !== i)) return json({ error: "chunks_incomplete", received: chunks.length, expected: expectedTotal }, 409);
      const encoded = chunks.map((c: any) => c.payload).join("");
      let payload: any;
      try { payload = JSON.parse(decodeBase64Url(encoded)); } catch { return json({ error: "payload_decode_failed" }, 400); }
      if (payload?.edition_date !== date) return json({ error: "edition_date_mismatch" }, 400);

      const results: any[] = [];
      if (kind === "outputs") {
        const workerId = String(payload?.worker_id ?? "");
        if (!/^personews-generator-[abc]$/.test(workerId) || !Array.isArray(payload?.outputs)) return json({ error: "invalid_outputs_payload" }, 400);
        for (const item of payload.outputs) {
          try {
            const { data, error } = await supabase.rpc("chatgpt_bridge_submit_output", {
              p_job_id: item.job_id,
              p_worker_id: workerId,
              p_output_json: item.output_json,
              p_source_records: item.source_records,
              p_prompt_version: item.prompt_version,
              p_edition_date: date,
            });
            if (error) throw error;
            results.push({ job_id: item.job_id, ok: true, output_id: data });
          } catch (error) {
            results.push({ job_id: item?.job_id ?? null, ok: false, error: String(error?.message ?? error) });
          }
        }
      } else {
        const reviewerId = String(payload?.reviewer_id ?? "personews-reviewer");
        if (reviewerId !== "personews-reviewer" || !Array.isArray(payload?.reviews)) return json({ error: "invalid_reviews_payload" }, 400);
        for (const item of payload.reviews) {
          try {
            const { data, error } = await supabase.rpc("chatgpt_bridge_submit_review", {
              p_job_id: item.job_id,
              p_reviewer_id: reviewerId,
              p_verdict: item.verdict,
              p_score: item.score,
              p_checks: item.checks,
              p_feedback: item.feedback ?? null,
            });
            if (error) throw error;
            results.push({ job_id: item.job_id, ok: true, review_id: data, verdict: item.verdict });
          } catch (error) {
            results.push({ job_id: item?.job_id ?? null, ok: false, error: String(error?.message ?? error) });
          }
        }
      }
      await supabase.from("task_bridge_chunks").delete().eq("sid", sid).eq("kind", kind);

      // Publication deliberately does not happen here. When the last review
      // lands the batch simply becomes ready; `personews-scheduled-publisher`
      // decides at 19:00 Europe/Paris, against the SQL hard gate, whether that
      // readiness is real. Reported back so a worker can see that its work
      // landed, without ever being able to act on it.
      let publication: any = { published: false, reason: "publication_is_scheduled_and_deterministic" };
      if (kind === "reviews") {
        const { data: ready } = await supabase.rpc("get_ready_batch_payload", { p_edition_date: date });
        publication = {
          published: false,
          reason: "publication_is_scheduled_and_deterministic",
          publisher: "personews-scheduled-publisher",
          scheduled_for: "19:00 Europe/Paris",
          batch_ready: ready?.ready === true,
          batch_reason: ready?.reason ?? null,
        };
      }
      return json({ ok: results.every((r) => r.ok), kind, results, publication });
    }

    if (action === "review_index") {
      const { data: kind, error: kindError } = await supabase.rpc("resolve_staging_edition_kind", { p_date: date });
      if (kindError) throw kindError;
      if (!kind) return json({ edition_date: date, edition_kind: null, jobs: [] });
      const { data: queue, error } = await supabase.rpc("get_generation_review_queue_v4", { p_limit: 100, p_edition_kind: kind, p_edition_date: date });
      if (error) throw error;
      const jobs = (queue ?? []).map((ctx: any) => ({
        job_id: ctx?.job?.id,
        content_type: ctx?.job?.content_type,
        topic: ctx?.job?.topic,
        mini_case_topic: ctx?.job?.mini_case_topic,
        ordinal: ctx?.job?.ordinal,
        output_id: ctx?.output?.id,
        deterministic_preflight: ctx?.deterministic_preflight,
      }));
      return json({ edition_date: date, edition_kind: kind, count: jobs.length, jobs });
    }

    if (action === "review_item") {
      const jobId = url.searchParams.get("job_id") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "invalid_job_id" }, 400);
      const { data: kind, error: kindError } = await supabase.rpc("resolve_staging_edition_kind", { p_date: date });
      if (kindError) throw kindError;
      const { data: queue, error } = await supabase.rpc("get_generation_review_queue_v4", { p_limit: 100, p_edition_kind: kind, p_edition_date: date });
      if (error) throw error;
      const item = (queue ?? []).find((ctx: any) => ctx?.job?.id === jobId);
      if (!item) return json({ error: "review_item_not_found" }, 404);
      return json(item);
    }

    if (action === "status") {
      const { data: kind, error: kindError } = await supabase.rpc("resolve_staging_edition_kind", { p_date: date });
      if (kindError) throw kindError;
      const { data: batch, error: batchError } = await supabase.from("automation_batches").select("id,status,expected_jobs,completed_jobs,approved_jobs,updated_at").eq("edition_date", date).eq("edition_kind", kind).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (batchError) throw batchError;
      let jobCounts: Record<string, number> = {};
      if (batch?.id) {
        const { data: jobs, error } = await supabase.from("generation_jobs").select("status").eq("batch_id", batch.id);
        if (error) throw error;
        for (const row of jobs ?? []) jobCounts[row.status] = (jobCounts[row.status] ?? 0) + 1;
      }
      const { data: receipt } = batch?.id ? await supabase.from("publication_receipts").select("id,production_run_id,published_at").eq("batch_id", batch.id).maybeSingle() : { data: null };
      return json({ edition_date: date, edition_kind: kind, batch, job_counts: jobCounts, publication_receipt: receipt ?? null });
    }

    return json({ error: "unknown_action" }, 404);
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
});
