/**
 * personews-push-notifications — PRODUCTION project (wkbviidrbmehmjbhvpeh).
 *
 * The primary push worker. pg_cron calls `public.invoke_push_worker()` every
 * minute; when something is due (an evening notification at 20:00 reader-local,
 * a morning reminder at 08:30 reader-local, a retry at +15/+30 minutes) it POSTs
 * here with a shared token. This function claims exactly what is due through
 * SQL, sends it to Expo, and records each outcome through SQL. Every rule —
 * who, when, how many attempts, never twice — lives in the database; the loop
 * lives in `core.ts`.
 *
 * The GitHub workflow `push-notification-retry.yml` remains as a fallback on the
 * same SQL claims. Leases make the two safe to run at the same time.
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
  type ClaimedPush,
  type Outcome,
  type RecordResult
} from "./core.ts";

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
      record: async (row: ClaimedPush, outcome: Outcome): Promise<RecordResult> => {
        const { data, error } = await supabase.rpc("record_push_delivery_attempt", {
          p_delivery_id: row.deliveryId,
          p_claim_id: claimId,
          p_outcome: outcome.kind,
          p_expo_ticket_id: outcome.kind === "ticket_accepted" ? outcome.ticketId : null,
          p_error: outcome.kind === "ticket_accepted" ? null : outcome.error
        });

        if (error) {
          throw new Error(`record_push_delivery_attempt failed: ${error.message}`);
        }

        const recorded = ((data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
        return {
          status: String(recorded.recorded_status ?? "unknown"),
          nextAttemptAt:
            typeof recorded.recorded_next_attempt_at === "string"
              ? recorded.recorded_next_attempt_at
              : null
        };
      },
      now: () => new Date(),
      log: (line) => console.log(JSON.stringify(line))
    });

    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "push_worker_failed", error: message.slice(0, 300) }));
    return json({ error: message.slice(0, 300) }, 500);
  }
});
