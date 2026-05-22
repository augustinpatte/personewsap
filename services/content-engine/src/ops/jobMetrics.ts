import { TOPIC_IDS, type DailyDropPayload, type Language, type RankedArticle, type TopicId } from "../domain.js";

export type RssMetricDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  articlesByTopic: Record<TopicId, number>;
  staleFallbackUsedByTopic: Record<TopicId, string>;
};

export type LanguageJobMetrics = {
  rss_attempted: number;
  rss_succeeded: number;
  rss_failed: number;
  articles_by_topic: Record<TopicId, number>;
  stale_fallback_used: boolean;
  stale_fallback_used_by_topic: Record<TopicId, string>;
  llm_latency_ms: number | null;
  llm_timeout_count: number;
  validation_failures_by_rule: Record<string, number>;
  generated_items: number;
  stored_items: number;
  content_items_deduplicated: number;
  assigned_users: number;
  estimated_input_tokens: number | null;
  estimated_output_tokens: number | null;
  estimated_cost_usd: number | null;
};

export type JobRunMetrics = {
  rss_attempted: number;
  rss_succeeded: number;
  rss_failed: number;
  articles_by_topic: Record<TopicId, number>;
  stale_fallback_used: boolean;
  stale_fallback_used_by_topic: Record<TopicId, string>;
  llm_latency_ms: {
    total: number | null;
    average: number | null;
    by_language: Partial<Record<Language, number>>;
  };
  llm_timeout_count: number;
  validation_failures_by_rule: Record<string, number>;
  generated_items_by_language: Partial<Record<Language, number>>;
  stored_items: number;
  content_items_deduplicated: number;
  assigned_users: number;
  estimated_input_tokens: number | null;
  estimated_output_tokens: number | null;
  estimated_cost_usd: number | null;
  estimated_cost_available: boolean;
  estimated_cost_reason: string;
};

export type PricingConfig = {
  available: boolean;
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
  reason: string;
};

export function emptyTopicCounts(): Record<TopicId, number> {
  return Object.fromEntries(TOPIC_IDS.map((topic) => [topic, 0])) as Record<TopicId, number>;
}

export function countArticlesByTopic(articles: RankedArticle[]): Record<TopicId, number> {
  const counts = emptyTopicCounts();
  for (const article of articles) {
    counts[article.topic] += 1;
  }
  return counts;
}

export function buildLanguageJobMetrics(input: {
  rssDiagnostics: RssMetricDiagnostics[];
  rankedArticles: RankedArticle[];
  useLlm: boolean;
  llmLatencyMs: number | null;
  llmTimedOut: boolean;
  validationFailuresByRule?: Record<string, number>;
  payload: DailyDropPayload | null;
  storedItems: number;
  deduplicatedContentItems: number;
  assignedUsers: number;
  pricing: PricingConfig;
}): LanguageJobMetrics {
  const tokenEstimate = input.useLlm
    ? estimateTokens({
        articles: input.rankedArticles,
        payload: input.payload
      })
    : { input: null, output: null };
  const estimatedCostUsd = estimateCostUsd({
    inputTokens: tokenEstimate.input,
    outputTokens: tokenEstimate.output,
    pricing: input.pricing
  });

  return {
    rss_attempted: sumRss(input.rssDiagnostics, "attempted"),
    rss_succeeded: sumRss(input.rssDiagnostics, "succeeded"),
    rss_failed: sumRss(input.rssDiagnostics, "failed"),
    articles_by_topic: countArticlesByTopic(input.rankedArticles),
    stale_fallback_used: input.rssDiagnostics.some((diagnostic) =>
      Object.values(diagnostic.staleFallbackUsedByTopic).some((fallback) => fallback !== "none")
    ),
    stale_fallback_used_by_topic: mergeFallbacks(input.rssDiagnostics),
    llm_latency_ms: input.useLlm ? input.llmLatencyMs : null,
    llm_timeout_count: input.llmTimedOut ? 1 : 0,
    validation_failures_by_rule: input.validationFailuresByRule ?? {},
    generated_items: input.payload?.items.length ?? 0,
    stored_items: input.storedItems,
    content_items_deduplicated: input.deduplicatedContentItems,
    assigned_users: input.assignedUsers,
    estimated_input_tokens: tokenEstimate.input,
    estimated_output_tokens: tokenEstimate.output,
    estimated_cost_usd: estimatedCostUsd
  };
}

export function buildFailedLanguageJobMetrics(input: {
  errorReason: string | null;
  error: string;
  useLlm: boolean;
}): LanguageJobMetrics {
  return {
    rss_attempted: 0,
    rss_succeeded: 0,
    rss_failed: 0,
    articles_by_topic: emptyTopicCounts(),
    stale_fallback_used: false,
    stale_fallback_used_by_topic: emptyFallbacks(),
    llm_latency_ms: null,
    llm_timeout_count: input.errorReason === "timeout" ? 1 : 0,
    validation_failures_by_rule: input.errorReason === "validation_error" ? parseValidationFailures(input.error) : {},
    generated_items: 0,
    stored_items: 0,
    content_items_deduplicated: 0,
    assigned_users: 0,
    estimated_input_tokens: input.useLlm ? null : null,
    estimated_output_tokens: input.useLlm ? null : null,
    estimated_cost_usd: null
  };
}

export function aggregateJobRunMetrics(
  languageMetrics: Array<{
    language: Language;
    metrics: LanguageJobMetrics;
  }>,
  pricing: PricingConfig
): JobRunMetrics {
  const latencyByLanguage: Partial<Record<Language, number>> = {};
  let latencyTotal = 0;
  let latencyCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let hasTokenEstimate = false;

  for (const result of languageMetrics) {
    if (result.metrics.llm_latency_ms !== null) {
      latencyByLanguage[result.language] = result.metrics.llm_latency_ms;
      latencyTotal += result.metrics.llm_latency_ms;
      latencyCount += 1;
    }

    if (result.metrics.estimated_input_tokens !== null) {
      inputTokens += result.metrics.estimated_input_tokens;
      hasTokenEstimate = true;
    }

    if (result.metrics.estimated_output_tokens !== null) {
      outputTokens += result.metrics.estimated_output_tokens;
      hasTokenEstimate = true;
    }
  }

  return {
    rss_attempted: sumMetric(languageMetrics, "rss_attempted"),
    rss_succeeded: sumMetric(languageMetrics, "rss_succeeded"),
    rss_failed: sumMetric(languageMetrics, "rss_failed"),
    articles_by_topic: mergeTopicCounts(languageMetrics.map((result) => result.metrics.articles_by_topic)),
    stale_fallback_used: languageMetrics.some((result) => result.metrics.stale_fallback_used),
    stale_fallback_used_by_topic: mergeLanguageFallbacks(languageMetrics.map((result) => result.metrics.stale_fallback_used_by_topic)),
    llm_latency_ms: {
      total: latencyCount > 0 ? latencyTotal : null,
      average: latencyCount > 0 ? Math.round(latencyTotal / latencyCount) : null,
      by_language: latencyByLanguage
    },
    llm_timeout_count: sumMetric(languageMetrics, "llm_timeout_count"),
    validation_failures_by_rule: mergeRuleCounts(languageMetrics.map((result) => result.metrics.validation_failures_by_rule)),
    generated_items_by_language: Object.fromEntries(
      languageMetrics.map((result) => [result.language, result.metrics.generated_items])
    ) as Partial<Record<Language, number>>,
    stored_items: sumMetric(languageMetrics, "stored_items"),
    content_items_deduplicated: sumMetric(languageMetrics, "content_items_deduplicated"),
    assigned_users: sumMetric(languageMetrics, "assigned_users"),
    estimated_input_tokens: hasTokenEstimate ? inputTokens : null,
    estimated_output_tokens: hasTokenEstimate ? outputTokens : null,
    estimated_cost_usd:
      hasTokenEstimate && pricing.available
        ? estimateCostUsd({
            inputTokens,
            outputTokens,
            pricing
          })
        : null,
    estimated_cost_available: hasTokenEstimate && pricing.available,
    estimated_cost_reason: pricing.available
      ? "Estimated from character-count token approximation and configured per-1M token prices."
      : pricing.reason
  };
}

export function readPricingConfig(env: NodeJS.ProcessEnv = process.env): PricingConfig {
  const inputCost = readOptionalNumber(env.OPENAI_INPUT_COST_PER_1M_TOKENS);
  const outputCost = readOptionalNumber(env.OPENAI_OUTPUT_COST_PER_1M_TOKENS);

  if (inputCost === null || outputCost === null) {
    return {
      available: false,
      inputCostPerMillion: inputCost,
      outputCostPerMillion: outputCost,
      reason: "Set OPENAI_INPUT_COST_PER_1M_TOKENS and OPENAI_OUTPUT_COST_PER_1M_TOKENS to estimate run cost."
    };
  }

  return {
    available: true,
    inputCostPerMillion: inputCost,
    outputCostPerMillion: outputCost,
    reason: "Pricing configured from OPENAI_*_COST_PER_1M_TOKENS."
  };
}

export function parseValidationFailures(error: string): Record<string, number> {
  const marker = "Generated daily drop failed validation:";
  const detail = error.includes(marker) ? error.slice(error.indexOf(marker) + marker.length) : error;
  const counts: Record<string, number> = {};

  for (const part of detail.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const [path, ...messageParts] = trimmed.split(":");
    const message = messageParts.join(":").trim();
    const rule = normalizeRule(message || path || "unknown_validation_failure");
    counts[rule] = (counts[rule] ?? 0) + 1;
  }

  return counts;
}

function estimateTokens(input: {
  articles: RankedArticle[];
  payload: DailyDropPayload | null;
}): { input: number; output: number | null } {
  const sourceText = input.articles
    .map((article) => [article.title, article.summary, article.body, article.url].filter(Boolean).join("\n"))
    .join("\n\n");
  const outputText = input.payload ? JSON.stringify(input.payload) : "";

  return {
    input: estimateTokensFromText(sourceText),
    output: input.payload ? estimateTokensFromText(outputText) : null
  };
}

function estimateTokensFromText(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function estimateCostUsd(input: {
  inputTokens: number | null;
  outputTokens: number | null;
  pricing: PricingConfig;
}): number | null {
  if (!input.pricing.available || input.inputTokens === null || input.outputTokens === null) {
    return null;
  }

  const inputCost = (input.inputTokens / 1_000_000) * (input.pricing.inputCostPerMillion ?? 0);
  const outputCost = (input.outputTokens / 1_000_000) * (input.pricing.outputCostPerMillion ?? 0);
  return Number((inputCost + outputCost).toFixed(6));
}

function sumRss(diagnostics: RssMetricDiagnostics[], key: "attempted" | "succeeded" | "failed"): number {
  return diagnostics.reduce((sum, diagnostic) => sum + diagnostic[key], 0);
}

function sumMetric<K extends keyof LanguageJobMetrics>(
  languageMetrics: Array<{ metrics: LanguageJobMetrics }>,
  key: K
): number {
  return languageMetrics.reduce((sum, result) => sum + (typeof result.metrics[key] === "number" ? result.metrics[key] : 0), 0);
}

function mergeTopicCounts(counts: Array<Record<TopicId, number>>): Record<TopicId, number> {
  const merged = emptyTopicCounts();
  for (const entry of counts) {
    for (const topic of TOPIC_IDS) {
      merged[topic] += entry[topic] ?? 0;
    }
  }
  return merged;
}

function mergeFallbacks(diagnostics: RssMetricDiagnostics[]): Record<TopicId, string> {
  return mergeLanguageFallbacks(diagnostics.map((diagnostic) => diagnostic.staleFallbackUsedByTopic));
}

function mergeLanguageFallbacks(fallbacks: Array<Record<TopicId, string>>): Record<TopicId, string> {
  const merged = emptyFallbacks();
  for (const fallback of fallbacks) {
    for (const topic of TOPIC_IDS) {
      const value = fallback[topic];
      if (value && value !== "none") {
        merged[topic] = value;
      }
    }
  }
  return merged;
}

function mergeRuleCounts(counts: Array<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const entry of counts) {
    for (const [rule, count] of Object.entries(entry)) {
      merged[rule] = (merged[rule] ?? 0) + count;
    }
  }
  return merged;
}

function emptyFallbacks(): Record<TopicId, string> {
  return Object.fromEntries(TOPIC_IDS.map((topic) => [topic, "none"])) as Record<TopicId, string>;
}

function normalizeRule(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown_validation_failure";
}

function readOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
