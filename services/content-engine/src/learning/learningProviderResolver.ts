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
  if (!input.useLlm) {
    return {
      status: "ready",
      provider: "deterministic"
    };
  }

  const env = input.env ?? process.env;

  try {
    return {
      status: "ready",
      provider: new OpenAiJsonProvider({
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
