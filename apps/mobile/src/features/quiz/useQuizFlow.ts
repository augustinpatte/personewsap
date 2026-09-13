import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { trackAnalyticsEvent } from "../../lib/analytics";
import type { AnalyticsContentType } from "../../lib/analytics";
import { notifyTeamScoresChanged } from "../teams/teamScoreEvents";
import type { QuestionExplanation } from "./answerExplanation";
import type { SettledSeed } from "./questionProgress";
import { recordAttempt } from "./questionProgressStore";
import {
  fetchQuestionExplanation,
  startQuestionAttempt,
  submitAnswerWithRetry,
  submitQuestionAnswer
} from "./quizData";
import {
  hasPendingQuestions,
  initialQuestionState,
  isSettled,
  questionReducer,
  resolveDisplayedIndex,
  summarizeQuiz,
  type QuestionAction,
  type QuestionGradeBand,
  type QuestionScoreTier,
  type QuestionState
} from "./quizSession";

/**
 * The quiz, wired to the server.
 *
 * The rules live in `quizSession.ts` as a pure reducer; this is the part that
 * cannot be pure — the RPCs, the clock that drives expiry, and the analytics.
 *
 * WHAT THIS HOOK EXISTS TO GUARANTEE:
 *
 *   A question starts only when it is the one on screen. The start effect fires
 *   for the displayed index and no other, so Q2's twenty seconds never run
 *   behind Q1.
 *
 *   A question the server has already settled is never started again. The
 *   reading's progress (`question_attempts`) is passed in as `settled`, and
 *   those questions are restored as settled and continued past without a single
 *   `start_question_attempt` — a finished reading opens on its score, a
 *   half-finished one on the first question still owed.
 *
 *   A started question's answer always lands. The start request is NOT tied to
 *   the effect's cleanup: it used to be, and dispatching `start_requested`
 *   changed `states`, which re-ran the effect, whose cleanup cancelled the very
 *   request it had just sent. The result is dropped only if the flow unmounted
 *   or its question list was replaced.
 *
 *   A start never spins forever. After START_TIMEOUT_MS the question becomes
 *   `start_failed`, which shows Retry; retrying resumes the same server attempt
 *   with its original deadline, because the RPC is idempotent.
 *
 *   The reader sees the outcome before the next question. A settled question
 *   stays on screen until the reader taps Continue; only then is the next one
 *   displayed — and started.
 *
 *   Every attempt the server opens or settles is told to the progress store,
 *   so the rows and buttons the reader returns to are already current; and an
 *   answer the server says counted for a Team tells the Team screens to
 *   refetch their standing.
 *
 *   Expiry is decided against the SERVER deadline. The interval below does not
 *   count anything down; it only asks the reducer to compare `Date.now()` with
 *   the deadline the server set.
 */

const EXPIRY_TICK_MS = 500;

/** How long a start may take before the reader is offered Retry instead of a loader. */
export const START_TIMEOUT_MS = 15_000;

export type QuizQuestionRef = {
  /** The logical question id — shared by the FR and EN renderings. */
  logicalQuestionId: string;
};

export type QuizFlowState = {
  states: QuestionState[];
  /** The question on screen: the first one not yet settled and continued past. */
  currentIndex: number;
  total: number;
  /** Every question settled, and the reader has continued past the last one. */
  isComplete: boolean;
  scoreMilli: number;
  /**
   * What the current question teaches, released only once it is settled: the
   * chosen option and the best option. undefined while it is on its way (and
   * before settlement); null when it could not be loaded.
   */
  explanation: QuestionExplanation | null | undefined;
  select: (optionId: string) => void;
  skip: () => void;
  /** Continue past the settled question on screen. */
  advance: () => void;
  retryStart: () => void;
  /** True while at least one question is unsettled. */
  hasPending: boolean;
};

/**
 * The identity of a question list: its logical ids, in order. The FR and EN
 * renderings of one reading share it, which is what keeps a language switch
 * from restarting anything.
 */
export function questionListKey(questions: QuizQuestionRef[]): string {
  return questions.map((question) => question.logicalQuestionId).join("|");
}

type FlowState = { key: string; states: QuestionState[] };

type FlowAction =
  | { type: "reset"; key: string; states: QuestionState[] }
  | { type: "seed"; key: string; index: number; state: QuestionState }
  | { type: "question"; key: string; index: number; action: QuestionAction };

function bandForTier(scoreMilli: QuestionScoreTier): QuestionGradeBand {
  return scoreMilli === 1000
    ? "excellent"
    : scoreMilli === 600
      ? "good"
      : scoreMilli === 300
        ? "average"
        : "bad";
}

/** A question the server already settled, as a state that needs no start. */
function settledState(seed: SettledSeed): QuestionState {
  return {
    status: "answered",
    attemptId: "",
    prompt: "",
    options: [],
    selectedOptionId: seed.selectedOptionId,
    scoreMilli: seed.scoreMilli,
    gradeBand: bandForTier(seed.scoreMilli),
    expired: seed.expired,
    skipped: seed.skipped
  };
}

function initialFlow(
  questions: QuizQuestionRef[],
  settled: Record<string, SettledSeed> | undefined
): { states: QuestionState[]; acknowledged: ReadonlySet<number> } {
  const acknowledged = new Set<number>();
  const states = questions.map((question, index) => {
    const seed = settled?.[question.logicalQuestionId];

    if (!seed) {
      return initialQuestionState();
    }

    // Settled on an earlier visit: restored with its score, continued past.
    acknowledged.add(index);
    return settledState(seed);
  });

  return { states, acknowledged };
}

function flowReducer(flow: FlowState, action: FlowAction): FlowState {
  if (action.type === "reset") {
    return action.key === flow.key && flow.states.length === action.states.length
      ? flow
      : { key: action.key, states: action.states };
  }

  // A result for a question list that has since been replaced is dropped.
  if (action.key !== flow.key) {
    return flow;
  }

  const current = flow.states[action.index];

  if (!current) {
    return flow;
  }

  // A late seed only ever fills a question nothing has touched yet.
  const next =
    action.type === "seed"
      ? current.status === "idle"
        ? action.state
        : current
      : questionReducer(current, action.action);

  if (next === current) {
    return flow;
  }

  const states = [...flow.states];
  states[action.index] = next;
  return { key: flow.key, states };
}

function withIndex(set: ReadonlySet<number>, index: number): ReadonlySet<number> {
  if (set.has(index)) {
    return set;
  }

  const next = new Set(set);
  next.add(index);
  return next;
}

export function useQuizFlow(input: {
  questions: QuizQuestionRef[];
  /** False while the questions are not on screen — nothing starts before then. */
  active: boolean;
  contentType: AnalyticsContentType;
  isTeam: boolean;
  /** Questions the server has already settled, keyed by logical id. Never started. */
  settled?: Record<string, SettledSeed>;
  onCompleted?: (scoreMilli: number) => void;
}): QuizFlowState {
  const key = questionListKey(input.questions);
  const total = input.questions.length;

  const [flow, dispatchFlow] = useReducer(flowReducer, undefined, () => ({
    key,
    states: initialFlow(input.questions, input.settled).states
  }));
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<number>>(
    () => initialFlow(input.questions, input.settled).acknowledged
  );
  const [explanationByIndex, setExplanationByIndex] = useState<
    Record<number, QuestionExplanation | null>
  >({});
  const startedRef = useRef(new Set<number>());
  const expiredReportedRef = useRef(new Set<number>());
  const completedRef = useRef(false);
  const mountedRef = useRef(true);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const settledRef = useRef(input.settled);
  settledRef.current = input.settled;
  // Bumped by retryStart so the start effect runs again after a failure.
  const [retryToken, setRetryToken] = useState(0);

  // THE QUESTION LIST CHANGED UNDER THE FLOW (an item that loaded its questions
  // late, a Team merge). The states belong to the old list, so they are
  // replaced — during render, so no effect ever sees a mismatched pair.
  if (flow.key !== key) {
    const fresh = initialFlow(input.questions, input.settled);
    startedRef.current = new Set();
    expiredReportedRef.current = new Set();
    completedRef.current = false;
    setAcknowledged(fresh.acknowledged);
    setExplanationByIndex({});
    dispatchFlow({ type: "reset", key, states: fresh.states });
  }

  const states =
    flow.key === key ? flow.states : initialFlow(input.questions, input.settled).states;
  const statesRef = useRef(states);
  statesRef.current = states;
  const keyRef = useRef(key);
  keyRef.current = key;

  const progress = useMemo(() => summarizeQuiz(states), [states]);
  const currentIndex = resolveDisplayedIndex(states, acknowledged);
  const currentQuestion = input.questions[currentIndex];

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;

    return () => {
      mountedRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const dispatch = useCallback(
    (requestKey: string, index: number, action: QuestionAction) => {
      dispatchFlow({ type: "question", key: requestKey, index, action });
    },
    []
  );

  const loadFeedback = useCallback(
    async (index: number, requestKey: string) => {
      const question = input.questions[index];

      if (!question) {
        return;
      }

      const explanation = await fetchQuestionExplanation(question.logicalQuestionId);

      if (!mountedRef.current || keyRef.current !== requestKey) {
        return;
      }

      // Null rather than absent on a failure: the screen then says the
      // explanation could not be loaded instead of waiting for it forever.
      setExplanationByIndex((current) => ({
        ...current,
        [index]: explanation.ok ? explanation.data : null
      }));
    },
    [input.questions]
  );

  // Progress that arrived after the flow was created: restore every settled
  // question nothing has touched yet, and move past it. Declared before the
  // start effect, which also refuses to start a seeded question.
  const settledIds = Object.keys(input.settled ?? {}).sort().join("|");

  useEffect(() => {
    const seeds = settledRef.current;

    if (!seeds) {
      return;
    }

    const restored: number[] = [];

    input.questions.forEach((question, index) => {
      const seed = seeds[question.logicalQuestionId];
      const state = statesRef.current[index];

      if (!seed || !state || state.status !== "idle" || startedRef.current.has(index)) {
        return;
      }

      dispatchFlow({ type: "seed", key, index, state: settledState(seed) });
      restored.push(index);
    });

    if (restored.length > 0) {
      setAcknowledged((current) =>
        restored.reduce<ReadonlySet<number>>((set, index) => withIndex(set, index), current)
      );
    }
    // Keyed on the ids: `input.questions` and `input.settled` are rebuilt on
    // every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settledIds]);

  // Start the question in front of the reader, and only that one.
  useEffect(() => {
    if (!input.active || !currentQuestion || startedRef.current.has(currentIndex)) {
      return;
    }

    // Settled server-side: restored by the seed effect, never started.
    if (settledRef.current?.[currentQuestion.logicalQuestionId]) {
      return;
    }

    const state = statesRef.current[currentIndex];

    // Startable from idle, and from a failed start once the reader taps Retry.
    if (!state || (state.status !== "idle" && state.status !== "start_failed")) {
      return;
    }

    startedRef.current.add(currentIndex);
    const index = currentIndex;
    const requestKey = key;
    const logicalQuestionId = currentQuestion.logicalQuestionId;
    let answered = false;

    dispatch(requestKey, index, { type: "start_requested" });

    const timeout = setTimeout(() => {
      timersRef.current.delete(timeout);

      if (answered || !mountedRef.current) {
        return;
      }

      // No answer in time: Retry, never an endless loader. A late answer is
      // ignored below; retrying resumes the same attempt server-side.
      answered = true;
      startedRef.current.delete(index);
      dispatch(requestKey, index, { type: "start_failed", message: "start_timeout" });
    }, START_TIMEOUT_MS);
    timersRef.current.add(timeout);

    // Deliberately no cleanup that cancels this request (see the header).
    void (async () => {
      const result = await startQuestionAttempt(currentQuestion.logicalQuestionId);

      if (answered || !mountedRef.current || keyRef.current !== requestKey) {
        return;
      }

      answered = true;
      clearTimeout(timeout);
      timersRef.current.delete(timeout);

      if (!result.ok) {
        // No local fallback timer. A Team question needs the network, and a
        // locally-timed one would be unwinnable: no attempt exists server-side.
        startedRef.current.delete(index);
        dispatch(requestKey, index, { type: "start_failed", message: result.error.message });
        return;
      }

      // An open question with nothing to choose from is unavailable, not an
      // empty card with a running clock.
      if (!result.data.alreadySubmitted && result.data.options.length === 0) {
        startedRef.current.delete(index);
        dispatch(requestKey, index, { type: "start_failed", message: "question_incomplete" });
        return;
      }

      // RESUMING A SETTLED QUESTION RESTORES ITS RESULT: `settled` is what the
      // server already holds for an attempt this reader submitted.
      dispatch(requestKey, index, {
        type: "start_succeeded",
        attempt: result.data,
        answered: result.data.settled
      });

      if (result.data.alreadySubmitted) {
        recordAttempt({
          logicalQuestionId,
          status: "submitted",
          deadlineAt: result.data.deadlineAt || null,
          expired: result.data.settled?.expired ?? false,
          selectedOptionId: result.data.settled?.selectedOptionId ?? null,
          scoreMilli: result.data.settled?.scoreMilli ?? 0
        });
        // Settled on an earlier visit: never replayed, and not shown again
        // either — the reader moves straight on to the first question owed.
        setAcknowledged((current) => withIndex(current, index));
        return;
      }

      recordAttempt({
        logicalQuestionId,
        status: "in_progress",
        deadlineAt: result.data.deadlineAt || null,
        expired: false,
        selectedOptionId: null,
        scoreMilli: null
      });

      trackAnalyticsEvent("quiz_started", {
        content_type: input.contentType,
        is_team: input.isTeam,
        question_index: index + 1,
        question_count: total
      });
    })();
  }, [
    currentIndex,
    currentQuestion,
    dispatch,
    input.active,
    input.contentType,
    input.isTeam,
    key,
    retryToken,
    total
  ]);

  // The expiry clock. It counts nothing — it asks the reducer to compare now()
  // against the server's deadline, which is the only authority here.
  useEffect(() => {
    const state = states[currentIndex];

    if (!state || (state.status !== "answering" && state.status !== "submitting")) {
      return;
    }

    const requestKey = key;
    const interval = setInterval(() => {
      dispatch(requestKey, currentIndex, { type: "tick", now: Date.now() });
    }, EXPIRY_TICK_MS);

    return () => clearInterval(interval);
  }, [currentIndex, dispatch, key, states]);

  const reportSettled = useCallback(
    (
      index: number,
      settled: {
        deadlineAt: string | null;
        expired: boolean;
        selectedOptionId: string | null;
        scoreMilli: QuestionScoreTier;
        teamsScored?: number;
      }
    ) => {
      const logicalQuestionId = input.questions[index]?.logicalQuestionId;

      if (logicalQuestionId) {
        recordAttempt({
          logicalQuestionId,
          status: "submitted",
          deadlineAt: settled.deadlineAt,
          expired: settled.expired,
          selectedOptionId: settled.selectedOptionId,
          scoreMilli: settled.scoreMilli
        });
      }

      // The server says this answer counted for at least one Team: the Team
      // screens refetch the standing it just recomputed.
      if ((settled.teamsScored ?? 0) > 0) {
        notifyTeamScoresChanged();
      }
    },
    [input.questions]
  );

  // A timeout, settled: zero, no option, final.
  const reportTimedOut = useCallback(
    (index: number, teamsScored: number | undefined) => {
      reportSettled(index, {
        deadlineAt: null,
        expired: true,
        selectedOptionId: null,
        scoreMilli: 0,
        teamsScored
      });
    },
    [reportSettled]
  );

  const settleExpiredAttempt = useCallback(
    async (index: number, attemptId: string, requestKey: string) => {
      if (!attemptId) {
        return;
      }

      const result = await submitQuestionAnswer({ attemptId, selectedOptionId: null });

      // A 23505 here means another device already settled it. Both outcomes are
      // the same zero, so there is nothing to reconcile.
      if (result.ok) {
        await loadFeedback(index, requestKey);
        reportTimedOut(index, result.data?.teamsScored);
      }
    },
    [loadFeedback, reportTimedOut]
  );

  // A question that just expired is reported — and SETTLED — once, from the
  // transition rather than from a render, so a re-render cannot do it twice.
  useEffect(() => {
    states.forEach((state, index) => {
      if (state.status !== "expired" || expiredReportedRef.current.has(index)) {
        return;
      }

      expiredReportedRef.current.add(index);
      trackAnalyticsEvent("quiz_timed_out", {
        content_type: input.contentType,
        is_team: input.isTeam,
        question_index: index + 1,
        question_count: total
      });

      // AN EXPIRED ATTEMPT IS STILL SUBMITTED, with no option. The server
      // compares against the deadline it set and returns zero; submitting is
      // what closes the attempt so the edition can complete and the feedback
      // opens. No retry loop: the deadline has already passed.
      void settleExpiredAttempt(index, state.attemptId, key);
    });
    // `settleExpiredAttempt` is stable for the life of the flow; depending on it
    // would re-run this on every state change and re-report a settled timeout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.contentType, input.isTeam, key, states, total]);

  useEffect(() => {
    if (!progress.isComplete || completedRef.current) {
      return;
    }

    completedRef.current = true;
    trackAnalyticsEvent("quiz_completed", {
      content_type: input.contentType,
      is_team: input.isTeam,
      question_count: total
    });
    input.onCompleted?.(progress.scoreMilli);
  }, [input, progress.isComplete, progress.scoreMilli, total]);

  const submit = useCallback(
    async (index: number, optionId: string | null) => {
      const state = statesRef.current[index];

      // Only an open question can be answered: a settled one — this visit or an
      // earlier one — has no path back to `answering`.
      if (!state || state.status !== "answering") {
        return;
      }

      const requestKey = keyRef.current;
      const deadlineAt = state.deadlineAt;
      const attemptId = state.attemptId;

      dispatch(requestKey, index, optionId ? { type: "option_selected", optionId } : { type: "skip_requested" });

      const result = await submitAnswerWithRetry({
        attemptId,
        selectedOptionId: optionId,
        deadlineAt
      });

      if (!mountedRef.current) {
        return;
      }

      if (!result.ok) {
        // Stays committed. The reducer settles it at zero on the next tick if
        // the deadline passes — nothing is back-dated to rescue it.
        dispatch(requestKey, index, { type: "submit_failed", message: result.error.message });
        return;
      }

      dispatch(requestKey, index, { type: "submit_succeeded", result: result.data });
      reportSettled(index, {
        deadlineAt,
        expired: result.data.expired,
        selectedOptionId: result.data.selectedOptionId,
        scoreMilli: result.data.scoreMilli,
        teamsScored: result.data.teamsScored
      });

      trackAnalyticsEvent(optionId ? "quiz_answered" : "quiz_skipped", {
        content_type: input.contentType,
        is_team: input.isTeam,
        question_index: index + 1,
        question_count: total
      });

      // The explanation is fetched only now: `get_question_feedback` refuses a
      // caller with no submitted attempt, because before submitting it IS the
      // answer key.
      await loadFeedback(index, requestKey);
    },
    [dispatch, input.contentType, input.isTeam, loadFeedback, reportSettled, total]
  );

  const select = useCallback(
    (optionId: string) => {
      void submit(currentIndex, optionId);
    },
    [currentIndex, submit]
  );

  const skip = useCallback(() => {
    void submit(currentIndex, null);
  }, [currentIndex, submit]);

  const advance = useCallback(() => {
    const state = statesRef.current[currentIndex];

    // Continue only moves past a settled question; it never skips an open one.
    if (state && isSettled(state)) {
      setAcknowledged((current) => withIndex(current, currentIndex));
    }
  }, [currentIndex]);

  const retryStart = useCallback(() => {
    // Clearing the guard is what lets the start effect run again; the token
    // makes that a state change the effect can actually depend on.
    startedRef.current.delete(currentIndex);
    setRetryToken((token) => token + 1);
  }, [currentIndex]);

  return {
    states,
    currentIndex,
    total,
    isComplete: total > 0 && currentIndex >= total,
    scoreMilli: progress.scoreMilli,
    explanation: explanationByIndex[currentIndex],
    select,
    skip,
    advance,
    retryStart,
    hasPending: hasPendingQuestions({ questionCount: total, states })
  };
}

export { isSettled };
