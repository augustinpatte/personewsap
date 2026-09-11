/**
 * A question, from the moment it becomes visible to the moment it is settled.
 *
 * THE SERVER IS THE CLOCK. `start_question_attempt` returns `started_at`,
 * `deadline_at` and `server_now` from Postgres; everything here works from that
 * deadline and never from a device timestamp. The countdown on screen is a
 * rendering of a deadline the server already decided — moving the phone's clock
 * forward buys nothing, and moving it back rescues nothing.
 *
 * Two rules shape the whole machine, and both are easy to get wrong in a screen:
 *
 *   A QUESTION NEVER STARTS BEFORE IT IS VISIBLE. Prefetching Q2 while the
 *   reader is still answering Q1 would start its 20 seconds off-screen and burn
 *   them. So `start` is only ever called from a visibility transition, and a
 *   question that has not started is `idle` — not expired, however long the app
 *   has been closed.
 *
 *   A QUESTION IS ANSWERED ONCE. Selecting locks the options immediately, and
 *   there is no path from `answered` or `expired` back to `answering`. Reopening
 *   a finished reading from the archive shows the debrief; it cannot be replayed
 *   for points.
 *
 * There is deliberately no speed bonus. The score depends on which option was
 * chosen, never on how fast — so the feedback step is untimed, and a reader can
 * take as long as they like reading why they lost 400 points.
 */

export const QUESTION_SCORE_TIERS = [0, 300, 600, 1000] as const;
export type QuestionScoreTier = (typeof QUESTION_SCORE_TIERS)[number];
export type QuestionGradeBand = "bad" | "average" | "good" | "excellent";

export type QuizOption = {
  optionId: string;
  label: string;
};

/** What `start_question_attempt` hands back. */
export type StartedAttempt = {
  attemptId: string;
  /** ISO instants, all from Postgres. */
  serverNow: string;
  startedAt: string;
  deadlineAt: string;
  timeLimitSeconds: number;
  alreadySubmitted: boolean;
  prompt: string;
  options: QuizOption[];
  /**
   * The result the server already holds, present only when `alreadySubmitted`.
   *
   * Without it a reopened reading could only ever render a fabricated zero: the
   * reducer has always been able to restore a settled question, but nothing
   * gave it the answer to restore. The server now returns what was chosen and
   * what it scored on the same call, so the archive, a second device and the
   * app reopened after a kill all show the debrief the reader actually earned.
   */
  settled?: SubmittedAnswer;
};

/** What `submit_question_answer` hands back. */
export type SubmittedAnswer = {
  attemptId: string;
  scoreMilli: QuestionScoreTier;
  gradeBand: QuestionGradeBand;
  expired: boolean;
  skipped: boolean;
  selectedOptionId: string | null;
};

export type QuestionState =
  /** Not started. Not expired — a question nobody opened has no deadline. */
  | { status: "idle" }
  | { status: "starting" }
  /** The RPC failed. Team questions need the network; a local timer would be a lie. */
  | { status: "start_failed"; message: string }
  | {
      status: "answering";
      attemptId: string;
      deadlineAt: string;
      prompt: string;
      options: QuizOption[];
    }
  /** Locked the instant an option is tapped, before the network round-trip. */
  | {
      status: "submitting";
      attemptId: string;
      deadlineAt: string;
      prompt: string;
      options: QuizOption[];
      selectedOptionId: string | null;
    }
  | {
      status: "answered";
      attemptId: string;
      prompt: string;
      options: QuizOption[];
      selectedOptionId: string | null;
      scoreMilli: QuestionScoreTier;
      gradeBand: QuestionGradeBand;
      expired: boolean;
      skipped: boolean;
    }
  /** The deadline passed with nothing submitted. Worth zero, and final. */
  | { status: "expired"; attemptId: string; prompt: string; options: QuizOption[] };

export type QuestionAction =
  | { type: "start_requested" }
  | { type: "start_succeeded"; attempt: StartedAttempt; answered?: SubmittedAnswer }
  | { type: "start_failed"; message: string }
  | { type: "option_selected"; optionId: string }
  | { type: "skip_requested" }
  | { type: "submit_succeeded"; result: SubmittedAnswer }
  | { type: "submit_failed"; message: string }
  /** The clock moved. `now` is compared against the SERVER deadline. */
  | { type: "tick"; now: number };

export function initialQuestionState(): QuestionState {
  return { status: "idle" };
}

export function isSettled(state: QuestionState): boolean {
  return state.status === "answered" || state.status === "expired";
}

/** Can the reader still act on this question? */
export function isInteractive(state: QuestionState): boolean {
  return state.status === "answering";
}

export function deadlineOf(state: QuestionState): string | null {
  return state.status === "answering" || state.status === "submitting"
    ? state.deadlineAt
    : null;
}

/**
 * Seconds left, for the countdown.
 *
 * Clamped at zero and never negative, and returns null when there is no
 * deadline — an idle question shows no timer at all rather than "20".
 */
export function remainingSeconds(state: QuestionState, now: number): number | null {
  const deadline = deadlineOf(state);

  if (!deadline) {
    return null;
  }

  const remaining = (Date.parse(deadline) - now) / 1000;
  return Number.isFinite(remaining) ? Math.max(0, remaining) : null;
}

export function hasDeadlinePassed(state: QuestionState, now: number): boolean {
  const deadline = deadlineOf(state);
  return deadline ? now > Date.parse(deadline) : false;
}

export function questionReducer(state: QuestionState, action: QuestionAction): QuestionState {
  switch (action.type) {
    case "start_requested":
      // Only from idle or a failed start. Never from answering — a re-entry into
      // the screen must not restart a running question, and never from a settled
      // one, which is the no-replay rule.
      return state.status === "idle" || state.status === "start_failed"
        ? { status: "starting" }
        : state;

    case "start_succeeded": {
      const { attempt, answered } = action;

      // Resuming a question the server already has an answer for: the archive
      // path, and the "closed the app after answering" path. Same outcome.
      if (attempt.alreadySubmitted) {
        return answered
          ? toAnswered(attempt, answered)
          : {
              status: "answered",
              attemptId: attempt.attemptId,
              prompt: attempt.prompt,
              options: attempt.options,
              selectedOptionId: null,
              scoreMilli: 0,
              gradeBand: "bad",
              expired: false,
              skipped: false
            };
      }

      // Resuming an unanswered attempt whose deadline has already passed —
      // the app was closed mid-question. Zero, decided by the server clock the
      // attempt carries, not by the device's.
      if (Date.parse(attempt.serverNow) > Date.parse(attempt.deadlineAt)) {
        return {
          status: "expired",
          attemptId: attempt.attemptId,
          prompt: attempt.prompt,
          options: attempt.options
        };
      }

      return {
        status: "answering",
        attemptId: attempt.attemptId,
        deadlineAt: attempt.deadlineAt,
        prompt: attempt.prompt,
        options: attempt.options
      };
    }

    case "start_failed":
      return state.status === "starting"
        ? { status: "start_failed", message: action.message }
        : state;

    case "option_selected":
      // Locked here, synchronously, before any network call. The reader cannot
      // change their mind while the request is in flight.
      return state.status === "answering"
        ? { ...state, status: "submitting", selectedOptionId: action.optionId }
        : state;

    case "skip_requested":
      // A skip is an explicit submit worth zero, not an abandonment — so it goes
      // through the same submitting state and the same RPC.
      return state.status === "answering"
        ? { ...state, status: "submitting", selectedOptionId: null }
        : state;

    case "submit_succeeded":
      return state.status === "submitting"
        ? {
            status: "answered",
            attemptId: state.attemptId,
            prompt: state.prompt,
            options: state.options,
            selectedOptionId: action.result.selectedOptionId,
            scoreMilli: action.result.scoreMilli,
            gradeBand: action.result.gradeBand,
            expired: action.result.expired,
            skipped: action.result.skipped
          }
        : state;

    case "submit_failed":
      // Back to submitting-with-no-selection is wrong and back to answering is
      // wrong too: the reader has committed. The caller retries while the
      // deadline holds; if it passes, `tick` settles this at zero.
      return state;

    case "tick": {
      if (state.status !== "answering" && state.status !== "submitting") {
        return state;
      }

      if (!hasDeadlinePassed(state, action.now)) {
        return state;
      }

      // The deadline passed. For `answering` that is a timeout; for `submitting`
      // it means the answer never reached the server in time, and the product
      // rule is explicit that this scores zero. Nothing is faked to rescue it.
      return {
        status: "expired",
        attemptId: state.attemptId,
        prompt: state.prompt,
        options: state.options
      };
    }

    default:
      return state;
  }
}

function toAnswered(attempt: StartedAttempt, answered: SubmittedAnswer): QuestionState {
  return {
    status: "answered",
    attemptId: attempt.attemptId,
    prompt: attempt.prompt,
    options: attempt.options,
    selectedOptionId: answered.selectedOptionId,
    scoreMilli: answered.scoreMilli,
    gradeBand: answered.gradeBand,
    expired: answered.expired,
    skipped: answered.skipped
  };
}

/* ------------------------------------------------------------------------- */
/* The set of questions attached to one reading                              */
/* ------------------------------------------------------------------------- */

export type QuizProgress = {
  /** 1-based index of the question in front of the reader. */
  currentIndex: number;
  total: number;
  /** How many are settled, answered or expired alike. */
  settled: number;
  /** Every question settled — the reading is finished. */
  isComplete: boolean;
  /** Total earned, in milli-points. */
  scoreMilli: number;
};

export function summarizeQuiz(states: QuestionState[]): QuizProgress {
  const settled = states.filter(isSettled).length;
  const scoreMilli = states.reduce(
    (total, state) => total + (state.status === "answered" ? state.scoreMilli : 0),
    0
  );

  // The first unsettled question is the one on screen. Nothing after it has
  // started, which is exactly the property that keeps Q2's clock stopped while
  // Q1 is being answered.
  const nextIndex = states.findIndex((state) => !isSettled(state));

  return {
    currentIndex: nextIndex === -1 ? states.length : nextIndex,
    total: states.length,
    settled,
    isComplete: states.length > 0 && settled === states.length,
    scoreMilli
  };
}

/**
 * The question on screen.
 *
 * The first question that is either still open, or settled but not yet
 * continued past. The second half is what keeps an outcome and its explanation
 * on screen until the reader taps Continue — without it the next question
 * replaced the feedback the instant the answer came back, and started its own
 * clock while the reader was still reading why they lost points.
 */
export function resolveDisplayedIndex(
  states: QuestionState[],
  acknowledged: ReadonlySet<number>
): number {
  const index = states.findIndex((state, position) => !isSettled(state) || !acknowledged.has(position));
  return index === -1 ? states.length : index;
}

/**
 * Does this reading still owe the reader something?
 *
 * What "Continue challenge" is computed from: the article is read, but at least
 * one of its questions has never been settled. A reading with no questions at
 * all is never pending — legacy content must not grow a challenge it does not
 * have.
 */
export function hasPendingQuestions(input: {
  questionCount: number;
  states: QuestionState[];
}): boolean {
  if (input.questionCount === 0) {
    return false;
  }

  const settled = input.states.filter(isSettled).length;
  return settled < input.questionCount;
}

/** Points as the reader sees them: 0 / 0.3 / 0.6 / 1. */
export function formatPoints(scoreMilli: number): string {
  const points = scoreMilli / 1000;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}
