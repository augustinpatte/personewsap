import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The post-answer explanation, as the app asks for it.
 *
 * One call, one question id, after settlement. Against a database that
 * predates get_question_explanation, the same two options come from
 * get_question_feedback. A refusal (42501: not settled) is an error to show,
 * never a reason to try the other door.
 */

type Reply = { data: unknown; error: { code?: string; message?: string } | null };

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let replies: Record<string, Reply> = {};

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(replies[name] ?? { data: null, error: { code: "PGRST202", message: "missing" } });
    }
  },
  normalizeSupabaseError: (error: { code?: string; message?: string } | null) => ({
    code: error?.code ?? "unknown",
    message: error?.message ?? "error"
  })
}));

import { fetchQuestionExplanation } from "./quizData";

beforeEach(() => {
  calls.length = 0;
  replies = {};
});

describe("get_question_explanation", () => {
  it("asks with the question id alone, and reads the chosen and the best option", async () => {
    replies.get_question_explanation = {
      data: [
        {
          outcome: "answered",
          explanation_language: "en",
          selected_option_id: "o-c",
          selected_label: "Wait",
          selected_score_milli: 300,
          selected_feedback_md: "Why C is partial.",
          best_option_id: "o-a",
          best_label: "Protect the margin",
          best_score_milli: 1000,
          best_feedback_md: "Why A works."
        }
      ],
      error: null
    };

    const result = await fetchQuestionExplanation("lq-1");

    expect(calls).toEqual([{ name: "get_question_explanation", args: { p_logical_question_id: "lq-1" } }]);
    expect(result).toEqual({
      ok: true,
      data: {
        outcome: "answered",
        selected: { optionId: "o-c", label: "Wait", scoreMilli: 300, feedback: "Why C is partial." },
        best: { optionId: "o-a", label: "Protect the margin", scoreMilli: 1000, feedback: "Why A works." }
      }
    });
  });

  it("reads a timeout as nothing chosen, and still the best option", async () => {
    replies.get_question_explanation = {
      data: [
        {
          outcome: "expired",
          selected_option_id: null,
          selected_label: null,
          selected_score_milli: 0,
          selected_feedback_md: null,
          best_option_id: "o-a",
          best_label: "Protect the margin",
          best_score_milli: 1000,
          best_feedback_md: "Why A works."
        }
      ],
      error: null
    };

    const result = await fetchQuestionExplanation("lq-1");

    expect(result.ok && result.data.outcome).toBe("expired");
    expect(result.ok && result.data.selected).toBeNull();
    expect(result.ok && result.data.best?.feedback).toBe("Why A works.");
  });

  it("treats a refusal before settlement as an error, and tries nothing else", async () => {
    replies.get_question_explanation = { data: null, error: { code: "42501", message: "No submitted answer" } };

    const result = await fetchQuestionExplanation("lq-1");

    expect(result.ok).toBe(false);
    expect(calls.map((call) => call.name)).toEqual(["get_question_explanation"]);
  });
});

describe("a database without get_question_explanation yet", () => {
  it("derives the same two options from get_question_feedback", async () => {
    replies.get_question_feedback = {
      data: [
        { option_id: "o-a", is_selected: false, score_milli: 1000, grade_band: "excellent", feedback_md: "Why A works." },
        { option_id: "o-b", is_selected: true, score_milli: 600, grade_band: "good", feedback_md: "Why B falls short." }
      ],
      error: null
    };

    const result = await fetchQuestionExplanation("lq-1");

    expect(calls.map((call) => call.name)).toEqual(["get_question_explanation", "get_question_feedback"]);
    expect(result).toEqual({
      ok: true,
      data: {
        outcome: null,
        selected: { optionId: "o-b", label: null, scoreMilli: 600, feedback: "Why B falls short." },
        best: { optionId: "o-a", label: null, scoreMilli: 1000, feedback: "Why A works." }
      }
    });
  });
});
