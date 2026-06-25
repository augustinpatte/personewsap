import { CONTENT_DIFFICULTIES, LANGUAGES, TOPIC_IDS } from "../domain.js";

const sourceUrlsSchema = {
  type: "array",
  items: {
    type: "string"
  }
} as const;

const baseItemProperties = {
  language: {
    type: "string",
    enum: LANGUAGES
  },
  title: {
    type: "string"
  },
  topic: {
    type: "string",
    enum: TOPIC_IDS
  },
  source_urls: sourceUrlsSchema,
  version: {
    type: "integer"
  }
} as const;

// Per-item schemas. Single source of truth: the full daily-drop schema and each
// per-section schema are both composed from these, so they can never diverge.
export const NEWSLETTER_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "content_type",
    "slot",
    "topic",
    "language",
    "title",
    "published_date",
    "summary",
    "body_md",
    "why_it_matters",
    "source_urls",
    "version"
  ],
  properties: {
    content_type: {
      type: "string",
      enum: ["newsletter_article"]
    },
    slot: {
      type: "string",
      enum: ["newsletter"]
    },
    ...baseItemProperties,
    published_date: {
      type: "string"
    },
    summary: {
      type: "string"
    },
    body_md: {
      type: "string"
    },
    why_it_matters: {
      type: "string"
    }
  }
} as const;

export const BUSINESS_STORY_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "content_type",
    "slot",
    "topic",
    "language",
    "title",
    "company_or_market",
    "story_date",
    "setup",
    "tension",
    "decision",
    "outcome",
    "lesson",
    "body_md",
    "editorial_memory",
    "source_urls",
    "version"
  ],
  properties: {
    content_type: {
      type: "string",
      enum: ["business_story"]
    },
    slot: {
      type: "string",
      enum: ["business_story"]
    },
    ...baseItemProperties,
    company_or_market: {
      type: "string"
    },
    story_date: {
      type: "string"
    },
    setup: {
      type: "string"
    },
    tension: {
      type: "string"
    },
    decision: {
      type: "string"
    },
    outcome: {
      type: "string"
    },
    lesson: {
      type: "string"
    },
    body_md: {
      type: "string"
    },
    editorial_memory: {
      type: "object",
      additionalProperties: false,
      required: [
        "entity_name",
        "entity_type",
        "main_company",
        "companies_mentioned",
        "industry",
        "key_mechanism",
        "secondary_mechanisms",
        "strategic_angle",
        "core_takeaway",
        "year_period"
      ],
      properties: {
        entity_name: { type: "string" },
        entity_type: {
          type: "string",
          enum: ["founder", "ceo", "investor", "company", "product", "crisis", "acquisition", "strategy", "other"]
        },
        main_company: { type: "string" },
        companies_mentioned: {
          type: "array",
          items: { type: "string" }
        },
        industry: { type: "string" },
        key_mechanism: { type: "string" },
        secondary_mechanisms: {
          type: "array",
          items: { type: "string" }
        },
        strategic_angle: { type: "string" },
        core_takeaway: { type: "string" },
        year_period: { type: "string" }
      }
    }
  }
} as const;

export const MINI_CASE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "content_type",
    "slot",
    "topic",
    "product_topic",
    "language",
    "title",
    "scenario_type",
    "decision_type",
    "concept_tested",
    "mechanism",
    "difficulty",
    "context",
    "challenge",
    "constraints",
    "question",
    "questions",
    "question_pattern",
    "correct_answer_pattern",
    "expected_reasoning",
    "sample_answer",
    "conclusion",
    "core_takeaway",
    "final_takeaway",
    "score_max",
    "learning_points",
    "prerequisites",
    "next_recommended",
    "cognitive_load",
    "surprise_fact",
    "business_context_type",
    "body_md",
    "source_urls",
    "version"
  ],
  properties: {
    content_type: {
      type: "string",
      enum: ["mini_case"]
    },
    slot: {
      type: "string",
      enum: ["mini_case"]
    },
    ...baseItemProperties,
    product_topic: {
      type: "string",
      enum: ["finance_economy", "stock_market", "ai", "law_compliance", "health_pharma", "engineering_operations"]
    },
    scenario_type: {
      type: "string"
    },
    decision_type: {
      type: "string"
    },
    concept_tested: {
      type: "string"
    },
    mechanism: {
      type: "string"
    },
    difficulty: {
      type: "string",
      enum: CONTENT_DIFFICULTIES
    },
    context: {
      type: "string"
    },
    challenge: {
      type: "string"
    },
    constraints: {
      type: "array",
      items: {
        type: "string"
      }
    },
    question: {
      type: "string"
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "role", "question", "options"],
        properties: {
          id: { type: "string" },
          role: {
            type: "string",
            enum: ["method_framework", "technical_application", "conclusion_decision"]
          },
          question: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "text", "is_correct", "feedback"],
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                is_correct: { type: "boolean" },
                feedback: { type: "string" }
              }
            }
          }
        }
      }
    },
    question_pattern: {
      type: "string"
    },
    correct_answer_pattern: {
      type: "string"
    },
    expected_reasoning: {
      type: "array",
      items: {
        type: "string"
      }
    },
    sample_answer: {
      type: "string"
    },
    conclusion: {
      type: "string"
    },
    core_takeaway: {
      type: "string"
    },
    final_takeaway: {
      type: "string"
    },
    score_max: {
      type: "integer"
    },
    // Optional editorial enrichments. OpenAI Structured Outputs requires every
    // property in `required`, so they are expressed as nullable unions; the model
    // returns null when not applicable. Allowed enum values for cognitive_load
    // (low|medium|high) and business_context_type are enforced by the validators,
    // keeping the schema free of nullable-enum edge cases.
    learning_points: {
      type: ["array", "null"],
      items: { type: "string" }
    },
    prerequisites: {
      type: ["array", "null"],
      items: { type: "string" }
    },
    next_recommended: {
      type: ["array", "null"],
      items: { type: "string" }
    },
    cognitive_load: {
      type: ["string", "null"]
    },
    surprise_fact: {
      type: ["string", "null"]
    },
    business_context_type: {
      type: ["string", "null"]
    },
    body_md: {
      type: "string"
    }
  }
} as const;

export const CONCEPT_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "content_type",
    "slot",
    "topic",
    "language",
    "title",
    "category",
    "definition",
    "plain_english",
    "example",
    "why_it_matters",
    "how_to_use_it",
    "common_mistake",
    "body_md",
    "source_urls",
    "version"
  ],
  properties: {
    content_type: {
      type: "string",
      enum: ["concept"]
    },
    slot: {
      type: "string",
      enum: ["concept"]
    },
    ...baseItemProperties,
    category: {
      type: "string",
      enum: [...TOPIC_IDS, "career"]
    },
    definition: {
      type: "string"
    },
    plain_english: {
      type: "string"
    },
    example: {
      type: "string"
    },
    why_it_matters: {
      type: "string"
    },
    how_to_use_it: {
      type: "string"
    },
    common_mistake: {
      type: "string"
    },
    body_md: {
      type: "string"
    }
  }
} as const;

export const DAILY_DROP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["drop_date", "language", "prompt_version", "generator_version", "items"],
  properties: {
    drop_date: {
      type: "string"
    },
    language: {
      type: "string",
      enum: LANGUAGES
    },
    prompt_version: {
      type: "string"
    },
    generator_version: {
      type: "string"
    },
    items: {
      type: "array",
      items: {
        anyOf: [
          NEWSLETTER_ITEM_SCHEMA,
          BUSINESS_STORY_ITEM_SCHEMA,
          MINI_CASE_ITEM_SCHEMA,
          CONCEPT_ITEM_SCHEMA
        ]
      }
    }
  }
} as const;

// Per-section output schema. The LLM only emits the items array for one section;
// the engine sets drop_date/language/prompt_version/generator_version itself, so
// they are not part of the schema. OpenAI Structured Outputs requires every
// property to be listed in `required`, so the wrapper exposes only `items`.
function dailyDropSectionSchema(itemSchema: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: itemSchema
      }
    }
  } as const;
}

export const DAILY_DROP_SECTION_SCHEMAS = {
  newsletter_article: dailyDropSectionSchema(NEWSLETTER_ITEM_SCHEMA as unknown as Record<string, unknown>),
  business_story: dailyDropSectionSchema(BUSINESS_STORY_ITEM_SCHEMA as unknown as Record<string, unknown>),
  mini_case: dailyDropSectionSchema(MINI_CASE_ITEM_SCHEMA as unknown as Record<string, unknown>),
  concept: dailyDropSectionSchema(CONCEPT_ITEM_SCHEMA as unknown as Record<string, unknown>)
} as const;
