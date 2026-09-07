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

      // THE VERIFICATION SUCCESS BOUNDARY.
      //
      // Publishing the edition wrote a notification_outbox event in the
      // publishing transaction, deliberately in a state nothing will act on.
      // This is the moment the product means by "the edition succeeded":
      // production has been written, and then read back and found complete. Only
      // now may readers be told.
      //
      // Best-effort on purpose. A failure to release is a notification that
      // arrives on the fallback schedule instead of within minutes; it is not a
      // reason to report an edition unverified when it verified, and the
      // publication path must never acquire a dependency on the notification
      // path. The result is reported so the release is observable either way.
      const verification = (data ?? {}) as Record<string, unknown>;
      let notificationRelease: unknown = { released: 0, status: "not_attempted" };

      if (verification.ok === true) {
        // The try/catch is the load-bearing part, not belt and braces. Everything
        // below it — a missing RPC while the database migration has not landed
        // yet, a transport fault, a client library that decides to throw where it
        // used to return — has to end as a reported release failure and never as
        // a throw, because a throw here reaches the outer catch and answers the
        // staging scheduler HTTP 500 for an edition that verified.
        try {
          const { data: released, error: releaseError } = await supabase.rpc(
            "release_verified_edition_notifications",
            { p_edition_date: editionDate },
          );
          notificationRelease = releaseError
            ? { released: 0, status: "release_failed", error: releaseError.message }
            : released;
        } catch (releaseThrow) {
          notificationRelease = {
            released: 0,
            status: "release_failed",
            error: releaseThrow instanceof Error ? releaseThrow.message : String(releaseThrow),
          };
        }
      }

      return json({ ...verification, notification_release: notificationRelease });
    }

    return json({ error: "unknown_action" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
