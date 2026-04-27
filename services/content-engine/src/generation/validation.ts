import { CONTENT_TYPES, TOPIC_IDS, type DailyDropPayload, type GeneratedContentItem } from "../domain.js";

export type ValidationIssue = {
  path: string;
  message: string;
};

const GENERIC_AI_PHRASES = [
  "in today's fast-paced world",
  "it is important to note",
  "this highlights the importance",
  "in conclusion"
];

const HIGH_STAKES_ADVICE_PATTERNS = [
  /\byou should buy\b/i,
  /\byou should sell\b/i,
  /\bdiagnose\b/i,
  /\btreatment plan\b/i,
  /\blegal advice for your case\b/i
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

  if (!CONTENT_TYPES.includes(item.content_type)) {
    issues.push({ path: `${path}.content_type`, message: "Unsupported content type." });
  }

  if (item.topic !== null && !TOPIC_IDS.includes(item.topic)) {
    issues.push({ path: `${path}.topic`, message: "Unsupported topic." });
  }

  if (!item.title.trim()) {
    issues.push({ path: `${path}.title`, message: "Title is required." });
  }

  if (item.source_urls.length === 0) {
    issues.push({ path: `${path}.source_urls`, message: "At least one source is required." });
  }

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
