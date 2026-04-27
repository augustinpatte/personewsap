import type {
  DailyDropPayload,
  GeneratedContentItem,
  Language,
  RankedArticle,
  TopicId
} from "../domain.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { DAILY_DROP_JSON_SCHEMA } from "./dailyDropSchema.js";
import type { LlmProvider } from "./llmProvider.js";
import {
  CONTENT_TYPE_PROMPTS,
  EDITORIAL_PROMPT,
  GENERATOR_VERSION,
  PROMPT_VERSION,
  STRONG_WRITING_EXAMPLES
} from "./prompts.js";
import type { ContentGenerator, GenerationRequest } from "./types.js";
import { BANNED_EDITORIAL_PHRASES, validateDailyDropPayload, type ValidationIssue } from "./validation.js";

const LLM_GENERATOR_VERSION = `${GENERATOR_VERSION}_llm`;
const MAX_ATTEMPTS = 3;
const MAX_SOURCE_ARTICLES = 12;
const MAX_SOURCE_BODY_CHARS = 1200;

type LlmContentGeneratorOptions = {
  provider: LlmProvider;
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
  private readonly maxAttempts: number;
  private readonly onProgress?: (message: string, details: Record<string, unknown>) => void;

  constructor(options: LlmContentGeneratorOptions) {
    this.provider = options.provider;
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.onProgress = options.onProgress;
  }

  async generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload> {
    const sources = sourcePackets(request);
    if (sources.length === 0) {
      throw new Error(`No source articles available for ${request.language} LLM generation.`);
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
          maxOutputTokens: 6500
        });

        this.reportProgress("OpenAI request completed", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          provider: this.provider.name
        });

        const payload = assembleDailyDropPayload(normalizePayload(rawPayload, request));
        const issues = [
          ...validateDailyDropPayload(payload),
          ...validateComposition(payload, request),
          ...validateSourceUse(payload, sources)
        ];

        if (issues.length === 0) {
          return payload;
        }

        feedback = formatIssues(issues);
        lastError = new Error(`LLM generation failed validation on attempt ${attempt}: ${feedback}`);
        this.reportProgress("LLM validation failed", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          issue_count: issues.length
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        feedback = lastError.message;
        this.reportProgress("LLM generation attempt failed", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          error: lastError.message
        });
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
          "1 mini_case item",
          "1 concept item"
        ],
        schema_notes: [
          "Use the exact field names from the JSON schema.",
          "Use content_type and slot values exactly.",
          "Use source_urls only from allowed_source_urls.",
          "Every body_md must include a concise source line with a YYYY-MM-DD date.",
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
        "For law, medicine, and finance, explain context and uncertainty without personalized advice."
      ],
      banned_phrases: BANNED_EDITORIAL_PHRASES,
      stronger_writing_examples: STRONG_WRITING_EXAMPLES,
      content_type_guidance: {
        newsletter_article: CONTENT_TYPE_PROMPTS.newsletter_article,
        business_story: CONTENT_TYPE_PROMPTS.business_story,
        mini_case: CONTENT_TYPE_PROMPTS.mini_case,
        concept: CONTENT_TYPE_PROMPTS.concept
      },
      request: {
        drop_date: request.dropDate,
        language: request.language,
        newsletter_topics: request.newsletterTopics,
        newsletter_article_count: request.newsletterArticleCount
      },
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
    throw new Error("LLM response must be a daily drop object with an items array.");
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

  if (miniCaseCount !== 1) {
    issues.push({ path: "items", message: `Expected 1 mini_case item, received ${miniCaseCount}.` });
  }

  if (conceptCount !== 1) {
    issues.push({ path: "items", message: `Expected 1 concept item, received ${conceptCount}.` });
  }

  payload.items.forEach((item, index) => {
    if (item.topic && !requestedTopics.has(item.topic)) {
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
