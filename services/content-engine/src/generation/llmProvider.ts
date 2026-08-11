export type LlmJsonRequest = {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  schemaName?: string;
};

export type LlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
};

export type LlmRequestAttempt = {
  provider: string;
  model: string;
  /** 1-based index of the HTTP attempt inside one logical item generation. */
  attempt: number;
  schemaName: string;
};

export type LlmRequestCompletion = LlmRequestAttempt & {
  latencyMs: number;
  usage: LlmUsage;
};

export type LlmRequestAttemptObserver = (attempt: LlmRequestAttempt) => void;
export type LlmRequestCompletionObserver = (completion: LlmRequestCompletion) => void;

export type LlmProvider = {
  name: string;
  generateJson(request: LlmJsonRequest): Promise<unknown>;
  observeRequestAttempts?(observer: LlmRequestAttemptObserver): () => void;
  observeRequestCompletions?(observer: LlmRequestCompletionObserver): () => void;
};

export class MissingLlmApiKeyError extends Error {
  constructor(providerName: string, envVarName: string) {
    super(`${envVarName} is required for ${providerName} LLM generation. Set it before running llm-run.`);
    this.name = "MissingLlmApiKeyError";
  }
}
