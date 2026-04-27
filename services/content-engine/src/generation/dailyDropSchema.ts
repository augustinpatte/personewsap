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
          {
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
          },
          {
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
              }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "content_type",
              "slot",
              "topic",
              "language",
              "title",
              "difficulty",
              "context",
              "challenge",
              "constraints",
              "question",
              "expected_reasoning",
              "sample_answer",
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
              expected_reasoning: {
                type: "array",
                items: {
                  type: "string"
                }
              },
              sample_answer: {
                type: "string"
              },
              body_md: {
                type: "string"
              }
            }
          },
          {
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
          }
        ]
      }
    }
  }
} as const;
