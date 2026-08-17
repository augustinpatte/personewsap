import type { MiniCaseResponseMap, MiniCaseResponseRecord } from "./miniCaseResponses";

/**
 * Pure mapping and reconciliation for mini-case results.
 *
 * Kept free of any Supabase import so the rules that decide what a device and
 * the server each keep can be unit tested directly; the I/O lives in
 * miniCaseSync.ts.
 */

function isRecordShape(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSelections(value: unknown): Record<string, string> {
  if (!isRecordShape(value)) {
    return {};
  }

  const selections: Record<string, string> = {};

  for (const [questionId, optionId] of Object.entries(value)) {
    if (typeof optionId === "string") {
      selections[questionId] = optionId;
    }
  }

  return selections;
}

/**
 * Rebuild a local record from a stored row. `score` is a 0-1 ratio in the
 * database (an existing CHECK constraint), so the raw point count is derived
 * from it and score_max.
 */
export function toResponseRecord(row: {
  score: number | null;
  score_max: number | null;
  selections: unknown;
  completed_at: string | null;
  created_at?: string | null;
}): MiniCaseResponseRecord {
  const total = typeof row.score_max === "number" ? row.score_max : 0;
  const ratio = typeof row.score === "number" ? row.score : 0;

  return {
    selections: parseSelections(row.selections),
    score: total > 0 ? Math.round(ratio * total) : 0,
    total,
    completedAt: row.completed_at ?? row.created_at ?? ""
  };
}

/** The row shape written for a completed case. */
export function toResponseRow(
  userId: string,
  contentItemId: string,
  record: MiniCaseResponseRecord
) {
  return {
    user_id: userId,
    content_item_id: contentItemId,
    // answer_md is NOT NULL and must not be blank: keep it a readable trace of
    // the decisions, which is also what a GDPR data export shows the reader.
    answer_md: formatAnswerMarkdown(record),
    score: record.total > 0 ? record.score / record.total : 0,
    score_max: record.total,
    selections: record.selections,
    completed_at: record.completedAt || new Date().toISOString()
  };
}

export function formatAnswerMarkdown(record: MiniCaseResponseRecord): string {
  const lines = Object.entries(record.selections).map(
    ([questionId, optionId]) => `- ${questionId}: ${optionId}`
  );

  return lines.length > 0
    ? lines.join("\n")
    : `Score ${record.score}/${record.total}`;
}

/**
 * Merge server and local results. A case present on both sides keeps the
 * server copy, so every device converges on the same answer.
 */
export function mergeMiniCaseResponses(
  local: MiniCaseResponseMap,
  remote: MiniCaseResponseMap
): { merged: MiniCaseResponseMap; localOnly: string[] } {
  const merged: MiniCaseResponseMap = { ...local, ...remote };
  const localOnly = Object.keys(local).filter((itemId) => !remote[itemId]);

  return { merged, localOnly };
}

