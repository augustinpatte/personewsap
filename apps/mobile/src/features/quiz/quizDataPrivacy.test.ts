import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O. What the client is allowed to know before it answers.
 *
 * `start_question_attempt` returns score, grade and choice columns, and they
 * are NULL on an open attempt by construction. This pins the client side of
 * that promise: even if a row ever carried them for an unanswered question, the
 * app would not read them — no answer key, no score, no grade before the
 * answer is in.
 */

let nextRow: Record<string, unknown> = {};
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { maybeSingle: () => Promise.resolve({ data: nextRow, error: null }) };
    }
  },
  normalizeSupabaseError: (error: { code?: string; message?: string } | null) => ({
    code: error?.code ?? "unknown",
    message: error?.message ?? "error"
  })
}));

import { startQuestionAttempt } from "./quizData";

const openRow = {
  attempt_id: "attempt-1",
  server_now: "2026-09-14T17:05:00Z",
  started_at: "2026-09-14T17:05:00Z",
  deadline_at: "2026-09-14T17:05:20Z",
  time_limit_seconds: 20,
  already_submitted: false,
  prompt: "What does it imply?",
  options: [
    { option_id: "o1", label: "A", score_milli: 1000, is_correct: true },
    { option_id: "o2", label: "B", score_milli: 0 },
    { option_id: "o3", label: "C" },
    { option_id: "o4", label: "D" }
  ],
  // Columns that must stay unread on an open question.
  score_milli: 1000,
  grade_band: "excellent",
  selected_option_id: "o1"
};

beforeEach(() => {
  rpcCalls.length = 0;
});

describe("before the answer", () => {
  it("reads no score, grade or answer from an open attempt", async () => {
    nextRow = openRow;

    const result = await startQuestionAttempt("lq-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.settled).toBeUndefined();
    // An option is an id and a label. Nothing else crosses into the app.
    for (const option of result.data.options) {
      expect(Object.keys(option).sort()).toEqual(["label", "optionId"]);
    }
    expect(JSON.stringify(result.data)).not.toMatch(/score|grade|is_correct|correct_answer|rationale/i);
  });

  it("sends only the logical question id", async () => {
    nextRow = openRow;

    await startQuestionAttempt("lq-1");

    expect(rpcCalls).toEqual([{ name: "start_question_attempt", args: { p_logical_question_id: "lq-1" } }]);
  });
});

describe("after the answer", () => {
  it("restores the result the server holds for a submitted attempt", async () => {
    nextRow = { ...openRow, already_submitted: true, score_milli: 600, grade_band: "good", selected_option_id: "o2" };

    const result = await startQuestionAttempt("lq-1");

    expect(result.ok && result.data.settled).toEqual({
      attemptId: "attempt-1",
      scoreMilli: 600,
      gradeBand: "good",
      expired: false,
      skipped: false,
      selectedOptionId: "o2"
    });
  });
});
