// react / react-dom resolve to apps/mobile/node_modules (React 19), the copy
// the hook itself uses — same harness as useArchiveSearch.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyDropContentItem } from "../today/contentTypes";
import type { StartedAttempt, SubmittedAnswer } from "./quizSession";
import type { QuizRpcResult } from "./quizData";

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

/**
 * The quiz flow as the reader lives it, against a scripted server.
 *
 * Every start is held until the test answers it, which is exactly what exposed
 * the black screen: the hook used to cancel its own start request the moment
 * it sent it, so the answer was thrown away and the question sat in
 * `starting` — an empty page with one caption — forever.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const starts: Array<{ id: string; call: Deferred<QuizRpcResult<StartedAttempt>> }> = [];
const submits: Array<{ attemptId: string; selectedOptionId: string | null }> = [];
const timeoutSubmits: Array<{ attemptId: string; selectedOptionId: string | null }> = [];

vi.mock("./quizData", () => ({
  startQuestionAttempt: (id: string) => {
    const call = deferred<QuizRpcResult<StartedAttempt>>();
    starts.push({ id, call });
    return call.promise;
  },
  submitAnswerWithRetry: (input: { attemptId: string; selectedOptionId: string | null }) => {
    submits.push(input);
    const result: QuizRpcResult<SubmittedAnswer> = {
      ok: true,
      data: {
        attemptId: input.attemptId,
        scoreMilli: input.selectedOptionId?.endsWith("-a") ? 1000 : 300,
        gradeBand: input.selectedOptionId?.endsWith("-a") ? "excellent" : "average",
        expired: false,
        skipped: input.selectedOptionId === null,
        selectedOptionId: input.selectedOptionId
      }
    };
    return Promise.resolve(result);
  },
  submitQuestionAnswer: (input: { attemptId: string; selectedOptionId: string | null }) => {
    timeoutSubmits.push(input);
    return Promise.resolve({
      ok: true,
      data: {
        attemptId: input.attemptId,
        scoreMilli: 0,
        gradeBand: "bad",
        expired: true,
        skipped: false,
        selectedOptionId: null
      }
    });
  },
  fetchQuestionFeedback: () =>
    Promise.resolve({
      ok: true,
      data: [
        { optionId: "chosen", isSelected: true, scoreMilli: 300, gradeBand: "average", feedback: "Why it scored." }
      ]
    })
}));

vi.mock("../../lib/analytics", () => ({ trackAnalyticsEvent: () => undefined }));

import { readItemQuestions } from "./itemQuestions";
import { START_TIMEOUT_MS, useQuizFlow, type QuizFlowState } from "./useQuizFlow";

function opened(id: string, overrides: Partial<StartedAttempt> = {}): QuizRpcResult<StartedAttempt> {
  const now = Date.now();
  return {
    ok: true,
    data: {
      attemptId: `attempt-${id}`,
      serverNow: new Date(now).toISOString(),
      startedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + 20_000).toISOString(),
      timeLimitSeconds: 20,
      alreadySubmitted: false,
      prompt: `Prompt ${id}`,
      options: ["a", "b", "c", "d"].map((key) => ({ optionId: `${id}-${key}`, label: `Option ${key}` })),
      ...overrides
    }
  };
}

/** A question this reader already answered, as the server hands it back. */
function settledEarlier(id: string, scoreMilli: 0 | 300 | 600 | 1000 = 1000): QuizRpcResult<StartedAttempt> {
  const attempt = opened(id, { alreadySubmitted: true });

  if (!attempt.ok) {
    throw new Error("unreachable");
  }

  return {
    ok: true,
    data: {
      ...attempt.data,
      settled: {
        attemptId: attempt.data.attemptId,
        scoreMilli,
        gradeBand: scoreMilli === 1000 ? "excellent" : "bad",
        expired: false,
        skipped: false,
        selectedOptionId: `${id}-a`
      }
    }
  };
}

type Props = Parameters<typeof useQuizFlow>[0];

let root: Root | null = null;
const latest: { current: QuizFlowState | null } = { current: null };

function Probe(props: Props) {
  latest.current = useQuizFlow(props);
  return null;
}

function render(props: Props) {
  root = createRoot(document.createElement("div"));
  act(() => {
    root?.render(<Probe {...props} />);
  });
}

function rerender(props: Props) {
  act(() => {
    root?.render(<Probe {...props} />);
  });
}

async function flush() {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) {
      await Promise.resolve();
    }
  });
}

async function answerStart(index: number, result: QuizRpcResult<StartedAttempt>) {
  await act(async () => {
    starts[index].call.resolve(result);
  });
  await flush();
}

function flow(): QuizFlowState {
  if (!latest.current) {
    throw new Error("hook not rendered");
  }
  return latest.current;
}

const refs = (...ids: string[]) => ids.map((id) => ({ logicalQuestionId: id }));
const newsletter = (active = true): Props => ({
  questions: refs("q1", "q2"),
  active,
  contentType: "newsletter_article",
  isTeam: false
});

beforeEach(() => {
  starts.length = 0;
  submits.length = 0;
  timeoutSubmits.length = 0;
  latest.current = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

describe("the question in front of the reader actually appears", () => {
  it("lets the start answer land instead of cancelling it (the black screen)", async () => {
    render(newsletter());

    expect(starts.map((start) => start.id)).toEqual(["q1"]);
    expect(flow().states[0].status).toBe("starting");

    await answerStart(0, opened("q1"));

    const state = flow().states[0];
    expect(state.status).toBe("answering");
    expect(state.status === "answering" ? state.options : []).toHaveLength(4);
    expect(state.status === "answering" ? state.prompt : "").toBe("Prompt q1");
  });

  it("starts nothing while the questions are not on screen", () => {
    render(newsletter(false));

    expect(starts).toEqual([]);
  });

  it("never spins forever: a start with no answer becomes Retry, and Retry resumes it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    render(newsletter());

    act(() => {
      vi.advanceTimersByTime(START_TIMEOUT_MS);
    });

    expect(flow().states[0].status).toBe("start_failed");

    act(() => flow().retryStart());

    expect(starts.map((start) => start.id)).toEqual(["q1", "q1"]);
    await answerStart(1, opened("q1"));
    expect(flow().states[0].status).toBe("answering");

    // The first request's late answer is ignored rather than applied twice.
    await answerStart(0, opened("q1"));
    expect(flow().states[0].status).toBe("answering");
  });

  it("shows Retry, not an empty card, when the server refuses the start", async () => {
    render(newsletter());

    await answerStart(0, {
      ok: false,
      error: { code: "42501", message: "Question not available" }
    } as QuizRpcResult<StartedAttempt>);

    expect(flow().states[0].status).toBe("start_failed");
  });

  it("treats an open question with no options as unavailable, never as a blank card", async () => {
    render(newsletter());

    await answerStart(0, opened("q1", { options: [] }));

    expect(flow().states[0].status).toBe("start_failed");
  });

  it("copes with questions that arrive after the screen mounted", async () => {
    render({ ...newsletter(), questions: [] });
    expect(flow().total).toBe(0);

    rerender(newsletter());

    expect(flow().states).toHaveLength(2);
    expect(starts.map((start) => start.id)).toEqual(["q1"]);
  });
});

describe("answer, feedback, then the next question", () => {
  it("I. a Newsletter's two questions: q1 → feedback → Continue → q2 → complete", async () => {
    render(newsletter());
    await answerStart(0, opened("q1"));

    await act(async () => flow().select("q1-a"));
    await flush();

    // The outcome and its explanation stay on screen; q2 has NOT started.
    expect(flow().currentIndex).toBe(0);
    expect(flow().states[0].status).toBe("answered");
    expect(flow().feedback).toBe("Why it scored.");
    expect(starts.map((start) => start.id)).toEqual(["q1"]);

    act(() => flow().advance());
    expect(flow().currentIndex).toBe(1);
    expect(starts.map((start) => start.id)).toEqual(["q1", "q2"]);

    await answerStart(1, opened("q2"));
    await act(async () => flow().select("q2-b"));
    await flush();
    expect(flow().isComplete).toBe(false);

    act(() => flow().advance());
    expect(flow().isComplete).toBe(true);
    expect(flow().scoreMilli).toBe(1300);
    expect(flow().total).toBe(2);
  });

  it("J. a Mini Case's three questions, in order, one at a time", async () => {
    render({ questions: refs("m1", "m2", "m3"), active: true, contentType: "mini_case", isTeam: false });

    for (const [index, id] of ["m1", "m2", "m3"].entries()) {
      expect(starts.map((start) => start.id)).toEqual(["m1", "m2", "m3"].slice(0, index + 1));
      await answerStart(index, opened(id));
      await act(async () => flow().select(`${id}-a`));
      await flush();
      act(() => flow().advance());
    }

    expect(flow().isComplete).toBe(true);
    expect(flow().scoreMilli).toBe(3000);
  });

  it("Continue never skips an open question", async () => {
    render(newsletter());
    await answerStart(0, opened("q1"));

    act(() => flow().advance());

    expect(flow().currentIndex).toBe(0);
    expect(starts).toHaveLength(1);
  });
});

describe("one logical question is answered once", () => {
  it("K. the same question reached through a Team and Solo is started and answered once", async () => {
    const item = {
      id: "row-fr",
      logical_questions: [
        { logical_question_id: "q2", question_sequence: 2, question_role: "application_decision" },
        { logical_question_id: "q1", question_sequence: 1, question_role: "interpretation" },
        // The same logical question again, through a second route.
        { logical_question_id: "q1", question_sequence: 1, question_role: "interpretation" }
      ]
    } as unknown as DailyDropContentItem;
    const { questions } = readItemQuestions(item);

    expect(questions).toEqual(refs("q1", "q2"));

    render({ questions, active: true, contentType: "newsletter_article", isTeam: true });
    await answerStart(0, opened("q1"));
    await act(async () => flow().select("q1-a"));
    await flush();
    await act(async () => flow().select("q1-b"));
    await flush();

    expect(submits.map((submit) => submit.attemptId)).toEqual(["attempt-q1"]);
    expect(starts.map((start) => start.id)).toEqual(["q1"]);
  });

  it("L. a question settled earlier cannot be answered again", async () => {
    render(newsletter());
    await answerStart(0, settledEarlier("q1"));

    await act(async () => flow().select("q1-b"));
    await flush();

    expect(flow().states[0].status).toBe("answered");
    expect(submits).toEqual([]);
  });

  it("M. reopening after q1 was answered lands on q2, not on q1 again", async () => {
    render(newsletter());
    await answerStart(0, settledEarlier("q1", 600));

    expect(flow().currentIndex).toBe(1);
    expect(starts.map((start) => start.id)).toEqual(["q1", "q2"]);

    await answerStart(1, opened("q2"));
    expect(flow().states[1].status).toBe("answering");
    expect(flow().scoreMilli).toBe(600);
  });

  it("a reading answered in full reopens on its score, with nothing to retry", async () => {
    render(newsletter());
    await answerStart(0, settledEarlier("q1", 1000));
    await answerStart(1, settledEarlier("q2", 300));

    expect(flow().isComplete).toBe(true);
    expect(flow().scoreMilli).toBe(1300);
    expect(submits).toEqual([]);
  });

  it("N. a language switch keeps the same logical questions and restarts nothing", async () => {
    render(newsletter());
    await answerStart(0, opened("q1"));

    // The EN rendering: a different content row, the same logical ids.
    rerender({ ...newsletter(), questions: refs("q1", "q2") });

    expect(starts.map((start) => start.id)).toEqual(["q1"]);
    expect(flow().states[0].status).toBe("answering");
  });
});

describe("P. the server owns the clock", () => {
  it("settles a question whose deadline already passed at zero, once, through the server", async () => {
    const past = Date.now() - 30_000;
    render(newsletter());
    await answerStart(
      0,
      opened("q1", {
        serverNow: new Date(past + 25_000).toISOString(),
        deadlineAt: new Date(past + 20_000).toISOString()
      })
    );

    expect(flow().states[0].status).toBe("expired");
    expect(timeoutSubmits).toEqual([{ attemptId: "attempt-q1", selectedOptionId: null }]);

    // No second chance, and the timeout is shown before moving on.
    await act(async () => flow().select("q1-a"));
    await flush();
    expect(submits).toEqual([]);
    expect(flow().currentIndex).toBe(0);
  });
});
