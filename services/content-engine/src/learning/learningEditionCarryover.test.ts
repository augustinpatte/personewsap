import { describe, expect, it } from "vitest";

import { generateLearningSessionForUser } from "./learningSessionOrchestrator.js";
import { CountingLearningPromptProvider, fakeLearningPromptResponse, InMemoryLearningRepository } from "./learningTestDoubles.js";
import type { LearningPathRecord } from "./learningTypes.js";

const PATH: LearningPathRecord = {
  id: "path-1",
  user_id: "user-1",
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 1,
  target_level: 3,
  language: "en"
};

describe("learning edition carryover", () => {
  it("reattaches an available session to the new daily drop without generation", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    await generate(repository, "drop-1");

    const provider = providerForFailureDetection();
    const result = await generate(repository, "drop-2", provider);

    expect(result).toMatchObject({
      status: "blocked",
      reason: "blocked_by_available_session",
      sessionId: "session-1",
      learning_sessions_carried_forward: 1,
      learning_api_calls: 0
    });
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0].daily_drop_id).toBe("drop-2");
    expect(repository.sessions[0].available_on).toBe("2026-08-02");
    expect(provider.httpRequests).toBe(0);
  });

  it("reattaches an opened session to the new daily drop without generation", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    await generate(repository, "drop-1");
    repository.sessions[0].status = "opened";
    repository.sessions[0].opened_at = "2026-08-02T08:00:00.000Z";

    const provider = providerForFailureDetection();
    const result = await generate(repository, "drop-2", provider);

    expect(result.reason).toBe("blocked_by_opened_session");
    expect(result.learning_sessions_carried_forward).toBe(1);
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0].daily_drop_id).toBe("drop-2");
    expect(provider.httpRequests).toBe(0);
  });
});

function providerForFailureDetection() {
  return new CountingLearningPromptProvider({
    disableFallback: true,
    buildPrompt: fakeLearningPromptResponse
  });
}

function generate(
  repository: InMemoryLearningRepository,
  dailyDropId: string,
  provider: CountingLearningPromptProvider | "deterministic" = "deterministic"
) {
  return generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId,
    dropDate: "2026-08-02",
    providerResolution: { status: "ready", provider }
  });
}
