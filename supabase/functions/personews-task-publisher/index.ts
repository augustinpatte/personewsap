/**
 * personews-task-publisher — PRODUCTION project (wkbviidrbmehmjbhvpeh).
 *
 * The production door. Nothing outside this project holds a production
 * service-role key; the staging scheduler reaches production only through this
 * function, authenticated with a shared token whose SHA-256 hash lives in a
 * Supabase secret.
 *
 * It orchestrates and nothing else. `publish` forwards a payload to
 * `public.publish_scheduled_staging_payload`, which does the whole edition in one
 * transaction — hard gate, content items, sources, editorial memory, daily drops.
 * `verify` forwards to `public.verify_scheduled_edition`, which reads the result
 * back. Neither branch inspects, edits, repairs or interprets editorial content.
 *
 * This file was previously deployed only from a local machine and existed
 * nowhere in the repository. It is written down here so the function that
 * publishes PersoNews is reviewable like the rest of the codebase.
 *
 * Deploy:
 *   supabase functions deploy personews-task-publisher \
 *     --project-ref wkbviidrbmehmjbhvpeh --no-verify-jwt
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRODUCTION_REF = "wkbviidrbmehmjbhvpeh";

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

/** A publisher that woke up in the wrong project must fail, not improvise. */
function assertProductionProject(): void {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`personews-task-publisher must run in ${PRODUCTION_REF}, not ${url}`);
  }
}

Deno.serve(async (req: Request) => {
  try {
    assertProductionProject();

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "invalid_body" }, 400);

    const expectedHash = Deno.env.get("PERSONEWS_PUBLISH_TOKEN_SHA256") ?? "";
    if (!expectedHash) return json({ error: "publish_token_not_configured" }, 500);

    const token = typeof body.token === "string" ? body.token : "";
    if (!token || (await sha256Hex(token)) !== expectedHash) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Absent action means publish: the pre-existing callers send only
    // { token, payload, run_id } and must keep working unchanged.
    const action = typeof body.action === "string" ? body.action : "publish";
    const runId = typeof body.run_id === "string" ? body.run_id : "";

    if (action === "publish") {
      const payload = body.payload as Record<string, unknown> | undefined;
      if (!payload || payload.ready !== true || !runId) return json({ error: "invalid_payload" }, 400);

      const { data, error } = await supabase.rpc("publish_scheduled_staging_payload", {
        p_payload: payload,
        p_run_id: runId,
      });
      if (error) throw error;
      return json(data);
    }

    if (action === "verify") {
      const editionDate = typeof body.edition_date === "string" ? body.edition_date : "";
      const batchId = typeof body.batch_id === "string" ? body.batch_id : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(editionDate) || !/^[0-9a-f-]{36}$/i.test(batchId)) {
        return json({ error: "invalid_verification_request" }, 400);
      }

      const { data, error } = await supabase.rpc("verify_scheduled_edition", {
        p_edition_date: editionDate,
        p_batch_id: batchId,
        p_run_id: runId || null,
      });
      if (error) throw error;
      return json(data);
    }

    return json({ error: "unknown_action" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
