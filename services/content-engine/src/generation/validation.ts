import { CONTENT_TYPES, TOPIC_IDS, type ContentType, type DailyDropPayload, type GeneratedContentItem } from "../domain.js";

export type ValidationIssue = {
  path: string;
  message: string;
};

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
const WORDS_PER_MINUTE = 220;

const REQUIRED_SOURCE_COUNTS: Record<ContentType, number> = {
  newsletter_article: 1,
  business_story: 1,
  mini_case: 1,
  concept: 1,
  quick_quiz: 1
};

const DAILY_DROP_SLOT_BY_TYPE: Partial<Record<ContentType, GeneratedContentItem["slot"]>> = {
  newsletter_article: "newsletter",
  business_story: "business_story",
  mini_case: "mini_case",
  concept: "concept"
};

const REQUIRED_TEXT_FIELDS: Partial<Record<ContentType, string[]>> = {
  newsletter_article: ["title", "summary", "body_md", "why_it_matters", "published_date"],
  business_story: ["title", "company_or_market", "setup", "tension", "decision", "outcome", "lesson", "body_md", "story_date"],
  mini_case: ["title", "context", "challenge", "question", "sample_answer", "body_md"],
  concept: ["title", "definition", "plain_english", "example", "why_it_matters", "how_to_use_it", "common_mistake", "body_md"]
};

const READING_TIME_LIMITS_SECONDS: Partial<Record<ContentType, { min: number; max: number }>> = {
  newsletter_article: { min: 30, max: 90 },
  business_story: { min: 30, max: 120 },
  mini_case: { min: 30, max: 120 },
  concept: { min: 30, max: 120 }
};

const GENERIC_AI_PHRASES = [
  "in today's fast-paced world",
  "it is important to note",
  "this highlights the importance",
  "in conclusion",
  "this serves as a reminder",
  "as we navigate",
  "now more than ever",
  "in an ever-changing world",
  "it goes without saying"
];

const HIGH_STAKES_ADVICE_PATTERNS = [
  /\byou should buy\b/i,
  /\byou should sell\b/i,
  /\bbuy this stock\b/i,
  /\bsell this stock\b/i,
  /\bguaranteed return\b/i,
  /\bdiagnose\b/i,
  /\byou have\b.*\b(disease|condition|infection)\b/i,
  /\bstop taking\b/i,
  /\bstart taking\b/i,
  /\btreatment plan\b/i,
  /\blegal advice for your case\b/i,
  /\byou should sue\b/i,
  /\byou should plead\b/i
];

export function validateDailyDropPayload(payload: DailyDropPayload): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!payload.drop_date) {
    issues.push({ path: "drop_date", message: "Drop date is required." });
  }

  if (!["fr", "en"].includes(payload.language)) {
    issues.push({ path: "language", message: "Language must be fr or en." });
  }

  payload.items.forEach((item, index) => {
    if (item.language !== payload.language) {
      issues.push({ path: `items.${index}.language`, message: "Item language must match the daily drop language." });
    }
    issues.push(...validateGeneratedItem(item, `items.${index}`));
  });

  return issues;
}

export function assertValidDailyDropPayload(payload: DailyDropPayload): void {
  const issues = validateDailyDropPayload(payload);
  if (issues.length > 0) {
    throw new Error(`Generated daily drop failed validation: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
}

function validateGeneratedItem(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fullText = JSON.stringify(item).toLowerCase();

  issues.push(...validateContentTypeConsistency(item, path));
  issues.push(...validateTopicConsistency(item, path));
  issues.push(...validateTitleAndBodyPresence(item, path));
  issues.push(...validateRequiredSourceCount(item, path));
  issues.push(...validateEstimatedReadingTime(item, path));
  issues.push(...validateDatePresence(item, path));

  for (const phrase of GENERIC_AI_PHRASES) {
    if (fullText.includes(phrase)) {
      issues.push({ path, message: `Generic AI phrase is not allowed: ${phrase}.` });
    }
  }

  for (const pattern of HIGH_STAKES_ADVICE_PATTERNS) {
    if (pattern.test(fullText)) {
      issues.push({ path, message: "High-stakes personal advice pattern detected." });
    }
  }

  return issues;
}

export function validateRequiredSourceCount(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const contentType = item.content_type;
  const requiredSourceCount = REQUIRED_SOURCE_COUNTS[contentType];

  if (!Array.isArray(item.source_urls)) {
    return [{ path: `${path}.source_urls`, message: "Source URLs must be an array." }];
  }

  const uniqueSources = new Set(item.source_urls.map((url) => url.trim()).filter(Boolean));
  if (uniqueSources.size < requiredSourceCount) {
    issues.push({
      path: `${path}.source_urls`,
      message: `At least ${requiredSourceCount} source URL${requiredSourceCount === 1 ? "" : "s"} required for ${contentType}.`
    });
  }

  item.source_urls.forEach((url, index) => {
    if (!isValidHttpUrl(url)) {
      issues.push({ path: `${path}.source_urls.${index}`, message: "Source URL must be a valid http(s) URL." });
    }
  });

  return issues;
}

export function validateTitleAndBodyPresence(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requiredFields = REQUIRED_TEXT_FIELDS[item.content_type];

  if (!requiredFields) {
    return [{ path: `${path}.content_type`, message: `${item.content_type} is not supported as a daily drop item.` }];
  }

  for (const field of requiredFields) {
    if (!hasTextField(item, field)) {
      issues.push({ path: `${path}.${field}`, message: `${field} is required for ${item.content_type}.` });
    }
  }

  if (item.content_type === "mini_case") {
    const constraints = (item as unknown as Record<string, unknown>).constraints;
    const expectedReasoning = (item as unknown as Record<string, unknown>).expected_reasoning;

    if (!Array.isArray(constraints) || constraints.length === 0) {
      issues.push({ path: `${path}.constraints`, message: "Mini-case constraints are required." });
    }
    if (!Array.isArray(expectedReasoning) || expectedReasoning.length === 0) {
      issues.push({ path: `${path}.expected_reasoning`, message: "Mini-case expected reasoning is required." });
    }
  }

  return issues;
}

export function validateTopicConsistency(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (item.topic === null) {
    issues.push({ path: `${path}.topic`, message: "Daily drop items must have a topic." });
    return issues;
  }

  if (!TOPIC_IDS.includes(item.topic)) {
    issues.push({ path: `${path}.topic`, message: "Unsupported topic." });
  }

  if (item.content_type === "concept" && item.category !== "career" && item.category !== item.topic) {
    issues.push({ path: `${path}.category`, message: "Concept category must match the item topic or be career." });
  }

  return issues;
}

export function validateContentTypeConsistency(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!CONTENT_TYPES.includes(item.content_type)) {
    issues.push({ path: `${path}.content_type`, message: "Unsupported content type." });
    return issues;
  }

  const expectedSlot = DAILY_DROP_SLOT_BY_TYPE[item.content_type];
  if (!expectedSlot) {
    issues.push({ path: `${path}.content_type`, message: `${item.content_type} is not supported as a daily drop item.` });
    return issues;
  }

  if (item.slot !== expectedSlot) {
    issues.push({ path: `${path}.slot`, message: `${item.content_type} must use the ${expectedSlot} slot.` });
  }

  return issues;
}

export function validateEstimatedReadingTime(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const limits = READING_TIME_LIMITS_SECONDS[item.content_type];

  if (!limits) {
    return [];
  }

  const body = typeof item.body_md === "string" ? item.body_md : "";
  const estimatedReadSeconds = estimateReadingSeconds(body);

  if (estimatedReadSeconds < limits.min || estimatedReadSeconds > limits.max) {
    return [
      {
        path: `${path}.body_md`,
        message: `${item.content_type} estimated reading time is ${estimatedReadSeconds}s; expected ${limits.min}-${limits.max}s.`
      }
    ];
  }

  return [];
}

export function estimateReadingSeconds(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(30, Math.ceil((words / WORDS_PER_MINUTE) * 60));
}

function validateDatePresence(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (item.content_type === "newsletter_article" && !DATE_PATTERN.test(item.published_date)) {
    issues.push({ path: `${path}.published_date`, message: "Newsletter article published_date must use YYYY-MM-DD." });
  }

  if (item.content_type === "business_story" && !DATE_PATTERN.test(item.story_date)) {
    issues.push({ path: `${path}.story_date`, message: "Business story story_date must use YYYY-MM-DD." });
  }

  if (typeof item.body_md !== "string" || !DATE_PATTERN.test(item.body_md)) {
    issues.push({ path: `${path}.body_md`, message: "Body must include at least one source or event date in YYYY-MM-DD format." });
  }

  return issues;
}

function hasTextField(item: GeneratedContentItem, field: string): boolean {
  const value = (item as unknown as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim().length > 0;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
