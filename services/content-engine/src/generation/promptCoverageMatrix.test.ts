import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LANGUAGES,
  MINI_CASE_TOPIC_IDS,
  TOPIC_IDS,
  miniCaseTopicToContentTopics,
  type Language,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import { emptyMiniCaseMemoryContext } from "../miniCase/editorialMemory.js";
import { LlmContentGenerator } from "./llmGenerator.js";
import type { LlmJsonRequest, LlmProvider } from "./llmProvider.js";
import type { EditorialSection } from "./modelRouting.js";
import {
  BUSINESS_STORY_PROMPT_FINAL,
  CONTENT_TYPE_PROMPTS,
  MINI_CASE_PROMPT_FINAL,
  NEWSLETTER_PROMPT_FINAL,
  PROMPT_VERSION
} from "./prompts.js";

/**
 * Prompt coverage matrix.
 *
 * This is not a "the prompt file is non-empty" test. For every combination the
 * product actually generates — Newsletter x 8 topics x FR/EN, Mini Case x 6
 * topics x FR/EN, Business Story x FR/EN — it captures the FINAL assembled
 * prompt handed to the model and asserts the prompt really carries the language,
 * the topic, the content-type rules, the JSON output contract, the source
 * constraints, the right guardrails, and enough context to produce a coherent
 * item.
 *
 * It also proves the assembled prompt embeds the versioned Markdown editorial
 * specification verbatim, and that no second, simplified editorial prompt exists
 * anywhere in the TypeScript sources to short-circuit those three files.
 */

const PROMPT_HEADERS = {
  newsletter_article: "# PROMPT NEWSLETTER — VERSION PRODUCTION COMPLÈTE",
  business_story: "# BUSINESS STORY PROMPT — VERSION PRODUCTION MOBILE EDUCATION PREMIUM",
  mini_case: "# MINI CASE PROMPT — VERSION PRODUCTION MOBILE EDUCATION PREMIUM"
} as const satisfies Record<EditorialSection, string>;

const EDITORIAL_SPECIFICATIONS = {
  newsletter_article: NEWSLETTER_PROMPT_FINAL,
  business_story: BUSINESS_STORY_PROMPT_FINAL,
  mini_case: MINI_CASE_PROMPT_FINAL
} as const satisfies Record<EditorialSection, string>;

const DROP_DATE = "2026-08-17";

/** The fields of the assembled prompt this matrix asserts on. */
type PromptBody = {
  output_contract: {
    drop_date: string;
    language: Language;
    prompt_version: string;
    items: string[];
    schema_notes: string[];
  };
  request: {
    language: Language;
    newsletter_topics?: TopicId[];
    newsletter_items_per_topic?: number;
    mini_case_product_topics?: MiniCaseTopicId[];
  };
  editorial_requirements: string[];
  banned_phrases: string[];
  content_type_guidance: Partial<
    Record<EditorialSection, { editorial_specification: string; daily_drop_output_contract: string }>
  >;
  allowed_source_urls: string[];
  source_material: Array<{
    url: string;
    title: string;
    publisher: string;
    published_at: string | null;
    topic: TopicId;
  }>;
  mini_case_anti_repeat_rules?: string[];
  mini_case_rotation_context?: {
    selected_topics: MiniCaseTopicId[];
    allowed_scenario_types: readonly string[];
    allowed_decision_types: readonly string[];
    allowed_concepts: readonly string[];
    allowed_question_patterns: readonly string[];
    allowed_correct_answer_patterns: readonly string[];
    allowed_topic_framing: Record<string, string>;
    forbidden_advice_language: string[];
    ux_contract: string[];
  };
  mini_case_editorial_memory?: unknown;
  business_story_anti_repeat_rules?: string[];
  business_story_editorial_memory?: unknown;
};

type CapturedPrompt = {
  raw: string;
  systemPrompt: string;
  body: PromptBody;
};

class PromptCapturingProviderError extends Error {
  constructor() {
    super("prompt captured");
    this.name = "PromptCapturingProviderError";
  }
}

/**
 * Captures the assembled prompt and then aborts, so no fake editorial content is
 * ever needed and the generator cannot advance past the call under test.
 */
function capturingProvider(sink: { request?: LlmJsonRequest }): LlmProvider {
  return {
    name: "prompt-capture",
    async generateJson(request: LlmJsonRequest): Promise<unknown> {
      sink.request = request;
      throw new PromptCapturingProviderError();
    }
  };
}

function rankedArticle(topic: TopicId, language: Language, index: number): RankedArticle {
  return {
    url: `https://sources.test/${language}/${topic}/${index}`,
    title: `${topic} development ${index}`,
    publisher: `${topic} desk ${index}`,
    author: null,
    published_at: `${DROP_DATE}T08:00:00.000Z`,
    retrieved_at: `${DROP_DATE}T09:00:00.000Z`,
    language,
    summary: `A concrete ${topic} development a reader can reuse.`,
    body: `Body about ${topic}.`,
    sourceTopic: topic,
    credibility_score: 0.9,
    content_hash: `hash-${language}-${topic}-${index}`,
    normalized_url: `https://sources.test/${language}/${topic}/${index}`,
    topic,
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

async function capturePrompt(input: {
  section: EditorialSection;
  language: Language;
  newsletterTopic?: TopicId;
  miniCaseTopic?: MiniCaseTopicId;
}): Promise<CapturedPrompt> {
  const sink: { request?: LlmJsonRequest } = {};
  const generator = new LlmContentGenerator({
    providerForSection: () => capturingProvider(sink),
    maxAttempts: 1
  });

  const articles = TOPIC_IDS.flatMap((topic) =>
    LANGUAGES.map((language) => rankedArticle(topic, language, 1))
  );

  await expect(
    generator.generateDailyDrop({
      dropDate: DROP_DATE,
      language: input.language,
      articles,
      newsletterTopics: input.newsletterTopic ? [input.newsletterTopic] : [...TOPIC_IDS],
      newsletterArticleCount: 2,
      sections: [input.section],
      miniCaseProductTopics: input.miniCaseTopic ? [input.miniCaseTopic] : [],
      miniCaseMemory: emptyMiniCaseMemoryContext()
    })
  ).rejects.toThrow();

  const request = sink.request;
  if (!request) {
    throw new Error(`No prompt captured for ${input.section}.`);
  }

  return {
    raw: request.userPrompt,
    systemPrompt: request.systemPrompt,
    body: JSON.parse(request.userPrompt) as PromptBody
  };
}

/** Assertions every section must satisfy, whatever its topic or language. */
function expectSharedPromptCoverage(prompt: CapturedPrompt, section: EditorialSection, language: Language): void {
  // Requested language.
  expect(prompt.body.output_contract.language).toBe(language);
  expect(prompt.body.request.language).toBe(language);
  expect(prompt.systemPrompt).toContain("Use the requested language exactly: fr or en.");

  // Content-type specific rules, and ONLY this content type's rules.
  const guidance = prompt.body.content_type_guidance[section];
  expect(guidance).toBeDefined();
  expect(guidance?.editorial_specification).toBe(EDITORIAL_SPECIFICATIONS[section]);
  expect(guidance?.editorial_specification).toContain(PROMPT_HEADERS[section]);
  expect(guidance?.daily_drop_output_contract).toBe(CONTENT_TYPE_PROMPTS[section]);
  for (const other of Object.keys(PROMPT_HEADERS) as EditorialSection[]) {
    if (other === section) {
      continue;
    }
    expect(prompt.body.content_type_guidance[other]).toBeUndefined();
    expect(prompt.raw).not.toContain(PROMPT_HEADERS[other]);
  }

  // Expected JSON contract.
  expect(prompt.body.output_contract.prompt_version).toBe(PROMPT_VERSION);
  expect(prompt.body.output_contract.drop_date).toBe(DROP_DATE);
  expect(prompt.body.output_contract.schema_notes.join(" ")).toContain("Use the exact field names from the JSON schema.");
  expect(prompt.body.output_contract.schema_notes.join(" ")).toContain("Return JSON only.");
  expect(prompt.systemPrompt).toContain("Return structured JSON only.");

  // Source constraints.
  expect(Array.isArray(prompt.body.allowed_source_urls)).toBe(true);
  expect(prompt.body.allowed_source_urls.length).toBeGreaterThan(0);
  expect(prompt.body.output_contract.schema_notes.join(" ")).toContain("Use source_urls only from allowed_source_urls.");
  expect(prompt.body.editorial_requirements.join(" ")).toContain("Ground factual claims in the supplied sources only.");
  expect(prompt.body.editorial_requirements.join(" ")).toContain(
    "Do not invent URLs, dates, authors, institutions, numbers, or quotes."
  );

  // Guardrails shared by every content type.
  expect(prompt.body.banned_phrases.length).toBeGreaterThan(0);
  expect(prompt.systemPrompt).toContain(
    "For legal, medical, and financial topics, explain facts, incentives, uncertainty, and context."
  );

  // Enough material to write a logical, sourced item.
  expect(prompt.body.source_material.length).toBeGreaterThan(0);
  for (const source of prompt.body.source_material) {
    expect(source.url).toMatch(/^https:\/\//);
    expect(source.title.length).toBeGreaterThan(0);
    expect(source.publisher.length).toBeGreaterThan(0);
    expect(source.published_at).toBeTruthy();
    expect(prompt.body.allowed_source_urls).toContain(source.url);
  }
}

describe("prompt coverage matrix: Newsletter x 8 topics x FR/EN", () => {
  for (const topic of TOPIC_IDS) {
    for (const language of LANGUAGES) {
      it(`assembles a complete newsletter prompt for ${topic}/${language}`, async () => {
        const prompt = await capturePrompt({ section: "newsletter_article", language, newsletterTopic: topic });

        expectSharedPromptCoverage(prompt, "newsletter_article", language);

        // Requested topic.
        expect(prompt.body.request.newsletter_topics).toEqual([topic]);
        expect(prompt.body.output_contract.items.join(" ")).toContain(`topic "${topic}"`);
        expect(prompt.body.request.newsletter_items_per_topic).toBeGreaterThan(0);

        // Newsletter-specific rules.
        expect(prompt.body.content_type_guidance.newsletter_article!.daily_drop_output_contract).toContain(
          "Newsletter article output contract"
        );
        expect(prompt.body.editorial_requirements.join(" ")).toContain(
          "Do not repeat the same body structure across every newsletter item."
        );
        // The newsletter spec owns recency and per-category source priority.
        expect(prompt.body.content_type_guidance.newsletter_article!.editorial_specification).toContain(
          "RÈGLE DE TEMPORALITÉ (STRICTE — NON NÉGOCIABLE)"
        );
        expect(prompt.body.content_type_guidance.newsletter_article!.editorial_specification).toContain(
          "FORMAT DE SORTIE : JSON (OBLIGATOIRE)"
        );

        // Mini-case and business-story memory must not leak into a newsletter call.
        expect(prompt.body.mini_case_editorial_memory).toBeUndefined();
        expect(prompt.body.business_story_editorial_memory).toBeUndefined();
      });
    }
  }
});

describe("prompt coverage matrix: Mini Case x 6 topics x FR/EN", () => {
  for (const topic of MINI_CASE_TOPIC_IDS) {
    for (const language of LANGUAGES) {
      it(`assembles a complete mini-case prompt for ${topic}/${language}`, async () => {
        const prompt = await capturePrompt({ section: "mini_case", language, miniCaseTopic: topic });

        expectSharedPromptCoverage(prompt, "mini_case", language);

        // Requested topic.
        expect(prompt.body.request.mini_case_product_topics).toEqual([topic]);
        expect(prompt.body.output_contract.items.join(" ")).toContain(`product_topic "${topic}"`);
        expect(prompt.body.mini_case_rotation_context!.selected_topics).toEqual([topic]);

        // Mini-case interactive contract: 3 questions, 4 options, one correct,
        // feedback per option, score_max 3, final_takeaway.
        const contract = prompt.body.content_type_guidance.mini_case!.daily_drop_output_contract;
        expect(contract).toContain("exactly 3 MCQ questions");
        expect(contract).toContain("exactly 4 options (A/B/C/D)");
        expect(contract).toContain("exactly one with is_correct true");
        expect(contract).toContain("single short feedback string");
        expect(contract).toContain("Set score_max to 3");
        expect(contract).toContain("final_takeaway");
        expect(prompt.body.mini_case_rotation_context!.ux_contract.join(" ")).toContain("exactly 3 MCQ questions");

        // Taxonomy the validators and DB CHECK constraints enforce.
        expect(prompt.body.mini_case_rotation_context!.allowed_scenario_types.length).toBeGreaterThan(0);
        expect(prompt.body.mini_case_rotation_context!.allowed_decision_types.length).toBeGreaterThan(0);
        expect(prompt.body.mini_case_rotation_context!.allowed_concepts.length).toBeGreaterThan(0);
        expect(prompt.body.mini_case_rotation_context!.allowed_question_patterns.length).toBeGreaterThan(0);
        expect(prompt.body.mini_case_rotation_context!.allowed_correct_answer_patterns.length).toBeGreaterThan(0);

        // Topic-appropriate guardrails: never personal legal/medical/financial advice.
        const forbidden = prompt.body.mini_case_rotation_context!.forbidden_advice_language.join(" ");
        expect(forbidden).toContain("law_compliance is business/compliance/legal-risk education only, never personal legal advice.");
        expect(forbidden).toContain("never diagnosis or treatment advice");
        expect(forbidden).toContain("stock_market is market education only, never buy/sell instructions.");
        expect(prompt.body.mini_case_rotation_context!.allowed_topic_framing[topic]).toBeTruthy();
        expect(prompt.body.editorial_requirements.join(" ")).toContain(
          "Never provide legal advice, medical advice, diagnosis, treatment guidance, or personalized financial advice."
        );

        // Anti-repetition memory is present so five cases per topic can differ.
        expect(prompt.body.mini_case_anti_repeat_rules.length).toBeGreaterThan(0);
        expect(prompt.body.mini_case_editorial_memory).toBeDefined();

        // Sources are scoped to the topics this mini-case topic maps to.
        const allowedContentTopics = new Set<TopicId>(miniCaseTopicToContentTopics(topic));
        for (const source of prompt.body.source_material) {
          expect(allowedContentTopics.has(source.topic)).toBe(true);
        }
      });
    }
  }
});

describe("prompt coverage matrix: Business Story x FR/EN", () => {
  for (const language of LANGUAGES) {
    it(`assembles a complete business-story prompt for ${language}`, async () => {
      const prompt = await capturePrompt({ section: "business_story", language });

      expectSharedPromptCoverage(prompt, "business_story", language);

      // Business Story has no product topic; it must still be pinned to one item.
      expect(prompt.body.output_contract.items.join(" ")).toContain("Exactly 1 business_story item");

      const contract = prompt.body.content_type_guidance.business_story!.daily_drop_output_contract;
      expect(contract).toContain("setup, tension, decision, outcome, lesson, and body_md");
      expect(contract).toContain("editorial_memory");
      expect(contract).toContain("Do not provide investment recommendations.");

      // Diversity machinery: anti-repeat rules plus injected editorial memory.
      expect(prompt.body.business_story_anti_repeat_rules.join(" ")).toContain("No same entity_name within 180 days.");
      expect(prompt.body.business_story_anti_repeat_rules.join(" ")).toContain("No same title or slug ever.");
      expect(prompt.body.business_story_editorial_memory).toBeDefined();
      expect(prompt.body.editorial_requirements.join(" ")).toContain(
        "Prefer underused industries, mechanisms, entity types, geographies, and time periods."
      );

      // Mini-case rotation context must not leak into a business-story call.
      expect(prompt.body.mini_case_rotation_context).toBeUndefined();
    });
  }
});

describe("no simplified editorial prompt short-circuits the three Markdown files", () => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  it("keeps the full Markdown specification as the only editorial source in assembled prompts", async () => {
    for (const section of Object.keys(PROMPT_HEADERS) as EditorialSection[]) {
      const prompt = await capturePrompt({
        section,
        language: "en",
        newsletterTopic: section === "newsletter_article" ? "business" : undefined,
        miniCaseTopic: section === "mini_case" ? "finance_economy" : undefined
      });

      const specification = prompt.body.content_type_guidance[section]?.editorial_specification ?? "";
      // Byte-identical to the versioned Markdown: not a paraphrase, not a summary.
      expect(specification).toBe(EDITORIAL_SPECIFICATIONS[section]);
      expect(specification.length).toBeGreaterThan(2000);
    }
  });

  it("never copies the editorial Markdown into a TypeScript module", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScriptFiles(sourceRoot)) {
      // Tests may name the headers: they use them as assertion markers, not as
      // prompt text sent to a model.
      if (file.endsWith(".test.ts")) {
        continue;
      }

      const contents = readFileSync(file, "utf8");
      for (const header of Object.values(PROMPT_HEADERS)) {
        if (contents.includes(header)) {
          offenders.push(`${file} contains "${header}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("loads every editorial specification through the single prompt library", () => {
    const promptLibrary = readFileSync(join(sourceRoot, "generation", "promptLibrary.ts"), "utf8");
    expect(promptLibrary).toContain("business_story_prompt_final.md");
    expect(promptLibrary).toContain("mini_case_prompt_final.md");
    expect(promptLibrary).toContain("newsletter_prompt_final.md");

    const prompts = readFileSync(join(sourceRoot, "generation", "prompts.ts"), "utf8");
    expect(prompts).toContain('from "./promptLibrary.js"');
  });
});

function* walkTypeScriptFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      yield* walkTypeScriptFiles(fullPath);
      continue;
    }
    if (fullPath.endsWith(".ts")) {
      yield fullPath;
    }
  }
}
