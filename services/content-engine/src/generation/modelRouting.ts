import type { Language, MiniCaseTopicId, TopicId } from "../domain.js";
import { AnthropicJsonProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropicProvider.js";
import type { LlmProvider, LlmRequestCompletion, LlmUsage } from "./llmProvider.js";
import { OpenAiJsonProvider } from "./openAiProvider.js";

export type EditorialSection = "newsletter_article" | "business_story" | "mini_case";
export type ModelProviderName = "openai" | "anthropic";

export type ContentModelRoute = {
  provider: ModelProviderName;
  model: string;
  reasoningEffort: string | null;
  fallbackProvider: ModelProviderName | null;
  fallbackModel: string | null;
};

type LearningPathRoute = {
  provider: "deterministic";
  model: "deterministic-learning-v1";
  reasoningEffort: null;
  fallbackProvider: null;
  fallbackModel: null;
};

export type ContentModelRouting = Record<EditorialSection, ContentModelRoute> & {
  learning_path: LearningPathRoute;
};

export type SectionProviderContext = {
  section: EditorialSection;
  language: Language;
  newsletterTopic?: TopicId;
  miniCaseTopic?: MiniCaseTopicId | null;
  attempt: number;
  maxAttempts: number;
};

export type LlmCallMetric = {
  provider: ModelProviderName;
  model: string;
  content_type: EditorialSection | "learning_path";
  language: Language | null;
  topic: TopicId | MiniCaseTopicId | null;
  attempt: number;
  fallback: boolean;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  estimated: boolean;
  estimated_cost_usd: number | null;
};

const DEFAULT_NEWSLETTER_MODEL = "gpt-5-mini-2025-08-07";
const DEFAULT_NEWSLETTER_FALLBACK_MODEL = "gpt-5.4-mini-2026-03-17";
const DEFAULT_MINI_CASE_MODEL = "gpt-5.4-mini-2026-03-17";
const DEFAULT_MINI_CASE_FALLBACK_MODEL = "gpt-5.4-2026-03-05";
const DEFAULT_BUSINESS_STORY_FALLBACK_MODEL = "gpt-5.4-2026-03-05";
const DETERMINISTIC_LEARNING_MODEL = "deterministic-learning-v1";

type Pricing = {
  input: number;
  cachedInput: number;
  output: number;
  reasoningOutput?: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
};

const PRICING_USD_PER_MILLION: Record<string, Pricing> = {
  "gpt-5-mini-2025-08-07": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5.4-mini-2026-03-17": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-2026-03-05": { input: 2.5, cachedInput: 0.25, output: 15 },
  "claude-sonnet-4-6": {
    input: 3,
    cachedInput: 3,
    output: 15,
    cacheCreationInput: 3.75,
    cacheReadInput: 0.3
  }
};

export function resolveContentModelRouting(env: NodeJS.ProcessEnv = process.env): ContentModelRouting {
  const legacyOpenAiModel = trimToNull(env.OPENAI_MODEL);
  return {
    newsletter_article: {
      provider: "openai",
      model: trimToNull(env.NEWSLETTER_MODEL) ?? legacyOpenAiModel ?? DEFAULT_NEWSLETTER_MODEL,
      reasoningEffort: trimToNull(env.NEWSLETTER_REASONING_EFFORT) ?? "none",
      fallbackProvider: "openai",
      fallbackModel: trimToNull(env.NEWSLETTER_FALLBACK_MODEL) ?? DEFAULT_NEWSLETTER_FALLBACK_MODEL
    },
    mini_case: {
      provider: "openai",
      model: trimToNull(env.MINI_CASE_MODEL) ?? legacyOpenAiModel ?? DEFAULT_MINI_CASE_MODEL,
      reasoningEffort: trimToNull(env.MINI_CASE_REASONING_EFFORT) ?? "low",
      fallbackProvider: "openai",
      fallbackModel: trimToNull(env.MINI_CASE_FALLBACK_MODEL) ?? DEFAULT_MINI_CASE_FALLBACK_MODEL
    },
    business_story: {
      provider: parseProvider(env.BUSINESS_STORY_PROVIDER, "anthropic"),
      model: trimToNull(env.BUSINESS_STORY_MODEL) ?? DEFAULT_ANTHROPIC_MODEL,
      reasoningEffort: null,
      fallbackProvider: parseProvider(env.BUSINESS_STORY_FALLBACK_PROVIDER, "openai"),
      fallbackModel: trimToNull(env.BUSINESS_STORY_FALLBACK_MODEL) ?? legacyOpenAiModel ?? DEFAULT_BUSINESS_STORY_FALLBACK_MODEL
    },
    learning_path: {
      provider: "deterministic",
      model: DETERMINISTIC_LEARNING_MODEL,
      reasoningEffort: null,
      fallbackProvider: null,
      fallbackModel: null
    }
  };
}

export function createRoutedProviderFactory(input: {
  routing?: ContentModelRouting;
  onCallMetric?: (metric: LlmCallMetric) => void;
} = {}): (context: SectionProviderContext) => LlmProvider {
  const routing = input.routing ?? resolveContentModelRouting();

  return (context) => {
    const route = routing[context.section];
    const useFallback = shouldUseFallback(route, context.attempt, context.maxAttempts);
    const providerName = useFallback ? route.fallbackProvider ?? route.provider : route.provider;
    const model = useFallback ? route.fallbackModel ?? route.model : route.model;
    const metricContext = {
      contentType: context.section,
      language: context.language,
      topic: context.newsletterTopic ?? context.miniCaseTopic ?? null,
      attempt: context.attempt,
      fallback: useFallback
    };
    const onCompletion = (completion: LlmRequestCompletion) => {
      input.onCallMetric?.(toLlmCallMetric(completion, metricContext));
    };

    if (providerName === "anthropic") {
      return new AnthropicJsonProvider({
        model,
        onRequestCompletion: onCompletion
      });
    }

    return new OpenAiJsonProvider({
      model,
      reasoningEffort: route.reasoningEffort,
      disableFallback: true,
      onRequestCompletion: onCompletion
    });
  };
}

export function toSafeModelRoutingSummary(routing: ContentModelRouting = resolveContentModelRouting()): Record<string, unknown> {
  return {
    newsletter_article: routing.newsletter_article,
    mini_case: routing.mini_case,
    business_story: routing.business_story,
    learning_path: routing.learning_path
  };
}

export function estimateCallCostUsd(model: string, usage: LlmUsage): number | null {
  const pricing = PRICING_USD_PER_MILLION[model];
  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) {
    return null;
  }

  const cachedInput = usage.cachedInputTokens ?? 0;
  const cacheCreationInput = usage.cacheCreationInputTokens ?? 0;
  const cacheReadInput = usage.cacheReadInputTokens ?? 0;
  const billableInput = Math.max(0, usage.inputTokens - cachedInput - cacheCreationInput - cacheReadInput);
  const inputCost = (billableInput / 1_000_000) * pricing.input;
  const cachedCost = (cachedInput / 1_000_000) * pricing.cachedInput;
  const cacheWriteCost = (cacheCreationInput / 1_000_000) * (pricing.cacheCreationInput ?? pricing.input);
  const cacheReadCost = (cacheReadInput / 1_000_000) * (pricing.cacheReadInput ?? pricing.cachedInput);
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  const reasoningCost = ((usage.reasoningOutputTokens ?? 0) / 1_000_000) * (pricing.reasoningOutput ?? pricing.output);

  return Number((inputCost + cachedCost + cacheWriteCost + cacheReadCost + outputCost + reasoningCost).toFixed(6));
}

function toLlmCallMetric(
  completion: LlmRequestCompletion,
  context: {
    contentType: EditorialSection | "learning_path";
    language: Language | null;
    topic: TopicId | MiniCaseTopicId | null;
    attempt: number;
    fallback: boolean;
  }
): LlmCallMetric {
  const usage = completion.usage;
  return {
    provider: completion.provider as ModelProviderName,
    model: completion.model,
    content_type: context.contentType,
    language: context.language,
    topic: context.topic,
    attempt: context.attempt,
    fallback: context.fallback,
    latency_ms: completion.latencyMs,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cached_input_tokens: usage.cachedInputTokens ?? null,
    reasoning_output_tokens: usage.reasoningOutputTokens ?? null,
    cache_creation_input_tokens: usage.cacheCreationInputTokens ?? null,
    cache_read_input_tokens: usage.cacheReadInputTokens ?? null,
    estimated: usage.inputTokens === null || usage.outputTokens === null,
    estimated_cost_usd: estimateCallCostUsd(completion.model, usage)
  };
}

function shouldUseFallback(route: ContentModelRoute, attempt: number, maxAttempts: number): boolean {
  return Boolean(route.fallbackProvider && route.fallbackModel && attempt === maxAttempts && maxAttempts > 1);
}

function parseProvider(value: string | undefined, fallback: ModelProviderName): ModelProviderName {
  const normalized = value?.trim().toLowerCase();
  return normalized === "openai" || normalized === "anthropic" ? normalized : fallback;
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
