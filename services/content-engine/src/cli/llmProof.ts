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
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  OpenAiJsonProvider
} from "../generation/openAiProvider.js";
import {
  validateDailyDropPayload,
  validateDailyDropQuality,
  type ContentQualityDiagnostics,
  type ValidationIssue
} from "../generation/validation.js";
import { processArticles } from "../processing/pipeline.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { CURATED_SOURCE_COVERAGE, CURATED_SOURCES } from "../sources/curatedSources.js";
import { RssFeedConnector, type RssFetchDiagnostics } from "../sources/rssFetcher.js";
import { toDateOnly } from "../utils/date.js";

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
};

export type LlmProofOutput = {
  mode: "llm-proof";
  persisted: false;
  dryRun: true;
  liveRss: true;
  useLlm: true;
  rssOnly: true;
  llmConfig: {
    provider: "openai";
    model: string;
    fallback_model: string | null;
    endpoint_host: string;
    request_timeout_ms: number;
    max_attempts: number;
    max_output_tokens: number;
    api_key_configured: boolean;
    api_key_logged: false;
    token_usage_available: false;
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
    model: readOpenAiModel(),
    fallback_model: readOpenAiFallbackModel(),
    request_timeout_ms: readRequestTimeoutMs(),
    strict_llm_proof: isStrictLlmProof(),
    api_key_configured: Boolean(process.env.OPENAI_API_KEY)
  });

  const generator = new LlmContentGenerator({
    provider: new OpenAiJsonProvider(),
    maxAttempts: options.maxAttempts,
    maxOutputTokens: options.maxOutputTokens,
    onProgress: logProgress
  });
  const languages: LlmProofOutput["languages"] = [];
  const drops: DailyDropPayload[] = [];

  for (const language of options.languages) {
    const rssConnector = new RssFeedConnector(CURATED_SOURCES);
    let rawArticles: Awaited<ReturnType<RssFeedConnector["fetchArticles"]>> = [];
    let rankedArticles: ReturnType<typeof processArticles> = [];

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

      rankedArticles = processArticles(rawArticles)
        .filter((article) => article.language === language)
        .slice(0, options.sourceArticleLimit);

      if (rankedArticles.length === 0) {
        throw new LlmGenerationError(
          "validation_error",
          `LLM proof has zero ranked ${language} RSS articles. Check topic/language coverage and rss_source_health logs.`
        );
      }

      logProgress("LLM proof generation started", {
        language,
        fetched_articles: rawArticles.length,
        ranked_articles: rankedArticles.length,
        source_articles_sent_to_llm: rankedArticles.length
      });

      const payload = assembleDailyDropPayload(
        await generator.generateDailyDrop({
          dropDate: options.dropDate,
          language,
          articles: rankedArticles,
          newsletterTopics: options.topics,
          newsletterArticleCount: 1,
          productionStrict: true
        })
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
    llmConfig: readSafeLlmConfig(options),
    sourceConfig: {
      limit_per_source: options.limitPerSource,
      source_article_limit: options.sourceArticleLimit,
      rss_timeout_ms: readOptionalPositiveInteger(process.env.RSS_TIMEOUT_MS),
      rss_max_age_days: readOptionalPositiveInteger(process.env.RSS_MAX_AGE_DAYS),
      rss_allow_stale: process.env.RSS_ALLOW_STALE?.toLowerCase() === "true"
    },
    sourceCoverage: CURATED_SOURCE_COVERAGE,
    languages,
    drops
  };
}

export function parseLlmProofOptions(args: string[]): LlmProofOptions {
  const values = readFlags(args);

  return {
    dropDate: values.get("date") ?? toDateOnly(new Date()),
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

function readSafeLlmConfig(options: LlmProofOptions): LlmProofOutput["llmConfig"] {
  return {
    provider: "openai",
    model: readOpenAiModel(),
    fallback_model: readOpenAiFallbackModel(),
    endpoint_host: readEndpointHost(),
    request_timeout_ms: readRequestTimeoutMs(),
    max_attempts: options.maxAttempts,
    max_output_tokens: options.maxOutputTokens,
    api_key_configured: Boolean(process.env.OPENAI_API_KEY),
    api_key_logged: false,
    token_usage_available: false
  };
}

function readOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

function readOpenAiFallbackModel(): string | null {
  return process.env.OPENAI_FALLBACK_MODEL?.trim() || null;
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
