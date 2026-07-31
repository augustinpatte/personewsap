export const LEARNING_SESSION_STATUSES = ["available", "opened", "started", "completed"] as const;

export const LEARNING_ADAPTATION_MODES = [
  "normal",
  "reinforce",
  "accelerate",
  "context_shift",
  "prerequisite"
] as const;

export type LearningSessionStatus = (typeof LEARNING_SESSION_STATUSES)[number];
export type LearningAdaptationMode = (typeof LEARNING_ADAPTATION_MODES)[number];

export type LearningSessionLifecycleRecord = {
  id: string;
  sequenceNumber: number;
  status: LearningSessionStatus;
  openedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type LearningSessionFeedbackRatings = {
  comprehensionRating: number;
  explainabilityRating: number;
  interestRating: number;
  difficultyRating: number;
};

export type LearningSchedulerDecision =
  | {
      action: "skip";
      reason: "no_path" | "blocked_by_available_session" | "blocked_by_opened_session";
      nextSequenceNumber: null;
      adaptationMode: null;
    }
  | {
      action: "create";
      reason: "no_previous_session" | "last_session_started" | "last_session_completed";
      nextSequenceNumber: number;
      adaptationMode: LearningAdaptationMode;
    };

export type LearningSchedulerInput = {
  activePathId: string | null;
  sessions: LearningSessionLifecycleRecord[];
  feedbackBySessionId?: ReadonlyMap<string, LearningSessionFeedbackRatings>;
};

export function markLearningSessionOpened(
  session: LearningSessionLifecycleRecord,
  nowIso: string
): LearningSessionLifecycleRecord {
  if (session.status !== "available") {
    return session;
  }

  return {
    ...session,
    openedAt: session.openedAt ?? nowIso,
    status: "opened"
  };
}

export function markLearningSessionStarted(
  session: LearningSessionLifecycleRecord,
  nowIso: string
): LearningSessionLifecycleRecord {
  if (session.status === "completed") {
    return session;
  }

  return {
    ...session,
    openedAt: session.openedAt ?? nowIso,
    startedAt: session.startedAt ?? nowIso,
    status: "started"
  };
}

export function markLearningSessionCompleted(
  session: LearningSessionLifecycleRecord,
  nowIso: string
): LearningSessionLifecycleRecord {
  return {
    ...session,
    completedAt: session.completedAt ?? nowIso,
    openedAt: session.openedAt ?? nowIso,
    startedAt: session.startedAt ?? nowIso,
    status: "completed"
  };
}

export function planNextLearningSession(input: LearningSchedulerInput): LearningSchedulerDecision {
  if (!input.activePathId) {
    return {
      action: "skip",
      adaptationMode: null,
      nextSequenceNumber: null,
      reason: "no_path"
    };
  }

  const orderedSessions = [...input.sessions].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber
  );
  const latestSession = orderedSessions[orderedSessions.length - 1] ?? null;

  if (!latestSession) {
    return {
      action: "create",
      adaptationMode: "normal",
      nextSequenceNumber: 1,
      reason: "no_previous_session"
    };
  }

  if (latestSession.status === "available") {
    return {
      action: "skip",
      adaptationMode: null,
      nextSequenceNumber: null,
      reason: "blocked_by_available_session"
    };
  }

  if (latestSession.status === "opened") {
    return {
      action: "skip",
      adaptationMode: null,
      nextSequenceNumber: null,
      reason: "blocked_by_opened_session"
    };
  }

  return {
    action: "create",
    adaptationMode: resolveLearningAdaptationMode(
      input.feedbackBySessionId?.get(latestSession.id) ?? null
    ),
    nextSequenceNumber: latestSession.sequenceNumber + 1,
    reason: latestSession.status === "completed" ? "last_session_completed" : "last_session_started"
  };
}

export function resolveLearningAdaptationMode(
  feedback: LearningSessionFeedbackRatings | null | undefined
): LearningAdaptationMode {
  if (!feedback) {
    return "normal";
  }

  if (feedback.comprehensionRating <= 2 || feedback.explainabilityRating <= 2) {
    return "prerequisite";
  }

  if (feedback.difficultyRating >= 4) {
    return "reinforce";
  }

  if (
    feedback.comprehensionRating >= 4 &&
    feedback.explainabilityRating >= 4 &&
    feedback.difficultyRating <= 2
  ) {
    return "accelerate";
  }

  if (feedback.interestRating <= 2) {
    return "context_shift";
  }

  return "reinforce";
}
