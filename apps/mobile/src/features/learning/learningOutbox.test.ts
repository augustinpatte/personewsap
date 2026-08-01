import { describe, expect, it } from "vitest";

import {
  LEARNING_OUTBOX_KEY_V1,
  getLearningOutboxKey,
  parseLearningOutbox,
  readLearningOutbox,
  removeLearningOutboxEvent,
  upsertLearningOutboxEvent,
  writeLearningOutbox,
  type LearningOutboxStorage
} from "./learningOutbox";

describe("learning outbox", () => {
  it("migrates legacy started events into the user-scoped v2 key", async () => {
    const storage = memoryStorage({
      [LEARNING_OUTBOX_KEY_V1]: JSON.stringify([
        {
          sessionId: "session-1",
          eventType: "started",
          createdAt: "2026-08-01T09:00:00Z",
          attemptCount: 0,
          lastAttemptAt: null
        }
      ])
    });

    const events = await readLearningOutbox(storage, "user-1");

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("started");
    expect(await storage.getItem(LEARNING_OUTBOX_KEY_V1)).toBeNull();
    expect(await storage.getItem(getLearningOutboxKey("user-1"))).toContain("session-1");
  });

  it("orders started before feedback for the same session", async () => {
    const storage = memoryStorage();
    await writeLearningOutbox(storage, "user-1", [
      feedbackEvent("session-1", "2026-08-01T09:01:00Z"),
      startedEvent("session-1", "2026-08-01T09:00:00Z")
    ]);

    const events = await readLearningOutbox(storage, "user-1");

    expect(events.map((event) => event.eventType)).toEqual(["started", "feedback"]);
  });

  it("dedupes feedback and keeps the latest local ratings", () => {
    const events = upsertLearningOutboxEvent(
      [feedbackEvent("session-1", "2026-08-01T09:01:00Z", { comprehension: 1 })],
      feedbackEvent("session-1", "2026-08-01T09:02:00Z", { comprehension: 5 })
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("feedback");
    expect(events[0]?.eventType === "feedback" ? events[0].ratings.comprehension : null).toBe(5);
  });

  it("removes only the synced event type when requested", () => {
    const remaining = removeLearningOutboxEvent(
      [startedEvent("session-1", "2026-08-01T09:00:00Z"), feedbackEvent("session-1", "2026-08-01T09:01:00Z")],
      "session-1",
      "started"
    );

    expect(remaining.map((event) => event.eventType)).toEqual(["feedback"]);
  });

  it("drops corrupted records rather than replaying unsafe events", () => {
    expect(parseLearningOutbox("{not-json")).toEqual([]);
    expect(parseLearningOutbox(JSON.stringify([{ sessionId: "x", eventType: "feedback" }]))).toEqual([]);
  });
});

function startedEvent(sessionId: string, createdAt: string) {
  return {
    sessionId,
    eventType: "started" as const,
    createdAt,
    attemptCount: 0,
    lastAttemptAt: null
  };
}

function feedbackEvent(
  sessionId: string,
  createdAt: string,
  patch: Partial<{ comprehension: number; explainability: number; interest: number; difficulty: number }> = {}
) {
  return {
    sessionId,
    eventType: "feedback" as const,
    ratings: {
      comprehension: patch.comprehension ?? 4,
      explainability: patch.explainability ?? 4,
      interest: patch.interest ?? 4,
      difficulty: patch.difficulty ?? 3
    },
    createdAt,
    attemptCount: 0,
    lastAttemptAt: null
  };
}

function memoryStorage(initial: Record<string, string> = {}): LearningOutboxStorage {
  const values = new Map(Object.entries(initial));

  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    }
  };
}
