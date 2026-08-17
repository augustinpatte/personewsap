import { getAuthSession, normalizeSupabaseError, supabase } from "../../lib/supabase";
import {
  mergeMiniCaseResponses,
  toResponseRecord,
  toResponseRow
} from "./miniCaseMapping";
import type { MiniCaseResponseMap, MiniCaseResponseRecord } from "./miniCaseResponses";

/**
 * Cross-device mini-case results.
 *
 * On-device storage stays the offline cache and keeps the app usable with no
 * network; Supabase (public.mini_case_responses) is the source of truth as soon
 * as it answers. Reconciliation is last-write-never-wins per case: a result is
 * written once and never overwritten, so a case solved on one phone reads
 * identically on another.
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
}

/**
 * Upsert one result. Idempotent through the
 * (user_id, content_item_id) unique index, so replaying it — a retry, a second
 * device, a reopened case — never creates a duplicate row.
 */
export async function pushMiniCaseResponse(
  userId: string,
  contentItemId: string,
  record: MiniCaseResponseRecord
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

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
}

/**
 * The stored result for one case, device first then server.
 *
 * A case finished on another phone is already marked complete here (completion
 * lives in content_interactions), so review mode opens — but the answers it
 * replays only exist server-side until this fills them in. The fetched result
 * is cached on the device so the next open is instant and works offline.
 */
export async function readMiniCaseResponseAnywhere(
  contentItemId: string,
  local: MiniCaseResponseRecord | null
): Promise<MiniCaseResponseRecord | null> {
  if (local) {
    return local;
  }

  const sessionResult = await getAuthSession();
  const userId = sessionResult.data?.user.id;

  if (!userId || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("mini_case_responses")
    .select(MINI_CASE_RESPONSE_SELECT)
    .eq("user_id", userId)
    .eq("content_item_id", contentItemId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return toResponseRecord(data);
}

/**
 * Reconcile this device with the server: pull stored results, push the ones
 * that only ever existed locally (results recorded before this sync existed,
 * or while offline), and return the merged view.
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

  for (const contentItemId of localOnly) {
    const record = local[contentItemId];

    if (record && (await pushMiniCaseResponse(userId, contentItemId, record))) {
      pushed.push(contentItemId);
    }
  }

  return { merged, pushed, offline: false };
}
