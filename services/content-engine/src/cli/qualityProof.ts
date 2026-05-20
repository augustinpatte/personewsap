import type { DailyDropPayload, GeneratedContentItem, RankedArticle } from "../domain.js";
import { sanitizeLlmDailyDropPayload } from "../generation/llmSanitizer.js";
import { assertValidDailyDropPayload, validateDailyDropQuality, type ValidationIssue } from "../generation/validation.js";

type RejectedExample = {
  name: string;
  rejected: true;
  expected_codes: string[];
  observed_codes: string[];
  quality_score: number;
  error: string;
};

export type QualityProofOutput = {
  mode: "quality-proof";
  productionContentStrict: true;
  status: "passed";
  rejected_examples: RejectedExample[];
  sanitized_examples: Array<{
    name: string;
    accepted: true;
    source_urls: string[];
    body_includes_source_url: boolean;
    body_includes_source_date: boolean;
    concept_title: string;
    concept_category: string;
  }>;
};

const SOURCE_DATE = "2026-04-29";
const RETRIEVED_DATE = "2026-04-29";
const FINANCE_SOURCE_URL = "https://www.reputable-publisher.test/markets/oil-price-risk";
const TECH_SOURCE_URL = "https://www.reputable-publisher.test/technology/ai-chip-capacity";

const FINANCE_SOURCE: RankedArticle = {
  url: FINANCE_SOURCE_URL,
  title: "Oil prices jump as supply risk changes market expectations",
  publisher: "Reputable Markets Desk",
  author: null,
  published_at: `${SOURCE_DATE}T08:00:00.000Z`,
  retrieved_at: `${RETRIEVED_DATE}T09:00:00.000Z`,
  language: "en",
  summary: "Oil prices rose after a supply disruption changed inflation and market risk expectations.",
  sourceTopic: "finance",
  credibility_score: 0.85,
  content_hash: "finance-source",
  normalized_url: FINANCE_SOURCE_URL,
  topic: "finance",
  importance_score: 0.81,
  rank_reasons: ["market risk", "funding impact"]
};

const TECH_SOURCE: RankedArticle = {
  url: TECH_SOURCE_URL,
  title: "AI chip capacity forces cloud teams to revise deployment plans",
  publisher: "Reputable Tech Desk",
  author: null,
  published_at: `${SOURCE_DATE}T10:00:00.000Z`,
  retrieved_at: `${RETRIEVED_DATE}T11:00:00.000Z`,
  language: "en",
  summary: "AI chip capacity constraints changed model deployment timelines for cloud teams.",
  sourceTopic: "tech_ai",
  credibility_score: 0.84,
  content_hash: "tech-source",
  normalized_url: TECH_SOURCE_URL,
  topic: "tech_ai",
  importance_score: 0.8,
  rank_reasons: ["compute bottleneck", "deployment impact"]
};

export function runQualityProof(): QualityProofOutput {
  const examples = [
    expectRejected(
      "concept lens mismatched with source topic",
      withConcept({
        topic: "business",
        category: "business",
        title: "Pricing power",
        definition: "The ability to raise prices without losing enough customers to damage the business.",
        sourceUrl: FINANCE_SOURCE_URL,
        example: "Oil prices rose after a supply disruption changed inflation and market risk expectations."
      }),
      ["source_topic_mismatch"],
      [FINANCE_SOURCE, TECH_SOURCE]
    ),
    expectRejected(
      "body omits cited source URL",
      withNewsletterBody(
        "Oil prices rose after a supply disruption changed inflation expectations. The useful finance signal is market risk, funding costs, and credit repricing after 2026-04-29. This paragraph is intentionally long enough to satisfy the reading-time floor while still omitting the source URL that production content must cite directly."
      ),
      ["source_url_not_cited"],
      [FINANCE_SOURCE, TECH_SOURCE]
    ),
    expectRejected(
      "published unknown used despite known source date",
      withNewsletterBody(
        `Oil prices rose after a supply disruption changed inflation expectations. The body says Source: [Reputable Markets Desk](${FINANCE_SOURCE_URL}), published unknown, retrieved ${RETRIEVED_DATE}. This is invalid because the source packet has a real publication date and production content must not hide it behind an unknown label.`
      ),
      ["published_unknown_with_known_date"],
      [FINANCE_SOURCE, TECH_SOURCE]
    ),
    expectRejected(
      "sample URL in RSS-only production mode",
      withNewsletterSourceUrl("https://example.com/sample-source"),
      ["sample_url_blocked"],
      [FINANCE_SOURCE, TECH_SOURCE]
    ),
    expectRejected(
      "source URL was not supplied to the model",
      withNewsletterSourceUrl("https://www.other-publisher.test/markets/oil-price-risk"),
      ["unsupported_source_url"],
      [FINANCE_SOURCE, TECH_SOURCE]
    ),
    expectRejected(
      "generic title does not reflect topic or source",
      withNewsletterTitle("Generic update"),
      ["title_topic_mismatch"],
      [FINANCE_SOURCE, TECH_SOURCE]
    ),
    expectRejected(
      "placeholder filler is not production content",
      withNewsletterGenericFiller(),
      ["generic_filler"],
      [FINANCE_SOURCE, TECH_SOURCE]
    )
  ];

  return {
    mode: "quality-proof",
    productionContentStrict: true,
    status: "passed",
    rejected_examples: examples,
    sanitized_examples: [expectSanitizedAccepted()]
  };
}

function expectSanitizedAccepted(): QualityProofOutput["sanitized_examples"][number] {
  const unsanitized = basePayload();
  unsanitized.items[0] = {
    ...unsanitized.items[0],
    body_md:
      "Oil prices rose after a supply disruption changed inflation and market risk expectations. The finance implication is market risk, funding cost pressure, and capital allocation discipline for operators deciding whether this is a temporary shock or a budget constraint.",
    source_urls: [`${FINANCE_SOURCE_URL}/?utm_source=llm#summary`]
  } as GeneratedContentItem;
  unsanitized.items[1] = {
    ...unsanitized.items[1],
    body_md: [
      "AI chip capacity constraints changed model deployment timelines for cloud teams and made compute allocation a business decision.",
      "The operator trade-off is whether to protect the highest-value customers first or spread scarce capacity across more launches with weaker guarantees.",
      "The signal to watch is deployment delay by customer segment, because that shows whether compute scarcity is shaping revenue, trust, or product roadmaps.",
      `Source: Reputable Tech Desk, published ${SOURCE_DATE}, retrieved ${RETRIEVED_DATE}. ${TECH_SOURCE_URL}`
    ].join("\n\n")
  } as GeneratedContentItem;
  unsanitized.items[2] = {
    ...unsanitized.items[2],
    body_md: [
      "Oil prices rose after a supply disruption changed inflation and market risk expectations for finance teams.",
      "Your task is to brief a decision owner on whether the move changes this week's funding assumptions or only deserves monitoring.",
      "A strong answer names the factual market move, one capital risk, and the next signal that would justify action.",
      `Source: Reputable Markets Desk, published ${SOURCE_DATE}, retrieved ${RETRIEVED_DATE}. ${FINANCE_SOURCE_URL}`
    ].join("\n\n")
  } as GeneratedContentItem;
  unsanitized.items[3] = {
    ...unsanitized.items[3],
    title: "Decision lens",
    category: "business",
    body_md:
      "Oil prices rose after a supply disruption changed inflation and market risk expectations. The reusable lesson is to separate the observed market move from the decision owner, then watch the next capital signal before acting.",
    source_urls: []
  } as GeneratedContentItem;

  const sanitized = sanitizeLlmDailyDropPayload(unsanitized, [FINANCE_SOURCE, TECH_SOURCE]);

  assertValidDailyDropPayload(sanitized, {
    articles: [FINANCE_SOURCE, TECH_SOURCE],
    rssOnly: true,
    productionStrict: true
  });

  const newsletter = sanitized.items[0];
  const concept = sanitized.items[3];
  if (concept.content_type !== "concept") {
    throw new Error("Quality proof failed: sanitized concept slot was not a concept.");
  }

  return {
    name: "llm post-processing repairs supplied source citation fields",
    accepted: true,
    source_urls: newsletter.source_urls,
    body_includes_source_url: newsletter.body_md.includes(FINANCE_SOURCE_URL),
    body_includes_source_date: newsletter.body_md.includes(SOURCE_DATE),
    concept_title: concept.title,
    concept_category: concept.category
  };
}

function expectRejected(
  name: string,
  payload: DailyDropPayload,
  expectedCodes: string[],
  articles: RankedArticle[]
): RejectedExample {
  const diagnostics = validateDailyDropQuality(payload, {
    articles,
    rssOnly: true,
    productionStrict: true
  });

  let error: string | null = null;
  try {
    assertValidDailyDropPayload(payload, {
      articles,
      rssOnly: true,
      productionStrict: true
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  if (!error) {
    throw new Error(`Quality proof failed: ${name} was accepted.`);
  }

  const observedCodes = Array.from(new Set(diagnostics.issues.map((issue) => issue.code).filter(isString)));
  const missingCodes = expectedCodes.filter((code) => !observedCodes.includes(code));
  if (missingCodes.length > 0) {
    throw new Error(`Quality proof failed: ${name} did not report expected code(s): ${missingCodes.join(", ")}.`);
  }

  return {
    name,
    rejected: true,
    expected_codes: expectedCodes,
    observed_codes: observedCodes,
    quality_score: diagnostics.score,
    error
  };
}

function basePayload(): DailyDropPayload {
  return {
    drop_date: SOURCE_DATE,
    language: "en",
    prompt_version: "quality_proof",
    generator_version: "quality_proof",
    items: [
      newsletterItem(FINANCE_SOURCE_URL),
      businessStoryItem(),
      miniCaseItem(),
      conceptItem({
        topic: "finance",
        category: "finance",
        title: "Duration risk",
        definition: "The sensitivity of an asset value to changes in interest rates and market risk.",
        sourceUrl: FINANCE_SOURCE_URL,
        example: "Oil prices rose after a supply disruption changed inflation and market risk expectations."
      })
    ]
  };
}

function newsletterItem(sourceUrl: string): GeneratedContentItem {
  return {
    content_type: "newsletter_article",
    slot: "newsletter",
    topic: "finance",
    language: "en",
    title: "Oil prices jump as supply risk changes market expectations",
    published_date: SOURCE_DATE,
    summary: "Oil prices rose after a supply disruption changed inflation and market risk expectations.",
    body_md: sourceBackedBody(sourceUrl, "Finance"),
    why_it_matters: "Finance: market risk and inflation expectations can reprice decisions quickly.",
    source_urls: [sourceUrl],
    version: 1
  };
}

function businessStoryItem(): GeneratedContentItem {
  return {
    content_type: "business_story",
    slot: "business_story",
    topic: "tech_ai",
    language: "en",
    title: "The business lesson inside AI chip capacity",
    company_or_market: "Reputable Tech Desk",
    story_date: SOURCE_DATE,
    setup: "AI chip capacity constraints changed model deployment timelines for cloud teams.",
    tension: "The pressure sits in Tech/AI: compute capacity changes delivery promises.",
    decision: "A strong operator would tie the capacity bottleneck to one owner and one deployment metric.",
    outcome: "The measurable outcome is deployment timelines and customer migration behavior.",
    lesson: "Compute constraints can become strategy constraints before the demo changes.",
    body_md: sourceBackedBody(TECH_SOURCE_URL, "Tech/AI"),
    source_urls: [TECH_SOURCE_URL],
    version: 1
  };
}

function miniCaseItem(): GeneratedContentItem {
  return {
    content_type: "mini_case",
    slot: "mini_case",
    topic: "finance",
    language: "en",
    title: "Mini-case: brief the market risk move",
    difficulty: "medium",
    context: "Oil prices rose after a supply disruption changed inflation and market risk expectations.",
    challenge: "Prepare a five-minute brief for a team deciding whether market risk deserves action this week.",
    constraints: ["Use only sourced facts", "name the decision owner", "watch funding costs and inflation expectations"],
    question: "Would you act now, wait for one signal, or narrow the decision?",
    expected_reasoning: ["State the sourced fact from 2026-04-29", "Name who has less room to maneuver", "Choose one signal to watch"],
    sample_answer: "I would wait for one confirming signal because the sourced fact changes risk expectations, not the whole budget yet.",
    body_md: sourceBackedBody(FINANCE_SOURCE_URL, "Finance"),
    source_urls: [FINANCE_SOURCE_URL],
    version: 1
  };
}

function conceptItem(input: {
  topic: "business" | "finance";
  category: "business" | "finance";
  title: string;
  definition: string;
  sourceUrl: string;
  example: string;
}): GeneratedContentItem {
  return {
    content_type: "concept",
    slot: "concept",
    topic: input.topic,
    language: "en",
    title: input.title,
    category: input.category,
    definition: input.definition,
    plain_english: "Use the concept to identify the constraint doing the work in the sourced update.",
    example: input.example,
    why_it_matters: "It turns one sourced update into a reusable analytical lens for a decision.",
    how_to_use_it: "Pair the concept with one observable signal and one decision owner.",
    common_mistake: "Treating the concept as a label instead of a testable mechanism.",
    body_md: sourceBackedBody(input.sourceUrl, input.category),
    source_urls: [input.sourceUrl],
    version: 1
  };
}

function withConcept(input: {
  topic: "business" | "finance";
  category: "business" | "finance";
  title: string;
  definition: string;
  sourceUrl: string;
  example: string;
}): DailyDropPayload {
  const payload = basePayload();
  payload.items[3] = conceptItem(input);
  return payload;
}

function withNewsletterBody(body: string): DailyDropPayload {
  const payload = basePayload();
  payload.items[0] = {
    ...payload.items[0],
    body_md: body
  } as GeneratedContentItem;
  return payload;
}

function withNewsletterSourceUrl(sourceUrl: string): DailyDropPayload {
  const payload = basePayload();
  payload.items[0] = newsletterItem(sourceUrl);
  return payload;
}

function withNewsletterTitle(title: string): DailyDropPayload {
  const payload = basePayload();
  payload.items[0] = {
    ...payload.items[0],
    title
  } as GeneratedContentItem;
  return payload;
}

function withNewsletterGenericFiller(): DailyDropPayload {
  const payload = basePayload();
  payload.items[0] = {
    ...payload.items[0],
    summary: "Placeholder content for a finance article.",
    body_md: [
      "Placeholder content says very little about the actual finance mechanism, market risk, source fact, or decision owner.",
      `Source: Reputable Markets Desk, published ${SOURCE_DATE}, retrieved ${RETRIEVED_DATE}. ${FINANCE_SOURCE_URL}`
    ].join("\n\n")
  } as GeneratedContentItem;
  return payload;
}

function sourceBackedBody(sourceUrl: string, label: string): string {
  return [
    `${label} update: Oil prices rose after a supply disruption changed inflation and market risk expectations for the day.`,
    "The analytical move is to separate the sourced fact from the decision it pressures, then name the owner and the next signal.",
    "A useful brief would watch funding costs, deployment timelines, customer behavior, or budget changes before turning the update into action.",
    `Source: [Reputable Desk](${sourceUrl}), published ${SOURCE_DATE}, retrieved ${RETRIEVED_DATE}.`
  ].join("\n\n");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
