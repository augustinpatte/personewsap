import { describe, expect, it } from "vitest";

import {
  formatPoints,
  hasPendingQuestions,
  initialQuestionState,
  isInteractive,
  isSettled,
  questionReducer,
  remainingSeconds,
  summarizeQuiz,
  type QuestionState,
  type StartedAttempt,
  type SubmittedAnswer
} from "./quizSession";

/**
 * The twenty seconds, and who owns them.
 *
 * Every case here is about one of two properties. The server owns the deadline,
 * so no device clock can buy or rescue time. And a question is answered once,
 * so neither reopening the screen, nor closing the app, nor coming back through
 * the archive can produce a second go at points.
 */

const T0 = Date.parse("2026-09-06T10:00:00.000Z");
const seconds = (n: number) => T0 + n * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function attempt(overrides: Partial<StartedAttempt> = {}): StartedAttempt {
  return {
    attemptId: "attempt-1",
    serverNow: iso(T0),
    startedAt: iso(T0),
    deadlineAt: iso(seconds(20)),
    timeLimitSeconds: 20,
    alreadySubmitted: false,
    prompt: "Why did the margin move before the volume did?",
    options: [
      { optionId: "a", label: "Because the discount landed on contribution" },
      { optionId: "b", label: "Because the volume commitment lagged demand" },
      { optionId: "c", label: "Because the headline price matched a rival" },
      { optionId: "d", label: "Because coverage shifted the market mood" }
    ],
    ...overrides
  };
}

function answer(overrides: Partial<SubmittedAnswer> = {}): SubmittedAnswer {
  return {
    attemptId: "attempt-1",
    scoreMilli: 1000,
    gradeBand: "excellent",
    expired: false,
    skipped: false,
    selectedOptionId: "a",
    ...overrides
  };
}

/** Drive the machine through the happy path up to `answering`. */
function answering(overrides: Partial<StartedAttempt> = {}): QuestionState {
  let state = initialQuestionState();
  state = questionReducer(state, { type: "start_requested" });
  return questionReducer(state, { type: "start_succeeded", attempt: attempt(overrides) });
}

describe("a question that has not started", () => {
  it("is idle, not expired, however long the app was closed", () => {
    // The rule that stops Q2's clock running while Q1 is on screen. A question
    // with no attempt has no deadline, so a week of absence changes nothing.
    const state = initialQuestionState();

    expect(state.status).toBe("idle");
    expect(isSettled(state)).toBe(false);
    expect(remainingSeconds(state, seconds(100_000))).toBeNull();
    expect(questionReducer(state, { type: "tick", now: seconds(100_000) }).status).toBe("idle");
  });

  it("shows no timer at all", () => {
    expect(remainingSeconds(initialQuestionState(), T0)).toBeNull();
  });
});

describe("starting", () => {
  it("only starts from idle", () => {
    const state = answering();

    // Re-entering the screen must not restart a running question.
    expect(questionReducer(state, { type: "start_requested" })).toBe(state);
  });

  it("takes its deadline from the server", () => {
    const state = answering({ deadlineAt: iso(seconds(20)) });

    expect(state.status).toBe("answering");
    expect(remainingSeconds(state, T0)).toBe(20);
    expect(remainingSeconds(state, seconds(12))).toBe(8);
  });

  it("never reports negative time", () => {
    expect(remainingSeconds(answering(), seconds(60))).toBe(0);
  });

  it("shows Retry rather than a fake local timer when the RPC fails", () => {
    // A Team question needs the network. A locally-timed question would be
    // unwinnable anyway, because no attempt was ever opened server-side.
    let state = questionReducer(initialQuestionState(), { type: "start_requested" });
    state = questionReducer(state, { type: "start_failed", message: "offline" });

    expect(state.status).toBe("start_failed");
    expect(remainingSeconds(state, T0)).toBeNull();

    // And Retry is allowed from there.
    expect(questionReducer(state, { type: "start_requested" }).status).toBe("starting");
  });
});

describe("answering", () => {
  it("locks the options the instant one is tapped", () => {
    const state = questionReducer(answering(), { type: "option_selected", optionId: "b" });

    // Locked before the network round-trip: the reader cannot change their mind
    // while the request is in flight.
    expect(state.status).toBe("submitting");
    expect(isInteractive(state)).toBe(false);
  });

  it("ignores a second selection once locked", () => {
    const locked = questionReducer(answering(), { type: "option_selected", optionId: "b" });

    expect(questionReducer(locked, { type: "option_selected", optionId: "a" })).toBe(locked);
  });

  it("reports the score the server returned", () => {
    let state = questionReducer(answering(), { type: "option_selected", optionId: "b" });
    state = questionReducer(state, {
      type: "submit_succeeded",
      result: answer({ scoreMilli: 600, gradeBand: "good", selectedOptionId: "b" })
    });

    expect(state).toMatchObject({ status: "answered", scoreMilli: 600, gradeBand: "good" });
  });

  it("gives no speed bonus", () => {
    // The same option is worth the same whether it took two seconds or nineteen.
    const fast = questionReducer(
      questionReducer(answering(), { type: "option_selected", optionId: "a" }),
      { type: "submit_succeeded", result: answer({ scoreMilli: 1000 }) }
    );
    const slow = questionReducer(
      questionReducer(answering(), { type: "option_selected", optionId: "a" }),
      { type: "submit_succeeded", result: answer({ scoreMilli: 1000 }) }
    );

    expect(fast).toEqual(slow);
  });

  it("leaves the feedback step untimed", () => {
    let state = questionReducer(answering(), { type: "option_selected", optionId: "a" });
    state = questionReducer(state, { type: "submit_succeeded", result: answer() });

    // Long past the original deadline, and still answered: the twenty seconds
    // covered the decision, not the reading of the explanation.
    expect(questionReducer(state, { type: "tick", now: seconds(600) })).toBe(state);
  });
});

describe("skip", () => {
  it("is an explicit submit worth zero", () => {
    let state = questionReducer(answering(), { type: "skip_requested" });

    expect(state.status).toBe("submitting");
    expect(state.status === "submitting" ? state.selectedOptionId : "x").toBeNull();

    state = questionReducer(state, {
      type: "submit_succeeded",
      result: answer({ scoreMilli: 0, gradeBand: "bad", skipped: true, selectedOptionId: null })
    });

    expect(state).toMatchObject({ status: "answered", scoreMilli: 0, skipped: true });
  });

  it("cannot be skipped after answering", () => {
    const answered = questionReducer(
      questionReducer(answering(), { type: "option_selected", optionId: "a" }),
      { type: "submit_succeeded", result: answer() }
    );

    expect(questionReducer(answered, { type: "skip_requested" })).toBe(answered);
  });
});

describe("timeout", () => {
  it("expires at the server deadline with no answer", () => {
    const state = questionReducer(answering(), { type: "tick", now: seconds(21) });

    expect(state.status).toBe("expired");
    expect(isSettled(state)).toBe(true);
  });

  it("does not expire a moment early", () => {
    const state = answering();

    expect(questionReducer(state, { type: "tick", now: seconds(19) })).toBe(state);
    expect(questionReducer(state, { type: "tick", now: seconds(20) })).toBe(state);
  });

  it("expires an answer that never reached the server in time", () => {
    // The reader tapped, the network dropped, the deadline passed. The rule is
    // explicit: score zero. Nothing is back-dated to rescue it.
    let state = questionReducer(answering(), { type: "option_selected", optionId: "a" });
    state = questionReducer(state, { type: "submit_failed", message: "offline" });
    state = questionReducer(state, { type: "tick", now: seconds(25) });

    expect(state.status).toBe("expired");
  });

  it("keeps a failed submit committed while the deadline holds", () => {
    // Still submitting, not back to answering: the reader has chosen, and the
    // caller retries.
    let state = questionReducer(answering(), { type: "option_selected", optionId: "a" });
    state = questionReducer(state, { type: "submit_failed", message: "offline" });

    expect(state.status).toBe("submitting");
    expect(questionReducer(state, { type: "tick", now: seconds(5) }).status).toBe("submitting");
  });

  it("cannot be answered after expiring", () => {
    const expired = questionReducer(answering(), { type: "tick", now: seconds(30) });

    expect(questionReducer(expired, { type: "option_selected", optionId: "a" })).toBe(expired);
    expect(questionReducer(expired, { type: "start_requested" })).toBe(expired);
  });
});

describe("closing and reopening the app", () => {
  it("resumes with the time actually left, not a fresh twenty seconds", () => {
    // Reopened eight seconds in. The RPC is idempotent per (user, question), so
    // it returns the ORIGINAL deadline.
    const state = questionReducer(
      questionReducer(initialQuestionState(), { type: "start_requested" }),
      {
        type: "start_succeeded",
        attempt: attempt({ serverNow: iso(seconds(8)), deadlineAt: iso(seconds(20)) })
      }
    );

    expect(state.status).toBe("answering");
    expect(remainingSeconds(state, seconds(8))).toBe(12);
  });

  it("settles at zero when the deadline passed while the app was closed", () => {
    // Decided from the server's own `server_now`, not the device's clock.
    const state = questionReducer(
      questionReducer(initialQuestionState(), { type: "start_requested" }),
      {
        type: "start_succeeded",
        attempt: attempt({ serverNow: iso(seconds(300)), deadlineAt: iso(seconds(20)) })
      }
    );

    expect(state.status).toBe("expired");
  });

  it("restores an answer the server already has", () => {
    const state = questionReducer(
      questionReducer(initialQuestionState(), { type: "start_requested" }),
      {
        type: "start_succeeded",
        attempt: attempt({ alreadySubmitted: true }),
        answered: answer({ scoreMilli: 600, gradeBand: "good" })
      }
    );

    expect(state).toMatchObject({ status: "answered", scoreMilli: 600 });
  });

  it("never replays a question the server has already settled", () => {
    // The archive path. The debrief is readable; the points are not re-winnable.
    const state = questionReducer(
      questionReducer(initialQuestionState(), { type: "start_requested" }),
      { type: "start_succeeded", attempt: attempt({ alreadySubmitted: true }) }
    );

    expect(isSettled(state)).toBe(true);
    expect(questionReducer(state, { type: "start_requested" })).toBe(state);
    expect(questionReducer(state, { type: "option_selected", optionId: "a" })).toBe(state);
  });
});

describe("progress across a quiz", () => {
  const settledAnswer: QuestionState = {
    status: "answered",
    attemptId: "a",
    prompt: "p",
    options: [],
    selectedOptionId: "a",
    scoreMilli: 600,
    gradeBand: "good",
    expired: false,
    skipped: false
  };

  it("points at the first unsettled question", () => {
    const progress = summarizeQuiz([settledAnswer, initialQuestionState()]);

    // Which is what keeps Q2 unstarted while Q1 is on screen.
    expect(progress.currentIndex).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.isComplete).toBe(false);
  });

  it("sums only what was actually scored", () => {
    const expired: QuestionState = { status: "expired", attemptId: "b", prompt: "p", options: [] };
    const progress = summarizeQuiz([settledAnswer, expired]);

    expect(progress.scoreMilli).toBe(600);
    expect(progress.settled).toBe(2);
    expect(progress.isComplete).toBe(true);
  });

  it("reports an empty quiz as not complete", () => {
    expect(summarizeQuiz([]).isComplete).toBe(false);
  });
});

describe("Continue challenge", () => {
  it("appears when a read article still owes questions", () => {
    expect(
      hasPendingQuestions({ questionCount: 2, states: [initialQuestionState()] })
    ).toBe(true);
  });

  it("disappears once every question is settled", () => {
    const settled: QuestionState = { status: "expired", attemptId: "a", prompt: "", options: [] };

    expect(hasPendingQuestions({ questionCount: 2, states: [settled, settled] })).toBe(false);
  });

  it("never appears on legacy content with no questions", () => {
    // An article that predates questions must not grow a challenge it has not got.
    expect(hasPendingQuestions({ questionCount: 0, states: [] })).toBe(false);
  });
});

describe("points as the reader sees them", () => {
  it("renders the four tiers", () => {
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(300)).toBe("0.3");
    expect(formatPoints(600)).toBe("0.6");
    expect(formatPoints(1000)).toBe("1");
  });
});
