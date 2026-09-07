/**
 * personews-task-publisher — PRODUCTION project (wkbviidrbmehmjbhvpeh).
 *
 * The production door. Nothing outside this project holds a production
 * service-role key; the staging scheduler reaches production only through this
 * function, authenticated with a shared token whose SHA-256 hash lives in a
 * Supabase secret.
 *
 * It orchestrates and nothing else. Neither branch inspects, edits, repairs or
 * interprets editorial content.
 *
 * PUBLISHING IS THREE STAGES, NOT ONE.
 *
 *   1. content       publish_scheduled_staging_payload   one transaction:
 *                                                        items, sources,
 *                                                        editorial memory, drops
 *   2. questions      publish_scheduled_batch_questions   the scored questions,
 *                                                        display into public and
 *                                                        grading into private
 *   3. assignments    materialize_edition_assignments     who is asked what:
 *                                                        solo, team content,
 *                                                        team questions, roster
 *
 * The order is forced by the data. Questions need both language items to exist,
 * so they cannot be written inside the publishing transaction — that is why
 * 20260906100000 split them out. Assignments need the questions AND the daily
 * drops, because a solo assignment is derived from the reader's own drop and the
 * edition row is registered by the drop's own publish trigger. Running stage 3
 * before stage 1 committed would assign an edition nobody has.
 *
 * WHY A FAILING STAGE DOES NOT UNDO THE ONE BEFORE IT.
 *
 * Stage 1 has committed by the time stage 2 runs. There is no honest way to take
 * it back, and pretending otherwise would mean deleting a live edition to tidy up
 * a question. So each stage reports its own receipt and a later failure is
 * recorded rather than thrown:
 *
 *   - the response always says what each stage did, and never says "published"
 *     about a stage that did not run;
 *   - verification (which now checks the questions and the assignments too)
 *     fails, so NO receipt is written in staging;
 *   - no receipt means the gate will offer the same batch again, and every stage
 *     is idempotent, so the retry completes the edition instead of duplicating
 *     it.
 *
 * An operator who wants to retry only the tail can send
 * `stages: ["questions", "assignments"]`, which touches no editorial content at
 * all. That exists so that "retry the question pass" never has to be spelled
 * "republish the edition".
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

import {
  combineVerification,
  isEditionDate,
  resolveRequestedStages,
  runPublishStages,
} from "./core.ts";

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

      const batch = (payload.batch ?? {}) as Record<string, unknown>;
      const editionDate = batch.edition_date;

      // The edition date comes from the canonical payload, never from the
      // request: the assignment stage is keyed on it, and a caller-supplied date
      // would let one request publish an edition and materialize another.
      if (!isEditionDate(editionDate)) {
        return json({ error: "invalid_payload_edition_date" }, 400);
      }

      const stages = resolveRequestedStages(body.stages);

      if (!Array.isArray(stages)) {
        return json({ error: "unknown_stage", stage: stages.unknown }, 400);
      }

      const result = await runPublishStages({
        payload,
        runId,
        editionDate,
        stages,
        deps: {
          async publishContent(p, id) {
            const { data, error } = await supabase.rpc("publish_scheduled_staging_payload", {
              p_payload: p,
              p_run_id: id,
            });
            if (error) throw error;
            return (data ?? {}) as Record<string, unknown>;
          },
          async publishQuestions(p, id) {
            const { data, error } = await supabase.rpc("publish_scheduled_batch_questions", {
              p_payload: p,
              p_run_id: id,
            });
            if (error) throw error;
            return data ?? null;
          },
          async materializeAssignments(date) {
            const { data, error } = await supabase.rpc("materialize_edition_assignments", {
              p_edition_date: date,
            });
            if (error) throw error;
            return data ?? null;
          },
        },
      });

      return json(result);
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

      // THE SECOND HALF OF THE READ-BACK.
      //
      // `verify_scheduled_edition` proves the editorial surfaces landed. It says
      // nothing about whether the edition is playable, and an edition whose
      // question pass silently wrote nothing passes it cleanly: 46 items, every
      // count right, and not one reader able to open a challenge.
      //
      // Caught rather than thrown, for the same reason as the publish stages: if
      // this RPC is missing because the migration has not landed yet, the answer
      // must be "the game could not be verified" and not HTTP 500 for an edition
      // that published. It counts as a verification FAILURE, though — an
      // unverifiable game is not a verified one, and no receipt may be written on
      // the strength of it.
      let gameVerification: Record<string, unknown>;

      try {
        const { data: game, error: gameError } = await supabase.rpc(
          "verify_scheduled_edition_game",
          { p_edition_date: editionDate, p_batch_id: batchId, p_run_id: runId || null },
        );

        gameVerification = gameError
          ? { ok: false, reason: "game_verification_unavailable", error: gameError.message }
          : ((game ?? { ok: false, reason: "game_verification_empty" }) as Record<string, unknown>);
      } catch (thrown) {
        gameVerification = {
          ok: false,
          reason: "game_verification_unavailable",
          error: thrown instanceof Error ? thrown.message : String(thrown),
        };
      }

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
      const verification = combineVerification({
        editorial: data as Record<string, unknown> | null,
        game: gameVerification,
      });

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
