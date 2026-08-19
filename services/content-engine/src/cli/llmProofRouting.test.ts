import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseLlmProofOptions } from "./llmProof.js";

/**
 * The proof has to exercise what production runs.
 *
 * The previous implementation constructed one `OpenAiJsonProvider` directly, so
 * the last live proof reported gpt-4.1-mini — a model production never uses.
 * A proof that does not go through modelRouting proves nothing about the
 * edition that ships.
 */

const source = readFileSync(join(__dirname, "llmProof.ts"), "utf8");

describe("llm-proof provider construction", () => {
  it("builds its generator from the routed provider factory", () => {
    expect(source).toMatch(/createRoutedProviderFactory\(/);
    expect(source).toMatch(/providerForSection: createRoutedProviderFactory/);
  });

  it("no longer constructs a single OpenAI provider of its own", () => {
    expect(source).not.toMatch(/provider: new OpenAiJsonProvider/);
    expect(source).not.toMatch(/function readOpenAiModel/);
  });

  it("records provider, model, section, language, topic and usage per call", () => {
    for (const field of [
      "provider: metric.provider",
      "model: metric.model",
      "section: metric.content_type",
      "language: metric.language",
      "topic: metric.topic",
      "input_tokens: metric.input_tokens",
      "output_tokens: metric.output_tokens",
      "cached_input_tokens: metric.cached_input_tokens",
      "estimated_cost_usd: metric.estimated_cost_usd"
    ]) {
      expect(source).toContain(field);
    }
  });

  it("reports the routing it used and never an API key", () => {
    expect(source).toMatch(/routing_mode: options\.overrideModel/);
    expect(source).toMatch(/api_key_logged: false/);
    expect(source).not.toMatch(/OPENAI_API_KEY.*[:=].*process\.env\.OPENAI_API_KEY\b(?!\))/);
  });

  it("marks placeholder pricing so a cost is never presented as confirmed", () => {
    expect(source).toMatch(/hasVerifiedPricing/);
    expect(source).toMatch(/cost_is_verified/);
  });
});

describe("llm-proof options", () => {
  it("defaults to production routing", () => {
    const options = parseLlmProofOptions([]);

    expect(options.overrideModel).toBeNull();
  });

  it("allows an explicit single-model diagnostic", () => {
    expect(parseLlmProofOptions(["--model", "gpt-5.6-luna"]).overrideModel).toBe("gpt-5.6-luna");
  });

  it("never silently reuses a legacy OPENAI_MODEL as the proof model", () => {
    const previous = process.env.OPENAI_MODEL;
    process.env.OPENAI_MODEL = "gpt-4.1-mini";

    try {
      // Compatibility for generation env is one thing; the proof must not be
      // pinned to it behind the operator's back.
      expect(parseLlmProofOptions([]).overrideModel).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_MODEL;
      } else {
        process.env.OPENAI_MODEL = previous;
      }
    }
  });
});
