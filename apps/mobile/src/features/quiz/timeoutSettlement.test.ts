import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { questionReducer, type QuestionState } from "./quizSession";

/**
 * What happens to a question nobody answered.
 *
 * The obvious implementation stops at the screen: the deadline passes, the UI
 * says zero, done. That leaves the attempt `in_progress` in Postgres forever,
 * and two things break quietly:
 *
 *   THE LEDGER NEVER SETTLES. `team_member_edition_scores.answered_count` only
 *   moves on a submit, so an edition with one timed-out question never counts as
 *   complete and the reader's streak never advances — for a question they were
 *   shown, ran out of time on, and would reasonably consider finished.
 *
 *   THE EXPLANATION NEVER ARRIVES. `get_question_feedback` opens only once an
 *   attempt is submitted. So the timeout screen promises "the explanation is
 *   below" and nothing follows it.
 *
 * The fix is to submit the timeout, with no option, and let the server return
 * the zero it was always going to return. Nothing is back-dated to rescue it —
 * there is no timestamp in the request to back-date.
 */

const flow = readFileSync(join(__dirname, "useQuizFlow.ts"), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = stripComments(flow);

const T0 = Date.parse("2026-09-07T10:00:00.000Z");

function answering(deadlineOffsetMs: number): QuestionState {
  return {
    status: "answering",
    attemptId: "attempt-1",
    deadlineAt: new Date(T0 + deadlineOffsetMs).toISOString(),
    prompt: "Which constraint binds first?",
    options: [
      { optionId: "a", label: "Capital" },
      { optionId: "b", label: "Liquidity" }
    ]
  };
}

describe("the deadline is the server's, and the reducer only reads it", () => {
  it("expires an unanswered question once the server deadline passes", () => {
    const state = questionReducer(answering(20_000), { type: "tick", now: T0 + 20_001 });

    expect(state.status).toBe("expired");
    expect(state.status === "expired" && state.attemptId).toBe("attempt-1");
  });

  it("expires a committed answer whose submit never arrived in time", () => {
    const submitting = questionReducer(answering(20_000), {
      type: "option_selected",
      optionId: "a"
    });

    expect(submitting.status).toBe("submitting");
    expect(
      questionReducer(submitting, { type: "tick", now: T0 + 20_001 }).status
    ).toBe("expired");
  });

  it("leaves a question that never started alone, however long the app was shut", () => {
    // Idle is not expired. Q2 has no deadline until it is actually on screen.
    const idle: QuestionState = { status: "idle" };

    expect(questionReducer(idle, { type: "tick", now: T0 + 86_400_000 })).toBe(idle);
  });

  it("keeps the attempt id, which is what the timeout is submitted against", () => {
    const expired = questionReducer(answering(20_000), { type: "tick", now: T0 + 30_000 });

    expect(expired.status === "expired" && expired.attemptId).toBe("attempt-1");
  });
});

describe("the flow settles it with the server", () => {
  it("submits the expired attempt with no option", () => {
    expect(code).toContain("const settleExpiredAttempt = useCallback(");
    expect(code).toMatch(
      /submitQuestionAnswer\(\{ attemptId, selectedOptionId: null \}\)/
    );
    expect(code).toContain("void settleExpiredAttempt(index, state.attemptId, key);");
  });

  it("does it once per question, from the transition rather than from a render", () => {
    expect(code).toMatch(/expiredReportedRef\.current\.has\(index\)/);
    expect(code).toMatch(/expiredReportedRef\.current\.add\(index\)/);
  });

  it("does not retry: the deadline has passed and nothing can be won", () => {
    const settle = code.slice(
      code.indexOf("const settleExpiredAttempt"),
      code.indexOf("states.forEach((state, index)")
    );

    // Guard against a vacuous slice: the settle body must actually be here.
    expect(settle).toContain("submitQuestionAnswer");
    expect(settle).not.toContain("submitAnswerWithRetry");
    expect(settle).not.toContain("deadlineAt");
  });

  it("releases the explanation only after the settle succeeded", () => {
    expect(code).toMatch(/if \(result\.ok\) \{\s*await loadFeedback\(index, requestKey\);/);
  });

  it("sends no timestamp, no duration and no score, here or anywhere", () => {
    for (const forbidden of ["Date.now()", "startedAt", "score_milli", "p_score"]) {
      const settle = code.slice(
        code.indexOf("const settleExpiredAttempt"),
        code.indexOf("const expiredReportedRef")
      );

      expect(settle, forbidden).not.toContain(forbidden);
    }
  });
});
