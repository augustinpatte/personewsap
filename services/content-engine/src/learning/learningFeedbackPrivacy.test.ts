import { describe, expect, it } from "vitest";

import { generateLearningSessionForUser } from "./learningSessionOrchestrator.js";
import { CountingLearningPromptProvider, fakeLearningPromptResponse, InMemoryLearningRepository } from "./learningTestDoubles.js";
import type { LearningPathRecord } from "./learningTypes.js";

const USER_UUID = "11111111-1111-4111-8111-111111111111";
const PATH_UUID = "22222222-2222-4222-8222-222222222222";
const DROP_UUID = "33333333-3333-4333-8333-333333333333";
const SESSION_1_UUID = "44444444-4444-4444-8444-444444444444";
const SESSION_2_UUID = "55555555-5555-4555-8555-555555555555";

const PATH: LearningPathRecord = {
  id: PATH_UUID,
  user_id: USER_UUID,
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 1,
  target_level: 4,
  language: "en"
};

describe("learning prompt feedback privacy", () => {
  it("sends only latest ratings and no Supabase identifiers to the provider", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    await generate(repository, "deterministic", "drop-1");
    repository.sessions[0].id = SESSION_1_UUID;
    repository.sessions[0].status = "completed";
    repository.sessions[0].started_at = "2026-08-02T08:00:00.000Z";
    repository.sessions[0].completed_at = "2026-08-02T08:04:00.000Z";
    repository.feedback.push({
      session_id: SESSION_1_UUID,
      comprehension_rating: 1,
      explainability_rating: 1,
      interest_rating: 1,
      difficulty_rating: 5
    });

    await generate(repository, "deterministic", "drop-2");
    repository.sessions[1].id = SESSION_2_UUID;
    repository.sessions[1].status = "started";
    repository.sessions[1].started_at = "2026-08-04T08:00:00.000Z";
    repository.feedback.push({
      session_id: SESSION_2_UUID,
      comprehension_rating: 4,
      explainability_rating: 3,
      interest_rating: 5,
      difficulty_rating: 2
    });

    let capturedPrompt = "";
    const provider = new CountingLearningPromptProvider({
      disableFallback: true,
      buildPrompt: (request) => {
        capturedPrompt = request.userPrompt;
        return fakeLearningPromptResponse(request);
      }
    });

    await generate(repository, provider, DROP_UUID);

    const payload = JSON.parse(capturedPrompt) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(payload.last_feedback).toEqual({
      comprehension_rating: 4,
      explainability_rating: 3,
      interest_rating: 5,
      difficulty_rating: 2
    });
    expect(serialized).not.toContain("session_id");
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("path_id");
    expect(serialized).not.toContain("daily_drop_id");
    expect(serialized).not.toContain(USER_UUID);
    expect(serialized).not.toContain(PATH_UUID);
    expect(serialized).not.toContain(DROP_UUID);
    expect(serialized).not.toContain(SESSION_1_UUID);
    expect(serialized).not.toContain(SESSION_2_UUID);
    expect(serialized).not.toContain('"comprehension_rating":1');
  });
});

async function generate(
  repository: InMemoryLearningRepository,
  provider: Parameters<typeof generateLearningSessionForUser>[0]["providerResolution"]["provider"] | CountingLearningPromptProvider,
  dailyDropId: string
) {
  return generateLearningSessionForUser({
    repository,
    userId: USER_UUID,
    dailyDropId,
    dropDate: "2026-08-06",
    providerResolution: { status: "ready", provider }
  });
}
