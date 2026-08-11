import { describe, expect, it } from "vitest";

import { generateLearningSessionForUser } from "./learningSessionOrchestrator.js";
import { resolveLearningProvider } from "./learningProviderResolver.js";
import { CountingLearningPromptProvider, fakeLearningPromptResponse, InMemoryLearningRepository } from "./learningTestDoubles.js";
import type { LearningPathRecord } from "./learningTypes.js";

const PATH_A: LearningPathRecord = {
  id: "path-a",
  user_id: "user-a",
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 1,
  target_level: 2,
  language: "en"
};

const PATH_B: LearningPathRecord = {
  ...PATH_A,
  id: "path-b",
  user_id: "user-b"
};

describe("learning provider isolation", () => {
  it("uses the injected env and stays unavailable when the injected key is empty", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "real-process-key";

    try {
      const resolution = resolveLearningProvider({
        useLlm: true,
        env: { LEARNING_GENERATION_MODE: "llm", OPENAI_API_KEY: "", OPENAI_MODEL: "gpt-test" } as NodeJS.ProcessEnv
      });

      expect(resolution.status).toBe("unavailable");
    } finally {
      if (originalKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });

  it("uses the injected env key without reading process.env", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const resolution = resolveLearningProvider({
        useLlm: true,
        env: { LEARNING_GENERATION_MODE: "llm", OPENAI_API_KEY: "injected-key", OPENAI_MODEL: "gpt-test" } as NodeJS.ProcessEnv
      });

      expect(resolution.status).toBe("ready");
    } finally {
      if (originalKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });

  it("captures constructor failures without creating a claim", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH_A });
    const resolution = resolveLearningProvider({
      useLlm: true,
      env: { LEARNING_GENERATION_MODE: "llm", OPENAI_API_KEY: "", OPENAI_MODEL: "gpt-test" } as NodeJS.ProcessEnv
    });

    expect(resolution.status).toBe("unavailable");

    const result = await generateLearningSessionForUser({
      repository,
      userId: "user-a",
      dailyDropId: "drop-a",
      dropDate: "2026-08-02",
      providerResolution: resolution
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "learning_provider_unavailable",
      learning_sessions_failed: 1,
      learning_api_calls: 0,
      sessionId: null
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it("keeps Learning deterministic by default even when editorial USE_LLM is true", () => {
    const resolution = resolveLearningProvider({
      useLlm: true,
      env: { OPENAI_API_KEY: "", OPENAI_MODEL: "gpt-test" } as NodeJS.ProcessEnv
    });

    expect(resolution).toEqual({
      status: "ready",
      provider: "deterministic"
    });
  });

  it("lets the next user proceed after one user's learning provider is unavailable", async () => {
    const unavailableRepository = new InMemoryLearningRepository({ ...PATH_A });
    const availableRepository = new InMemoryLearningRepository({ ...PATH_B });
    const unavailable = { status: "unavailable" as const, error: new Error("missing key") };
    const provider = new CountingLearningPromptProvider({
      disableFallback: true,
      buildPrompt: fakeLearningPromptResponse
    });

    const first = await generateLearningSessionForUser({
      repository: unavailableRepository,
      userId: "user-a",
      dailyDropId: "drop-a",
      dropDate: "2026-08-02",
      providerResolution: unavailable
    });
    const second = await generateLearningSessionForUser({
      repository: availableRepository,
      userId: "user-b",
      dailyDropId: "drop-b",
      dropDate: "2026-08-02",
      providerResolution: { status: "ready", provider }
    });

    expect(first.reason).toBe("learning_provider_unavailable");
    expect(unavailableRepository.sessions).toHaveLength(0);
    expect(second.status).toBe("generated");
    expect(availableRepository.sessions).toHaveLength(1);
    expect(provider.httpRequests).toBe(1);
  });
});
