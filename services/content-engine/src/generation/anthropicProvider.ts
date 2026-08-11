import { LlmGenerationError, toLlmGenerationError } from "./llmErrors.js";
import type {
  LlmJsonRequest,
  LlmProvider,
  LlmRequestAttemptObserver,
  LlmRequestCompletionObserver,
  LlmUsage
} from "./llmProvider.js";
import { MissingLlmApiKeyError } from "./llmProvider.js";
import { DEFAULT_OPENAI_REQUEST_TIMEOUT_MS } from "./openAiProvider.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const DEFAULT_ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

type AnthropicProviderOptions = {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  requestTimeoutMs?: number;
  onRequestAttempt?: LlmRequestAttemptObserver;
  onRequestCompletion?: LlmRequestCompletionObserver;
};

type AnthropicToolUseBlock = {
  type: "tool_use";
  name?: string;
  input?: unknown;
};

type AnthropicTextBlock = {
  type: "text";
  text?: unknown;
};

type AnthropicPayload = {
  content?: Array<AnthropicToolUseBlock | AnthropicTextBlock | Record<string, unknown>>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

export class AnthropicJsonProvider implements LlmProvider {
  readonly name = "anthropic";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly requestTimeoutMs: number;
  private readonly attemptObservers = new Set<LlmRequestAttemptObserver>();
  private readonly completionObservers = new Set<LlmRequestCompletionObserver>();

  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new MissingLlmApiKeyError("Anthropic", "ANTHROPIC_API_KEY");
    }

    this.apiKey = apiKey;
    this.model = options.model ?? process.env.BUSINESS_STORY_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
    this.endpoint = options.endpoint ?? process.env.ANTHROPIC_MESSAGES_ENDPOINT ?? DEFAULT_ANTHROPIC_ENDPOINT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? readRequestTimeoutMs();
    if (options.onRequestAttempt) this.attemptObservers.add(options.onRequestAttempt);
    if (options.onRequestCompletion) this.completionObservers.add(options.onRequestCompletion);
  }

  observeRequestAttempts(observer: LlmRequestAttemptObserver): () => void {
    this.attemptObservers.add(observer);
    return () => {
      this.attemptObservers.delete(observer);
    };
  }

  observeRequestCompletions(observer: LlmRequestCompletionObserver): () => void {
    this.completionObservers.add(observer);
    return () => {
      this.completionObservers.delete(observer);
    };
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const schemaName = request.schemaName ?? "personewsap_daily_drop";
    for (const observer of this.attemptObservers) {
      observer({ provider: this.name, model: this.model, attempt: 1, schemaName });
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": process.env.ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxOutputTokens ?? 5000,
          system: [
            {
              type: "text",
              text: request.systemPrompt,
              cache_control: { type: "ephemeral" }
            }
          ],
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: request.userPrompt
                }
              ]
            }
          ],
          tools: [
            {
              name: schemaName,
              description: "Return the PersoNewsAP structured JSON payload for this generation step.",
              input_schema: request.jsonSchema
            }
          ],
          tool_choice: {
            type: "tool",
            name: schemaName
          }
        })
      });
    } catch (error) {
      throw formatAnthropicRequestError(error, this.requestTimeoutMs, this.model);
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => ({}))) as AnthropicPayload;
    if (!response.ok) {
      const detail = payload.error?.message ?? response.statusText;
      throw new LlmGenerationError(
        "api_error",
        `Anthropic generation failed with HTTP ${response.status}: ${detail}. Check ANTHROPIC_API_KEY, BUSINESS_STORY_MODEL, request size, and account quota.`,
        { model: this.model }
      );
    }

    for (const observer of this.completionObservers) {
      observer({
        provider: this.name,
        model: this.model,
        attempt: 1,
        schemaName,
        latencyMs: Date.now() - startedAt,
        usage: parseAnthropicUsage(payload)
      });
    }

    return parseAnthropicOutput(payload, schemaName, this.model);
  }
}

function parseAnthropicOutput(payload: AnthropicPayload, schemaName: string, model: string): unknown {
  const toolUse = payload.content?.find(
    (block): block is AnthropicToolUseBlock =>
      typeof block === "object" && block !== null && block.type === "tool_use" && block.name === schemaName
  );
  if (toolUse?.input !== undefined) {
    return toolUse.input;
  }

  const text = payload.content
    ?.filter((block): block is AnthropicTextBlock => typeof block === "object" && block !== null && block.type === "text")
    .map((block) => block.text)
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (!text) {
    throw new LlmGenerationError(
      "empty_output",
      "Anthropic generation response did not include a tool_use input or JSON text content.",
      { model }
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LlmGenerationError("malformed_json", `Anthropic generation returned invalid JSON: ${detail}`, { model });
  }
}

function parseAnthropicUsage(payload: AnthropicPayload): LlmUsage {
  const usage = payload.usage;
  return {
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? null,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? null
  };
}

function readRequestTimeoutMs(): number {
  const value = Number(process.env.ANTHROPIC_REQUEST_TIMEOUT_MS ?? process.env.OPENAI_REQUEST_TIMEOUT_MS ?? String(DEFAULT_OPENAI_REQUEST_TIMEOUT_MS));
  if (!Number.isFinite(value) || value < 1000) {
    throw new Error("ANTHROPIC_REQUEST_TIMEOUT_MS must be a number greater than or equal to 1000.");
  }

  return value;
}

function formatAnthropicRequestError(error: unknown, timeoutMs: number, model: string): LlmGenerationError {
  const llmError = toLlmGenerationError(error);
  if (error instanceof Error && error.name === "AbortError") {
    return new LlmGenerationError(
      "timeout",
      `Anthropic generation timed out after ${timeoutMs}ms. Try again, lower the local test scope, or increase ANTHROPIC_REQUEST_TIMEOUT_MS.`,
      { model }
    );
  }

  return new LlmGenerationError(
    llmError.reason === "timeout" ? "timeout" : "api_error",
    `Anthropic request failed before a response was received: ${llmError.message}. Check network access, ANTHROPIC_MESSAGES_ENDPOINT, and ANTHROPIC_API_KEY.`,
    { model }
  );
}
