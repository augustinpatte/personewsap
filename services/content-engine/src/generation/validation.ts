import {
  CONTENT_TYPES,
  TOPIC_IDS,
  type ContentType,
  type DailyDropPayload,
  type GeneratedContentItem,
  type RankedArticle,
  type TopicId
} from "../domain.js";

export type ValidationIssue = {
  path: string;
  message: string;
  code?: string;
  severity?: "error" | "warning";
};

export type ContentQualityOptions = {
  articles?: RankedArticle[];
  productionStrict?: boolean;
  rssOnly?: boolean;
};

export type ContentQualityDiagnostics = {
  status: "passed" | "warning" | "failed";
  score: number;
  strict: boolean;
  issues: ValidationIssue[];
  checks: Array<{
    code: string;
    status: "passed" | "warning" | "failed";
    issue_count: number;
  }>;
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
  "it is important",
  "it is important to note",
  "highlights the importance",
  "this highlights the importance",
  "in the current climate",
  "in conclusion",
  "this serves as a reminder",
  "as we navigate",
  "now more than ever",
  "in an ever-changing world",
  "it goes without saying"
];

export const BANNED_EDITORIAL_PHRASES = [
  "this shift means",
  "it is important",
  "highlights the importance",
  "in the current climate",
  "critical in",
  "key in",
  "this matters because",
  "stories like this change incentives",
  "the useful question is not whether",
  "the headline is loud",
  "the useful context is",
  "ce type de sujet en",
  "la bonne question n'est pas de savoir",
  "le titre fait du bruit"
] as const;

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

const CONCEPT_ANCHORS: Record<TopicId, string[]> = {
  business: ["customer", "pricing", "price", "revenue", "margin", "retention", "distribution", "demand", "churn"],
  finance: ["rate", "risk", "asset", "credit", "loan", "funding", "yield", "market", "capital", "default"],
  tech_ai: ["ai", "model", "data", "compute", "chip", "platform", "software", "security", "automation"],
  law: ["rule", "regulation", "legal", "court", "compliance", "enforcement", "privacy", "rights", "law"],
  medicine: ["clinical", "patient", "trial", "treatment", "health", "safety", "endpoint", "care", "medical"],
  engineering: ["system", "design", "failure", "reliability", "capacity", "maintenance", "deployment", "infrastructure"],
  sport_business: ["rights", "sponsorship", "league", "audience", "fans", "tickets", "media", "attendance", "broadcast"],
  culture_media: ["attention", "audience", "subscriber", "platform", "licensing", "content", "media", "format", "loyalty"]
};

const ALLOWED_REPEATED_TEMPLATE_SENTENCES = new Set(["source"]);

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

export function assertValidDailyDropPayload(payload: DailyDropPayload, options: ContentQualityOptions = {}): void {
  const issues = validateDailyDropPayload(payload);
  const quality = validateDailyDropQuality(payload, options);
  const blockingIssues = [
    ...issues,
    ...quality.issues.filter((issue) => issue.severity === "error")
  ];

  if (blockingIssues.length > 0) {
    throw new Error(
      `Generated daily drop failed validation: ${blockingIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`
    );
  }
}

export function validateDailyDropQuality(
  payload: DailyDropPayload,
  options: ContentQualityOptions = {}
): ContentQualityDiagnostics {
  const strict = options.productionStrict ?? readProductionContentStrict();
  const issues: ValidationIssue[] = [];
  const sourceByUrl = new Map<string, RankedArticle>();

  for (const article of options.articles ?? []) {
    sourceByUrl.set(normalizeUrlKey(article.url), article);
  }

  payload.items.forEach((item, index) => {
    const path = `items.${index}`;
    issues.push(...validateSampleUrls(item, path, strict || Boolean(options.rssOnly)));
    issues.push(...validateBodySourceCitations(item, path, sourceByUrl, strict));
    issues.push(...validateItemSourceTopicMatch(item, path, sourceByUrl, strict));
    issues.push(...validateConceptRelevance(item, path, sourceByUrl, strict));
  });

  issues.push(...validateRepeatedTemplatePhrases(payload, strict));

  const checks = summarizeQualityChecks(issues);
  const failedChecks = checks.filter((check) => check.status === "failed").length;
  const warningChecks = checks.filter((check) => check.status === "warning").length;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity !== "error").length;
  const score = Math.max(0, 100 - failedChecks * 25 - warningChecks * 8);

  return {
    status: errorCount > 0 ? "failed" : warningCount > 0 ? "warning" : "passed",
    score,
    strict,
    issues,
    checks
  };
}

export function readProductionContentStrict(): boolean {
  return process.env.PRODUCTION_CONTENT_STRICT?.toLowerCase() === "true";
}

function validateGeneratedItem(item: GeneratedContentItem, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fullText = normalizeForPhraseCheck(JSON.stringify(item));

  issues.push(...validateContentTypeConsistency(item, path));
  issues.push(...validateTopicConsistency(item, path));
  issues.push(...validateTitleAndBodyPresence(item, path));
  issues.push(...validateRequiredSourceCount(item, path));
  issues.push(...validateEstimatedReadingTime(item, path));
  issues.push(...validateDatePresence(item, path));

  for (const phrase of [...GENERIC_AI_PHRASES, ...BANNED_EDITORIAL_PHRASES]) {
    if (fullText.includes(phrase)) {
      issues.push({ path, message: `Banned editorial phrase is not allowed: ${phrase}.` });
    }
  }

  for (const pattern of HIGH_STAKES_ADVICE_PATTERNS) {
    if (pattern.test(fullText)) {
      issues.push({ path, message: "High-stakes personal advice pattern detected." });
    }
  }

  return issues;
}

function normalizeForPhraseCheck(value: string): string {
  return value
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function validateSampleUrls(item: GeneratedContentItem, path: string, blockSampleUrls: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const urls = [
    ...(Array.isArray(item.source_urls) ? item.source_urls : []),
    typeof item.body_md === "string" ? item.body_md : ""
  ];

  urls.forEach((value, index) => {
    if (containsSampleUrl(value)) {
      issues.push(qualityIssue({
        path: index < item.source_urls.length ? `${path}.source_urls.${index}` : `${path}.body_md`,
        code: "sample_url_blocked",
        message: "Sample/example.com URLs are not allowed in production-strict or RSS-only mode.",
        strict: blockSampleUrls
      }));
    }
  });

  return issues;
}

function validateBodySourceCitations(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const body = typeof item.body_md === "string" ? item.body_md : "";
  const bodyLower = body.toLowerCase();
  const sourceUrls = Array.isArray(item.source_urls) ? item.source_urls : [];

  sourceUrls.forEach((sourceUrl, index) => {
    if (!bodyIncludesUrl(body, sourceUrl)) {
      issues.push(qualityIssue({
        path: `${path}.body_md`,
        code: "source_url_not_cited",
        message: `Body must cite source URL from source_urls.${index}.`,
        strict
      }));
    }

    const source = sourceByUrl.get(normalizeUrlKey(sourceUrl));
    const sourceDate = source?.published_at?.slice(0, 10) ?? null;
    const retrievedDate = source?.retrieved_at?.slice(0, 10) ?? null;

    if (sourceDate && !body.includes(sourceDate)) {
      issues.push(qualityIssue({
        path: `${path}.body_md`,
        code: "source_date_not_cited",
        message: `Body must cite source/event date ${sourceDate}.`,
        strict
      }));
    }

    if (!sourceDate && source && retrievedDate && !body.includes(retrievedDate)) {
      issues.push(qualityIssue({
        path: `${path}.body_md`,
        code: "retrieved_date_missing",
        message: `Undated source must cite retrieved date ${retrievedDate}.`,
        strict
      }));
    }

    if (sourceDate && bodyLower.includes("published unknown")) {
      issues.push(qualityIssue({
        path: `${path}.body_md`,
        code: "published_unknown_with_known_date",
        message: "Body says published unknown even though the source has a publication date.",
        strict
      }));
    }
  });

  if (bodyLower.includes("published unknown") && !/\bretrieved\s+\d{4}-\d{2}-\d{2}\b/i.test(body)) {
    issues.push(qualityIssue({
      path: `${path}.body_md`,
      code: "published_unknown_without_retrieved_date",
      message: "published unknown is allowed only when a retrieved date is present.",
      strict
    }));
  }

  return issues;
}

function validateItemSourceTopicMatch(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  if (!item.topic) {
    return [];
  }

  const sourceTopics = knownSourcesForItem(item, sourceByUrl).map((source) => source.topic);
  if (sourceTopics.length === 0) {
    return [];
  }

  const hasMatchingTopic = sourceTopics.includes(item.topic);
  if (hasMatchingTopic) {
    return [];
  }

  return [
    qualityIssue({
      path: `${path}.topic`,
      code: "source_topic_mismatch",
      message: `Item topic ${item.topic} must match at least one cited source topic (${Array.from(new Set(sourceTopics)).join(", ")}).`,
      strict
    })
  ];
}

function validateConceptRelevance(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  if (item.content_type !== "concept" || !item.topic) {
    return [];
  }

  const conceptText = normalizeForPhraseCheck(
    [item.title, item.definition, item.plain_english, item.why_it_matters, item.how_to_use_it, item.common_mistake].join(" ")
  );
  const anchors = CONCEPT_ANCHORS[item.topic];
  const hasTopicAnchor = anchors.some((anchor) => conceptText.includes(anchor));
  const sources = knownSourcesForItem(item, sourceByUrl);
  const sourceText = normalizeForPhraseCheck(
    sources.map((source) => `${source.title} ${source.summary ?? ""} ${source.body ?? ""}`).join(" ")
  );
  const exampleText = normalizeForPhraseCheck(`${item.example} ${item.body_md}`);
  const overlapsSource = keywordOverlap(exampleText, sourceText) >= 2;

  const issues: ValidationIssue[] = [];

  if (!hasTopicAnchor) {
    issues.push(qualityIssue({
      path: `${path}.title`,
      code: "concept_missing_topic_anchor",
      message: `Concept lens must contain a clear ${item.topic} analytical anchor.`,
      strict
    }));
  }

  if (sources.length > 0 && !overlapsSource) {
    issues.push(qualityIssue({
      path: `${path}.example`,
      code: "concept_example_source_mismatch",
      message: "Concept example must reuse concrete terms from the cited source, not a generic template example.",
      strict
    }));
  }

  return issues;
}

function validateRepeatedTemplatePhrases(payload: DailyDropPayload, strict: boolean): ValidationIssue[] {
  const seen = new Map<string, { path: string; topic: TopicId | null }>();
  const issues: ValidationIssue[] = [];

  payload.items.forEach((item, index) => {
    const sentences = extractSentences(templateTextForItem(item));

    for (const sentence of sentences) {
      if (
        ALLOWED_REPEATED_TEMPLATE_SENTENCES.has(sentence) ||
        sentence.length < 55 ||
        sentence.includes("source:") ||
        sentence.includes("published ") ||
        sentence.includes("retrieved ")
      ) {
        continue;
      }

      const previous = seen.get(sentence);
      if (previous && previous.topic !== item.topic) {
        issues.push(qualityIssue({
          path: `items.${index}`,
          code: "repeated_template_phrase",
          message: `Repeated generic sentence also appears at ${previous.path}: "${sentence.slice(0, 100)}".`,
          strict
        }));
        continue;
      }

      seen.set(sentence, { path: `items.${index}`, topic: item.topic });
    }
  });

  return issues;
}

function knownSourcesForItem(item: GeneratedContentItem, sourceByUrl: Map<string, RankedArticle>): RankedArticle[] {
  return Array.from(
    new Map(
      (Array.isArray(item.source_urls) ? item.source_urls : [])
        .map((url) => sourceByUrl.get(normalizeUrlKey(url)))
        .filter((source): source is RankedArticle => Boolean(source))
        .map((source) => [source.url, source])
    ).values()
  );
}

function qualityIssue(input: { path: string; code: string; message: string; strict: boolean }): ValidationIssue {
  return {
    path: input.path,
    code: input.code,
    message: input.message,
    severity: input.strict ? "error" : "warning"
  };
}

function summarizeQualityChecks(issues: ValidationIssue[]): ContentQualityDiagnostics["checks"] {
  const checkCodes = [
    "sample_url_blocked",
    "source_url_not_cited",
    "source_date_not_cited",
    "retrieved_date_missing",
    "published_unknown_with_known_date",
    "published_unknown_without_retrieved_date",
    "source_topic_mismatch",
    "concept_missing_topic_anchor",
    "concept_example_source_mismatch",
    "repeated_template_phrase"
  ];

  return checkCodes.map((code) => {
    const codeIssues = issues.filter((issue) => issue.code === code);
    const hasError = codeIssues.some((issue) => issue.severity === "error");
    return {
      code,
      status: hasError ? "failed" : codeIssues.length > 0 ? "warning" : "passed",
      issue_count: codeIssues.length
    };
  });
}

function bodyIncludesUrl(body: string, sourceUrl: string): boolean {
  if (body.includes(sourceUrl)) {
    return true;
  }

  try {
    return body.includes(decodeURI(sourceUrl));
  } catch {
    return false;
  }
}

function containsSampleUrl(value: string): boolean {
  if (value.includes("example.com")) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.hostname === "example.com" || url.hostname.endsWith(".example.com");
  } catch {
    return false;
  }
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function keywordOverlap(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  const rightTerms = new Set(contentTerms(right));
  return contentTerms(left).filter((term) => rightTerms.has(term)).length;
}

function contentTerms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/[^a-z0-9\u00C0-\u017F]+/gi, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length >= 5)
        .filter((term) => !["source", "published", "retrieved", "their", "there", "about", "would"].includes(term))
    )
  );
}

function extractSentences(value: string): string[] {
  return normalizeForPhraseCheck(value)
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function templateTextForItem(item: GeneratedContentItem): string {
  if (item.content_type === "newsletter_article") {
    return [item.summary, item.body_md, item.why_it_matters].join(" ");
  }

  if (item.content_type === "business_story") {
    return [item.setup, item.tension, item.decision, item.outcome, item.lesson, item.body_md].join(" ");
  }

  if (item.content_type === "mini_case") {
    return [item.context, item.challenge, item.question, item.sample_answer, item.body_md].join(" ");
  }

  return [
    item.definition,
    item.plain_english,
    item.example,
    item.why_it_matters,
    item.how_to_use_it,
    item.common_mistake,
    item.body_md
  ].join(" ");
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
