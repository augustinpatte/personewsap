import { afterEach, describe, expect, it, vi } from "vitest";

import { AnthropicJsonProvider } from "./anthropicProvider.js";
import { OpenAiJsonProvider } from "./openAiProvider.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LLM provider usage metrics", () => {
  it("records OpenAI usage tokens from Responses API payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: "{\"ok\":true}",
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            input_tokens_details: { cached_tokens: 25 },
            output_tokens_details: { reasoning_tokens: 5 }
          }
        })
      } as unknown as Response)
    );
    const completions: unknown[] = [];
    const provider = new OpenAiJsonProvider({
      apiKey: "test-key",
      model: "gpt-test",
      disableFallback: true,
      onRequestCompletion: (completion) => completions.push(completion)
    });

    await expect(provider.generateJson(jsonRequest())).resolves.toEqual({ ok: true });
    expect(completions).toMatchObject([
      {
        provider: "openai",
        model: "gpt-test",
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          cachedInputTokens: 25,
          reasoningOutputTokens: 5
        }
      }
    ]);
  });

  it("parses Anthropic tool_use structured output and cache usage tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            {
              type: "tool_use",
              name: "test_schema",
              input: { ok: true }
            }
          ],
          usage: {
            input_tokens: 120,
            output_tokens: 60,
            cache_creation_input_tokens: 80,
            cache_read_input_tokens: 20
          }
        })
      } as unknown as Response)
    );
    const completions: unknown[] = [];
    const provider = new AnthropicJsonProvider({
      apiKey: "test-key",
      model: "claude-test",
      onRequestCompletion: (completion) => completions.push(completion)
    });

    await expect(provider.generateJson(jsonRequest())).resolves.toEqual({ ok: true });
    expect(completions).toMatchObject([
      {
        provider: "anthropic",
        model: "claude-test",
        usage: {
          inputTokens: 120,
          outputTokens: 60,
          cacheCreationInputTokens: 80,
          cacheReadInputTokens: 20
        }
      }
    ]);
  });
});

function jsonRequest() {
  return {
    systemPrompt: "system",
    userPrompt: "user",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: {
        ok: { type: "boolean" }
      }
    },
    schemaName: "test_schema"
  };
}
