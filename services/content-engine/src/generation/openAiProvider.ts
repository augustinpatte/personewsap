import type {
  LlmJsonRequest,
  LlmProvider,
  LlmRequestAttempt,
  LlmRequestAttemptObserver,
  LlmRequestCompletion,
  LlmRequestCompletionObserver,
  LlmUsage
} from "./llmProvider.js";
import { MissingLlmApiKeyError } from "./llmProvider.js";
import { LlmGenerationError, toLlmGenerationError } from "./llmErrors.js";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
export const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 120_000;

export type OpenAiRequestAttempt = LlmRequestAttempt;
export type OpenAiRequestObserver = LlmRequestAttemptObserver;

type OpenAiProviderOptions = {
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  endpoint?: string;
  requestTimeoutMs?: number;
  reasoningEffort?: string | null;
  /** When true the provider never tries a second model after a failure. */
  disableFallback?: boolean;
  /** Called once per real HTTP request, before it is sent. */
  onRequestAttempt?: OpenAiRequestObserver;
  /** Called once per successful real HTTP request, after usage is known. */
  onRequestCompletion?: LlmRequestCompletionObserver;
};

type OpenAiResponseContent = {
  text?: unknown;
};

type OpenAiResponseOutput = {
  content?: OpenAiResponseContent[];
};

type OpenAiResponsesPayload = {
  output_text?: unknown;
  output?: OpenAiResponseOutput[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  error?: {
    message?: string;
  };
};

export class OpenAiJsonProvider implements LlmProvider {
  readonly name = "openai";

  private readonly apiKey: string;
  private readonly models: string[];
  private readonly endpoint: string;
  private readonly requestTimeoutMs: number;
  private readonly reasoningEffort: string | null;
  private readonly attemptObservers = new Set<OpenAiRequestObserver>();
  private readonly completionObservers = new Set<LlmRequestCompletionObserver>();

  constructor(options: OpenAiProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new MissingLlmApiKeyError("OpenAI", "OPENAI_API_KEY");
    }

    this.apiKey = apiKey;
    this.models = uniqueModels([
      options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      options.disableFallback ? undefined : options.fallbackModel ?? process.env.OPENAI_FALLBACK_MODEL
    ]);
    this.endpoint = options.endpoint ?? process.env.OPENAI_RESPONSES_ENDPOINT ?? DEFAULT_OPENAI_ENDPOINT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? readRequestTimeoutMs();
    this.reasoningEffort = normalizeReasoningEffort(options.reasoningEffort ?? process.env.OPENAI_REASONING_EFFORT ?? null);
    if (options.onRequestAttempt) {
      this.attemptObservers.add(options.onRequestAttempt);
    }
    if (options.onRequestCompletion) {
      this.completionObservers.add(options.onRequestCompletion);
    }
  }

  /** Registers an observer for the real HTTP attempts. Returns an unsubscribe. */
  observeRequestAttempts(observer: OpenAiRequestObserver): () => void {
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
    let lastError: LlmGenerationError | undefined;
    let attempt = 0;

    for (const model of this.models) {
      attempt += 1;
      for (const observer of this.attemptObservers) {
        observer({ provider: this.name, model, attempt, schemaName: request.schemaName ?? "personewsap_daily_drop" });
      }
      try {
        return await this.generateJsonWithModel(request, model, attempt);
      } catch (error) {
        lastError = toLlmGenerationError(error);
        if (lastError.model === null) {
          lastError = new LlmGenerationError(lastError.reason, lastError.message, { model });
        }
      }
    }

    throw lastError ?? new LlmGenerationError("api_error", "OpenAI generation failed before a model was attempted.");
  }

  private async generateJsonWithModel(request: LlmJsonRequest, model: string, attempt: number): Promise<unknown> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      const body: Record<string, unknown> = {
        model,
        input: [
          {
            role: "system",
            content: request.systemPrompt
          },
          {
            role: "user",
            content: request.userPrompt
          }
        ],
        max_output_tokens: request.maxOutputTokens ?? 5000,
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName ?? "personewsap_daily_drop",
            strict: true,
            schema: request.jsonSchema
          }
        }
      };
      if (this.reasoningEffort) {
        body.reasoning = { effort: this.reasoningEffort };
      }

      response = await fetch(this.endpoint, {
        method: "POST",
        signal: abortController.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw formatOpenAiRequestError(error, this.requestTimeoutMs, model);
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => ({}))) as OpenAiResponsesPayload;
    if (!response.ok) {
      const detail = payload.error?.message ?? response.statusText;
      throw new LlmGenerationError(
        "api_error",
        `OpenAI generation failed with HTTP ${response.status}: ${detail}. ` +
          "Check OPENAI_API_KEY, OPENAI_MODEL, request size, and account quota.",
        { model }
      );
    }

    for (const observer of this.completionObservers) {
      observer({
        provider: this.name,
        model,
        attempt,
        schemaName: request.schemaName ?? "personewsap_daily_drop",
        latencyMs: Date.now() - startedAt,
        usage: parseOpenAiUsage(payload)
      });
    }

    return parseJsonOutput(payload, model);
  }
}

function parseOpenAiUsage(payload: OpenAiResponsesPayload): LlmUsage {
  const usage = payload.usage;
  return {
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    reasoningOutputTokens: usage?.output_tokens_details?.reasoning_tokens ?? null
  };
}

function parseJsonOutput(payload: OpenAiResponsesPayload, model: string): unknown {
  if (typeof payload.output_text === "string") {
    return parseJsonText(payload.output_text, model);
  }

  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .find((value): value is string => typeof value === "string");

  if (!text) {
    throw new LlmGenerationError(
      "empty_output",
      "OpenAI generation response did not include JSON text. " +
        "The Responses API returned no output_text/content text for the structured request.",
      { model }
    );
  }

  return parseJsonText(text, model);
}

function parseJsonText(text: string, model: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LlmGenerationError("malformed_json", `OpenAI generation returned invalid JSON: ${detail}`, { model });
  }
}

function readRequestTimeoutMs(): number {
  const value = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? String(DEFAULT_OPENAI_REQUEST_TIMEOUT_MS));
  if (!Number.isFinite(value) || value < 1000) {
    throw new Error("OPENAI_REQUEST_TIMEOUT_MS must be a number greater than or equal to 1000.");
  }

  return value;
}

function normalizeReasoningEffort(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "none") {
    return null;
  }

  return normalized;
}

function formatOpenAiRequestError(error: unknown, timeoutMs: number, model: string): LlmGenerationError {
  if (error instanceof Error && error.name === "AbortError") {
    return new LlmGenerationError(
      "timeout",
      `OpenAI generation timed out after ${timeoutMs}ms. ` +
        "Try again, lower the local test scope, or increase OPENAI_REQUEST_TIMEOUT_MS.",
      { model }
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new LlmGenerationError(
    "api_error",
    `OpenAI request failed before a response was received: ${detail}. ` +
      "Check network access, OPENAI_RESPONSES_ENDPOINT, and OPENAI_API_KEY.",
    { model }
  );
}

function uniqueModels(models: Array<string | undefined>): string[] {
  return [...new Set(models.map((model) => model?.trim()).filter((model): model is string => Boolean(model)))];
}
