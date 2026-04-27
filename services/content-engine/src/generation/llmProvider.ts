export type LlmJsonRequest = {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
};

export type LlmProvider = {
  name: string;
  generateJson(request: LlmJsonRequest): Promise<unknown>;
};

export class MissingLlmApiKeyError extends Error {
  constructor(providerName: string, envVarName: string) {
    super(`${envVarName} is required for ${providerName} LLM generation. Set it before running llm-run.`);
    this.name = "MissingLlmApiKeyError";
  }
}
