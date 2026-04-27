import type { LlmJsonRequest, LlmProvider } from "./llmProvider.js";
import { MissingLlmApiKeyError } from "./llmProvider.js";

type OpenAiProviderOptions = {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  requestTimeoutMs?: number;
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
  error?: {
    message?: string;
  };
};

export class OpenAiJsonProvider implements LlmProvider {
  readonly name = "openai";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly requestTimeoutMs: number;

  constructor(options: OpenAiProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new MissingLlmApiKeyError("OpenAI", "OPENAI_API_KEY");
    }

    this.apiKey = apiKey;
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
    this.endpoint = options.endpoint ?? process.env.OPENAI_RESPONSES_ENDPOINT ?? "https://api.openai.com/v1/responses";
    this.requestTimeoutMs = options.requestTimeoutMs ?? readRequestTimeoutMs();
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        signal: abortController.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
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
              name: "personewsap_daily_drop",
              strict: true,
              schema: request.jsonSchema
            }
          }
        })
      });
    } catch (error) {
      throw formatOpenAiRequestError(error, this.requestTimeoutMs);
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => ({}))) as OpenAiResponsesPayload;
    if (!response.ok) {
      const detail = payload.error?.message ?? response.statusText;
      throw new Error(
        `OpenAI generation failed with HTTP ${response.status}: ${detail}. ` +
          "Check OPENAI_API_KEY, OPENAI_MODEL, request size, and account quota."
      );
    }

    return parseJsonOutput(payload);
  }
}

function parseJsonOutput(payload: OpenAiResponsesPayload): unknown {
  if (typeof payload.output_text === "string") {
    return parseJsonText(payload.output_text);
  }

  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .find((value): value is string => typeof value === "string");

  if (!text) {
    throw new Error(
      "OpenAI generation response did not include JSON text. " +
        "The Responses API returned no output_text/content text for the structured request."
    );
  }

  return parseJsonText(text);
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI generation returned invalid JSON: ${detail}`);
  }
}

function readRequestTimeoutMs(): number {
  const value = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? "60000");
  if (!Number.isFinite(value) || value < 1000) {
    throw new Error("OPENAI_REQUEST_TIMEOUT_MS must be a number greater than or equal to 1000.");
  }

  return value;
}

function formatOpenAiRequestError(error: unknown, timeoutMs: number): Error {
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(
      `OpenAI generation timed out after ${timeoutMs}ms. ` +
        "Try again, lower the local test scope, or increase OPENAI_REQUEST_TIMEOUT_MS."
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `OpenAI request failed before a response was received: ${detail}. ` +
      "Check network access, OPENAI_RESPONSES_ENDPOINT, and OPENAI_API_KEY."
  );
}
