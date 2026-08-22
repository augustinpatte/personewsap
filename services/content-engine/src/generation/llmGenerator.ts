import {
  NEWSLETTER_ITEMS_PER_TOPIC,
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
import {
  businessStoryJudgeRejectionReasons,
  type BusinessStoryEditorialJudge
} from "./businessStoryEditorialJudge.js";
import { DAILY_DROP_SECTION_SCHEMAS } from "./dailyDropSchema.js";
import { compactBusinessStoryMemoryForPrompt } from "./editorialMemory.js";
import { LlmGenerationError, serializeLlmFailure, toLlmGenerationError } from "./llmErrors.js";
import type { LlmProvider } from "./llmProvider.js";
import { sanitizeLlmDailyDropPayload } from "./llmSanitizer.js";
import {
  createRoutedProviderFactory,
  type EditorialSection,
  type LlmCallMetric,
  type SectionProviderContext
} from "./modelRouting.js";
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
import {
  EDITORIAL_SECTION_ORDER,
  requestedSections,
  type ContentGenerator,
  type GenerationRequest
} from "./types.js";
import {
  BANNED_EDITORIAL_PHRASES,
  buildSourceIndex,
  validateGeneratedItem,
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
  provider?: LlmProvider;
  providerForSection?: (context: SectionProviderContext) => LlmProvider;
  maxOutputTokens?: number;
  maxAttempts?: number;
  onLlmCallMetric?: (metric: LlmCallMetric) => void;
  onProgress?: (message: string, details: Record<string, unknown>) => void;
  /**
   * Semantic QA over every generated Business Story.
   *
   * Optional: without it the deterministic gates stand alone, which is what
   * fixtures and tests use. With it, a refused story becomes a validation issue
   * and the existing retry loop asks the model again.
   */
  businessStoryJudge?: BusinessStoryEditorialJudge;
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
  private readonly providerForSection: (context: SectionProviderContext) => LlmProvider;
  private readonly maxOutputTokens: number;
  private readonly maxAttempts: number;
  private readonly onProgress?: (message: string, details: Record<string, unknown>) => void;
  /** Optional semantic QA over each generated Business Story. */
  private readonly businessStoryJudge: LlmContentGeneratorOptions["businessStoryJudge"];

  constructor(options: LlmContentGeneratorOptions) {
    if (options.providerForSection) {
      this.providerForSection = options.providerForSection;
    } else if (options.provider) {
      this.providerForSection = () => options.provider as LlmProvider;
    } else {
      this.providerForSection = createRoutedProviderFactory({
        onCallMetric: options.onLlmCallMetric
      });
    }
    this.maxOutputTokens = options.maxOutputTokens ?? 6500;
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.onProgress = options.onProgress;
    this.businessStoryJudge = options.businessStoryJudge;
  }

  async generateDailyDrop(request: GenerationRequest): Promise<DailyDropPayload> {
    const sources = sourcePackets(request);
    if (sources.length === 0) {
      throw new LlmGenerationError("validation_error", `No source articles available for ${request.language} LLM generation.`);
    }

    // One isolated LLM call per content type/topic. Each call only carries that
    // section's editorial specification (newsletter / business story / mini
    // case), so a failed mini-case topic never forces successful newsletter or
    // business-story generations to be repeated.
    const items: GeneratedContentItem[] = [];
    // A topic with no source of its own is skipped, not faked and not fatal:
    // one starved topic must not take the other seven down with it. The skip is
    // recorded so the run reports exactly what was missing.
    const skippedForMissingSources: Array<{ section: DropSection; topic: string }> = [];

    const generateTopic = async (
      section: DropSection,
      topic: SectionTopic,
      label: string
    ): Promise<void> => {
      try {
        items.push(...(await this.generateSectionWithRetries(section, request, sources, topic)));
      } catch (error) {
        const failure = toLlmGenerationError(error);

        if (failure.reason !== "insufficient_source_material") {
          throw failure;
        }

        skippedForMissingSources.push({ section, topic: label });
        this.reportProgress("LLM section skipped for missing sources", {
          language: request.language,
          section,
          topic: label,
          reason: failure.reason
        });
      }
    };

    for (const section of requestedSections(request)) {
      if (section === "newsletter_article") {
        for (const newsletterTopic of request.newsletterTopics) {
          await generateTopic(section, { newsletterTopic }, newsletterTopic);
        }
      } else if (section === "mini_case") {
        for (const miniCaseTopic of miniCaseGenerationTopics(request)) {
          await generateTopic(section, { miniCaseTopic }, miniCaseTopic ?? section);
        }
      } else {
        await generateTopic(section, {}, section);
      }
    }

    // Everything was starved: that is a genuine failure, not a thin edition.
    if (items.length === 0 && skippedForMissingSources.length > 0) {
      throw new LlmGenerationError(
        "insufficient_source_material",
        `No section had relevant source material: ${skippedForMissingSources
          .map((entry) => `${entry.section}/${entry.topic}`)
          .join(", ")}.`
      );
    }

    if (skippedForMissingSources.length > 0) {
      this.reportProgress("LLM sections skipped for missing sources", {
        language: request.language,
        skipped: skippedForMissingSources
      });
    }

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

    if (issues.length > 0) {
      // Name the offending items, not just their indexes: a failed run is
      // otherwise impossible to diagnose without re-generating it.
      const offenders = [...new Set(issues.map((issue) => issue.path.split(".")[1]))]
        .map((index) => payload.items[Number(index)])
        .filter((item): item is GeneratedContentItem => Boolean(item))
        .map((item) => `${item.content_type}/${item.topic ?? "none"}: "${item.title}"`)
        .join(" | ");

      throw new LlmGenerationError(
        "validation_error",
        `LLM generated catalog failed final validation: ${formatIssues(issues)}${
          offenders ? ` -- offending items: ${offenders}` : ""
        }`,
        // Carry the rejected payload so a failed run can be inspected without
        // paying to regenerate it.
        { payload }
      );
    }

    return payload;
  }

  /**
   * Semantic QA over a generated Business Story, as a validation issue.
   *
   * Returning issues rather than throwing puts the verdict into the existing
   * retry loop: the model is told what was wrong and asked again, and only a
   * story that fails every attempt takes the section down. That is the right
   * shape for the daily job, where a refusal is a missing section rather than a
   * batch an operator will read.
   *
   * The daily job generates each language as its own run, so there is no pair
   * here and no parity to judge. The catalog repair, which does build pairs,
   * calls the same judge with both halves.
   *
   * Fail closed: a judge that errors or times out produces an issue, never a
   * silent pass.
   */
  private async judgeBusinessStories(
    section: DropSection,
    items: GeneratedContentItem[],
    request: GenerationRequest
  ): Promise<Array<{ path: string; message: string }>> {
    const judge = this.businessStoryJudge;

    if (!judge || section !== "business_story") {
      return [];
    }

    const stories = items.filter(
      (item): item is Extract<GeneratedContentItem, { content_type: "business_story" }> =>
        item.content_type === "business_story"
    );
    const issues: Array<{ path: string; message: string }> = [];

    for (const [index, story] of stories.entries()) {
      try {
        const result = await judge.judge({
          reference: { language: request.language, item: story }
        });
        const rejections = businessStoryJudgeRejectionReasons(result.verdict);

        this.reportProgress("business story editorial QA", {
          language: request.language,
          model: judge.model,
          pass: result.verdict.pass && rejections.length === 0,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          cost_usd: result.costUsd,
          cost_verified: result.costVerified
        });

        if (rejections.length > 0) {
          issues.push({
            path: `items.${index}`,
            message: `Business story editorial QA refused this story: ${rejections.join(" | ")}`
          });
        }
      } catch (error) {
        issues.push({
          path: `items.${index}`,
          message: `Business story editorial QA could not check this story (${
            error instanceof Error ? error.message : String(error)
          }). The story is refused rather than published unchecked.`
        });
      }
    }

    return issues;
  }

  private async generateSectionWithRetries(
    section: DropSection,
    request: GenerationRequest,
    allSources: SourcePacket[],
    topic: SectionTopic = {}
  ): Promise<GeneratedContentItem[]> {
    let feedback: string | undefined;
    let lastError: LlmGenerationError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const items = await this.generateSection(section, request, allSources, feedback, attempt, topic);
        const issues = [
          ...validateSectionItems(items, section, request, topic, allSources),
          ...(await this.judgeBusinessStories(section, items, request))
        ];
        if (issues.length === 0) {
          return items;
        }

        feedback = formatIssues(issues);
        lastError = new LlmGenerationError(
          "validation_error",
          `LLM ${section} failed validation on attempt ${attempt}: ${feedback}`
        );
        this.reportProgress("LLM section validation failed", {
          language: request.language,
          section,
          newsletter_topic: topic.newsletterTopic ?? null,
          mini_case_topic: topic.miniCaseTopic ?? null,
          attempt,
          max_attempts: this.maxAttempts,
          failure_reason: "validation_error",
          issue_count: issues.length
        });
      } catch (error) {
        lastError = toLlmGenerationError(error);

        // Missing sources is a fact about the input, not a flaky call: another
        // attempt would ask the same model the same impossible question.
        if (lastError.reason === "insufficient_source_material") {
          throw lastError;
        }

        feedback = lastError.message;
        this.reportProgress("LLM section attempt failed", {
          language: request.language,
          section,
          newsletter_topic: topic.newsletterTopic ?? null,
          mini_case_topic: topic.miniCaseTopic ?? null,
          attempt,
          max_attempts: this.maxAttempts,
          failure: serializeLlmFailure(lastError),
          error: lastError.message
        });
      }

      if (attempt < this.maxAttempts) {
        const retryDelayMs = retryDelay(attempt);
        this.reportProgress("LLM section retry scheduled", {
          language: request.language,
          section,
          newsletter_topic: topic.newsletterTopic ?? null,
          mini_case_topic: topic.miniCaseTopic ?? null,
          next_attempt: attempt + 1,
          max_attempts: this.maxAttempts,
          retry_delay_ms: retryDelayMs,
          failure: serializeLlmFailure(lastError)
        });
        await sleep(retryDelayMs);
      }
    }

    throw lastError ?? new Error(`LLM ${section} failed before an attempt was recorded.`);
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

    // No article is better than a misleading one: with no source of its own,
    // this section is not generated from unrelated material and is not handed
    // to the model to invent an angle for.
    if (scopedSources.length === 0 && allSources.length > 0) {
      const scopeLabel = topic.newsletterTopic ?? topic.miniCaseTopic ?? section;

      this.reportProgress("LLM section skipped: insufficient source material", {
        language: request.language,
        section,
        newsletter_topic: topic.newsletterTopic ?? null,
        mini_case_topic: topic.miniCaseTopic ?? null,
        available_source_count: allSources.length,
        scoped_source_count: 0
      });

      throw new LlmGenerationError(
        "insufficient_source_material",
        `No relevant source material for ${section} (${scopeLabel}). Refusing to generate from unrelated sources.`
      );
    }

    this.reportProgress("LLM section started", {
      language: request.language,
      section,
      newsletter_topic: topic.newsletterTopic ?? null,
      mini_case_topic: topic.miniCaseTopic ?? null,
      attempt,
      editorial_specification: SECTION_SPEC_FILE[section],
      source_count: scopedSources.length
    });

    const provider = this.providerForSection({
      section,
      language: request.language,
      newsletterTopic: topic.newsletterTopic,
      miniCaseTopic: topic.miniCaseTopic,
      attempt,
      maxAttempts: this.maxAttempts
    });

    const raw = await provider.generateJson({
      systemPrompt: EDITORIAL_PROMPT,
      userPrompt: buildSectionPrompt(section, request, scopedSources, feedback, topic),
      jsonSchema: DAILY_DROP_SECTION_SCHEMAS[section] as unknown as Record<string, unknown>,
      maxOutputTokens: this.maxOutputTokens,
      schemaName: `personewsap_${section}`
    });

    const items = applyCanonicalSectionTopic(
      normalizeSectionItems(raw, section),
      section,
      topic,
      scopedSources
    );

    this.reportProgress("LLM section completed", {
      language: request.language,
      section,
      newsletter_topic: topic.newsletterTopic ?? null,
      mini_case_topic: topic.miniCaseTopic ?? null,
      attempt,
      provider: provider.name,
      generated_items: items.length
    });

    return items;
  }

  private reportProgress(message: string, details: Record<string, unknown>): void {
    this.onProgress?.(message, details);
  }
}

type DropSection = EditorialSection;

const SECTION_ORDER: DropSection[] = EDITORIAL_SECTION_ORDER;

const SECTION_SPEC_FILE: Record<DropSection, string> = {
  newsletter_article: "newsletter_prompt_final.md",
  business_story: "business_story_prompt_final.md",
  mini_case: "mini_case_prompt_final.md"
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
  // The live proof produced "2026-08-26" from a source that said only "next
  // week": a generic "do not invent dates" was not enough, because the model
  // did not experience computing a date as inventing one.
  "DATES: write a calendar date only when the supplied source material states that exact date. If a source gives relative timing (\"next week\", \"in the coming days\", \"later this month\", \"prochainement\", \"dans les prochains jours\"), keep the relative wording. Never convert relative timing into a precise date, never infer a deadline, release, hearing or meeting date, and never compute one from the publication date. Beyond dates the source states, the only date you may cite is the source's own publication/retrieval date, used as a citation.",
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
    ...sectionLanguagePairContext(section, request),
    allowed_source_urls: allowedSourceUrls,
    source_material: sources
  };

  return JSON.stringify(prompt, null, 2);
}

// Rules for producing the counterpart language of an already-generated catalog
// entry. The editorial specification still governs how the item is written; this
// block only pins the invariants that must not drift between the FR and EN
// versions of the SAME entry.
export const LANGUAGE_PAIR_RULES = [
  "You are writing the counterpart-language version of an existing catalog entry, not a new entry.",
  "Keep identical: the sourced facts, the source URLs, the dates, the mechanism, the difficulty, the reasoning path, the taxonomy fields, and the correct answer.",
  "For a mini_case, keep the same number of questions, the same question roles in the same order, the same option ids A/B/C/D, and mark exactly the SAME option id as is_correct in every question.",
  "Do NOT translate word by word. Rewrite the entry natively in the requested language so it reads as if it had been written in that language first.",
  "Localize rhythm, idioms, connectors, and sentence structure; keep proper nouns, company names, URLs, and ISO dates unchanged.",
  "Never leave any sentence, option, or feedback string in the reference language. The output must be 100% in the requested language.",
  "Titles must be natural in the requested language, not a transliteration, but must describe the same story or case."
];

function sectionLanguagePairContext(section: DropSection, request: GenerationRequest): Record<string, unknown> {
  const pair = request.languagePair;
  if (!pair || pair.referenceItems.length === 0) {
    return {};
  }

  const referenceItems = pair.referenceItems.filter((item) => item.content_type === section);
  if (referenceItems.length === 0) {
    return {};
  }

  return {
    language_pair_context: {
      reference_language: pair.referenceLanguage,
      target_language: request.language,
      rules: LANGUAGE_PAIR_RULES,
      reference_items: referenceItems
    }
  };
}

function sectionItemsExpectation(
  section: DropSection,
  request: GenerationRequest,
  topic: SectionTopic
): string {
  switch (section) {
    case "newsletter_article":
      return topic.newsletterTopic
        ? `Exactly ${newsletterItemsPerTopic(request)} distinct newsletter_article items with topic "${topic.newsletterTopic}". The items array must contain exactly ${newsletterItemsPerTopic(request)} newsletter_article items.`
        : `Exactly ${expectedNewsletterCount(request)} newsletter_article item(s)`;
    case "business_story":
      return "Exactly 1 business_story item";
    case "mini_case":
      return topic.miniCaseTopic
        ? `Exactly 1 mini_case item with product_topic "${topic.miniCaseTopic}". The items array must contain exactly one mini_case.`
        : "Exactly 1 mini_case item";
  }
}

// One mini-case is generated per requested product topic. When no product topics
// are requested, a single default mini-case (null) keeps the existing behaviour.
function miniCaseGenerationTopics(request: GenerationRequest): (MiniCaseTopicId | null)[] {
  const topics = request.miniCaseProductTopics ?? [];
  return topics.length > 0 ? topics : [null];
}

function sectionSpecNote(section: DropSection): string {
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
        ? {
            newsletter_topics: [topic.newsletterTopic],
            newsletter_items_per_topic: newsletterItemsPerTopic(request),
            newsletter_article_count: newsletterItemsPerTopic(request)
          }
        : {
            newsletter_topics: request.newsletterTopics,
            newsletter_items_per_topic: newsletterItemsPerTopic(request),
            newsletter_article_count: expectedNewsletterCount(request)
          };
    case "mini_case":
      return { mini_case_product_topics: topic.miniCaseTopic ? [topic.miniCaseTopic] : request.miniCaseProductTopics ?? [] };
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

/**
 * Sources a section is allowed to work from.
 *
 * This used to fall back to `allSources` when a topic had no matching source,
 * which is how a topic-scoped call could receive completely unrelated material
 * and be asked to write about it anyway. That is the mechanism behind "no
 * source for tech_ai, so here is a crime story instead".
 *
 * The pool is now exactly the topic's own sources. An empty pool is a real
 * answer — there is nothing to write about — and the caller turns it into an
 * explicit insufficient_source_material failure rather than filling the slot
 * with something misleading.
 */
function scopeSourcesByTopics(allSources: SourcePacket[], topics: TopicId[] | null): SourcePacket[] {
  if (!topics || topics.length === 0) {
    return allSources;
  }

  const allowed = new Set(topics);
  return allSources.filter((source) => allowed.has(source.topic));
}

function sectionSourceTopics(section: DropSection, request: GenerationRequest): TopicId[] | null {
  switch (section) {
    case "newsletter_article":
      return request.newsletterTopics;
    case "business_story":
      return BUSINESS_STORY_TOPICS;
    case "mini_case":
      return Array.from(new Set((request.miniCaseProductTopics ?? []).flatMap(miniCaseTopicToContentTopics)));
  }
}

/**
 * The engine owns the topic, not the model.
 *
 * A topic-scoped call already knows what it is writing about: the section was
 * selected for that topic, and its source packet contains only that topic's
 * sources. Letting the model also emit a `topic` field meant it could
 * reinterpret the section — writing a law item inside the tech_ai call — which
 * then failed validation as a title/topic or source-topic mismatch. The engine's
 * decision is simply imposed.
 *
 * For an unscoped section (business story), the topic is pinned to a topic that
 * is actually present in its own source packet, so the item can never claim a
 * topic none of its cited sources support.
 */
export function applyCanonicalSectionTopic(
  items: GeneratedContentItem[],
  section: DropSection,
  topic: SectionTopic,
  scopedSources: Array<{ topic: TopicId; url?: string }>
): GeneratedContentItem[] {
  const scopedTopic =
    section === "newsletter_article" ? topic.newsletterTopic ?? null : null;
  const packetTopics = new Set(scopedSources.map((source) => source.topic));

  return items.map((item) => {
    if (scopedTopic) {
      return { ...item, topic: scopedTopic } as GeneratedContentItem;
    }

    // Unscoped section: the topic must be one the item's OWN cited sources
    // support. Checking the whole packet was not enough — a mini case scoped to
    // several content topics could claim "medicine" while citing only a tech_ai
    // source, which is exactly the source_topic_mismatch seen live.
    const citedUrls = new Set(Array.isArray(item.source_urls) ? item.source_urls : []);
    const citedTopics = scopedSources
      .filter((source) => citedUrls.has((source as { url?: string }).url ?? ""))
      .map((source) => source.topic);
    const supportingTopics = citedTopics.length > 0 ? citedTopics : [...packetTopics];

    if (item.topic && supportingTopics.includes(item.topic)) {
      return item;
    }

    const fallbackTopic = supportingTopics[0] ?? item.topic ?? null;

    return { ...item, topic: fallbackTopic } as GeneratedContentItem;
  });
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

function validateSectionItems(
  items: GeneratedContentItem[],
  section: DropSection,
  request: GenerationRequest,
  topic: SectionTopic,
  sources: SourcePacket[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expectedCount = expectedSectionItemCount(section, request);

  if (items.length !== expectedCount) {
    issues.push({
      path: "items",
      message: `Expected ${expectedCount} ${section} item(s), received ${items.length}.`
    });
  }

  items.forEach((item, index) => {
    if (item.content_type !== section) {
      issues.push({
        path: `items.${index}.content_type`,
        message: `Expected content_type ${section}, received ${item.content_type}.`
      });
    }
    if (item.language !== request.language) {
      issues.push({
        path: `items.${index}.language`,
        message: `Expected language ${request.language}, received ${item.language}.`
      });
    }
    if (section === "newsletter_article" && topic.newsletterTopic && item.topic !== topic.newsletterTopic) {
      issues.push({
        path: `items.${index}.topic`,
        message: `Expected newsletter topic ${topic.newsletterTopic}, received ${item.topic ?? "null"}.`
      });
    }
    if (section === "mini_case" && topic.miniCaseTopic && item.content_type === "mini_case" && item.product_topic !== topic.miniCaseTopic) {
      issues.push({
        path: `items.${index}.product_topic`,
        message: `Expected mini-case product_topic ${topic.miniCaseTopic}, received ${item.product_topic}.`
      });
    }
  });

  issues.push(...validateSourceUse({
    drop_date: request.dropDate,
    language: request.language,
    prompt_version: PROMPT_VERSION,
    generator_version: LLM_GENERATOR_VERSION,
    items
  }, sources));

  // Ungrounded figures and dates are caught here, per section, so the retry
  // gets exact feedback and rewrites this item. Running the check only on the
  // assembled payload meant an invented date failed the whole edition with no
  // attempt left to fix it.
  issues.push(...validateSectionQuality(items, request, sources));

  return issues;
}

/** Per-item claim grounding against the section's own source packet. */
/**
 * The full editorial quality bar, applied to one section while an attempt is
 * still available.
 *
 * Every one of these rules used to run only on the assembled payload, so a
 * single weak headline, an invented date, a duplicated MCQ option or a piece of
 * personal-advice phrasing failed the entire edition with nothing left to fix
 * it — and the model was never told. The bar itself is unchanged: the same
 * strict checks run again on the finished payload. What changed is that a
 * section now gets its own verdict, in time to act on it.
 */
function validateSectionQuality(
  items: GeneratedContentItem[],
  request: GenerationRequest,
  sources: SourcePacket[]
): ValidationIssue[] {
  const sectionSources = request.articles.filter((article) =>
    sources.some((source) => source.url === article.url)
  );

  if (sectionSources.length === 0) {
    return [];
  }

  const quality = validateDailyDropQuality(
    {
      drop_date: request.dropDate,
      language: request.language,
      prompt_version: PROMPT_VERSION,
      generator_version: LLM_GENERATOR_VERSION,
      items
    },
    {
      articles: sectionSources,
      // The section bar is the run's own bar, never a stricter one: a routing or
      // dry run must not be held to production strictness it never asked for.
      productionStrict: request.productionStrict ?? readProductionContentStrict(),
      rssOnly: sectionSources.every((article) => !isSampleUrl(article.url))
    }
  );

  return [
    ...quality.issues.filter((issue) => issue.severity === "error"),
    ...items.flatMap((item, index) => validateGeneratedItem(item, `items.${index}`))
  ].map((issue) => ({ path: issue.path, message: issue.message }));
}

function expectedSectionItemCount(section: DropSection, request: GenerationRequest): number {
  if (section === "newsletter_article") {
    return newsletterItemsPerTopic(request);
  }
  return 1;
}

function sourcePackets(request: GenerationRequest): SourcePacket[] {
  // Normal generation only sees same-language source material. When generating
  // the counterpart language of an existing catalog entry, the allowed sources
  // are exactly the sources the reference version cited — a source document's
  // own language is independent of the language the item is written in.
  const pairSourceUrls = new Set((request.languagePair?.referenceItems ?? []).flatMap((item) => item.source_urls));
  const candidates =
    pairSourceUrls.size > 0
      ? request.articles.filter((article) => pairSourceUrls.has(article.url))
      : request.crossLanguageSources === true
        ? // Catalog inventory: the factual basis is chosen on quality and
          // relevance, and a source's own language does not decide which
          // language the entry is written in.
          request.articles
        : request.articles.filter((article) => article.language === request.language);

  return candidates
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
  const sections = new Set(requestedSections(request));

  const expectedNewsletterItems = sections.has("newsletter_article") ? expectedNewsletterCount(request) : 0;
  if (newsletterCount !== expectedNewsletterItems) {
    issues.push({
      path: "items",
      message: `Expected ${expectedNewsletterItems} newsletter_article item(s), received ${newsletterCount}.`
    });
  }

  const expectedBusinessStoryCount = sections.has("business_story") ? 1 : 0;
  if (businessStoryCount !== expectedBusinessStoryCount) {
    issues.push({
      path: "items",
      message: `Expected ${expectedBusinessStoryCount} business_story item, received ${businessStoryCount}.`
    });
  }

  const expectedMiniCaseCount = sections.has("mini_case") ? request.miniCaseProductTopics?.length ?? 1 : 0;
  if (miniCaseCount !== expectedMiniCaseCount) {
    issues.push({ path: "items", message: `Expected ${expectedMiniCaseCount} mini_case item(s), received ${miniCaseCount}.` });
  }

  if (conceptCount !== 0) {
    issues.push({ path: "items", message: `Expected 0 concept item(s) for new daily drops, received ${conceptCount}.` });
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

function newsletterItemsPerTopic(request: GenerationRequest): number {
  if (request.newsletterItemsPerTopic !== undefined) {
    return request.newsletterItemsPerTopic;
  }

  if (request.newsletterTopics.length > 0 && request.newsletterArticleCount % request.newsletterTopics.length === 0) {
    return Math.max(1, request.newsletterArticleCount / request.newsletterTopics.length);
  }

  return NEWSLETTER_ITEMS_PER_TOPIC;
}

function expectedNewsletterCount(request: GenerationRequest): number {
  return request.newsletterTopics.length * newsletterItemsPerTopic(request);
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
