import { describe, expect, it } from "vitest";

import {
  markLearningSessionOpened,
  markLearningSessionStarted,
  planNextLearningSession,
  resolveLearningAdaptationMode,
  type LearningSessionLifecycleRecord
} from "./sessionLifecycle.js";

const NOW = "2026-07-31T14:00:00.000Z";

describe("learning session scheduler lifecycle", () => {
  it("does not create a new session when the latest session is available", () => {
    expect(decisionWithLatestStatus("available")).toMatchObject({
      action: "skip",
      reason: "blocked_by_available_session"
    });
  });

  it("does not create a new session when the latest session is opened", () => {
    expect(decisionWithLatestStatus("opened")).toMatchObject({
      action: "skip",
      reason: "blocked_by_opened_session"
    });
  });

  it("creates the next session when the latest session is started", () => {
    expect(decisionWithLatestStatus("started")).toEqual({
      action: "create",
      adaptationMode: "normal",
      nextSequenceNumber: 2,
      reason: "last_session_started"
    });
  });

  it("creates the next session when the latest session is completed", () => {
    expect(decisionWithLatestStatus("completed")).toEqual({
      action: "create",
      adaptationMode: "normal",
      nextSequenceNumber: 2,
      reason: "last_session_completed"
    });
  });

  it("uses normal adaptation when feedback is absent", () => {
    expect(resolveLearningAdaptationMode(null)).toBe("normal");
  });

  it("applies adaptation when feedback is present", () => {
    expect(
      resolveLearningAdaptationMode({
        comprehensionRating: 2,
        difficultyRating: 3,
        explainabilityRating: 4,
        interestRating: 4
      })
    ).toBe("reinforce");
  });

  it("uses prerequisite after a weak reinforced session", () => {
    expect(
      resolveLearningAdaptationMode(
        {
          comprehensionRating: 2,
          difficultyRating: 5,
          explainabilityRating: 2,
          interestRating: 4
        },
        true
      )
    ).toBe("prerequisite");
  });

  it("keeps normal feedback on normal adaptation", () => {
    expect(
      resolveLearningAdaptationMode({
        comprehensionRating: 3,
        difficultyRating: 3,
        explainabilityRating: 3,
        interestRating: 3
      })
    ).toBe("normal");
  });

  it("records opened_at exactly once", () => {
    const opened = markLearningSessionOpened(session("available"), NOW);
    const reopened = markLearningSessionOpened(opened, "2026-07-31T15:00:00.000Z");

    expect(opened.status).toBe("opened");
    expect(opened.openedAt).toBe(NOW);
    expect(reopened.openedAt).toBe(NOW);
  });

  it("records started_at exactly once", () => {
    const started = markLearningSessionStarted(session("opened", { openedAt: NOW }), NOW);
    const restarted = markLearningSessionStarted(started, "2026-07-31T15:00:00.000Z");

    expect(started.status).toBe("started");
    expect(started.startedAt).toBe(NOW);
    expect(restarted.startedAt).toBe(NOW);
  });

  it("prevents two simultaneously unstarted sessions", () => {
    expect(
      planNextLearningSession({
        activePathId: "path-1",
        sessions: [session("started", { id: "session-1" }), session("available", { id: "session-2", sequenceNumber: 2 })]
      })
    ).toMatchObject({
      action: "skip",
      reason: "blocked_by_available_session"
    });
  });

  it("is idempotent for repeated scheduler calls with the same state", () => {
    const input = {
      activePathId: "path-1",
      sessions: [session("started")]
    };

    expect(planNextLearningSession(input)).toEqual(planNextLearningSession(input));
  });
});

describe("adaptation decision rules", () => {
  const weakFeedback = {
    comprehensionRating: 2,
    difficultyRating: 5,
    explainabilityRating: 2,
    interestRating: 4
  };

  it("reinforces the concept the first time the feedback is weak", () => {
    expect(decisionAfter("normal", weakFeedback)).toMatchObject({ adaptationMode: "reinforce" });
  });

  it("only moves to a prerequisite when a reinforced session stayed weak", () => {
    expect(decisionAfter("reinforce", weakFeedback)).toMatchObject({ adaptationMode: "prerequisite" });
  });

  it("does not use a prerequisite just because older completed sessions exist", () => {
    expect(
      planNextLearningSession({
        activePathId: "path-1",
        sessions: [
          session("completed", { id: "session-1", adaptationMode: "normal" }),
          session("completed", { id: "session-2", sequenceNumber: 2, adaptationMode: "normal" })
        ],
        feedbackBySessionId: new Map([["session-2", weakFeedback]])
      })
    ).toMatchObject({ adaptationMode: "reinforce" });
  });

  it("accelerates on strong and easy feedback", () => {
    expect(
      decisionAfter("normal", {
        comprehensionRating: 5,
        difficultyRating: 2,
        explainabilityRating: 4,
        interestRating: 3
      })
    ).toMatchObject({ adaptationMode: "accelerate" });
  });

  it("shifts the context when only interest is low", () => {
    expect(
      decisionAfter("normal", {
        comprehensionRating: 4,
        difficultyRating: 3,
        explainabilityRating: 3,
        interestRating: 1
      })
    ).toMatchObject({ adaptationMode: "context_shift" });
  });

  function decisionAfter(
    adaptationMode: "normal" | "reinforce",
    ratings: {
      comprehensionRating: number;
      difficultyRating: number;
      explainabilityRating: number;
      interestRating: number;
    }
  ) {
    return planNextLearningSession({
      activePathId: "path-1",
      sessions: [session("completed", { id: "session-1", adaptationMode })],
      feedbackBySessionId: new Map([["session-1", ratings]])
    });
  }
});

function decisionWithLatestStatus(status: LearningSessionLifecycleRecord["status"]) {
  return planNextLearningSession({
    activePathId: "path-1",
    sessions: [session(status)]
  });
}

function session(
  status: LearningSessionLifecycleRecord["status"],
  overrides: Partial<LearningSessionLifecycleRecord> = {}
): LearningSessionLifecycleRecord {
  return {
    completedAt: status === "completed" ? NOW : null,
    id: "session-1",
    openedAt: null,
    sequenceNumber: 1,
    startedAt: status === "started" || status === "completed" ? NOW : null,
    status,
    ...overrides
  };
}
