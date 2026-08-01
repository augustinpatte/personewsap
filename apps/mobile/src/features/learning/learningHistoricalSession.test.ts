import { describe, expect, it, vi } from "vitest";

import {
  loadHistoricalLearningSession,
  selectHistoricalLearningSession
} from "./learningHistoricalSession";
import type { LearningSession } from "./learningTypes";

describe("historical learning session", () => {
  it("selects a session belonging to the requested path", () => {
    const result = selectHistoricalLearningSession({
      pathId: "path-1",
      sessionId: "session-1",
      sessions: [session("session-1", "path-1")]
    });

    expect(result.status).toBe("found");
  });

  it("rejects a session from another path", () => {
    const result = selectHistoricalLearningSession({
      pathId: "path-1",
      sessionId: "session-1",
      sessions: [session("session-1", "path-2")]
    });

    expect(result.status).toBe("not_found");
  });

  it("returns not_found for an unknown session", () => {
    const result = selectHistoricalLearningSession({
      pathId: "path-1",
      sessionId: "missing-session",
      sessions: [session("session-1", "path-1")]
    });

    expect(result.status).toBe("not_found");
  });

  it("loads sessions without calling lifecycle functions", async () => {
    const openSession = vi.fn();
    const startSession = vi.fn();
    const submitFeedback = vi.fn();

    await loadHistoricalLearningSession({
      pathId: "path-1",
      sessionId: "session-1",
      loadSessionsForPath: async () => [session("session-1", "path-1")]
    });

    expect(openSession).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(submitFeedback).not.toHaveBeenCalled();
  });
});

function session(id: string, pathId: string): LearningSession {
  return {
    id,
    path_id: pathId,
    daily_drop_id: null,
    curriculum_step_key: null,
    session_number: 1,
    adaptation_mode: "normal",
    title_fr: "Titre",
    title_en: "Title",
    summary_fr: "Résumé",
    summary_en: "Summary",
    objectives_fr: ["Objectif"],
    objectives_en: ["Objective"],
    prompt_text: "Prompt",
    generation_status: "ready",
    status: "completed",
    available_on: "2026-08-01",
    opened_at: null,
    started_at: "2026-08-01T09:00:00Z",
    completed_at: "2026-08-01T09:05:00Z",
    created_at: "2026-08-01T09:00:00Z"
  };
}
