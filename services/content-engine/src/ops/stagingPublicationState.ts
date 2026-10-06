import type { ContentEngineSupabaseClient } from "../storage/supabaseClient.js";
import { createStagingSupabaseClient, STAGING_KEY_ENV, STAGING_URL_ENV } from "../staging/stagingClient.js";
import type { StagingPublicationSnapshot } from "./editionPublicationHealth.js";

/**
 * What staging knows about one edition date: was it verified and receipted?
 *
 * Read through `scheduled_edition_publication_health(date)` (staging
 * 20261005140000) — the same function operators and publisher-status use — so
 * the rule lives in one place. Before that migration is applied, the same three
 * facts are read from the tables it reads (publication_receipts,
 * scheduled_publication_runs).
 *
 * Always for the exact date asked: never "the latest receipt".
 *
 * Never throws and never logs a key: an unreadable staging is reported as such,
 * with the database's message only.
 */
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "PGRST203", "42883"]);

export function stagingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[STAGING_URL_ENV] && env[STAGING_KEY_ENV]);
}

export async function readStagingPublication(
  editionDate: string,
  client?: ContentEngineSupabaseClient | null
): Promise<StagingPublicationSnapshot> {
  if (!client && !stagingConfigured()) {
    return { available: false, reason: "not_configured" };
  }

  try {
    const staging = client ?? createStagingSupabaseClient();
    const { data, error } = await staging.rpc("scheduled_edition_publication_health", {
      p_edition_date: editionDate
    });

    if (!error && data && typeof data === "object") {
      const health = data as {
        status?: string;
        receipt?: unknown;
        last_attempt?: { reason?: string | null } | null;
        stale_open_runs?: unknown[];
      };

      return {
        available: true,
        status: String(health.status ?? "unknown"),
        receipted: health.receipt !== null && health.receipt !== undefined,
        lastAttemptReason: health.last_attempt?.reason ?? null,
        staleOpenRuns: Array.isArray(health.stale_open_runs) ? health.stale_open_runs.length : 0,
        source: "rpc"
      };
    }

    if (error && !MISSING_FUNCTION_CODES.has(error.code ?? "")) {
      return { available: false, reason: "unreadable", error: error.message.slice(0, 200) };
    }

    return await readFromTables(staging, editionDate);
  } catch (error) {
    return {
      available: false,
      reason: "unreadable",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 200)
    };
  }
}

async function readFromTables(
  staging: ContentEngineSupabaseClient,
  editionDate: string
): Promise<StagingPublicationSnapshot> {
  const { data: batches, error: batchError } = await staging
    .from("automation_batches")
    .select("id")
    .eq("edition_date", editionDate);

  if (batchError) {
    return { available: false, reason: "unreadable", error: batchError.message.slice(0, 200) };
  }

  const batchIds = (batches ?? []).map((batch: { id: string }) => batch.id);
  let receipted = false;

  if (batchIds.length > 0) {
    const { data: receipts, error: receiptError } = await staging
      .from("publication_receipts")
      .select("batch_id")
      .in("batch_id", batchIds)
      .limit(1);

    if (receiptError) {
      return { available: false, reason: "unreadable", error: receiptError.message.slice(0, 200) };
    }

    receipted = (receipts ?? []).length > 0;
  }

  const { data: runs, error: runError } = await staging
    .from("scheduled_publication_runs")
    .select("reason,finished_at,started_at")
    .eq("edition_date", editionDate)
    .order("started_at", { ascending: false })
    .limit(20);

  if (runError) {
    return { available: false, reason: "unreadable", error: runError.message.slice(0, 200) };
  }

  const rows = (runs ?? []) as Array<{ reason: string | null; finished_at: string | null; started_at: string }>;
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

  return {
    available: true,
    status: receipted ? "published" : "unknown",
    receipted,
    lastAttemptReason: rows[0]?.reason ?? null,
    staleOpenRuns: rows.filter((run) => !run.finished_at && Date.parse(run.started_at) < tenMinutesAgo).length,
    source: "tables"
  };
}
