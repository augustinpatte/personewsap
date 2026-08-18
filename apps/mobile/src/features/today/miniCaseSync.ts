import { isSupabaseContentItemId } from "../../lib/contentItemId";
import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import {
  mergeMiniCaseResponses,
  selectSyncableMiniCaseIds,
  toResponseRecord,
  toResponseRow
} from "./miniCaseMapping";
import type { MiniCaseResponseMap, MiniCaseResponseRecord } from "./miniCaseResponses";

/**
 * Cross-device mini-case results.
 *
 * On-device storage stays the offline cache and keeps the app usable with no
 * network; Supabase (public.mini_case_responses) is the source of truth as soon
 * as it answers. Reconciliation converges on the server: a result present on
 * both sides keeps the server copy, so a case solved on one phone reads
 * identically on another.
 *
 * Only real content items take part. mini_case_responses.content_item_id is a
 * UUID, so a sample/demo case (text id, e.g. "mini-case-2026-04-26-fr-ai-notes")
 * can never have a row there — sending one produced a hard 22P02 on every
 * attempt. Those results stay device-local by design, silently, with no request
 * and no repeated warning.
 *
 * Every read and write is scoped by RLS to the authenticated user, so no query
 * here can reach another reader's results.
 */

const MINI_CASE_RESPONSE_SELECT =
  "content_item_id,answer_md,score,score_max,selections,completed_at,created_at";

export type MiniCaseSyncResult = {
  /** Merged view of server + local, keyed by content item id. */
  merged: MiniCaseResponseMap;
  /** Records that existed only on this device and were pushed up. */
  pushed: string[];
  /** True when the server could not be reached; `merged` is then local-only. */
  offline: boolean;
};

export async function fetchRemoteMiniCaseResponses(
  userId: string
): Promise<{ ok: true; responses: MiniCaseResponseMap } | { ok: false }> {
  if (!supabase) {
    return { ok: false };
  }

  try {
    const { data, error } = await supabase
      .from("mini_case_responses")
      .select(MINI_CASE_RESPONSE_SELECT)
      .eq("user_id", userId);

    if (error) {
      if (__DEV__) {
        console.warn("[MiniCase] could not read stored results", normalizeSupabaseError(error));
      }
      return { ok: false };
    }

    const responses: MiniCaseResponseMap = {};

    for (const row of data ?? []) {
      responses[row.content_item_id] = toResponseRecord(row);
    }

    return { ok: true, responses };
  } catch (error) {
    // A dropped connection is an expected outcome here, not a bug: the caller
    // falls back to the device cache.
    if (__DEV__) {
      console.info("[MiniCase] stored results unavailable", normalizeSupabaseError(error));
    }
    return { ok: false };
  }
}

/**
 * Upsert one result. Idempotent through the
 * (user_id, content_item_id) unique index, so replaying it — a retry, a second
 * device, a reopened case — never creates a duplicate row.
 *
 * A non-UUID id is not an error to report: sample content simply has no server
 * side. It is refused here, before any request, so the caller cannot reach the
 * database with an id Postgres would reject.
 */
export async function pushMiniCaseResponse(
  userId: string,
  contentItemId: string,
  record: MiniCaseResponseRecord
): Promise<boolean> {
  if (!supabase || !isSupabaseContentItemId(contentItemId)) {
    return false;
  }

  try {
    const { error } = await supabase
      .from("mini_case_responses")
      .upsert(toResponseRow(userId, contentItemId, record), {
        onConflict: "user_id,content_item_id",
        ignoreDuplicates: true
      });

    if (error) {
      if (__DEV__) {
        console.warn("[MiniCase] could not store result", normalizeSupabaseError(error));
      }
      return false;
    }

    return true;
  } catch (error) {
    if (__DEV__) {
      console.info("[MiniCase] result kept on this device only", normalizeSupabaseError(error));
    }
    return false;
  }
}

/**
 * The stored result for one case, converging on the server.
 *
 * Supabase is the source of truth for a real case: if the server holds a
 * result, that is the one replayed, even when this device already has a
 * different one (solved here before a reinstall, or on another phone first).
 * The device copy is the offline fallback and is refreshed from what the server
 * returns, so convergence does not depend on the reader visiting the Archive
 * tab — simply reopening the case is enough.
 *
 * A sample/demo case has no server side: its local record is returned as is.
 */
export async function readMiniCaseResponseAnywhere(
  contentItemId: string,
  local: MiniCaseResponseRecord | null
): Promise<MiniCaseResponseRecord | null> {
  if (!isSupabaseContentItemId(contentItemId)) {
    return local;
  }

  const sessionResult = await getAuthSession();
  const userId = sessionResult.data?.user.id;

  if (!userId || !supabase) {
    return local;
  }

  try {
    const { data, error } = await supabase
      .from("mini_case_responses")
      .select(MINI_CASE_RESPONSE_SELECT)
      .eq("user_id", userId)
      .eq("content_item_id", contentItemId)
      .maybeSingle();

    if (error || !data) {
      return local;
    }

    return toResponseRecord(data);
  } catch {
    // Offline: the device copy is exactly what this cache is for.
    return local;
  }
}

/**
 * Reconcile this device with the server: pull stored results, push the ones
 * that only ever existed locally (results recorded before this sync existed,
 * or while offline), and return the merged view.
 *
 * Sample/demo results are excluded from the push set entirely, so opening the
 * archive can never produce a repeated failing write.
 */
export async function syncMiniCaseResponses(
  local: MiniCaseResponseMap
): Promise<MiniCaseSyncResult> {
  const sessionResult = await getAuthSession();
  const userId = sessionResult.data?.user.id;

  if (!userId || !supabase) {
    return { merged: local, pushed: [], offline: true };
  }

  const remote = await fetchRemoteMiniCaseResponses(userId);

  if (!remote.ok) {
    return { merged: local, pushed: [], offline: true };
  }

  const { merged, localOnly } = mergeMiniCaseResponses(local, remote.responses);
  const pushed: string[] = [];

  for (const contentItemId of selectSyncableMiniCaseIds(localOnly)) {
    const record = local[contentItemId];

    if (record && (await pushMiniCaseResponse(userId, contentItemId, record))) {
      pushed.push(contentItemId);
    }
  }

  return { merged, pushed, offline: false };
}
