import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiJsonProvider } from "../generation/openAiProvider.js";
import { generateLearningSessionForUser } from "./learningSessionOrchestrator.js";
import {
  CountingLearningPromptProvider,
  fakeLearningPromptResponse,
  InMemoryLearningRepository
} from "./learningTestDoubles.js";
import type { LearningPathRecord } from "./learningTypes.js";

const PATH: LearningPathRecord = {
  id: "path-1",
  user_id: "user-1",
  domain_id: "computer_science",
  objective_id: "cs_systems",
  current_level: 2,
  target_level: 4,
  language: "en"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("learning generation API budget", () => {
  it("issues exactly one HTTP request for a new session", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    const provider = workingProvider();

    const result = await generate(repository, provider);

    expect(result.status).toBe("generated");
    expect(provider.httpRequests).toBe(1);
    expect(result.learning_api_calls).toBe(1);
  });

  it("issues no request while a session is still available", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    await generate(repository, workingProvider());

    const provider = workingProvider();
    const result = await generate(repository, provider);

    expect(result.status).toBe("blocked");
    expect(provider.httpRequests).toBe(0);
    expect(result.learning_api_calls).toBe(0);
  });

  it("issues no request while a session is only opened", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    await generate(repository, workingProvider());
    repository.sessions[0].status = "opened";
    repository.sessions[0].opened_at = new Date().toISOString();

    const provider = workingProvider();
    const result = await generate(repository, provider);

    expect(result.status).toBe("blocked");
    expect(provider.httpRequests).toBe(0);
  });

  it("issues no request when the same drop is re-run", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    await generate(repository, workingProvider());
    repository.sessions[0].status = "started";
    repository.sessions[0].started_at = new Date().toISOString();
    await generate(repository, workingProvider());

    const provider = workingProvider();
    const rerun = await generate(repository, provider);

    expect(provider.httpRequests).toBe(0);
    expect(rerun.learning_api_calls).toBe(0);
    expect(repository.sessions).toHaveLength(2);
  });

  it("counts one request, not two, when the model call fails", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });
    const provider = new CountingLearningPromptProvider({
      model: "gpt-primary",
      fallbackModel: "gpt-fallback",
      disableFallback: true,
      failWith: new Error("simulated outage")
    });

    const result = await generate(repository, provider);

    expect(provider.httpRequests).toBe(1);
    expect(provider.requestedModels).toEqual(["gpt-primary"]);
    expect(result.learning_api_calls).toBe(1);
    expect(result.status).toBe("failed");
    expect(repository.sessions[0].generation_status).toBe("failed");
  });

  it("issues no request at all in deterministic mode", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });

    const result = await generateLearningSessionForUser({
      repository,
      userId: "user-1",
      dailyDropId: "drop-1",
      dropDate: "2026-08-01",
      provider: "deterministic"
    });

    expect(result.status).toBe("generated");
    expect(result.learning_api_calls).toBe(0);
    expect(repository.sessions[0].model_name).toBe("deterministic-learning-v1");
  });

  it("stores the real model name rather than the provider name", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH });

    await generate(repository, workingProvider());

    expect(repository.sessions[0].model_name).toBe("gpt-primary");
  });

  it("issues no request once the path reached its target level", async () => {
    const repository = new InMemoryLearningRepository({ ...PATH, current_level: 6, target_level: 5 });
    let guard = 0;

    while (guard < 20) {
      guard += 1;
      const result = await generate(repository, workingProvider());
      if (result.status === "completed") {
        expect(result.learning_paths_completed).toBe(1);
        expect(result.learning_api_calls).toBe(0);
        expect(repository.pathStatus).toBe("completed");
        break;
      }
      const latest = repository.sessions.at(-1)!;
      latest.status = "started";
      latest.started_at = new Date().toISOString();
    }

    expect(repository.pathStatus).toBe("completed");
    expect(await repository.getActiveLearningPathForUser("user-1")).toBeNull();
  });
});

describe("OpenAI provider fallback control", () => {
  it("sends a single request when the fallback is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiJsonProvider({
      apiKey: "test-key",
      model: "gpt-primary",
      fallbackModel: "gpt-fallback",
      disableFallback: true
    });

    await expect(provider.generateJson(jsonRequest())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still falls back for editorial content when it is allowed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiJsonProvider({
      apiKey: "test-key",
      model: "gpt-primary",
      fallbackModel: "gpt-fallback"
    });

    await expect(provider.generateJson(jsonRequest())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports every real request to its observers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse());
    vi.stubGlobal("fetch", fetchMock);

    const attempts: string[] = [];
    const provider = new OpenAiJsonProvider({
      apiKey: "test-key",
      model: "gpt-primary",
      disableFallback: true,
      onRequestAttempt: (attempt) => attempts.push(`${attempt.model}#${attempt.attempt}`)
    });

    await expect(provider.generateJson(jsonRequest())).rejects.toThrow();
    expect(attempts).toEqual(["gpt-primary#1"]);
  });
});

function workingProvider() {
  return new CountingLearningPromptProvider({
    model: "gpt-primary",
    fallbackModel: "gpt-fallback",
    disableFallback: true,
    buildPrompt: fakeLearningPromptResponse
  });
}

async function generate(repository: InMemoryLearningRepository, provider: CountingLearningPromptProvider) {
  return generateLearningSessionForUser({
    repository,
    userId: "user-1",
    dailyDropId: `drop-${repository.sessions.length + 1}`,
    dropDate: "2026-08-01",
    provider
  });
}

function jsonRequest() {
  return {
    systemPrompt: "system",
    userPrompt: "user",
    jsonSchema: { type: "object" },
    schemaName: "personewsap_learning_prompt"
  };
}

function errorResponse() {
  return {
    ok: false,
    status: 500,
    statusText: "Server Error",
    json: async () => ({ error: { message: "boom" } })
  } as unknown as Response;
}
