import {
  miniCaseTopicToContentTopics,
  type DailyDropPayload,
  type GeneratedContentItem,
  type Language,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import { compactMiniCaseMemoryForPrompt } from "../miniCase/editorialMemory.js";
import {
  MINI_CASE_CONCEPTS,
  MINI_CASE_CORRECT_ANSWER_PATTERNS,
  MINI_CASE_DECISION_TYPES,
  MINI_CASE_QUESTION_PATTERNS,
  MINI_CASE_SCENARIO_TYPES
} from "../miniCase/taxonomy.js";
import { assembleDailyDropPayload } from "../scheduler/dailyDropBuilder.js";
import { DAILY_DROP_SECTION_SCHEMAS } from "./dailyDropSchema.js";
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
  NEWSLETTER_PROMPT_FINAL,
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
          provider: this.provider.name,
          sections: SECTION_ORDER
        });

        // One isolated LLM call per content type. Each call only carries that
        // section's editorial specification (newsletter / business story / mini
        // case), so a generation never sees a foreign prompt: maximal token
        // reduction and zero cross-prompt conflict. The newsletter is generated
        // one article per editorial topic and mini-cases one per product topic —
        // a focused call per topic guarantees the complete edition catalog and
        // keeps each response within the output token budget. This is purely
        // edition-driven: user preferences never influence what is generated.
        const items: GeneratedContentItem[] = [];
        for (const section of SECTION_ORDER) {
          if (section === "newsletter_article") {
            for (const newsletterTopic of request.newsletterTopics) {
              items.push(...(await this.generateSection(section, request, sources, feedback, attempt, { newsletterTopic })));
            }
          } else if (section === "mini_case") {
            for (const miniCaseTopic of miniCaseGenerationTopics(request)) {
              items.push(...(await this.generateSection(section, request, sources, feedback, attempt, { miniCaseTopic })));
            }
          } else {
            items.push(...(await this.generateSection(section, request, sources, feedback, attempt)));
          }
        }

        this.reportProgress("OpenAI request completed", {
          language: request.language,
          attempt,
          max_attempts: this.maxAttempts,
          provider: this.provider.name,
          sections: SECTION_ORDER
        });

        const payload = assembleDailyDropPayload(
          sanitizeLlmDailyDropPayload(
            {
              drop_date: request.dropDate,
              language: request.language,
              prompt_version: PROMPT_VERSION,
              generator_version: LLM_GENERATOR_VERSION,
              items
            },
            sources
          )
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

  // Generates a single content-type section with an isolated LLM call. Only this
  // section's editorial specification is sent; the other prompts are never loaded.
  private async generateSection(
    section: DropSection,
    request: GenerationRequest,
    allSources: SourcePacket[],
    feedback: string | undefined,
    attempt: number,
    topic: SectionTopic = {}
  ): Promise<GeneratedContentItem[]> {
    const scopedSources = scopeSourcesForSectionTopic(section, request, allSources, topic);

    this.reportProgress("LLM section started", {
      language: request.language,
      section,
      newsletter_topic: topic.newsletterTopic ?? null,
      mini_case_topic: topic.miniCaseTopic ?? null,
      attempt,
      editorial_specification: SECTION_SPEC_FILE[section],
      source_count: scopedSources.length
    });

    const raw = await this.provider.generateJson({
      systemPrompt: EDITORIAL_PROMPT,
      userPrompt: buildSectionPrompt(section, request, scopedSources, feedback, topic),
      jsonSchema: DAILY_DROP_SECTION_SCHEMAS[section] as unknown as Record<string, unknown>,
      maxOutputTokens: this.maxOutputTokens
    });

    const items = normalizeSectionItems(raw, section);

    this.reportProgress("LLM section completed", {
      language: request.language,
      section,
      newsletter_topic: topic.newsletterTopic ?? null,
      mini_case_topic: topic.miniCaseTopic ?? null,
      attempt,
      generated_items: items.length
    });

    return items;
  }

  private reportProgress(message: string, details: Record<string, unknown>): void {
    this.onProgress?.(message, details);
  }
}

type DropSection = keyof typeof DAILY_DROP_SECTION_SCHEMAS;

const SECTION_ORDER: DropSection[] = [
  "newsletter_article",
  "business_story",
  "mini_case",
  "concept"
];

const SECTION_SPEC_FILE: Record<DropSection, string> = {
  newsletter_article: "newsletter_prompt_final.md",
  business_story: "business_story_prompt_final.md",
  mini_case: "mini_case_prompt_final.md",
  concept: "(no editorial markdown; daily-drop concept contract only)"
};

const BUSINESS_STORY_TOPICS: TopicId[] = ["business", "finance", "tech_ai"];

// Generic editorial requirements shared by every section. Type-specific lines are
// appended per section so a section never receives another content type's rules.
const GENERIC_EDITORIAL_REQUIREMENTS = [
  "Concise, factual, direct tone for ambitious 18-25 year-old students.",
  "Lead with a sharp thesis, not a school-style summary.",
  "Name the concrete mechanism: the incentive, constraint, bottleneck, default, or trade-off doing the work.",
  "Give a specific implication: who gains leverage, who loses options, which budget/timeline/default changes, or what decision gets harder.",
  "Include one observable signal: churn, renewals, filings, guidance, adoption, safety data, funding costs, deadlines, usage, or behavior.",
  "Make the business judgment sharper than the source summary. Explain the operator's trade-off.",
  "No filler language, generic conclusions, hype, or unsupported predictions.",
  "Do not mention headline loudness or use meta phrases about what the useful question is.",
  "Do not use school-report phrases such as 'This shift means', 'it is important', 'highlights the importance', 'critical in', or 'key in'.",
  "Ground factual claims in the supplied sources only.",
  "Do not invent URLs, dates, authors, institutions, numbers, or quotes.",
  "Make each item relevant to its topic; do not force a source into the wrong topic."
];

const NEWSLETTER_EDITORIAL_REQUIREMENTS = [
  "Do not repeat the same body structure across every newsletter item."
];

const MINI_CASE_EDITORIAL_REQUIREMENTS = [
  "For law/compliance, health/pharma, and finance, frame mini-cases as business or compliance decisions. Never provide legal advice, medical advice, diagnosis, treatment guidance, or personalized financial advice.",
  "For mini_case, obey editorial memory: do not repeat banned scenario_type, concept_tested, decision_type, question_pattern, titles, or slugs. Use exactly 3 MCQ questions with instant feedback."
];

const BUSINESS_STORY_EDITORIAL_REQUIREMENTS = [
  "For business_story, obey editorial memory: do not repeat banned entities, companies, mechanisms, industries, strategic angles, titles, or slugs. Prefer underused industries, mechanisms, entity types, geographies, and time periods."
];

const MINI_CASE_ANTI_REPEAT_RULES = [
  "No same scenario_type within 10 days.",
  "No same concept_tested within 7 days.",
  "No same decision_type within 5 days.",
  "No same topic more than 2 days in a row globally if avoidable.",
  "No same question_pattern within 14 days.",
  "No same title or slug ever."
];

const BUSINESS_STORY_ANTI_REPEAT_RULES = [
  "No same entity_name within 180 days.",
  "No same main_company within 90 days unless the strategic_angle is clearly different.",
  "No same key_mechanism within 14 days.",
  "No same industry more than twice in 14 days.",
  "No same strategic_angle within 30 days.",
  "No same title or slug ever."
];

// Builds the user prompt for ONE section. Only that section's editorial
// specification, output contract, anti-repeat rules, and editorial memory are
// included, so foreign prompts are never sent to the model.
type SectionTopic = {
  newsletterTopic?: TopicId;
  miniCaseTopic?: MiniCaseTopicId | null;
};

function buildSectionPrompt(
  section: DropSection,
  request: GenerationRequest,
  sources: SourcePacket[],
  feedback?: string,
  topic: SectionTopic = {}
): string {
  const allowedSourceUrls = sources.map((source) => source.url);

  const prompt: Record<string, unknown> = {
    task: `Generate ONLY the ${section} portion of one PersoNewsAP daily drop as structured JSON only.`,
    retry_feedback: feedback ?? null,
    output_contract: {
      drop_date: request.dropDate,
      language: request.language,
      prompt_version: PROMPT_VERSION,
      generator_version: LLM_GENERATOR_VERSION,
      items: [sectionItemsExpectation(section, request, topic)],
      schema_notes: [
        "Emit a JSON object whose items array contains ONLY this section's item(s).",
        "Use the exact field names from the JSON schema.",
        "Use content_type and slot values exactly.",
        "Use source_urls only from allowed_source_urls.",
        "Every body_md must include a concise source line with a YYYY-MM-DD date.",
        "Every body_md source line must include the exact source URL string from source_urls.",
        sectionSpecNote(section),
        "The only valid output structure is this daily drop section schema. Map the editorial specification into these schema fields.",
        "Return JSON only."
      ]
    },
    editorial_requirements: editorialRequirementsForSection(section),
    banned_phrases: BANNED_EDITORIAL_PHRASES,
    stronger_writing_examples: STRONG_WRITING_EXAMPLES,
    content_type_guidance: sectionGuidance(section),
    request: {
      drop_date: request.dropDate,
      language: request.language,
      ...sectionRequestContext(section, request, topic)
    },
    ...sectionMemoryContext(section, request, topic),
    allowed_source_urls: allowedSourceUrls,
    source_material: sources
  };

  return JSON.stringify(prompt, null, 2);
}

function sectionItemsExpectation(
  section: DropSection,
  request: GenerationRequest,
  topic: SectionTopic
): string {
  switch (section) {
    case "newsletter_article":
      return topic.newsletterTopic
        ? `Exactly 1 newsletter_article item with topic "${topic.newsletterTopic}". The items array must contain exactly one newsletter_article.`
        : `Exactly ${request.newsletterArticleCount} newsletter_article item(s)`;
    case "business_story":
      return "Exactly 1 business_story item";
    case "mini_case":
      return topic.miniCaseTopic
        ? `Exactly 1 mini_case item with product_topic "${topic.miniCaseTopic}". The items array must contain exactly one mini_case.`
        : "Exactly 1 mini_case item";
    case "concept":
      return "Exactly 1 concept item";
  }
}

// One mini-case is generated per requested product topic. When no product topics
// are requested, a single default mini-case (null) keeps the existing behaviour.
function miniCaseGenerationTopics(request: GenerationRequest): (MiniCaseTopicId | null)[] {
  const topics = request.miniCaseProductTopics ?? [];
  return topics.length > 0 ? topics : [null];
}

function sectionSpecNote(section: DropSection): string {
  if (section === "concept") {
    return "content_type_guidance.concept defines the concept daily-drop output contract.";
  }

  return `content_type_guidance.${section}.editorial_specification defines editorial style, depth, and quality. It is NOT the output envelope: any standalone JSON object shown inside it is illustrative only.`;
}

function editorialRequirementsForSection(section: DropSection): string[] {
  switch (section) {
    case "newsletter_article":
      return [...GENERIC_EDITORIAL_REQUIREMENTS, ...NEWSLETTER_EDITORIAL_REQUIREMENTS];
    case "business_story":
      return [...GENERIC_EDITORIAL_REQUIREMENTS, ...BUSINESS_STORY_EDITORIAL_REQUIREMENTS];
    case "mini_case":
      return [...GENERIC_EDITORIAL_REQUIREMENTS, ...MINI_CASE_EDITORIAL_REQUIREMENTS];
    case "concept":
      return GENERIC_EDITORIAL_REQUIREMENTS;
  }
}

function sectionGuidance(section: DropSection): Record<string, unknown> {
  switch (section) {
    case "newsletter_article":
      return {
        newsletter_article: {
          editorial_specification: NEWSLETTER_PROMPT_FINAL,
          daily_drop_output_contract: CONTENT_TYPE_PROMPTS.newsletter_article
        }
      };
    case "business_story":
      return {
        business_story: {
          editorial_specification: BUSINESS_STORY_PROMPT_FINAL,
          daily_drop_output_contract: CONTENT_TYPE_PROMPTS.business_story
        }
      };
    case "mini_case":
      return {
        mini_case: {
          editorial_specification: MINI_CASE_PROMPT_FINAL,
          daily_drop_output_contract: CONTENT_TYPE_PROMPTS.mini_case
        }
      };
    case "concept":
      return { concept: CONTENT_TYPE_PROMPTS.concept };
  }
}

function sectionRequestContext(
  section: DropSection,
  request: GenerationRequest,
  topic: SectionTopic
): Record<string, unknown> {
  switch (section) {
    case "newsletter_article":
      return topic.newsletterTopic
        ? { newsletter_topics: [topic.newsletterTopic], newsletter_article_count: 1 }
        : {
            newsletter_topics: request.newsletterTopics,
            newsletter_article_count: request.newsletterArticleCount
          };
    case "mini_case":
      return { mini_case_product_topics: topic.miniCaseTopic ? [topic.miniCaseTopic] : request.miniCaseProductTopics ?? [] };
    case "concept":
      return { concept_topic: request.newsletterTopics[0] ?? "business" };
    case "business_story":
      return {};
  }
}

function sectionMemoryContext(
  section: DropSection,
  request: GenerationRequest,
  topic: SectionTopic
): Record<string, unknown> {
  if (section === "business_story") {
    return {
      business_story_anti_repeat_rules: BUSINESS_STORY_ANTI_REPEAT_RULES,
      business_story_editorial_memory: compactBusinessStoryMemoryForPrompt(request.businessStoryMemory)
    };
  }

  if (section === "mini_case") {
    return {
      mini_case_anti_repeat_rules: MINI_CASE_ANTI_REPEAT_RULES,
      mini_case_rotation_context: {
        selected_topics: topic.miniCaseTopic ? [topic.miniCaseTopic] : request.miniCaseProductTopics ?? [],
        // Allowed taxonomy values. These are enforced by both the validators and
        // the database CHECK constraints, so scenario_type, decision_type,
        // concept_tested, question_pattern, and correct_answer_pattern must be
        // chosen ONLY from these lists.
        allowed_scenario_types: MINI_CASE_SCENARIO_TYPES,
        allowed_decision_types: MINI_CASE_DECISION_TYPES,
        allowed_concepts: MINI_CASE_CONCEPTS,
        allowed_question_patterns: MINI_CASE_QUESTION_PATTERNS,
        allowed_correct_answer_patterns: MINI_CASE_CORRECT_ANSWER_PATTERNS,
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
      mini_case_editorial_memory: compactMiniCaseMemoryForPrompt(request.miniCaseMemory)
    };
  }

  return {};
}

// Shows each section only the sources relevant to its topics (with a safe
// fallback to all sources), trimming per-call tokens without ever starving a
// section. Whole-payload source validation still uses the full ranked set.
function scopeSourcesForSectionTopic(
  section: DropSection,
  request: GenerationRequest,
  allSources: SourcePacket[],
  topic: SectionTopic
): SourcePacket[] {
  if (section === "newsletter_article" && topic.newsletterTopic) {
    return scopeSourcesByTopics(allSources, [topic.newsletterTopic]);
  }
  if (section === "mini_case" && topic.miniCaseTopic) {
    return scopeSourcesByTopics(allSources, miniCaseTopicToContentTopics(topic.miniCaseTopic));
  }
  return scopeSourcesForSection(section, request, allSources);
}

function scopeSourcesForSection(
  section: DropSection,
  request: GenerationRequest,
  allSources: SourcePacket[]
): SourcePacket[] {
  return scopeSourcesByTopics(allSources, sectionSourceTopics(section, request));
}

function scopeSourcesByTopics(allSources: SourcePacket[], topics: TopicId[] | null): SourcePacket[] {
  if (!topics || topics.length === 0) {
    return allSources;
  }

  const allowed = new Set(topics);
  const scoped = allSources.filter((source) => allowed.has(source.topic));
  return scoped.length > 0 ? scoped : allSources;
}

function sectionSourceTopics(section: DropSection, request: GenerationRequest): TopicId[] | null {
  switch (section) {
    case "newsletter_article":
      return request.newsletterTopics;
    case "business_story":
      return BUSINESS_STORY_TOPICS;
    case "mini_case":
      return Array.from(new Set((request.miniCaseProductTopics ?? []).flatMap(miniCaseTopicToContentTopics)));
    case "concept":
      return [request.newsletterTopics[0] ?? "business"];
  }
}

function normalizeSectionItems(payload: unknown, section: DropSection): GeneratedContentItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new LlmGenerationError(
      "validation_error",
      `LLM ${section} response must be an object with an items array.`
    );
  }

  return payload.items as GeneratedContentItem[];
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
