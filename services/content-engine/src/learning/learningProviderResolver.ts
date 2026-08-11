import { OpenAiJsonProvider } from "../generation/openAiProvider.js";
import type { LearningPromptProvider } from "./learningPromptGenerator.js";

export type LearningProviderResolution =
  | {
      status: "ready";
      provider: LearningPromptProvider | "deterministic";
    }
  | {
      status: "unavailable";
      error: Error;
    };

export function resolveLearningProvider(input: {
  useLlm: boolean;
  env?: NodeJS.ProcessEnv;
}): LearningProviderResolution {
  const env = input.env ?? process.env;
  const mode = env.LEARNING_GENERATION_MODE?.trim().toLowerCase() || "deterministic";

  if (!input.useLlm || mode !== "llm") {
    return {
      status: "ready",
      provider: "deterministic"
    };
  }

  try {
    return {
      status: "ready",
      provider: new OpenAiJsonProvider({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_LEARNING_MODEL ?? env.OPENAI_MODEL,
        disableFallback: true
      })
    };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
