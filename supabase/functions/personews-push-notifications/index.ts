/**
 * personews-push-notifications — PRODUCTION project (wkbviidrbmehmjbhvpeh).
 *
 * The primary push worker. pg_cron calls `public.invoke_push_worker()` every
 * minute; when something is due (an evening notification at 20:00 reader-local,
 * a morning reminder at 08:30 reader-local, a retry at +15/+30 minutes) it POSTs
 * here with a shared token. This function claims exactly what is due through
 * SQL, sends it to Expo, and records the outcomes through SQL — one call per
 * Expo chunk (record_push_delivery_attempts). Every rule — who, when, how many
 * attempts, never twice — lives in the database; the loop lives in `core.ts`.
 *
 * The GitHub workflow `push-notification-retry.yml` remains as a fallback on the
 * same SQL claims. Leases make the two — or several invocations of this worker —
 * safe to run at the same time: each invocation has its own claim id, rows are
 * leased with SKIP LOCKED, and only the lease holder can record a row.
 *
 * Secrets:
 *   PERSONEWS_PUSH_WORKER_TOKEN   shared with the Vault secret personews_push_worker_token
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime.
 *
 * Deploy:
 *   supabase functions deploy personews-push-notifications \
 *     --project-ref wkbviidrbmehmjbhvpeh --no-verify-jwt
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  createExpoSender,
  mapClaimedRow,
  runPushWorker,
  type AttemptResult,
  type ClaimedPush,
  type RecordResult
} from "./core.ts";

/** PostgREST / Postgres "no such function": the batch migration is not applied yet. */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const expected = Deno.env.get("PERSONEWS_PUSH_WORKER_TOKEN");

  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    return json({ error: "not_configured" }, 500);
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const claimId = `edge-${crypto.randomUUID()}`;
  let batchUnavailable = false;

  try {
    const summary = await runPushWorker({
      claim: async (limit) => {
        const { data, error } = await supabase.rpc("claim_due_push_notifications", {
          p_claim_id: claimId,
          p_limit: limit,
          p_claim_ttl_seconds: 600
        });

        if (error) {
          throw new Error(`claim_due_push_notifications failed: ${error.message}`);
        }

        return ((data ?? []) as Array<Record<string, unknown>>)
          .map(mapClaimedRow)
          .filter((row): row is ClaimedPush => row !== null);
      },
      send: createExpoSender(fetch),
      recordBatch: async (results: AttemptResult[]): Promise<Map<string, RecordResult>> => {
        const recorded = new Map<string, RecordResult>();
        const payload = results.map(({ row, outcome }) => ({
          delivery_id: row.deliveryId,
          outcome: outcome.kind,
          expo_ticket_id: outcome.kind === "ticket_accepted" ? outcome.ticketId : null,
          error: outcome.kind === "ticket_accepted" ? null : outcome.error
        }));

        if (!batchUnavailable) {
          const { data, error } = await supabase.rpc("record_push_delivery_attempts", {
            p_claim_id: claimId,
            p_results: payload
          });

          if (!error) {
            for (const entry of (data ?? []) as Array<Record<string, unknown>>) {
              if (typeof entry.recorded_delivery_id !== "string") continue;
              recorded.set(entry.recorded_delivery_id, {
                status: String(entry.recorded_status ?? "unknown"),
                nextAttemptAt:
                  typeof entry.recorded_next_attempt_at === "string" ? entry.recorded_next_attempt_at : null
              });
            }
            return recorded;
          }

          if (!isMissingFunction(error)) {
            throw new Error(`record_push_delivery_attempts failed: ${error.message}`);
          }

          // Deployed ahead of 20261005170000: record row by row, as before.
          batchUnavailable = true;
          console.warn(JSON.stringify({ event: "push_batch_recording_unavailable", run: claimId }));
        }

        for (const entry of payload) {
          const { data, error } = await supabase.rpc("record_push_delivery_attempt", {
            p_delivery_id: entry.delivery_id,
            p_claim_id: claimId,
            p_outcome: entry.outcome,
            p_expo_ticket_id: entry.expo_ticket_id,
            p_error: entry.error
          });

          if (error) {
            throw new Error(`record_push_delivery_attempt failed: ${error.message}`);
          }

          const row = ((data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
          recorded.set(entry.delivery_id, {
            status: String(row.recorded_status ?? "unknown"),
            nextAttemptAt: typeof row.recorded_next_attempt_at === "string" ? row.recorded_next_attempt_at : null
          });
        }

        return recorded;
      },
      now: () => new Date(),
      log: (line) => console.log(JSON.stringify(line))
    }, { runId: claimId });

    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "push_worker_failed", error: message.slice(0, 300) }));
    return json({ error: message.slice(0, 300) }, 500);
  }
});
