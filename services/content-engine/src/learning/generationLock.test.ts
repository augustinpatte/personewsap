import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES,
  isReclaimableLearningSession,
  readLearningGenerationLockTimeoutMinutes
} from "./generationLock.js";
import { InMemoryLearningRepository } from "./learningTestDoubles.js";
import type { LearningPathRecord } from "./learningTypes.js";

const NOW = Date.parse("2026-08-01T10:00:00.000Z");
const PATH: LearningPathRecord = {
  id: "path-1",
  user_id: "user-1",
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 2,
  target_level: 4,
  language: "en"
};

describe("learning generation lock", () => {
  it("reads the timeout from the environment and falls back to fifteen minutes", () => {
    expect(readLearningGenerationLockTimeoutMinutes({ LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES: "20" })).toBe(20);
    expect(readLearningGenerationLockTimeoutMinutes({})).toBe(DEFAULT_LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES);
    expect(readLearningGenerationLockTimeoutMinutes({ LEARNING_GENERATION_LOCK_TIMEOUT_MINUTES: "nope" })).toBe(15);
  });

  it("leaves a recent lock alone", () => {
    expect(
      isReclaimableLearningSession(
        {
          generation_status: "generating",
          generation_attempts: 1,
          generation_locked_at: new Date(NOW - 5 * 60_000).toISOString()
        },
        { nowMs: NOW }
      )
    ).toBe(false);
  });

  it("allows taking over a lock older than the timeout", () => {
    expect(
      isReclaimableLearningSession(
        {
          generation_status: "generating",
          generation_attempts: 1,
          generation_locked_at: new Date(NOW - 16 * 60_000).toISOString()
        },
        { nowMs: NOW }
      )
    ).toBe(true);
  });

  it("never reclaims a ready session", () => {
    expect(
      isReclaimableLearningSession(
        { generation_status: "ready", generation_attempts: 1, generation_locked_at: null },
        { nowMs: NOW }
      )
    ).toBe(false);
  });

  it("always reclaims a failed session", () => {
    expect(
      isReclaimableLearningSession(
        { generation_status: "failed", generation_attempts: 1, generation_locked_at: null },
        { nowMs: NOW }
      )
    ).toBe(true);
  });
});

describe("concurrent recovery of a stale generating session", () => {
  it("lets exactly one of two simultaneous workers claim the session", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    let clock = NOW;
    repository.now = () => clock;

    const workerA = await repository.insertLearningSessionClaim(claim("drop-a"));
    expect(workerA.claimed).toBe(true);

    // Worker A stops without finishing: the row stays in `generating`.
    const whileLockIsFresh = await repository.insertLearningSessionClaim(claim("drop-b"));
    expect(whileLockIsFresh.claimed).toBe(false);
    expect(repository.sessions[0].generation_attempts).toBe(1);

    clock += 16 * 60_000;
    const [workerB, workerC] = await Promise.all([
      repository.insertLearningSessionClaim(claim("drop-c")),
      repository.insertLearningSessionClaim(claim("drop-d"))
    ]);

    expect([workerB, workerC].filter((result) => result.claimed)).toHaveLength(1);
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0].generation_attempts).toBe(2);
  });

  it("stops reclaiming once the attempt budget is spent", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    repository.maxAttempts = 2;
    let clock = NOW;
    repository.now = () => clock;

    await repository.insertLearningSessionClaim(claim("drop-a"));
    clock += 16 * 60_000;
    const second = await repository.insertLearningSessionClaim(claim("drop-b"));
    clock += 16 * 60_000;
    const third = await repository.insertLearningSessionClaim(claim("drop-c"));

    expect(second.claimed).toBe(true);
    expect(third).toMatchObject({ claimed: false, exhausted: true });
  });
});

function claim(dailyDropId: string) {
  return {
    pathId: PATH.id,
      dailyDropId,
      dropDate: "2026-08-01",
      curriculumStepKey: "computer_science.machine_layers",
      skippedStepKey: null,
      sessionNumber: 1,
      repetitionIndex: 0,
      adaptationMode: "normal" as const,
      language: "en",
      inputHash: "hash-computer-science-machine-layers-session-1"
  };
}
