import type {
  DailyDropPayload,
  GeneratedContentItem,
  Language,
  RankedArticle,
  TopicId
} from "../domain.js";
import { compactMiniCaseMemoryForPrompt } from "../miniCase/editorialMemory.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { DAILY_DROP_JSON_SCHEMA } from "./dailyDropSchema.js";
import { compactBusinessStoryMemoryForPrompt } from "./editorialMemory.js";
import { LlmGenerationError, serializeLlmFailure, toLlmGenerationError } from "./llmErrors.js";
import type { LlmProvider } from "./llmProvider.js";
import { sanitizeLlmDailyDropPayload } from "./llmSanitizer.js";
import {
  BUSINESS_STORY_PROMPT_FINAL,
  CONTENT_TYPE_PROMPTS,
  EDITORIAL_PROMPT,
  GENERATOR_VERSION,
  MINI_CASE_PROMPT_FINAL,
  PROMPT_VERSION,
  STRONG_WRITING_EXAMPLES
} from "./prompts.js";
import type { ContentGenerator, GenerationRequest } from "./types.js";
import {
  BANNED_EDITORIAL_PHRASES,
  readProductionContentStrict,
  validateDailyDropPayload,
  validateDailyDropQuality,
  type ValidationIssue
} from "./validation.js";

const LLM_GENERATOR_VERSION = `${GENERATOR_VERSION}_llm`;
const MAX_ATTEMPTS = 3;
const MAX_SOURCE_ARTICLES = 12;
const MAX_SOURCE_BODY_CHARS = 1200;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 8_000;

type LlmContentGeneratorOptions = {
  provider: LlmProvider;
  maxOutputTokens?: number;
  maxAttempts?: number;
  onProgress?: (message: string, details: Record<string, unknown>) => void;
};

type SourcePacket = {
  source_id: string;
  topic: TopicId;
  language: Language;
  title: string;
  publisher: string;
  author: string | null;
  url: string;
  published_at: string | null;
  retrieved_at: string;
  summary: string | null;
  body_excerpt: string | null;
  importance_score: number;
  rank_reasons: string[];
};

export class LlmContentGenerator implements ContentGenerator {
  private readonly provider: LlmProvider;
  private readonly maxOutputTokens: number;
  private readonly maxAttempts: number;
  private readonly onProgress?: (message: string, details: Record<string, unknown>) => void;

  constructor(options: LlmContentGeneratorOptions) {
    this.provider = options.provider;
    this.maxOutputTokens = options.maxOutputTokens ?? 6500;
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.onProgress = options.onProgress;
  }

  async generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload> {
    const sources = sourcePackets(request);
    if (sources.length === 0) {
      throw new LlmGenerationError("validation_error", `No source articles available for ${request.language} LLM generation.`);
    }

    let feedback: string | undefined;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        this.reportProgress("OpenAI request started", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          provider: this.provider.name
        });

        const rawPayload = await this.provider.generateJson({
          systemPrompt: EDITORIAL_PROMPT,
          userPrompt: buildDailyDropPrompt(request, sources, feedback),
          jsonSchema: DAILY_DROP_JSON_SCHEMA as unknown as Record<string, unknown>,
          maxOutputTokens: this.maxOutputTokens
        });

        this.reportProgress("OpenAI request completed", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          provider: this.provider.name
        });

        const payload = assembleDailyDropPayload(
          sanitizeLlmDailyDropPayload(normalizePayload(rawPayload, request), sources)
        );
        const quality = validateDailyDropQuality(payload, {
          articles: request.articles,
          productionStrict: request.productionStrict ?? readProductionContentStrict(),
          rssOnly: request.articles.every((article) => !isSampleUrl(article.url)),
          miniCaseProductTopics: request.miniCaseProductTopics,
          miniCaseMemory: request.miniCaseMemory?.recentOverall
        });
        const issues = [
          ...validateDailyDropPayload(payload),
          ...quality.issues.filter((issue) => issue.severity === "error"),
          ...validateComposition(payload, request),
          ...validateSourceUse(payload, sources)
        ];

        if (issues.length === 0) {
          return payload;
        }

        feedback = formatIssues(issues);
        lastError = new LlmGenerationError("validation_error", `LLM generation failed validation on attempt ${attempt}: ${feedback}`);
        this.reportProgress("LLM validation failed", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          failure_reason: "validation_error",
          issue_count: issues.length
        });
      } catch (error) {
        lastError = toLlmGenerationError(error);
        feedback = lastError.message;
        this.reportProgress("LLM generation attempt failed", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          failure: serializeLlmFailure(lastError),
          error: lastError.message
        });
      }

      if (attempt < this.maxAttempts) {
        const retryDelayMs = retryDelay(attempt);
        this.reportProgress("LLM generation retry scheduled", {
          language: request.language,
          next_attempt: attempt + 1,
          max_attempts: this.maxAttempts,
          retry_delay_ms: retryDelayMs,
          failure: serializeLlmFailure(lastError)
        });
        await sleep(retryDelayMs);
      }
    }

    throw lastError ?? new Error("LLM generation failed validation.");
  }

  private reportProgress(message: string, details: Record<string, unknown>): void {
    this.onProgress?.(message, details);
  }
}

function buildDailyDropPrompt(request: GenerationRequest, sources: SourcePacket[], feedback?: string): string {
  const allowedSourceUrls = sources.map((source) => source.url);

  return JSON.stringify(
    {
      task: "Generate one PersoNewsAP daily drop as structured JSON only.",
      retry_feedback: feedback ?? null,
      output_contract: {
        drop_date: request.dropDate,
        language: request.language,
        prompt_version: PROMPT_VERSION,
        generator_version: LLM_GENERATOR_VERSION,
        items: [
          `${request.newsletterArticleCount} newsletter_article items`,
          "1 business_story item",
          `${request.miniCaseProductTopics?.length ?? 1} mini_case item(s), one per requested mini_case_product_topics entry`,
          "1 concept item"
        ],
        schema_notes: [
          "Use the exact field names from the JSON schema.",
          "Use content_type and slot values exactly.",
          "Use source_urls only from allowed_source_urls.",
          "Every body_md must include a concise source line with a YYYY-MM-DD date.",
          "Every body_md source line must include the exact source URL string from source_urls.",
          "content_type_guidance.business_story.editorial_specification and content_type_guidance.mini_case.editorial_specification define editorial style, depth, and quality. They are NOT the output envelope: any standalone JSON object shown inside them is illustrative only.",
          "The only valid output structure is this daily drop JSON schema. Map the editorial specifications into these schema fields.",
          "Return JSON only."
        ]
      },
      editorial_requirements: [
        "Concise, factual, direct tone for ambitious 18-25 year-old students.",
        "Lead with a sharp thesis, not a school-style summary.",
        "Name the concrete mechanism: the incentive, constraint, bottleneck, default, or trade-off doing the work.",
        "Give a specific implication: who gains leverage, who loses options, which budget/timeline/default changes, or what decision gets harder.",
        "Include one observable signal: churn, renewals, filings, guidance, adoption, safety data, funding costs, deadlines, usage, or behavior.",
        "Make the business judgment sharper than the source summary. Explain the operator's trade-off.",
        "No filler language, generic conclusions, hype, or unsupported predictions.",
        "Do not repeat the same body structure across every newsletter item.",
        "Do not mention headline loudness or use meta phrases about what the useful question is.",
        "Do not use school-report phrases such as 'This shift means', 'it is important', 'highlights the importance', 'critical in', or 'key in'.",
        "Ground factual claims in the supplied sources only.",
        "Do not invent URLs, dates, authors, institutions, numbers, or quotes.",
        "Make each item relevant to its topic; do not force a source into the wrong topic.",
        "For law/compliance, health/pharma, and finance, frame mini-cases as business or compliance decisions. Never provide legal advice, medical advice, diagnosis, treatment guidance, or personalized financial advice.",
        "For mini_case, obey editorial memory: do not repeat banned scenario_type, concept_tested, decision_type, question_pattern, titles, or slugs. Use exactly 3 MCQ questions with instant feedback.",
        "For business_story, obey editorial memory: do not repeat banned entities, companies, mechanisms, industries, strategic angles, titles, or slugs. Prefer underused industries, mechanisms, entity types, geographies, and time periods."
      ],
      mini_case_anti_repeat_rules: [
        "No same scenario_type within 10 days.",
        "No same concept_tested within 7 days.",
        "No same decision_type within 5 days.",
        "No same topic more than 2 days in a row globally if avoidable.",
        "No same question_pattern within 14 days.",
        "No same title or slug ever."
      ],
      mini_case_rotation_context: {
        selected_topics: request.miniCaseProductTopics ?? [],
        banned_recent_scenario_types: request.miniCaseMemory?.bannedScenarioTypes ?? [],
        banned_recent_concepts: request.miniCaseMemory?.bannedConcepts ?? [],
        banned_recent_decision_types: request.miniCaseMemory?.bannedDecisionTypes ?? [],
        banned_recent_question_patterns: request.miniCaseMemory?.bannedQuestionPatterns ?? [],
        recent_titles_to_avoid: request.miniCaseMemory?.recentTitles ?? [],
        allowed_topic_framing: request.miniCaseMemory?.allowedFraming ?? {},
        forbidden_advice_language: [
          "law_compliance is business/compliance/legal-risk education only, never personal legal advice.",
          "health_pharma is pharma, healthcare business, public-health, trial, access, regulation, or operations education only, never diagnosis or treatment advice.",
          "stock_market is market education only, never buy/sell instructions."
        ],
        ux_contract: [
          "Each mini-case contains context/introduction, problem to solve, exactly 3 MCQ questions with exactly 4 options each (one correct), a single short feedback string per option, score_max 3, a computable score from 0/3 to 3/3, and a required final_takeaway.",
          "Question 1: method/framework. Question 2: technical/practical application. Question 3: conclusion/decision."
        ]
      },
      business_story_anti_repeat_rules: [
        "No same entity_name within 180 days.",
        "No same main_company within 90 days unless the strategic_angle is clearly different.",
        "No same key_mechanism within 14 days.",
        "No same industry more than twice in 14 days.",
        "No same strategic_angle within 30 days.",
        "No same title or slug ever."
      ],
      banned_phrases: BANNED_EDITORIAL_PHRASES,
      stronger_writing_examples: STRONG_WRITING_EXAMPLES,
      content_type_guidance: {
        newsletter_article: CONTENT_TYPE_PROMPTS.newsletter_article,
        business_story: {
          editorial_specification: BUSINESS_STORY_PROMPT_FINAL,
          daily_drop_output_contract: CONTENT_TYPE_PROMPTS.business_story
        },
        mini_case: {
          editorial_specification: MINI_CASE_PROMPT_FINAL,
          daily_drop_output_contract: CONTENT_TYPE_PROMPTS.mini_case
        },
        concept: CONTENT_TYPE_PROMPTS.concept
      },
      request: {
        drop_date: request.dropDate,
        language: request.language,
        newsletter_topics: request.newsletterTopics,
        newsletter_article_count: request.newsletterArticleCount,
        mini_case_product_topics: request.miniCaseProductTopics ?? []
      },
      business_story_editorial_memory: compactBusinessStoryMemoryForPrompt(request.businessStoryMemory),
      mini_case_editorial_memory: compactMiniCaseMemoryForPrompt(request.miniCaseMemory),
      allowed_source_urls: allowedSourceUrls,
      source_material: sources
    },
    null,
    2
  );
}

function sourcePackets(request: GenerationRequest): SourcePacket[] {
  return request.articles
    .filter((article) => article.language === request.language)
    .slice(0, MAX_SOURCE_ARTICLES)
    .map((article, index) => ({
      source_id: `source_${index + 1}`,
      topic: article.topic,
      language: article.language,
      title: article.title,
      publisher: article.publisher,
      author: article.author ?? null,
      url: article.url,
      published_at: article.published_at ?? null,
      retrieved_at: article.retrieved_at,
      summary: article.summary ?? null,
      body_excerpt: article.body ? compactText(article.body).slice(0, MAX_SOURCE_BODY_CHARS) : null,
      importance_score: article.importance_score,
      rank_reasons: article.rank_reasons
    }));
}

function normalizePayload(payload: unknown, request: GenerationRequest): DailyDropPayload {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new LlmGenerationError("validation_error", "LLM response must be a daily drop object with an items array.");
  }

  return {
    drop_date: request.dropDate,
    language: request.language,
    prompt_version: PROMPT_VERSION,
    generator_version: LLM_GENERATOR_VERSION,
    items: payload.items as GeneratedContentItem[]
  };
}

function validateComposition(payload: DailyDropPayload, request: GenerationRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const newsletterCount = payload.items.filter((item) => item.content_type === "newsletter_article").length;
  const businessStoryCount = payload.items.filter((item) => item.content_type === "business_story").length;
  const miniCaseCount = payload.items.filter((item) => item.content_type === "mini_case").length;
  const conceptCount = payload.items.filter((item) => item.content_type === "concept").length;
  const requestedTopics = new Set<TopicId>(request.newsletterTopics);

  if (newsletterCount !== request.newsletterArticleCount) {
    issues.push({
      path: "items",
      message: `Expected ${request.newsletterArticleCount} newsletter_article item(s), received ${newsletterCount}.`
    });
  }

  if (businessStoryCount !== 1) {
    issues.push({ path: "items", message: `Expected 1 business_story item, received ${businessStoryCount}.` });
  }

  const expectedMiniCaseCount = request.miniCaseProductTopics?.length ?? 1;
  if (miniCaseCount !== expectedMiniCaseCount) {
    issues.push({ path: "items", message: `Expected ${expectedMiniCaseCount} mini_case item(s), received ${miniCaseCount}.` });
  }

  if (conceptCount !== 1) {
    issues.push({ path: "items", message: `Expected 1 concept item, received ${conceptCount}.` });
  }

  payload.items.forEach((item, index) => {
    if (item.content_type !== "mini_case" && item.topic && !requestedTopics.has(item.topic)) {
      issues.push({
        path: `items.${index}.topic`,
        message: `Topic ${item.topic} is outside requested topics: ${request.newsletterTopics.join(", ")}.`
      });
    }
  });

  return issues;
}

function validateSourceUse(payload: DailyDropPayload, sources: SourcePacket[]): ValidationIssue[] {
  const allowedUrls = new Set(sources.map((source) => source.url));
  const issues: ValidationIssue[] = [];

  payload.items.forEach((item, itemIndex) => {
    const sourceUrls = Array.isArray(item.source_urls) ? item.source_urls : [];

    sourceUrls.forEach((url, sourceIndex) => {
      if (!allowedUrls.has(url)) {
        issues.push({
          path: `items.${itemIndex}.source_urls.${sourceIndex}`,
          message: "Source URL must come from supplied source material."
        });
      }
    });
  });

  return issues;
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSampleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "example.com" || url.hostname.endsWith(".example.com");
  } catch {
    return value.includes("example.com");
  }
}

function retryDelay(attempt: number): number {
  const exponentialDelay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exponentialDelay + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
