import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { trackAnalyticsEvent } from "../../lib/analytics";
import type { AnalyticsContentType } from "../../lib/analytics";
import {
  fetchQuestionFeedback,
  startQuestionAttempt,
  submitAnswerWithRetry
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

      dispatch({
        index: currentIndex,
        action: { type: "start_succeeded", attempt: result.data }
      });

      if (!result.data.alreadySubmitted) {
        trackAnalyticsEvent("quiz_started", {
          content_type: input.contentType,
          is_team: input.isTeam,
          question_index: currentIndex + 1,
          question_count: total
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentIndex, currentQuestion, input.active, input.contentType, input.isTeam, retryToken, states, total]);

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

  // A question that just expired is reported once, from the transition rather
  // than from a render, so a re-render cannot log it twice.
  const expiredReportedRef = useRef(new Set<number>());

  useEffect(() => {
    states.forEach((state, index) => {
      if (state.status === "expired" && !expiredReportedRef.current.has(index)) {
        expiredReportedRef.current.add(index);
        trackAnalyticsEvent("quiz_timed_out", {
          content_type: input.contentType,
          is_team: input.isTeam,
          question_index: index + 1,
          question_count: total
        });
      }
    });
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
      const question = input.questions[index];

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
      const feedback = await fetchQuestionFeedback(question.logicalQuestionId);

      if (feedback.ok) {
        const chosen = feedback.data.find((entry) => entry.isSelected);
        setFeedbackByIndex((current) => ({ ...current, [index]: chosen?.feedback ?? null }));
      }
    },
    [input.contentType, input.isTeam, input.questions, states, total]
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
