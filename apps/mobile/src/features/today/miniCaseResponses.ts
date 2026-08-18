import AsyncStorage from "@react-native-async-storage/async-storage";

import { isSupabaseContentItemId } from "../../lib/contentItemId";
import { getAuthSession } from "../../lib/supabase";
import { pushMiniCaseResponse } from "./miniCaseSync";

const STORAGE_KEY = "personews:mini-case-responses:v1";

export type MiniCaseResponseRecord = {
  selections: Record<string, string>;
  score: number;
  total: number;
  completedAt: string;
};

export type MiniCaseResponseMap = Record<string, MiniCaseResponseRecord>;

export async function readMiniCaseResponse(
  itemId: string
): Promise<MiniCaseResponseRecord | null> {
  const map = await readAll();
  return map[itemId] ?? null;
}

/** All stored responses in one storage read — used by the archive list. */
export async function readAllMiniCaseResponses(): Promise<MiniCaseResponseMap> {
  return readAll();
}

// Persists the answers once. A saved record is never overwritten, so reopening
// a completed case can only ever review the original decisions.
export async function writeMiniCaseResponse(
  itemId: string,
  record: MiniCaseResponseRecord
): Promise<void> {
  const existing = await readMiniCaseResponse(itemId);

  // Already recorded on this device: nothing to store and nothing to send.
  // The effect that calls this can re-run on re-render, so this guard is what
  // keeps one finished case to exactly one write and one request.
  if (existing) {
    return;
  }

  await writeLocalMiniCaseResponses({ [itemId]: record });

  // Sample/demo content has no server side: mini_case_responses.content_item_id
  // is a UUID, so a text mock id can only ever be rejected. The result stays on
  // the device, and no request is made.
  if (!isSupabaseContentItemId(itemId)) {
    return;
  }

  // The device copy is the offline cache; the server copy is what makes the
  // result follow the reader to another device. A failed push is not an error
  // here: the next sync finds the record local-only and retries it.
  const sessionResult = await getAuthSession();
  const userId = sessionResult.data?.user.id;

  if (userId) {
    await pushMiniCaseResponse(userId, itemId, record);
  }
}

/**
 * Write records into the on-device cache.
 *
 * Two callers, two rules:
 *  - the reader recording a freshly finished case (`origin: "device"`, the
 *    default) never overwrites an existing record, so reopening a completed
 *    case can only ever review the original decisions;
 *  - the server sync (`origin: "server"`) does overwrite, because Supabase is
 *    the source of truth: a stale local result for a case the server already
 *    holds differently must converge, not win.
 */
export async function writeLocalMiniCaseResponses(
  records: MiniCaseResponseMap,
  options: { origin?: "device" | "server" } = {}
): Promise<MiniCaseResponseMap> {
  const map = await readAll();
  const overwrite = options.origin === "server";
  let changed = false;

  for (const [itemId, record] of Object.entries(records)) {
    const existing = map[itemId];

    if (existing && !overwrite) {
      continue;
    }

    if (existing && sameMiniCaseResponse(existing, record)) {
      continue;
    }

    map[itemId] = record;
    changed = true;
  }

  if (!changed) {
    return map;
  }

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Device storage is best-effort; a failed write just means review mode
    // falls back to showing the model answers without the user's own picks.
  }

  return map;
}

async function readAll(): Promise<MiniCaseResponseMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return {};
    }

    const map: MiniCaseResponseMap = {};

    for (const [itemId, value] of Object.entries(parsed)) {
      const record = parseRecord(value);

      if (record) {
        map[itemId] = record;
      }
    }

    return map;
  } catch {
    return {};
  }
}

function parseRecord(value: unknown): MiniCaseResponseRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const { selections, score, total, completedAt } = value;

  if (!isRecord(selections)) {
    return null;
  }

  const normalizedSelections: Record<string, string> = {};

  for (const [questionId, optionId] of Object.entries(selections)) {
    if (typeof optionId === "string") {
      normalizedSelections[questionId] = optionId;
    }
  }

  return {
    selections: normalizedSelections,
    score: typeof score === "number" ? score : 0,
    total: typeof total === "number" ? total : 0,
    completedAt: typeof completedAt === "string" ? completedAt : ""
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameMiniCaseResponse(
  left: MiniCaseResponseRecord,
  right: MiniCaseResponseRecord
): boolean {
  return (
    left.score === right.score &&
    left.total === right.total &&
    left.completedAt === right.completedAt &&
    JSON.stringify(left.selections) === JSON.stringify(right.selections)
  );
}
