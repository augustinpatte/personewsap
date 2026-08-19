import {
  LANGUAGES,
  TOPIC_IDS,
  type DailyDropPayload,
  type GeneratedContentItem,
  type Language,
  type TopicId,
  isLanguage,
  isTopicId
} from "../domain.js";
import { LlmContentGenerator } from "../generation/llmGenerator.js";
import { classifyLlmFailure, serializeLlmFailure, LlmGenerationError, type LlmFailureReason } from "../generation/llmErrors.js";
import {
  DEFAULT_OPENAI_ENDPOINT,
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS
} from "../generation/openAiProvider.js";
import {
  validateDailyDropPayload,
  validateDailyDropQuality,
  type ContentQualityDiagnostics,
  type ValidationIssue
} from "../generation/validation.js";
import { processArticlesWithRelevanceGate } from "../processing/pipeline.js";
import {
  createLunaRelevanceClassifier,
  emptyRelevanceGateDiagnostics,
  type RelevanceGateDiagnostics
} from "../processing/relevanceClassifier.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { CURATED_SOURCE_COVERAGE, CURATED_SOURCES } from "../sources/curatedSources.js";
import { RssFeedConnector, type RssFetchDiagnostics } from "../sources/rssFetcher.js";
import {
  createRoutedProviderFactory,
  hasVerifiedPricing,
  resolveContentModelRouting,
  toSafeModelRoutingSummary,
  type ContentModelRoute,
  type ContentModelRouting,
  type EditorialSection,
  type LlmCallMetric
} from "../generation/modelRouting.js";
import { getProductEditionDate } from "../scheduler/editionCadence.js";

const DEFAULT_TOPICS = "business,finance";
const DEFAULT_LIMIT_PER_SOURCE = 1;
const DEFAULT_SOURCE_ARTICLE_LIMIT = 6;
const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_MAX_OUTPUT_TOKENS = 4500;
export type LlmProofOptions = {
  dropDate: string;
  languages: Language[];
  topics: TopicId[];
  limitPerSource: number;
  sourceArticleLimit: number;
  maxAttempts: number;
  maxOutputTokens: number;
  /**
   * Diagnostic escape hatch: pin every section to one model instead of using
   * production routing. Off by default — a proof that does not exercise the
   * routed providers proves nothing about production.
   */
  overrideModel: string | null;
  /** Diagnostic only: run the deterministic gate without the Luna stage. */
  disableRelevanceClassifier: boolean;
};

export type LlmProofOutput = {
  mode: "llm-proof";
  persisted: false;
  dryRun: true;
  liveRss: true;
  useLlm: true;
  rssOnly: true;
  llmConfig: {
    /** How the proof chose models: production routing, or a pinned override. */
    routing_mode: "production_routing" | "single_model_override";
    routing: Record<string, unknown>;
    override_model: string | null;
    endpoint_host: string;
    request_timeout_ms: number;
    max_attempts: number;
    max_output_tokens: number;
    api_key_configured: boolean;
    api_key_logged: false;
    pricing_verified: boolean;
  };
  /** Every model call the proof actually made, with usage and cost. */
  llmCalls: LlmCallMetric[];
  llmCallTotals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    reasoning_output_tokens: number;
    estimated_cost_usd: number | null;
    /** False while gpt-5.6 pricing is still the built-in placeholder. */
    cost_is_verified: boolean;
    models_used: string[];
  };
  sourceConfig: {
    limit_per_source: number;
    source_article_limit: number;
    rss_timeout_ms: number | null;
    rss_max_age_days: number | null;
    rss_allow_stale: boolean;
  };
  sourceCoverage: typeof CURATED_SOURCE_COVERAGE;
  languages: Array<{
    language: Language;
    status: "passed" | "failed";
    fetched_articles: number;
    processed_articles: number;
    source_articles_sent_to_llm: number;
    generated_items: number;
    rss: RssFetchDiagnostics;
    /** What the source relevance gate decided, including the Luna stage. */
    relevance_gate: RelevanceGateDiagnostics;
    validation: {
      status: "passed" | "failed";
      issues: ValidationIssue[];
    };
    quality: ContentQualityDiagnostics | null;
    failure_reason: LlmFailureReason | null;
    error: string | null;
    top_ranked_sources: Array<{
      title: string;
      publisher: string;
      topic: TopicId;
      importance_score: number;
      url: string;
      published_at: string | null;
    }>;
  }>;
  drops: DailyDropPayload[];
  /** Generated but rejected, so a failed proof stays inspectable. */
  rejectedDrops: Array<{ language: Language; payload: DailyDropPayload }>;
};

export async function runLlmProof(options: LlmProofOptions): Promise<LlmProofOutput> {
  logProgress("proof started", {
    dry_run: true,
    live_rss: true,
    use_llm: true,
    rss_only: true,
    languages: options.languages,
    topics: options.topics,
    limit_per_source: options.limitPerSource,
    source_article_limit: options.sourceArticleLimit,
    max_attempts: options.maxAttempts,
    max_output_tokens: options.maxOutputTokens,
    routing_mode: options.overrideModel ? "single_model_override" : "production_routing",
    routing: toSafeModelRoutingSummary(
      options.overrideModel
        ? pinRoutingToModel(resolveContentModelRouting(), options.overrideModel)
        : resolveContentModelRouting()
    ),
    request_timeout_ms: readRequestTimeoutMs(),
    strict_llm_proof: isStrictLlmProof(),
    api_key_configured: Boolean(process.env.OPENAI_API_KEY)
  });

  // Production routing by default: this is the whole point of the proof. The
  // previous implementation constructed one OpenAiJsonProvider directly, so it
  // silently exercised whatever OPENAI_MODEL happened to be — and reported a
  // model production never uses.
  const routing = options.overrideModel
    ? pinRoutingToModel(resolveContentModelRouting(), options.overrideModel)
    : resolveContentModelRouting();
  const llmCalls: LlmCallMetric[] = [];
  // One classifier for the whole proof: ambiguous candidates only, batched.
  const classifier = options.disableRelevanceClassifier
    ? null
    : createLunaRelevanceClassifier();
  const generator = new LlmContentGenerator({
    providerForSection: createRoutedProviderFactory({
      routing,
      onCallMetric: (metric) => {
        llmCalls.push(metric);
        logProgress("LLM call completed", {
          provider: metric.provider,
          model: metric.model,
          section: metric.content_type,
          language: metric.language,
          topic: metric.topic,
          attempt: metric.attempt,
          fallback: metric.fallback,
          input_tokens: metric.input_tokens,
          output_tokens: metric.output_tokens,
          cached_input_tokens: metric.cached_input_tokens,
          reasoning_output_tokens: metric.reasoning_output_tokens,
          estimated_cost_usd: metric.estimated_cost_usd
        });
      }
    }),
    maxAttempts: options.maxAttempts,
    maxOutputTokens: options.maxOutputTokens,
    onProgress: logProgress
  });
  const languages: LlmProofOutput["languages"] = [];
  const drops: DailyDropPayload[] = [];
  /** Payloads that were generated but rejected by validation, kept for review. */
  const rejectedDrops: Array<{ language: Language; payload: DailyDropPayload }> = [];

  for (const language of options.languages) {
    const rssConnector = new RssFeedConnector(CURATED_SOURCES);
    let rawArticles: Awaited<ReturnType<RssFeedConnector["fetchArticles"]>> = [];
    let rankedArticles: Awaited<
      ReturnType<typeof processArticlesWithRelevanceGate>
    >["articles"] = [];
    let relevanceGate: RelevanceGateDiagnostics = emptyRelevanceGateDiagnostics();
    let generatedPayload: DailyDropPayload | null = null;

    try {
      logProgress("RSS-only source fetch started", {
        language,
        topics: options.topics,
        limit_per_source: options.limitPerSource
      });

      rawArticles = await rssConnector.fetchArticles({
        topics: options.topics,
        languages: [language],
        since: options.dropDate,
        limitPerSource: options.limitPerSource
      });

      assertNoSampleUrls(rawArticles.map((article) => article.url), "source articles");

      // Real production path: deterministic gate, then one batched Luna call
      // for whatever is genuinely ambiguous, then ranking.
      const processed = await processArticlesWithRelevanceGate({
        articles: rawArticles,
        classifier,
        onProgress: logProgress
      });

      relevanceGate = processed.relevanceGate;
      logProgress("relevance gate completed", { language, ...processed.relevanceGate });

      rankedArticles = processed.articles
        .filter((article) => article.language === language)
        .slice(0, options.sourceArticleLimit);

      if (rankedArticles.length === 0) {
        throw new LlmGenerationError(
          "validation_error",
          `LLM proof has zero ranked ${language} RSS articles. Check topic/language coverage and rss_source_health logs.`
        );
      }

      const coveredTopics = options.topics.filter((topic) =>
        rankedArticles.some((article) => article.topic === topic)
      );

      if (coveredTopics.length === 0) {
        throw new LlmGenerationError(
          "insufficient_source_material",
          `No requested topic has relevant ${language} source material after the relevance gate.`
        );
      }

      logProgress("newsletter topics covered by sources", {
        language,
        requested: options.topics,
        covered: coveredTopics,
        dropped: options.topics.filter((topic) => !coveredTopics.includes(topic))
      });

      logProgress("LLM proof generation started", {
        language,
        fetched_articles: rawArticles.length,
        ranked_articles: rankedArticles.length,
        source_articles_sent_to_llm: rankedArticles.length
      });

      const payload = assembleDailyDropPayload(
        (generatedPayload = await generator.generateDailyDrop({
          dropDate: options.dropDate,
          language,
          articles: rankedArticles,
          // Only topics that actually have source material after the relevance
          // gate. Asking for a topic whose sources were all rejected is an
          // impossible request: the section is skipped and the edition then
          // fails a composition count it could never have met.
          newsletterTopics: coveredTopics,
          newsletterArticleCount: coveredTopics.length,
          // Lean proof: one article per topic instead of the production catalog's
          // NEWSLETTER_ITEMS_PER_TOPIC, keeping the proof cheap and fast.
          newsletterItemsPerTopic: 1,
          productionStrict: true
        }))
      );

      const quality = validateDailyDropQuality(payload, {
        articles: rankedArticles,
        rssOnly: true,
        productionStrict: true
      });
      const validationIssues = validateLlmProofPayload(payload, language, quality);
      if (validationIssues.length > 0) {
        throw new LlmGenerationError(
          "validation_error",
          `LLM proof validation failed for ${language}: ${validationIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`
        );
      }

      assertNoSampleUrls(payload.items.flatMap((item) => item.source_urls), "generated source_urls");

      logProgress("LLM proof validation passed", {
        language,
        generated_items: payload.items.length
      });

      languages.push({
        language,
        status: "passed",
        fetched_articles: rawArticles.length,
        processed_articles: rankedArticles.length,
        source_articles_sent_to_llm: rankedArticles.length,
        generated_items: payload.items.length,
        rss: rssConnector.getLastDiagnostics(),
        relevance_gate: relevanceGate,
        validation: {
          status: "passed",
          issues: []
        },
        quality,
        failure_reason: null,
        error: null,
        top_ranked_sources: rankedArticles.slice(0, 5).map((article) => ({
          title: article.title,
          publisher: article.publisher,
          topic: article.topic,
          importance_score: article.importance_score,
          url: article.url,
          published_at: article.published_at ?? null
        }))
      });
      drops.push(payload);
    } catch (error) {
      const failure = serializeLlmFailure(error);

      // A rejected payload is exactly what needs inspecting: keep it rather
      // than discarding the only evidence of what the model actually wrote.
      const failedPayload =
        generatedPayload ??
        (error instanceof LlmGenerationError && error.payload
          ? (error.payload as DailyDropPayload)
          : null);

      if (failedPayload) {
        rejectedDrops.push({ language, payload: failedPayload });
      }

      logProgress("LLM proof language failed", {
        language,
        failure,
        error: error instanceof Error ? error.message : String(error)
      });

      languages.push({
        language,
        status: "failed",
        fetched_articles: rawArticles.length,
        processed_articles: rankedArticles.length,
        source_articles_sent_to_llm: rankedArticles.length,
        generated_items: 0,
        rss: rssConnector.getLastDiagnostics(),
        relevance_gate: relevanceGate,
        validation: {
          status: "failed",
          issues: []
        },
        quality: null,
        failure_reason: failure?.reason ?? classifyLlmFailure(error) ?? "api_error",
        error: error instanceof Error ? error.message : String(error),
        top_ranked_sources: rankedArticles.slice(0, 5).map((article) => ({
          title: article.title,
          publisher: article.publisher,
          topic: article.topic,
          importance_score: article.importance_score,
          url: article.url,
          published_at: article.published_at ?? null
        }))
      });

      if (isStrictLlmProof()) {
        break;
      }
    }
  }

  const succeeded = languages.filter((result) => result.status === "passed").length;
  const failed = languages.length - succeeded;
  if (failed > 0 && (succeeded === 0 || isStrictLlmProof())) {
    process.exitCode = 1;
  }

  return {
    mode: "llm-proof",
    persisted: false,
    dryRun: true,
    liveRss: true,
    useLlm: true,
    rssOnly: true,
    llmConfig: readSafeLlmConfig(options, routing),
    llmCalls,
    llmCallTotals: summarizeLlmCalls(llmCalls),
    sourceConfig: {
      limit_per_source: options.limitPerSource,
      source_article_limit: options.sourceArticleLimit,
      rss_timeout_ms: readOptionalPositiveInteger(process.env.RSS_TIMEOUT_MS),
      rss_max_age_days: readOptionalPositiveInteger(process.env.RSS_MAX_AGE_DAYS),
      rss_allow_stale: process.env.RSS_ALLOW_STALE?.toLowerCase() === "true"
    },
    sourceCoverage: CURATED_SOURCE_COVERAGE,
    languages,
    drops,
    rejectedDrops
  };
}

export function parseLlmProofOptions(args: string[]): LlmProofOptions {
  const values = readFlags(args);

  return {
    dropDate: values.get("date") ?? getProductEditionDate(),
    languages: parseLanguages(values.get("languages") ?? values.get("language") ?? process.env.LANGUAGES ?? "en"),
    topics: parseTopics(values.get("topics") ?? values.get("topic") ?? DEFAULT_TOPICS),
    limitPerSource:
      readPositiveInteger(values.get("limit-per-source") ?? process.env.RSS_ARTICLES_PER_SOURCE, "limit-per-source") ??
      DEFAULT_LIMIT_PER_SOURCE,
    sourceArticleLimit:
      readPositiveInteger(values.get("source-article-limit") ?? process.env.LLM_PROOF_SOURCE_ARTICLES, "source-article-limit") ??
      DEFAULT_SOURCE_ARTICLE_LIMIT,
    maxAttempts:
      readPositiveInteger(values.get("max-attempts") ?? process.env.LLM_PROOF_MAX_ATTEMPTS, "max-attempts") ??
      DEFAULT_MAX_ATTEMPTS,
    // Diagnostic only: `--model x` pins every section to x. Without it the
    // proof runs production routing, which is the default on purpose.
    overrideModel: values.get("model")?.trim() || process.env.LLM_PROOF_MODEL?.trim() || null,
    disableRelevanceClassifier: values.has("no-relevance-classifier"),
    maxOutputTokens:
      readPositiveInteger(values.get("max-output-tokens") ?? process.env.LLM_PROOF_MAX_OUTPUT_TOKENS, "max-output-tokens") ??
      DEFAULT_MAX_OUTPUT_TOKENS
  };
}

function validateLlmProofPayload(
  payload: DailyDropPayload,
  requestedLanguage: Language,
  quality: ContentQualityDiagnostics
): ValidationIssue[] {
  const issues = validateDailyDropPayload(payload);
  issues.push(...quality.issues.filter((issue) => issue.severity === "error"));

  if (payload.language !== requestedLanguage) {
    issues.push({ path: "language", message: `Daily drop language must match requested language ${requestedLanguage}.` });
  }

  payload.items.forEach((item, index) => {
    const itemRecord = item as unknown as Record<string, unknown>;
    for (const field of ["title", "language", "topic", "body_md", "source_urls"]) {
      if (!hasRequiredProofField(itemRecord, field)) {
        issues.push({ path: `items.${index}.${field}`, message: `${field} is required for LLM proof output.` });
      }
    }

    if (item.language !== requestedLanguage) {
      issues.push({ path: `items.${index}.language`, message: `Item language must match requested language ${requestedLanguage}.` });
    }
  });

  return issues;
}

function hasRequiredProofField(item: Record<string, unknown>, field: string): boolean {
  const value = item[field];
  if (field === "source_urls") {
    return Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
  }

  return typeof value === "string" && value.trim().length > 0;
}

function assertNoSampleUrls(urls: string[], label: string): void {
  const sampleUrls = urls.filter(isSampleUrl);
  if (sampleUrls.length > 0) {
    throw new Error(
      `LIVE_RSS_ONLY proof detected sample URLs in ${label}: ${sampleUrls.slice(0, 5).join(", ")}. Refusing LLM proof.`
    );
  }
}

function isSampleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "example.com" || url.hostname.endsWith(".example.com");
  } catch {
    return value.includes("example.com");
  }
}

function readSafeLlmConfig(
  options: LlmProofOptions,
  routing: ContentModelRouting
): LlmProofOutput["llmConfig"] {
  const models = routedModels(routing);

  return {
    routing_mode: options.overrideModel ? "single_model_override" : "production_routing",
    routing: toSafeModelRoutingSummary(routing),
    override_model: options.overrideModel,
    endpoint_host: readEndpointHost(),
    request_timeout_ms: readRequestTimeoutMs(),
    max_attempts: options.maxAttempts,
    max_output_tokens: options.maxOutputTokens,
    api_key_configured: Boolean(process.env.OPENAI_API_KEY),
    api_key_logged: false,
    pricing_verified: models.every((model) => hasVerifiedPricing(model))
  };
}

/** Every model the current routing can reach, primary and fallback. */
function routedModels(routing: ContentModelRouting): string[] {
  const sections: EditorialSection[] = ["newsletter_article", "mini_case", "business_story"];

  return [
    ...new Set(
      sections.flatMap((section) =>
        [routing[section].model, routing[section].fallbackModel].filter(
          (model): model is string => Boolean(model)
        )
      )
    )
  ];
}

/** Pins every routed section to one model, for a single-model diagnostic run. */
function pinRoutingToModel(routing: ContentModelRouting, model: string): ContentModelRouting {
  const pin = (route: ContentModelRoute): ContentModelRoute => ({
    ...route,
    provider: "openai",
    model,
    fallbackProvider: "openai",
    fallbackModel: model
  });

  return {
    ...routing,
    newsletter_article: pin(routing.newsletter_article),
    mini_case: pin(routing.mini_case),
    business_story: pin(routing.business_story)
  };
}

/** Adds up what the proof actually spent, per model. */
function summarizeLlmCalls(calls: LlmCallMetric[]): LlmProofOutput["llmCallTotals"] {
  const models = [...new Set(calls.map((call) => call.model))];
  const costs = calls.map((call) => call.estimated_cost_usd);
  const anyCostMissing = costs.some((cost) => cost === null);

  return {
    calls: calls.length,
    input_tokens: sumMetric(calls, "input_tokens"),
    output_tokens: sumMetric(calls, "output_tokens"),
    cached_input_tokens: sumMetric(calls, "cached_input_tokens"),
    reasoning_output_tokens: sumMetric(calls, "reasoning_output_tokens"),
    estimated_cost_usd: anyCostMissing
      ? null
      : Number(costs.reduce<number>((total, cost) => total + (cost ?? 0), 0).toFixed(6)),
    // Placeholder gpt-5.6 rates must never be reported as a confirmed cost.
    cost_is_verified: models.length > 0 && models.every((model) => hasVerifiedPricing(model)),
    models_used: models
  };
}

function sumMetric(calls: LlmCallMetric[], key: keyof LlmCallMetric): number {
  return calls.reduce((total, call) => {
    const value = call[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function readEndpointHost(): string {
  const endpoint = process.env.OPENAI_RESPONSES_ENDPOINT?.trim() || DEFAULT_OPENAI_ENDPOINT;
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid_endpoint";
  }
}

function readRequestTimeoutMs(): number {
  return readOptionalPositiveInteger(process.env.OPENAI_REQUEST_TIMEOUT_MS) ?? DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
}

function isStrictLlmProof(): boolean {
  return process.env.STRICT_LLM_PROOF?.toLowerCase() === "true";
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = args[index + 1];

    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
      continue;
    }

    if (!nextValue || nextValue.startsWith("--")) {
      values.set(rawKey, "true");
      continue;
    }

    values.set(rawKey, nextValue);
    index += 1;
  }

  return values;
}

function parseLanguages(value: string): Language[] {
  const languages = value.split(",").map((language) => language.trim()).filter(Boolean);
  if (languages.length === 0 || languages.some((language) => !isLanguage(language))) {
    throw new Error(`--languages must contain approved languages: ${LANGUAGES.join(", ")}.`);
  }

  return languages as Language[];
}

function parseTopics(value: string): TopicId[] {
  const topics = value.split(",").map((topic) => topic.trim()).filter(Boolean);
  if (topics.length === 0 || topics.some((topic) => !isTopicId(topic))) {
    throw new Error(`--topics must use approved topic IDs: ${TOPIC_IDS.join(", ")}.`);
  }

  return topics as TopicId[];
}

function readPositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function readOptionalPositiveInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function logProgress(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[llm-proof] ${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
}
