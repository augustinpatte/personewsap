export const LEARNING_PROMPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "curriculum_step_key",
    "title_fr",
    "title_en",
    "summary_fr",
    "summary_en",
    "objectives_fr",
    "objectives_en",
    "prompt_text",
    "prompt_language",
    "adaptation_mode"
  ],
  properties: {
    curriculum_step_key: { type: "string" },
    title_fr: { type: "string" },
    title_en: { type: "string" },
    summary_fr: { type: "string" },
    summary_en: { type: "string" },
    objectives_fr: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
    objectives_en: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
    prompt_text: { type: "string" },
    prompt_language: { enum: ["fr", "en"] },
    adaptation_mode: { enum: ["normal", "reinforce", "accelerate", "context_shift", "prerequisite"] }
  }
} as const;
