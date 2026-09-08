import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { trackAnalyticsEvent } from "../../lib/analytics";
import type { AnalyticsContentType } from "../../lib/analytics";
import {
  fetchQuestionFeedback,
  startQuestionAttempt,
  submitAnswerWithRetry,
  submitQuestionAnswer
} from "./quizData";
import {
  hasPendingQuestions,
  initialQuestionState,
  isSettled,
  questionReducer,
  summarizeQuiz,
  type QuestionAction,
  type QuestionState
} from "./quizSession";

/**
 * The quiz, wired to the server.
 *
 * The rules live in `quizSession.ts` as a pure reducer; this is the part that
 * cannot be pure — the RPCs, the clock that drives expiry, and the analytics.
 *
 * TWO THINGS THIS HOOK EXISTS TO GUARANTEE:
 *
 *   A question starts only when it is the one on screen. `summarizeQuiz` points
 *   at the first unsettled question, and the start effect fires for that index
 *   and no other. Prefetching Q2 while Q1 is being answered would start its
 *   twenty seconds off-screen and burn them, which is the single easiest way to
 *   make this feature feel broken.
 *
 *   Expiry is decided against the SERVER deadline. The interval below does not
 *   count anything down; it only asks the reducer to compare `Date.now()` with
 *   the deadline the server set. An app suspended past the deadline settles at
 *   zero on its first tick after resuming, which is the correct outcome and the
 *   same one the server would report.
 */

const EXPIRY_TICK_MS = 500;

export type QuizQuestionRef = {
  /** The logical question id — shared by the FR and EN renderings. */
  logicalQuestionId: string;
};

export type QuizFlowState = {
  states: QuestionState[];
  currentIndex: number;
  total: number;
  isComplete: boolean;
  scoreMilli: number;
  /** Feedback for the current question, released only after submitting. */
  feedback: string | null;
  select: (optionId: string) => void;
  skip: () => void;
  advance: () => void;
  retryStart: () => void;
  /** True while at least one question is unsettled. */
  hasPending: boolean;
};

type FlowAction = { index: number; action: QuestionAction };

function flowReducer(states: QuestionState[], { index, action }: FlowAction): QuestionState[] {
  const next = questionReducer(states[index], action);

  if (next === states[index]) {
    return states;
  }

  const updated = [...states];
  updated[index] = next;
  return updated;
}

export function useQuizFlow(input: {
  questions: QuizQuestionRef[];
  /** False while the reader is still on the article — nothing starts before then. */
  active: boolean;
  contentType: AnalyticsContentType;
  isTeam: boolean;
  onCompleted?: (scoreMilli: number) => void;
}): QuizFlowState {
  const total = input.questions.length;

  const [states, dispatch] = useReducer(
    flowReducer,
    total,
    (count) => Array.from({ length: count }, initialQuestionState)
  );
  const [feedbackByIndex, setFeedbackByIndex] = useState<Record<number, string | null>>({});
  const startedRef = useRef(new Set<number>());
  const completedRef = useRef(false);
  // Bumped by retryStart so the start effect runs again after a failure.
  const [retryToken, setRetryToken] = useState(0);

  const progress = useMemo(() => summarizeQuiz(states), [states]);
  const currentIndex = progress.currentIndex;
  const currentQuestion = input.questions[currentIndex];

  const loadFeedback = useCallback(
    async (index: number) => {
      const question = input.questions[index];

      if (!question) {
        return;
      }

      const feedback = await fetchQuestionFeedback(question.logicalQuestionId);

      if (feedback.ok) {
        const chosen = feedback.data.find((entry) => entry.isSelected);
        setFeedbackByIndex((current) => ({ ...current, [index]: chosen?.feedback ?? null }));
      }
    },
    [input.questions]
  );

  // Start the question in front of the reader, and only that one.
  useEffect(() => {
    if (!input.active || !currentQuestion || startedRef.current.has(currentIndex)) {
      return;
    }

    const state = states[currentIndex];

    // Startable from idle, and from a failed start once the reader taps Retry.
    if (state.status !== "idle" && state.status !== "start_failed") {
      return;
    }

    startedRef.current.add(currentIndex);
    let cancelled = false;

    dispatch({ index: currentIndex, action: { type: "start_requested" } });

    void (async () => {
      const result = await startQuestionAttempt(currentQuestion.logicalQuestionId);

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        // No local fallback timer. A Team question needs the network, and a
        // locally-timed one would be unwinnable: no attempt exists server-side.
        startedRef.current.delete(currentIndex);
        dispatch({
          index: currentIndex,
          action: { type: "start_failed", message: result.error.message }
        });
        return;
      }

      // RESUMING A SETTLED QUESTION RESTORES ITS RESULT.
      //
      // `settled` is what the server already holds for an attempt this reader
      // submitted. Passing it through is the whole difference between a
      // reopened reading showing the debrief the reader earned and showing an
      // empty card worth zero — the reducer has always accepted the answer, and
      // for a long time nothing handed it one.
      dispatch({
        index: currentIndex,
        action: {
          type: "start_succeeded",
          attempt: result.data,
          answered: result.data.settled
        }
      });

      if (result.data.alreadySubmitted) {
        // The explanation too: it is part of the debrief, and
        // `get_question_feedback` opens for exactly the attempts that reach
        // here — the submitted ones.
        void loadFeedback(currentIndex);
        return;
      }

      trackAnalyticsEvent("quiz_started", {
        content_type: input.contentType,
        is_team: input.isTeam,
        question_index: currentIndex + 1,
        question_count: total
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [currentIndex, currentQuestion, input.active, input.contentType, input.isTeam, loadFeedback, retryToken, states, total]);

  // The expiry clock. It counts nothing — it asks the reducer to compare now()
  // against the server's deadline, which is the only authority here.
  useEffect(() => {
    const state = states[currentIndex];

    if (!state || (state.status !== "answering" && state.status !== "submitting")) {
      return;
    }

    const interval = setInterval(() => {
      dispatch({ index: currentIndex, action: { type: "tick", now: Date.now() } });
    }, EXPIRY_TICK_MS);

    return () => clearInterval(interval);
  }, [currentIndex, states]);

  const settleExpiredAttempt = useCallback(
    async (index: number, attemptId: string) => {
      if (!attemptId) {
        return;
      }

      const result = await submitQuestionAnswer({ attemptId, selectedOptionId: null });

      // A 23505 here means another device already settled it. Both outcomes are
      // the same zero, so there is nothing to reconcile.
      if (result.ok) {
        await loadFeedback(index);
      }
    },
    [loadFeedback]
  );

  // A question that just expired is reported — and SETTLED — once, from the
  // transition rather than from a render, so a re-render cannot do it twice.
  const expiredReportedRef = useRef(new Set<number>());

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

      // AN EXPIRED ATTEMPT IS STILL SUBMITTED, with no option.
      //
      // Not to rescue it — the server compares against the deadline it set and
      // returns zero, which is the whole point. It is submitted because an
      // attempt left `in_progress` forever is a hole in the reader's own
      // record: the team ledger never counts the question as answered, so the
      // edition never completes and the streak never settles. And because
      // `get_question_feedback` only opens once an attempt is submitted, an
      // unsettled timeout is also the one case where the screen says "the
      // explanation is below" and no explanation ever arrives.
      //
      // No retry loop: the deadline has already passed, so there is nothing a
      // second attempt could win. A failure leaves the reader on the same
      // honest zero.
      void settleExpiredAttempt(index, state.attemptId);
    });
    // `settleExpiredAttempt` is stable for the life of the flow; depending on it
    // would re-run this on every state change and re-report a settled timeout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.contentType, input.isTeam, states, total]);

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
      const state = states[index];

      if (state.status !== "answering") {
        return;
      }

      const deadlineAt = state.deadlineAt;
      const attemptId = state.attemptId;

      dispatch({
        index,
        action: optionId
          ? { type: "option_selected", optionId }
          : { type: "skip_requested" }
      });

      const result = await submitAnswerWithRetry({
        attemptId,
        selectedOptionId: optionId,
        deadlineAt
      });

      if (!result.ok) {
        // Stays committed. The reducer settles it at zero on the next tick if
        // the deadline passes — nothing is back-dated to rescue it.
        dispatch({ index, action: { type: "submit_failed", message: result.error.message } });
        return;
      }

      dispatch({ index, action: { type: "submit_succeeded", result: result.data } });

      trackAnalyticsEvent(optionId ? "quiz_answered" : "quiz_skipped", {
        content_type: input.contentType,
        is_team: input.isTeam,
        question_index: index + 1,
        question_count: total
      });

      // The explanation is fetched only now: `get_question_feedback` refuses a
      // caller with no submitted attempt, because before submitting it IS the
      // answer key.
      await loadFeedback(index);
    },
    [input.contentType, input.isTeam, loadFeedback, states, total]
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

  // Continue does not advance an index of its own: the current question is
  // whichever is unsettled, so settling one moves the flow forward by itself.
  // This exists so a host can react to the tap (scroll, dismiss, refresh).
  const advance = useCallback(() => undefined, []);

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
    isComplete: progress.isComplete,
    scoreMilli: progress.scoreMilli,
    feedback: feedbackByIndex[currentIndex] ?? null,
    select,
    skip,
    advance,
    retryStart,
    hasPending: hasPendingQuestions({ questionCount: total, states })
  };
}

export { isSettled };
