import { describe, expect, it } from "vitest";

import {
  getHistoricalLearningPaths,
  getLearningSessionsForPath,
  selectLatestLearningSessionForDrop
} from "./learningPathState";
import type { LearningPath, LearningSession } from "./learningTypes";

describe("learning path state", () => {
  it("selects the highest ready session number for the requested drop", () => {
    const selected = selectLatestLearningSessionForDrop(
      [
        session("drop-1", 1, "started"),
        session("drop-1", 2, "available"),
        session("drop-2", 3, "completed")
      ],
      "drop-1"
    );

    expect(selected?.session_number).toBe(2);
  });

  it("ignores failed sessions for a drop", () => {
    const selected = selectLatestLearningSessionForDrop(
      [session("drop-1", 1, "started"), session("drop-1", 3, "failed")],
      "drop-1"
    );

    expect(selected?.session_number).toBe(1);
  });

  it("ignores sessions from other drops", () => {
    expect(selectLatestLearningSessionForDrop([session("drop-2", 3, "completed")], "drop-1")).toBeNull();
  });

  it("keeps a completed session selectable for the current drop", () => {
    const selected = selectLatestLearningSessionForDrop([session("drop-1", 4, "completed")], "drop-1");

    expect(selected?.status).toBe("completed");
  });

  it("keeps active display separate from historical paths and opens old path sessions", () => {
    const active = path("active", "active", "2026-08-01T09:00:00Z");
    const oldA = path("old-a", "completed", "2026-07-31T09:00:00Z");
    const oldB = path("old-b", "archived", "2026-07-30T09:00:00Z");
    const sessions = [
      sessionForPath("active-session", "active"),
      sessionForPath("old-a-session", "old-a"),
      sessionForPath("old-b-session", "old-b")
    ];

    expect(active.id).toBe("active");
    expect(getHistoricalLearningPaths([active, oldA, oldB], active).map((item) => item.id)).toEqual([
      "old-a",
      "old-b"
    ]);
    expect(getLearningSessionsForPath(sessions, "old-b").map((item) => item.id)).toEqual([
      "old-b-session"
    ]);
  });
});

function path(id: string, status: string, updatedAt: string): LearningPath {
  return {
    id,
    user_id: "user-1",
    domain_id: "computer_science",
    objective_id: "cs_systems",
    current_level: 2,
    target_level: 4,
    language: "en",
    status,
    created_at: updatedAt,
    updated_at: updatedAt,
    archived_at: status === "archived" ? updatedAt : null,
    completed_at: status === "completed" ? updatedAt : null
  };
}

function session(
  dropId: string,
  sessionNumber: number,
  status: LearningSession["status"]
): LearningSession {
  return {
    ...sessionForPath(`session-${sessionNumber}`, "path-1"),
    daily_drop_id: dropId,
    session_number: sessionNumber,
    status
  };
}

function sessionForPath(id: string, pathId: string): LearningSession {
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
    objectives_fr: [],
    objectives_en: [],
    prompt_text: "Prompt",
    generation_status: "ready",
    status: "available",
    available_on: "2026-08-01",
    opened_at: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-01T09:00:00Z"
  };
}
