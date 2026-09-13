// react / react-dom resolve to apps/mobile/node_modules (React 19), the copy
// the hook itself uses — same harness as useQuizFlow.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettledSeed } from "./questionProgress";
import type { QuizRpcResult } from "./quizData";
import type { StartedAttempt } from "./quizSession";

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

/**
 * Opening a reading the reader has already worked on: the flow resumes on the
 * first question still owed and makes no start call for anything settled.
 */

const starts: string[] = [];
let teamsScored = 0;

vi.mock("./quizData", () => ({
  startQuestionAttempt: (id: string) => {
    starts.push(id);
    const now = Date.now();
    const result: QuizRpcResult<StartedAttempt> = {
      ok: true,
      data: {
        attemptId: `attempt-${id}`,
        serverNow: new Date(now).toISOString(),
        startedAt: new Date(now).toISOString(),
        deadlineAt: new Date(now + 20_000).toISOString(),
        timeLimitSeconds: 20,
        alreadySubmitted: false,
        prompt: `Prompt ${id}`,
        options: ["a", "b", "c", "d"].map((key) => ({ optionId: `${id}-${key}`, label: key }))
      }
    };
    return Promise.resolve(result);
  },
  submitAnswerWithRetry: (input: { attemptId: string; selectedOptionId: string | null }) =>
    Promise.resolve({
      ok: true,
      data: {
        attemptId: input.attemptId,
        scoreMilli: 1000,
        gradeBand: "excellent",
        expired: false,
        skipped: false,
        selectedOptionId: input.selectedOptionId,
        teamsScored
      }
    }),
  submitQuestionAnswer: () => Promise.resolve({ ok: true, data: null }),
  fetchQuestionExplanation: () => Promise.resolve({ ok: true, data: { outcome: null, selected: null, best: null } })
}));

vi.mock("../../lib/analytics", () => ({ trackAnalyticsEvent: () => undefined }));

import { onTeamScoresChanged } from "../teams/teamScoreEvents";
import { knownAttempt, resetQuestionProgress, setQuestionProgressOwner } from "./questionProgressStore";
import { useQuizFlow, type QuizFlowState } from "./useQuizFlow";

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
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
  });
}

function flow(): QuizFlowState {
  if (!latest.current) throw new Error("not rendered");
  return latest.current;
}

const refs = (...ids: string[]) => ids.map((id) => ({ logicalQuestionId: id }));
const answered = (scoreMilli: SettledSeed["scoreMilli"]): SettledSeed => ({
  scoreMilli,
  expired: false,
  skipped: false,
  selectedOptionId: "chosen"
});
const timedOut: SettledSeed = { scoreMilli: 0, expired: true, skipped: false, selectedOptionId: null };

beforeEach(() => {
  starts.length = 0;
  teamsScored = 0;
  latest.current = null;
  resetQuestionProgress();
  setQuestionProgressOwner("reader-1");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("resuming where the server says the reader stopped", () => {
  it("4. Q1 settled → the quiz opens on Q2, and never starts Q1", async () => {
    render({
      questions: refs("q1", "q2"),
      active: true,
      contentType: "newsletter_article",
      isTeam: false,
      settled: { q1: answered(600) }
    });
    await flush();

    expect(flow().currentIndex).toBe(1);
    expect(starts).toEqual(["q2"]);
    expect(flow().scoreMilli).toBe(600);
  });

  it("5. a Mini Case at 2/3 opens straight on Q3", async () => {
    render({
      questions: refs("m1", "m2", "m3"),
      active: true,
      contentType: "mini_case",
      isTeam: false,
      settled: { m1: answered(1000), m2: timedOut }
    });
    await flush();

    expect(flow().currentIndex).toBe(2);
    expect(starts).toEqual(["m3"]);
  });

  it("11. a reading settled in full opens on its score with no start call at all", async () => {
    render({
      questions: refs("q1", "q2"),
      active: true,
      contentType: "newsletter_article",
      isTeam: false,
      settled: { q1: answered(1000), q2: timedOut }
    });
    await flush();

    expect(starts).toEqual([]);
    expect(flow().isComplete).toBe(true);
    expect(flow().scoreMilli).toBe(1000);
  });

  it("10. a timed-out question stays settled: it cannot be answered again", async () => {
    render({
      questions: refs("q1", "q2"),
      active: true,
      contentType: "newsletter_article",
      isTeam: false,
      settled: { q1: timedOut }
    });
    await flush();

    expect(flow().states[0]).toMatchObject({ status: "answered", expired: true, scoreMilli: 0 });
    expect(starts).not.toContain("q1");
  });

  it("applies progress that arrives after the screen opened, without starting what it settles", async () => {
    render({ questions: refs("q1", "q2"), active: false, contentType: "newsletter_article", isTeam: false });
    rerender({
      questions: refs("q1", "q2"),
      active: true,
      contentType: "newsletter_article",
      isTeam: false,
      settled: { q1: answered(300) }
    });
    await flush();

    expect(starts).toEqual(["q2"]);
    expect(flow().currentIndex).toBe(1);
  });
});

describe("what an answer tells the rest of the app", () => {
  it("records the settled attempt, so the row the reader returns to is already current", async () => {
    render({ questions: refs("q1"), active: true, contentType: "newsletter_article", isTeam: false });
    await flush();
    expect(knownAttempt("q1")?.status).toBe("in_progress");

    await act(async () => flow().select("q1-a"));
    await flush();

    expect(knownAttempt("q1")).toMatchObject({ status: "submitted", scoreMilli: 1000 });
  });

  it("L1. an answer that counted for a Team tells the Team screens to refetch — once", async () => {
    const heard = vi.fn();
    const stop = onTeamScoresChanged(heard);
    teamsScored = 2;

    render({ questions: refs("q1"), active: true, contentType: "newsletter_article", isTeam: true });
    await flush();
    await act(async () => flow().select("q1-a"));
    await flush();

    // Two Teams scored, one answer: one nudge, and the server does the fan-out.
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stays quiet when the answer counted for no Team", async () => {
    const heard = vi.fn();
    const stop = onTeamScoresChanged(heard);

    render({ questions: refs("q1"), active: true, contentType: "newsletter_article", isTeam: false });
    await flush();
    await act(async () => flow().select("q1-a"));
    await flush();

    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});
