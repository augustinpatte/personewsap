/**
 * personews-scheduled-publisher — STAGING project (kukyotcgbnchsoeriqoz).
 *
 * The only thing in the system allowed to publish a PersoNews edition.
 *
 * It is deliberately thin. Every rule lives in SQL — `assert_edition_publishable`
 * and `get_scheduled_edition_publish_plan` in staging, `verify_scheduled_edition`
 * and `publish_scheduled_staging_payload` in production — and every decision
 * lives in `core.ts`. This file only knows how to authenticate a caller, reach
 * two projects, and hand the pieces to the orchestrator. There is no editorial
 * logic here, no generation, no review, no model call, and no way to add one:
 * the payload it forwards is the exact jsonb the canonical staging helper built.
 *
 * Cross-project hop: staging never holds a production service-role key. It POSTs
 * to production's own `personews-task-publisher` Edge Function with a shared
 * token; that function, inside the production project, is the only thing that
 * uses production's service role.
 *
 * Deploy:
 *   supabase functions deploy personews-scheduled-publisher \
 *     --project-ref kukyotcgbnchsoeriqoz --no-verify-jwt
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  editorialDate,
  isEditorialDate,
  PUBLISHER_VERSION,
  runScheduledPublication,
  type ProductionPublishResult,
  type ProductionVerification,
  type PublishPlan,
  type RunRecord,
} from "./core.ts";

const STAGING_REF = "kukyotcgbnchsoeriqoz";
const PRODUCTION_REF = "wkbviidrbmehmjbhvpeh";
const PRODUCTION_PUBLISH_URL = `https://${PRODUCTION_REF}.supabase.co/functions/v1/personews-task-publisher`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Refuse to run anywhere but staging.
 *
 * The staging and production function folders live in one repository and one CLI
 * invocation away from each other. A publisher that woke up inside the
 * production project would be reading tables that do not exist there and, worse,
 * would look like it was working.
 */
function assertStagingProject(): void {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error(`personews-scheduled-publisher must run in ${STAGING_REF}, not ${url}`);
  }
}

Deno.serve(async (req: Request) => {
  try {
    assertStagingProject();

    const url = new URL(req.url);
    const body = req.method === "POST"
      ? await req.json().catch(() => ({} as Record<string, unknown>))
      : {};
    const param = (name: string): string =>
      String((body as Record<string, unknown>)[name] ?? url.searchParams.get(name) ?? "");

    const expectedHash = Deno.env.get("SCHEDULED_PUBLISHER_TOKEN_SHA256") ?? "";
    if (!expectedHash) return json({ error: "publisher_token_not_configured" }, 500);

    const token = param("token");
    if (!token || (await sha256Hex(token)) !== expectedHash) {
      return json({ error: "unauthorized" }, 401);
    }

    const requestedDate = param("date");
    const editionDate = requestedDate || editorialDate();
    if (!isEditorialDate(editionDate)) return json({ error: "invalid_date" }, 400);

    const action = param("action") || "run";
    const triggerSource = param("trigger") || "cron";

    const staging = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const readPlan = async (date: string): Promise<PublishPlan> => {
      const { data, error } = await staging.rpc("get_scheduled_edition_publish_plan", {
        p_edition_date: date,
      });
      if (error) throw new Error(`staging_plan_failed: ${error.message}`);
      return data as PublishPlan;
    };

    // A read-only look at tonight's verdict. Writes nothing, publishes nothing,
    // records nothing — safe to call from a terminal at any hour.
    if (action === "check") {
      const plan = await readPlan(editionDate);
      return json({
        action: "check",
        edition_date: editionDate,
        publisher_version: PUBLISHER_VERSION,
        gate: plan.gate,
        would_publish: plan.gate?.ok === true && plan.ready_payload !== null,
      });
    }

    if (action !== "run") return json({ error: "unknown_action" }, 404);

    const productionToken = Deno.env.get("PERSONEWS_PRODUCTION_PUBLISH_TOKEN") ?? "";
    if (!productionToken) return json({ error: "production_token_not_configured" }, 500);

    const callProduction = async (payload: Record<string, unknown>): Promise<unknown> => {
      const response = await fetch(PRODUCTION_PUBLISH_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: productionToken, ...payload }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `production_http_${response.status}: ${JSON.stringify(result ?? {}).slice(0, 500)}`,
        );
      }
      return result;
    };

    const outcome = await runScheduledPublication({
      editionDate,
      triggerSource,
      deps: {
        plan: readPlan,

        runId: (date, batchId) =>
          `personews-scheduled-publish:${PUBLISHER_VERSION}:${date}:${batchId}`,

        beginRun: async (runId, date, trigger) => {
          const { data, error } = await staging.rpc("begin_scheduled_publication_run", {
            p_run_id: runId,
            p_edition_date: date,
            p_trigger_source: trigger,
            p_publisher_version: PUBLISHER_VERSION,
          });
          if (error) throw new Error(`audit_open_failed: ${error.message}`);
          return Number(data);
        },

        publish: async (payload, runId) =>
          (await callProduction({
            action: "publish",
            payload,
            run_id: runId,
          })) as ProductionPublishResult,

        verify: async (date, batchId, runId) =>
          (await callProduction({
            action: "verify",
            edition_date: date,
            batch_id: batchId,
            run_id: runId,
          })) as ProductionVerification,

        markPublished: async (batchId, runId, productionResult) => {
          const { data, error } = await staging.rpc("mark_batch_published", {
            p_batch_id: batchId,
            p_production_project_ref: PRODUCTION_REF,
            p_production_run_id: runId,
            p_production_result: productionResult,
          });
          if (error) throw new Error(error.message);
          return String(data);
        },

        finishRun: async (runRowId: number, record: RunRecord) => {
          const { error } = await staging.rpc("finish_scheduled_publication_run", {
            p_id: runRowId,
            p_gate: record.gate,
            p_gate_passed: record.gatePassed,
            p_publication_attempted: record.publicationAttempted,
            p_publication_succeeded: record.publicationSucceeded,
            p_production_verified: record.productionVerified,
            p_receipt_recorded: record.receiptRecorded,
            p_already_published: record.alreadyPublished,
            p_reason: record.reason,
            p_production_result: record.productionResult,
            p_verification_result: record.verification,
            p_error: record.error,
          });
          if (error) throw new Error(`audit_close_failed: ${error.message}`);
        },
      },
    });

    // 200 for every editorial outcome, including "nothing was ready". A refusal
    // is the system working; only infrastructure faults are HTTP errors.
    return json({ publisher_version: PUBLISHER_VERSION, ...outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
