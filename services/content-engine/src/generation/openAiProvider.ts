import type { LlmJsonRequest, LlmProvider } from "./llmProvider.js";
import { MissingLlmApiKeyError } from "./llmProvider.js";

type OpenAiProviderOptions = {
  apiKey?: string;
  model?: string;
  endpoint?: string;
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

  constructor(options: OpenAiProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new MissingLlmApiKeyError("OpenAI", "OPENAI_API_KEY");
    }

    this.apiKey = apiKey;
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
    this.endpoint = options.endpoint ?? process.env.OPENAI_RESPONSES_ENDPOINT ?? "https://api.openai.com/v1/responses";
  }

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
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

    const payload = (await response.json().catch(() => ({}))) as OpenAiResponsesPayload;
    if (!response.ok) {
      throw new Error(`OpenAI generation failed: ${payload.error?.message ?? response.statusText}`);
    }

    return parseJsonOutput(payload);
  }
}

function parseJsonOutput(payload: OpenAiResponsesPayload): unknown {
  if (typeof payload.output_text === "string") {
    return JSON.parse(payload.output_text);
  }

  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .find((value): value is string => typeof value === "string");

  if (!text) {
    throw new Error("OpenAI generation response did not include JSON text.");
  }

  return JSON.parse(text);
}
