import {
  CONTENT_TYPES,
  MINI_CASE_TOPIC_IDS,
  TOPIC_IDS,
  type BusinessStory,
  type BusinessStoryMemoryContext,
  type ContentType,
  type DailyDropPayload,
  type GeneratedContentItem,
  type MiniCaseTopicId,
  type RankedArticle,
  type TopicId
} from "../domain.js";
import {
  buildBusinessStoryEditorialMemory,
  daysBetween,
  normalizeMemoryKey,
  slugify
} from "./editorialMemory.js";
import type { MiniCaseEditorialMemoryRecord } from "../miniCase/editorialMemory.js";
import {
  isApprovedMiniCaseProductTopic,
  isMiniCaseConcept,
  isMiniCaseCorrectAnswerPattern,
  isMiniCaseDecisionType,
  isMiniCaseQuestionPattern,
  isMiniCaseScenarioType
} from "../miniCase/taxonomy.js";

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
  maxSourceAgeDays?: number;
  newsletterProductTopics?: string[];
  miniCaseProductTopics?: string[];
  miniCaseAllowedPreferenceTopicIds?: string[];
  miniCaseMemory?: MiniCaseEditorialMemoryRecord[];
  businessStoryMemory?: BusinessStoryMemoryContext;
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
const SPECIFIC_CLAIM_PATTERN =
  /(?:\b\d+(?:[.,]\d+)?%|\$[\d,.]+|\u20ac[\d,.]+|\u00a3[\d,.]+|\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:[.,]\d+)?\s?(?:bn|billion|m|million|bps|basis points|days?|weeks?|months?|years?|milliards?|millions?|jours?|semaines?|mois|ans)\b)/gi;
const WORDS_PER_MINUTE = 220;
const DEFAULT_MAX_SOURCE_AGE_DAYS = 21;

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

const MIN_BODY_WORDS: Partial<Record<ContentType, number>> = {
  newsletter_article: 90,
  business_story: 110,
  mini_case: 90,
  concept: 85,
  quick_quiz: 45
};

const GENERIC_AI_PHRASES = [
  "in today's fast-paced world",
  "it is important",
  "it is important to note",
  "highlights the importance",
  "this highlights the importance",
  "this shift means",
  "in the current climate",
  "critical in",
  "key in",
  "underscores the importance",
  "delve into",
  "navigate the landscape",
  "game changer",
  "it remains to be seen",
  "as we move forward",
  "overall,",
  "in conclusion",
  "this serves as a reminder",
  "as we navigate",
  "now more than ever",
  "in an ever-changing world",
  "it goes without saying"
];

const EMPTY_GENERIC_FILLER_PATTERNS = [
  /\blorem ipsum\b/i,
  /\bplaceholder\b/i,
  /\bsample content\b/i,
  /\bgeneric update\b/i,
  /\bsource unavailable\b/i,
  /\bcontenu generique\b/i,
  /\bcontenu d'exemple\b/i,
  /\bsource indisponible\b/i
];

const GENERIC_TITLE_PATTERNS = [
  /\bdaily update\b/i,
  /\bmarket update\b/i,
  /\bnews update\b/i,
  /\bkey concept\b/i,
  /\bbriefing du jour\b/i,
  /\bactualite du jour\b/i,
  /\bconcept cle\b/i
];

export const NEWSLETTER_PRODUCT_TOPIC_TO_CONTENT_TOPICS = {
  sport: ["sport_business"],
  international: ["law"],
  finance_economy: ["finance"],
  stock_market: ["business", "finance"],
  automotive: ["engineering"],
  pharma: ["medicine"],
  ai: ["tech_ai"],
  culture: ["culture_media"]
} as const satisfies Record<string, readonly TopicId[]>;

export const MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS = {
  finance_economy: ["finance"],
  stock_market: ["finance", "business"],
  ai: ["tech_ai"],
  law_compliance: ["law"],
  health_pharma: ["medicine"],
  engineering_operations: ["engineering"]
} as const satisfies Record<string, readonly TopicId[]>;

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
  /\bdiagnose (you|your|this|that|a|an)\b/i,
  /\bdiagnosed? with\b/i,
  /\byou have\b.*\b(disease|condition|infection)\b/i,
  /\bstop taking\b/i,
  /\bstart taking\b/i,
  /\btreatment plan\b/i,
  /\blegal advice for your case\b/i,
  /\bmedical advice\b/i,
  /\blegal advice\b/i,
  /\bconsult your doctor\b/i,
  /\bconsult a lawyer\b/i,
  /\byou should sue\b/i,
  /\byou should plead\b/i
];

const CONCEPT_ANCHORS: Record<TopicId, string[]> = {
  business: [
    "customer", "pricing", "price", "revenue", "margin", "retention", "distribution", "demand", "churn",
    "client", "prix", "revenu", "marge", "demande", "fidelisation", "retention"
  ],
  finance: [
    "rate", "risk", "asset", "credit", "loan", "funding", "yield", "market", "capital", "default",
    "taux", "risque", "actif", "pret", "financement", "rendement", "marche", "capital", "defaut"
  ],
  tech_ai: [
    "ai", "model", "data", "compute", "chip", "platform", "software", "security", "automation",
    "ia", "modele", "donnees", "calcul", "puce", "plateforme", "logiciel", "securite", "automatisation"
  ],
  law: [
    "rule", "regulation", "legal", "court", "compliance", "enforcement", "privacy", "rights", "law",
    "regle", "droit", "juridique", "tribunal", "conformite", "application", "confidentialite", "droits", "loi"
  ],
  medicine: [
    "clinical", "patient", "trial", "treatment", "health", "safety", "endpoint", "care", "medical",
    "clinique", "patient", "essai", "traitement", "sante", "securite", "soin", "medical"
  ],
  engineering: [
    "system", "design", "failure", "reliability", "capacity", "maintenance", "deployment", "infrastructure",
    "systeme", "conception", "panne", "fiabilite", "capacite", "maintenance", "deploiement"
  ],
  sport_business: [
    "rights", "sponsorship", "league", "audience", "fans", "tickets", "media", "attendance", "broadcast",
    "droits", "sponsoring", "ligue", "audience", "supporters", "billets", "medias", "affluence", "diffusion"
  ],
  culture_media: [
    "attention", "audience", "subscriber", "platform", "licensing", "content", "media", "format", "loyalty",
    "abonne", "plateforme", "licence", "contenu", "medias", "format", "fidelite"
  ]
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
  const maxSourceAgeDays = options.maxSourceAgeDays ?? DEFAULT_MAX_SOURCE_AGE_DAYS;

  for (const article of options.articles ?? []) {
    sourceByUrl.set(normalizeUrlKey(article.url), article);
  }

  issues.push(...validateRequestedTopicTaxonomy(options, strict));

  payload.items.forEach((item, index) => {
    const path = `items.${index}`;
    issues.push(...validateSampleUrls(item, path, strict || Boolean(options.rssOnly)));
    issues.push(...validateSourceUrlsComeFromSuppliedMaterial(item, path, sourceByUrl, strict));
    issues.push(...validateNoSampleSourceMaterial(item, path, sourceByUrl, strict || Boolean(options.rssOnly)));
    issues.push(...validateBodySourceCitations(item, path, sourceByUrl, strict));
    issues.push(...validateItemSourceTopicMatch(item, path, sourceByUrl, strict));
    issues.push(...validateConceptRelevance(item, path, sourceByUrl, strict));
    issues.push(...validateGenericFiller(item, path, strict));
    issues.push(...validateTitleReflectsTopic(item, path, sourceByUrl, strict));
    issues.push(...validateSourceFreshness(item, path, sourceByUrl, payload.drop_date, maxSourceAgeDays, strict));
    issues.push(...validateUnsupportedSpecificClaims(item, path, sourceByUrl, strict));
    issues.push(...validateItemProductTopicMapping(item, path, options, strict));
    issues.push(...validateMiniCaseUxAndRotation(item, path, payload.drop_date, options, strict));
    issues.push(...validateBusinessStoryEditorialMemory(item, path, payload.drop_date, options, strict));
  });

  issues.push(...validateRepeatedTemplatePhrases(payload, strict));
  issues.push(...validateDuplicateDailyRunStories(payload, strict));
  issues.push(...validateSourceDiversity(payload, sourceByUrl, strict));

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
      issues.push({
        path,
        code: "high_stakes_personal_advice",
        message: "High-stakes personal medical, legal, or financial advice pattern detected.",
        severity: "error"
      });
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
  const sourceUrls = Array.isArray(item.source_urls) ? item.source_urls : [];
  const urls = [
    ...sourceUrls,
    typeof item.body_md === "string" ? item.body_md : ""
  ];

  urls.forEach((value, index) => {
    if (containsSampleUrl(value)) {
      issues.push(qualityIssue({
        path: index < sourceUrls.length ? `${path}.source_urls.${index}` : `${path}.body_md`,
        code: "sample_url_blocked",
        message: "Sample/example.com URLs are not allowed in production-strict or RSS-only mode.",
        strict: blockSampleUrls
      }));
    }
  });

  return issues;
}

function validateSourceUrlsComeFromSuppliedMaterial(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  if (sourceByUrl.size === 0 || !Array.isArray(item.source_urls)) {
    return [];
  }

  return item.source_urls.flatMap((sourceUrl, index) => {
    if (sourceByUrl.has(normalizeUrlKey(sourceUrl))) {
      return [];
    }

    return [
      qualityIssue({
        path: `${path}.source_urls.${index}`,
        code: "unsupported_source_url",
        message: "Source URL must come from the supplied ranked article material.",
        strict
      })
    ];
  });
}

function validateNoSampleSourceMaterial(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  return knownSourcesForItem(item, sourceByUrl).flatMap((source, index) => {
    const sourceText = normalizeForPhraseCheck(`${source.publisher} ${source.title} ${source.url}`);
    const isSampleSource = sourceText.includes("personewsap sample") || sourceText.includes("dry-run");

    if (!isSampleSource) {
      return [];
    }

    return [
      qualityIssue({
        path: `${path}.source_urls.${index}`,
        code: "sample_source_material",
        message: "Sample source material is not allowed in production-strict or RSS-only mode.",
        strict
      })
    ];
  });
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

function validateGenericFiller(item: GeneratedContentItem, path: string, strict: boolean): ValidationIssue[] {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const body = typeof item.body_md === "string" ? item.body_md.trim() : "";
  const requiredText = templateTextForItem(item);
  const normalizedRequiredText = normalizeForPhraseCheck(requiredText);
  const issues: ValidationIssue[] = [];

  for (const pattern of EMPTY_GENERIC_FILLER_PATTERNS) {
    if (pattern.test(requiredText)) {
      issues.push(qualityIssue({
        path,
        code: "generic_filler",
        message: "Generated item contains placeholder or empty generic filler text.",
        strict
      }));
      break;
    }
  }

  if (title.length < 8 || body.length < 140 || contentTerms(normalizedRequiredText).length < 8) {
    issues.push(qualityIssue({
      path,
      code: "generic_filler",
      message: "Generated item is too thin to be production content.",
      strict
    }));
  }

  const minimumWords = MIN_BODY_WORDS[item.content_type];
  if (minimumWords && wordCount(body) < minimumWords) {
    issues.push(qualityIssue({
      path: `${path}.body_md`,
      code: "body_too_short",
      message: `${item.content_type} body has ${wordCount(body)} words; expected at least ${minimumWords} words for sourced production content.`,
      strict
    }));
  }

  return issues;
}

function validateSourceFreshness(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  dropDate: string,
  maxSourceAgeDays: number,
  strict: boolean
): ValidationIssue[] {
  const dropDay = parseDateOnly(dropDate);
  if (!dropDay) {
    return [];
  }

  return knownSourcesForItem(item, sourceByUrl).flatMap((source, sourceIndex) => {
    const sourceDate = parseDateOnly(source.published_at ?? source.retrieved_at);
    if (!sourceDate) {
      return [
        qualityIssue({
          path: `${path}.source_urls.${sourceIndex}`,
          code: "source_date_missing",
          message: `Cited source ${source.url} has no parseable published_at or retrieved_at YYYY-MM-DD date.`,
          strict
        })
      ];
    }

    const ageDays = dateDiffDays(sourceDate, dropDay);
    if (ageDays <= maxSourceAgeDays) {
      return [];
    }

    return [
      qualityIssue({
        path: `${path}.source_urls.${sourceIndex}`,
        code: "stale_source_date",
        message: `Cited source ${source.url} is ${ageDays} days older than drop_date ${dropDate}; max allowed is ${maxSourceAgeDays} days unless intentionally overridden.`,
        strict
      })
    ];
  });
}

function validateUnsupportedSpecificClaims(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  const sources = knownSourcesForItem(item, sourceByUrl);
  if (sources.length === 0) {
    return [];
  }

  const sourceText = normalizeClaimText(
    sources.map((source) => `${source.title} ${source.summary ?? ""} ${source.body ?? ""} ${source.published_at ?? ""}`).join(" ")
  );
  const itemText = normalizeClaimText(templateTextForItem(item));
  const claims = Array.from(itemText.matchAll(SPECIFIC_CLAIM_PATTERN))
    .map((match) => match[0])
    .filter((claim) => !isLikelyCitationDate(claim, item, sources));
  const unsupported = Array.from(new Set(claims.filter((claim) => !sourceText.includes(claim))));

  if (unsupported.length === 0) {
    return [];
  }

  return [
    qualityIssue({
      path,
      code: "unsupported_specific_claim",
      message: `Specific claim(s) not found in cited source material: ${unsupported.slice(0, 4).join(", ")}.`,
      strict
    })
  ];
}

function validateDuplicateDailyRunStories(payload: DailyDropPayload, strict: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const titles = new Map<string, string>();
  const nonNewsletterTopicSlots = new Map<string, string>();

  payload.items.forEach((item, index) => {
    const path = `items.${index}`;
    const normalizedTitle = normalizeStoryTitle(item.title);
    if (normalizedTitle) {
      const previousPath = titles.get(normalizedTitle);
      if (previousPath) {
        issues.push(qualityIssue({
          path: `${path}.title`,
          code: "duplicate_story_title",
          message: `Duplicate story title also appears at ${previousPath}.`,
          strict
        }));
      } else {
        titles.set(normalizedTitle, `${path}.title`);
      }
    }

    if (item.content_type !== "newsletter_article" && item.topic) {
      const key = `${item.content_type}:${item.topic}`;
      const previousPath = nonNewsletterTopicSlots.get(key);
      if (previousPath) {
        issues.push(qualityIssue({
          path,
          code: "duplicate_story_topic",
          message: `Duplicate ${item.content_type} topic ${item.topic} also appears at ${previousPath}.`,
          strict
        }));
      } else {
        nonNewsletterTopicSlots.set(key, path);
      }
    }
  });

  return issues;
}

function validateSourceDiversity(
  payload: DailyDropPayload,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  if (sourceByUrl.size <= 1 || payload.items.length <= 2) {
    return [];
  }

  const usage = new Map<string, number>();
  for (const item of payload.items) {
    const firstUrl = Array.isArray(item.source_urls) ? item.source_urls[0] : null;
    if (!firstUrl || !sourceByUrl.has(normalizeUrlKey(firstUrl))) {
      continue;
    }

    const normalizedUrl = normalizeUrlKey(firstUrl);
    usage.set(normalizedUrl, (usage.get(normalizedUrl) ?? 0) + 1);
  }

  const maxAllowed = Math.max(2, Math.ceil(payload.items.length * 0.6));
  const overused = Array.from(usage.entries()).filter(([, count]) => count > maxAllowed);
  return overused.map(([url, count]) =>
    qualityIssue({
      path: "items",
      code: "source_overused",
      message: `One source is cited by ${count}/${payload.items.length} items even though ${sourceByUrl.size} supplied alternatives exist: ${url}.`,
      strict
    })
  );
}

function validateRequestedTopicTaxonomy(options: ContentQualityOptions, strict: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const topic of options.newsletterProductTopics ?? []) {
    if (!(topic in NEWSLETTER_PRODUCT_TOPIC_TO_CONTENT_TOPICS)) {
      issues.push(qualityIssue({
        path: "newsletterProductTopics",
        code: "invalid_newsletter_product_topic",
        message: `Unsupported newsletter product topic "${topic}". Allowed: ${Object.keys(NEWSLETTER_PRODUCT_TOPIC_TO_CONTENT_TOPICS).join(", ")}.`,
        strict
      }));
    }
  }

  for (const topic of options.miniCaseProductTopics ?? []) {
    if (!(topic in MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS)) {
      issues.push(qualityIssue({
        path: "miniCaseProductTopics",
        code: "invalid_mini_case_product_topic",
        message: `Unsupported mini-case product topic "${topic}". Allowed: ${Object.keys(MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS).join(", ")}.`,
        strict
      }));
    }
  }

  for (const topic of options.miniCaseAllowedPreferenceTopicIds ?? []) {
    if (!isKnownMiniCaseProductTopic(topic)) {
      issues.push(qualityIssue({
        path: "miniCaseAllowedPreferenceTopicIds",
        code: "invalid_mini_case_preference_topic",
        message: `Unsupported mini-case preference topic "${topic}". Allowed: ${Object.keys(MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS).join(", ")}.`,
        strict
      }));
    }
  }

  return issues;
}

function validateItemProductTopicMapping(
  item: GeneratedContentItem,
  path: string,
  options: ContentQualityOptions,
  strict: boolean
): ValidationIssue[] {
  if (!item.topic) {
    return [];
  }

  if (item.content_type === "newsletter_article" && options.newsletterProductTopics?.length) {
    const allowedContentTopics = productTopicsToContentTopics(options.newsletterProductTopics, NEWSLETTER_PRODUCT_TOPIC_TO_CONTENT_TOPICS);
    if (!allowedContentTopics.has(item.topic)) {
      return [
        qualityIssue({
          path: `${path}.topic`,
          code: "newsletter_topic_mismatch",
          message: `Newsletter item topic ${item.topic} does not map to requested product newsletter topics: ${options.newsletterProductTopics.join(", ")}.`,
          strict
        })
      ];
    }
  }

  if (item.content_type === "mini_case") {
    const allowedProductTopics = options.miniCaseAllowedPreferenceTopicIds ?? options.miniCaseProductTopics ?? [];
    if (allowedProductTopics.length === 0) {
      return [];
    }

    const allowedContentTopics = productTopicsToContentTopics(allowedProductTopics, MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS);
    if (!allowedContentTopics.has(item.topic)) {
      return [
        qualityIssue({
          path: `${path}.topic`,
          code: "mini_case_preference_topic_mismatch",
          message: `Mini-case topic ${item.topic} does not match allowed mini-case preference topic(s): ${allowedProductTopics.join(", ")}.`,
          strict
        })
      ];
    }
  }

  return [];
}

function validateMiniCaseUxAndRotation(
  item: GeneratedContentItem,
  path: string,
  dropDate: string,
  options: ContentQualityOptions,
  strict: boolean
): ValidationIssue[] {
  if (item.content_type !== "mini_case") {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const productTopic = readItemString(item.product_topic);
  const scenarioType = readItemString(item.scenario_type);
  const decisionType = readItemString(item.decision_type);
  const conceptTested = readItemString(item.concept_tested);
  const questionPattern = readItemString(item.question_pattern);
  const correctAnswerPattern = readItemString(item.correct_answer_pattern);

  if (!productTopic || !isApprovedMiniCaseProductTopic(productTopic)) {
    issues.push(qualityIssue({
      path: `${path}.product_topic`,
      code: "invalid_mini_case_product_topic",
      message: `Mini-case product_topic must be one of: ${Object.keys(MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS).join(", ")}.`,
      strict
    }));
  }

  if (!scenarioType || !isMiniCaseScenarioType(scenarioType)) {
    issues.push(qualityIssue({ path: `${path}.scenario_type`, code: "invalid_mini_case_scenario_type", message: "Mini-case scenario_type is missing or unsupported.", strict }));
  }
  if (!decisionType || !isMiniCaseDecisionType(decisionType)) {
    issues.push(qualityIssue({ path: `${path}.decision_type`, code: "invalid_mini_case_decision_type", message: "Mini-case decision_type is missing or unsupported.", strict }));
  }
  if (!conceptTested || !isMiniCaseConcept(conceptTested)) {
    issues.push(qualityIssue({ path: `${path}.concept_tested`, code: "invalid_mini_case_concept", message: "Mini-case concept_tested is missing or unsupported.", strict }));
  }
  if (!questionPattern || !isMiniCaseQuestionPattern(questionPattern)) {
    issues.push(qualityIssue({ path: `${path}.question_pattern`, code: "invalid_mini_case_question_pattern", message: "Mini-case question_pattern is missing or unsupported.", strict }));
  }
  if (!correctAnswerPattern || !isMiniCaseCorrectAnswerPattern(correctAnswerPattern)) {
    issues.push(qualityIssue({ path: `${path}.correct_answer_pattern`, code: "invalid_mini_case_answer_pattern", message: "Mini-case correct_answer_pattern is missing or unsupported.", strict }));
  }

  issues.push(...validateMiniCaseQuestions(item, path, strict));
  issues.push(...validateMiniCaseConclusion(item, path, strict));
  issues.push(...validateMiniCaseCooldowns(item, path, dropDate, options.miniCaseMemory ?? [], strict));

  return issues;
}

function validateMiniCaseQuestions(item: Extract<GeneratedContentItem, { content_type: "mini_case" }>, path: string, strict: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const questions = Array.isArray(item.questions) ? item.questions : [];
  const expectedRoles = ["method_framework", "technical_application", "conclusion_decision"];

  if (questions.length !== 3) {
    issues.push(qualityIssue({ path: `${path}.questions`, code: "mini_case_mcq_count_invalid", message: "Mini-case must contain exactly 3 MCQ questions.", strict }));
  }

  questions.forEach((question, questionIndex) => {
    if (question.role !== expectedRoles[questionIndex]) {
      issues.push(qualityIssue({ path: `${path}.questions.${questionIndex}.role`, code: "mini_case_mcq_role_invalid", message: `Question ${questionIndex + 1} must use role ${expectedRoles[questionIndex]}.`, strict }));
    }

    if (!question.question || question.question.trim().length < 12) {
      issues.push(qualityIssue({ path: `${path}.questions.${questionIndex}.question`, code: "mini_case_mcq_question_missing", message: "Each MCQ question needs a concrete prompt.", strict }));
    }

    if (!Array.isArray(question.options) || question.options.length < 2) {
      issues.push(qualityIssue({ path: `${path}.questions.${questionIndex}.options`, code: "mini_case_mcq_options_missing", message: "Each MCQ question needs answer options.", strict }));
      return;
    }

    const correctCount = question.options.filter((option) => option.is_correct).length;
    if (correctCount !== 1) {
      issues.push(qualityIssue({ path: `${path}.questions.${questionIndex}.options`, code: "mini_case_mcq_correct_count_invalid", message: "Each MCQ question needs exactly one correct answer so score can be computed from 0/3 to 3/3.", strict }));
    }

    question.options.forEach((option, optionIndex) => {
      if (!option.text || !option.feedback_correct || !option.feedback_incorrect) {
        issues.push(qualityIssue({ path: `${path}.questions.${questionIndex}.options.${optionIndex}`, code: "mini_case_mcq_feedback_missing", message: "Each answer option needs text plus correct and incorrect instant feedback.", strict }));
      }
    });
  });

  return issues;
}

function validateMiniCaseConclusion(item: Extract<GeneratedContentItem, { content_type: "mini_case" }>, path: string, strict: boolean): ValidationIssue[] {
  const conclusion = `${readItemString(item.conclusion) ?? ""} ${readItemString(item.core_takeaway) ?? ""}`.trim();
  if (wordCount(conclusion) < 12 || GENERIC_AI_PHRASES.some((phrase) => normalizeForPhraseCheck(conclusion).includes(phrase))) {
    return [
      qualityIssue({
        path: `${path}.conclusion`,
        code: "mini_case_conclusion_missing",
        message: "Mini-case conclusion/final takeaway is missing, too short, or generic.",
        strict
      })
    ];
  }
  return [];
}

function validateMiniCaseCooldowns(
  item: Extract<GeneratedContentItem, { content_type: "mini_case" }>,
  path: string,
  dropDate: string,
  memory: MiniCaseEditorialMemoryRecord[],
  strict: boolean
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const titleSlug = normalizeStoryTitle(item.title);

  for (const record of memory) {
    const age = daysBetweenDates(record.published_date, dropDate);
    if (normalizeStoryTitle(record.title) === titleSlug || record.slug === titleSlug) {
      issues.push(qualityIssue({ path: `${path}.title`, code: "mini_case_title_repeated", message: "Mini-case title/slug was already used.", strict }));
    }
    if (age <= 10 && record.scenario_type === item.scenario_type) {
      issues.push(qualityIssue({ path: `${path}.scenario_type`, code: "mini_case_scenario_cooldown", message: `scenario_type ${item.scenario_type} was used within 10 days.`, strict }));
    }
    if (age <= 7 && record.concept_tested === item.concept_tested) {
      issues.push(qualityIssue({ path: `${path}.concept_tested`, code: "mini_case_concept_cooldown", message: `concept_tested ${item.concept_tested} was used within 7 days.`, strict }));
    }
    if (age <= 5 && record.decision_type === item.decision_type) {
      issues.push(qualityIssue({ path: `${path}.decision_type`, code: "mini_case_decision_cooldown", message: `decision_type ${item.decision_type} was used within 5 days.`, strict }));
    }
    if (age <= 14 && record.question_pattern === item.question_pattern) {
      issues.push(qualityIssue({ path: `${path}.question_pattern`, code: "mini_case_question_pattern_cooldown", message: `question_pattern ${item.question_pattern} was used within 14 days.`, strict }));
    }
  }

  return issues;
}

function validateBusinessStoryEditorialMemory(
  item: GeneratedContentItem,
  path: string,
  dropDate: string,
  options: ContentQualityOptions,
  strict: boolean
): ValidationIssue[] {
  if (item.content_type !== "business_story" || !options.businessStoryMemory) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const current = buildBusinessStoryEditorialMemory({
    item: item as BusinessStory,
    contentItemId: null,
    publishedDate: dropDate
  });
  const currentEntity = normalizeMemoryKey(current.entity_name);
  const currentCompany = normalizeMemoryKey(current.main_company);
  const currentMechanism = normalizeMemoryKey(current.key_mechanism);
  const currentIndustry = normalizeMemoryKey(current.industry);
  const currentAngle = normalizeMemoryKey(current.strategic_angle);
  const currentSlug = slugify(current.title);
  const currentTakeawayTokens = memoryTokens(current.core_takeaway);
  const recent = options.businessStoryMemory.recentStories;
  const industryUses14Days = recent.filter((entry) => {
    const age = daysBetween(entry.published_date, dropDate);
    return age >= 0 && age <= 14 && normalizeMemoryKey(entry.industry) === currentIndustry;
  });

  if (industryUses14Days.length >= 2) {
    issues.push(qualityIssue({
      path: `${path}.editorial_memory.industry`,
      code: "business_story_industry_overused",
      message: `Business-story industry "${current.industry}" was already used ${industryUses14Days.length} times in the last 14 days.`,
      strict
    }));
  }

  for (const entry of recent) {
    const age = daysBetween(entry.published_date, dropDate);
    const sameEntity = normalizeMemoryKey(entry.entity_name) === currentEntity;
    const sameCompany = normalizeMemoryKey(entry.main_company) === currentCompany;
    const sameMechanism = normalizeMemoryKey(entry.key_mechanism) === currentMechanism;
    const sameAngle = normalizeMemoryKey(entry.strategic_angle) === currentAngle;

    if (slugify(entry.title) === currentSlug || entry.slug === currentSlug) {
      issues.push(qualityIssue({
        path: `${path}.title`,
        code: "business_story_title_repeated",
        message: `Business-story title/slug already exists in editorial memory: ${currentSlug}.`,
        strict
      }));
    }

    if (age >= 0 && age <= 180 && sameEntity) {
      issues.push(qualityIssue({
        path: `${path}.editorial_memory.entity_name`,
        code: "business_story_entity_cooldown",
        message: `Business-story entity "${current.entity_name}" was used ${age} day(s) ago; cooldown is 180 days.`,
        strict
      }));
    }

    if (age >= 0 && age <= 90 && sameCompany && !clearlyDifferentAngle(current.strategic_angle, entry.strategic_angle)) {
      issues.push(qualityIssue({
        path: `${path}.editorial_memory.main_company`,
        code: "business_story_company_cooldown",
        message: `Business-story main company "${current.main_company}" was used ${age} day(s) ago without a clearly different angle; cooldown is 90 days.`,
        strict
      }));
    }

    if (age >= 0 && age <= 14 && sameMechanism) {
      issues.push(qualityIssue({
        path: `${path}.editorial_memory.key_mechanism`,
        code: "business_story_mechanism_cooldown",
        message: `Business-story mechanism "${current.key_mechanism}" was used ${age} day(s) ago; cooldown is 14 days.`,
        strict
      }));
    }

    if (age >= 0 && age <= 30 && sameAngle) {
      issues.push(qualityIssue({
        path: `${path}.editorial_memory.strategic_angle`,
        code: "business_story_angle_cooldown",
        message: `Business-story strategic angle "${current.strategic_angle}" was used ${age} day(s) ago; cooldown is 30 days.`,
        strict
      }));
    }

    if (age >= 0 && age <= 90 && jaccard(currentTakeawayTokens, memoryTokens(entry.core_takeaway)) >= 0.72) {
      issues.push(qualityIssue({
        path: `${path}.editorial_memory.core_takeaway`,
        code: "business_story_takeaway_similarity",
        message: `Business-story core takeaway is too similar to recent story "${entry.title}".`,
        strict
      }));
    }
  }

  return issues;
}

function validateTitleReflectsTopic(
  item: GeneratedContentItem,
  path: string,
  sourceByUrl: Map<string, RankedArticle>,
  strict: boolean
): ValidationIssue[] {
  if (!item.topic || typeof item.title !== "string") {
    return [];
  }

  const normalizedTitle = normalizeForTopicMatch(item.title);
  const anchors = CONCEPT_ANCHORS[item.topic] ?? [];
  const titleHasTopicAnchor = anchors.some((anchor) => normalizedTitle.includes(normalizeForTopicMatch(anchor)));
  const titleLooksGeneric = GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(item.title));
  const sourceTitleText = knownSourcesForItem(item, sourceByUrl).map((source) => source.title).join(" ");
  const titleOverlapsSource = keywordOverlap(normalizedTitle, normalizeForPhraseCheck(sourceTitleText)) >= 1;

  if (titleHasTopicAnchor || titleOverlapsSource) {
    return [];
  }

  return [
    qualityIssue({
      path: `${path}.title`,
      code: "title_topic_mismatch",
      message: titleLooksGeneric
        ? "Title is generic and does not reflect the item topic or supplied source."
        : "Title should reflect the item topic or supplied source material.",
      strict
    })
  ];
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
    "sample_source_material",
    "source_url_not_cited",
    "source_date_not_cited",
    "retrieved_date_missing",
    "published_unknown_with_known_date",
    "published_unknown_without_retrieved_date",
    "unsupported_source_url",
    "source_date_missing",
    "stale_source_date",
    "unsupported_specific_claim",
    "source_overused",
    "duplicate_story_title",
    "duplicate_story_topic",
    "invalid_newsletter_product_topic",
    "invalid_mini_case_product_topic",
    "invalid_mini_case_preference_topic",
    "newsletter_topic_mismatch",
    "mini_case_preference_topic_mismatch",
    "invalid_mini_case_scenario_type",
    "invalid_mini_case_decision_type",
    "invalid_mini_case_concept",
    "invalid_mini_case_question_pattern",
    "invalid_mini_case_answer_pattern",
    "mini_case_mcq_count_invalid",
    "mini_case_mcq_role_invalid",
    "mini_case_mcq_question_missing",
    "mini_case_mcq_options_missing",
    "mini_case_mcq_correct_count_invalid",
    "mini_case_mcq_feedback_missing",
    "mini_case_conclusion_missing",
    "mini_case_title_repeated",
    "mini_case_scenario_cooldown",
    "mini_case_concept_cooldown",
    "mini_case_decision_cooldown",
    "mini_case_question_pattern_cooldown",
    "business_story_entity_cooldown",
    "business_story_company_cooldown",
    "business_story_mechanism_cooldown",
    "business_story_industry_overused",
    "business_story_angle_cooldown",
    "business_story_title_repeated",
    "business_story_takeaway_similarity",
    "source_topic_mismatch",
    "concept_missing_topic_anchor",
    "concept_example_source_mismatch",
    "body_too_short",
    "generic_filler",
    "title_topic_mismatch",
    "high_stakes_personal_advice",
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
    if (body.includes(decodeURI(sourceUrl))) {
      return true;
    }
  } catch {
    // Fall through to normalized URL matching.
  }

  const normalizedSource = normalizeUrlKey(sourceUrl);
  const bodyUrls = Array.from(body.matchAll(/https?:\/\/[^\s)\]]+/gi)).map((match) => normalizeUrlKey(match[0]));
  return bodyUrls.includes(normalizedSource);
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
    url.hostname = url.hostname.toLowerCase();
    for (const param of Array.from(url.searchParams.keys())) {
      if (isTrackingParam(param)) {
        url.searchParams.delete(param);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function isTrackingParam(param: string): boolean {
  const normalized = param.toLowerCase();
  return normalized.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid", "igshid"].includes(normalized);
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

function normalizeForTopicMatch(value: string): string {
  return normalizeForPhraseCheck(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeClaimText(value: string): string {
  return value
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isLikelyCitationDate(claim: string, item: GeneratedContentItem, sources: RankedArticle[]): boolean {
  if (!DATE_PATTERN.test(claim)) {
    return false;
  }

  const sourceDates = new Set(
    sources
      .flatMap((source) => [source.published_at?.slice(0, 10), source.retrieved_at?.slice(0, 10)])
      .filter((date): date is string => Boolean(date))
  );

  if (sourceDates.has(claim)) {
    return true;
  }

  if (item.content_type === "newsletter_article" && item.published_date === claim) {
    return true;
  }

  return item.content_type === "business_story" && item.story_date === claim;
}

function parseDateOnly(value: string | null | undefined): Date | null {
  const dateText = value?.slice(0, 10);
  if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return null;
  }

  const parsed = new Date(`${dateText}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetweenDates(leftDate: string, rightDate: string): number {
  const left = parseDateOnly(leftDate);
  const right = parseDateOnly(rightDate);
  if (!left || !right) {
    return Number.MAX_SAFE_INTEGER;
  }
  return dateDiffDays(left, right);
}

function dateDiffDays(left: Date, right: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((right.getTime() - left.getTime()) / msPerDay);
}

function normalizeStoryTitle(value: string): string {
  return normalizeForTopicMatch(value)
    .replace(/[^a-z0-9\u00C0-\u017F]+/gi, " ")
    .trim();
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function readItemString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function productTopicsToContentTopics(
  topics: string[],
  mapping: Record<string, readonly TopicId[]>
): Set<TopicId> {
  return new Set(
    topics.flatMap((topic) => mapping[topic] ?? [])
  );
}

function isKnownMiniCaseProductTopic(value: string): value is MiniCaseTopicId | keyof typeof MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS {
  return MINI_CASE_TOPIC_IDS.includes(value as MiniCaseTopicId) || value in MINI_CASE_PRODUCT_TOPIC_TO_CONTENT_TOPICS;
}

function clearlyDifferentAngle(current: string, previous: string): boolean {
  return jaccard(memoryTokens(current), memoryTokens(previous)) < 0.35;
}

function memoryTokens(value: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "into",
    "one",
    "une",
    "des",
    "les",
    "pour",
    "avec",
    "dans",
    "plus",
    "moins",
    "decision",
    "strategy",
    "business"
  ]);

  return new Set(
    normalizeMemoryKey(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !stopWords.has(token))
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
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
