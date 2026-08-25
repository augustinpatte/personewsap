import { describe, expect, it } from "vitest";

import type { GeneratedContentItem, Language, TopicId } from "../domain.js";
import { readApprovedStagingBatch } from "./stagingBatchReader.js";
import { StagingBatchRejectedError, EXPECTED_SCHEDULED_JOBS } from "./stagingBatch.js";
import {
  buildPayloadsFromBatch,
  buildStagingContentMetadata,
  validateBatchPayload
} from "./publishStagingBatch.js";
import { resolveEditionType } from "../scheduler/editionCadence.js";

/**
 * The bridge between ChatGPT staging and the production pipeline.
 *
 * Editorial generation moved out of this repo; everything after it stayed. What
 * these tests protect is the seam: that nothing crosses it unvalidated, that a
 * batch is published whole or not at all, and that what comes out the other side
 * is exactly the shape `ContentRepository` and the mobile readers already
 * expect.
 *
 * The staging shapes here were read off the live project, not invented: an
 * `output_json` is a `{ fr, en }` envelope of the engine's own item type, and
 * `source_records` carries the metadata for every URL those items cite.
 */

const EDITION_DATE = "2026-08-24";
const SOURCE_URL = "https://sources.test/capacity";

const NEWSLETTER_TOPICS: TopicId[] = [
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering",
  "sport_business",
  "culture_media"
];

const MINI_CASE_TOPICS = [
  "finance_economy",
  "stock_market",
  "ai",
  "law_compliance",
  "health_pharma",
  "engineering_operations"
];

function sourceRecord() {
  return {
    url: SOURCE_URL,
    title: "Operator reprices reserved capacity",
    publisher: "Probe Desk",
    published_at: `${EDITION_DATE}T08:00:00Z`,
    language: "en"
  };
}

function newsletterItem(language: Language, topic: TopicId): Record<string, unknown> {
  const fr = language === "fr";
  return {
    content_type: "newsletter_article",
    slot: "newsletter",
    language,
    topic,
    title: fr ? "Un opérateur réajuste ses tarifs" : "An operator reprices its capacity",
    summary: fr ? "La marge dépend du taux d'acceptation." : "Margin depends on the acceptance rate.",
    body_md: fr
      ? `Le contrat porte sur 12 millions d'euros (${EDITION_DATE}).\n\nSource: ${SOURCE_URL}`
      : `The contract covers 12 million euros (${EDITION_DATE}).\n\nSource: ${SOURCE_URL}`,
    why_it_matters: fr ? "Le prix décide de la marge." : "Price decides the margin.",
    published_date: EDITION_DATE,
    source_urls: [SOURCE_URL],
    version: 1
  };
}

function businessStoryItem(language: Language): Record<string, unknown> {
  const fr = language === "fr";
  return {
    content_type: "business_story",
    slot: "business_story",
    language,
    topic: "business",
    title: fr ? "Comment un opérateur a défendu sa marge" : "How an operator defended its margin",
    company_or_market: "Probe Operator",
    story_date: EDITION_DATE,
    setup: fr ? "Les coûts unitaires montent de 8%." : "Unit costs rose 8%.",
    tension: fr ? "Absorber ou répercuter." : "Absorb it or pass it on.",
    decision: fr ? "Relever les tarifs réservés." : "Reprice the reserved tier.",
    outcome: fr ? "La marge se stabilise à 22%." : "Margin stabilised at 22%.",
    lesson: fr ? "La sélection défend la marge." : "Selection defends the margin.",
    body_md: fr
      ? `Le contrat porte sur 12 millions d'euros (${EDITION_DATE}).\n\nSource: ${SOURCE_URL}`
      : `The contract covers 12 million euros (${EDITION_DATE}).\n\nSource: ${SOURCE_URL}`,
    editorial_memory: {
      entity_name: "Probe Operator",
      entity_type: "company",
      main_company: "Probe Operator",
      companies_mentioned: ["Probe Operator"],
      industry: "cloud",
      key_mechanism: "pricing power",
      secondary_mechanisms: [],
      strategic_angle: "reprice the reserved tier",
      core_takeaway: "Selection defends the margin.",
      year_period: "2020s"
    },
    source_urls: [SOURCE_URL],
    version: 1
  };
}

function miniCaseItem(language: Language, productTopic: string): Record<string, unknown> {
  const fr = language === "fr";
  return {
    content_type: "mini_case",
    slot: "mini_case",
    language,
    topic: "finance",
    title: fr ? "Défendre la marge quand les coûts montent" : "Defending margin when costs rise",
    product_topic: productTopic,
    scenario_type: "pricing_decision",
    decision_type: "choose_metric",
    concept_tested: "margin",
    mechanism: "pricing power",
    question_pattern: "framework_then_apply_then_decide",
    correct_answer_pattern: "best_next_signal",
    core_takeaway: fr ? "La sélection défend la marge." : "Selection defends the margin.",
    difficulty: "intro",
    context: fr
      ? `Un opérateur voit ses coûts monter (${EDITION_DATE}).`
      : `An operator sees costs rise (${EDITION_DATE}).`,
    challenge: fr ? "Choisir le signal à suivre." : "Choose the signal to watch.",
    constraints: fr ? ["Budget gelé ce trimestre"] : ["Budget frozen this quarter"],
    question: fr ? "Quel signal suivre ?" : "Which signal should you watch?",
    questions: ["method_framework", "technical_application", "conclusion_decision"].map((role, index) => ({
      id: `q${index + 1}`,
      role,
      question: fr ? `Question ${index + 1} ?` : `Question ${index + 1}?`,
      options: ["A", "B", "C", "D"].map((id) => ({
        id,
        text: fr ? `Option ${id} en français` : `Option ${id} in English`,
        is_correct: id === "A",
        feedback: fr ? `Retour ${id}` : `Feedback ${id}`
      }))
    })),
    expected_reasoning: [fr ? "Comparer au trimestre." : "Compare against the quarter."],
    sample_answer: fr ? "Le taux d'acceptation." : "The acceptance rate.",
    conclusion: fr ? "Attendre le signal." : "Wait for the signal.",
    final_takeaway: fr ? "La marge suit la sélection." : "Margin follows selection.",
    score_max: 3,
    body_md: fr
      ? `Cas pratique (${EDITION_DATE}).\n\nSource: ${SOURCE_URL}`
      : `Practical case (${EDITION_DATE}).\n\nSource: ${SOURCE_URL}`,
    source_urls: [SOURCE_URL],
    version: 1
  };
}

type JobSpec = {
  id: string;
  content_type: string;
  topic: string | null;
  mini_case_topic: string | null;
  ordinal: number;
  status?: string;
  output?: unknown;
  sourceRecords?: unknown;
  review?: Partial<{ verdict: string; score: number; checks: Record<string, unknown> }>;
};

/** A full scheduled edition: 16 newsletter articles, 1 story, 6 mini cases. */
function scheduledJobs(): JobSpec[] {
  const jobs: JobSpec[] = [];

  NEWSLETTER_TOPICS.forEach((topic) => {
    for (const ordinal of [1, 2]) {
      jobs.push({
        id: `news-${topic}-${ordinal}`,
        content_type: "newsletter_article",
        topic,
        mini_case_topic: null,
        ordinal,
        output: { fr: newsletterItem("fr", topic), en: newsletterItem("en", topic) }
      });
    }
  });

  jobs.push({
    id: "story-1",
    content_type: "business_story",
    topic: "business",
    mini_case_topic: null,
    ordinal: 1,
    output: { fr: businessStoryItem("fr"), en: businessStoryItem("en") }
  });

  MINI_CASE_TOPICS.forEach((productTopic, index) => {
    jobs.push({
      id: `case-${productTopic}`,
      content_type: "mini_case",
      topic: "finance",
      mini_case_topic: productTopic,
      ordinal: index + 1,
      output: { fr: miniCaseItem("fr", productTopic), en: miniCaseItem("en", productTopic) }
    });
  });

  return jobs;
}

/** A Supabase-shaped stub over in-memory staging rows. */
function stagingStub(input: {
  batch?: Partial<Record<string, unknown>>;
  jobs?: JobSpec[];
}) {
  const jobs = input.jobs ?? scheduledJobs();
  const batch = {
    id: "batch-1",
    edition_date: EDITION_DATE,
    edition_kind: "daily",
    status: "ready",
    expected_jobs: jobs.length,
    completed_jobs: jobs.length,
    approved_jobs: jobs.length,
    prompt_bundle_version: "newsletter:v1|business_story:v1|mini_case:v1|reviewer:v1",
    target_project_ref: "wkbviidrbmehmjbhvpeh",
    metadata: { edition_type: "daily" },
    ...input.batch
  };

  const rows: Record<string, unknown[]> = {
    automation_batches: [batch],
    generation_jobs: jobs.map((job) => ({
      id: job.id,
      batch_id: batch.id,
      content_type: job.content_type,
      topic: job.topic,
      mini_case_topic: job.mini_case_topic,
      ordinal: job.ordinal,
      status: job.status ?? "approved",
      prompt_key: job.content_type
    })),
    generation_outputs: jobs
      .filter((job) => job.output !== undefined)
      .map((job) => ({
        id: `out-${job.id}`,
        job_id: job.id,
        attempt: 1,
        prompt_version: "chatgpt-v1",
        output_json: job.output,
        source_records: job.sourceRecords ?? [sourceRecord()]
      })),
    generation_reviews: jobs
      .filter((job) => job.output !== undefined)
      .map((job) => ({
        id: `rev-${job.id}`,
        job_id: job.id,
        output_id: `out-${job.id}`,
        reviewer_id: "reviewer-1",
        verdict: job.review?.verdict ?? "approved",
        score: job.review?.score ?? 95,
        checks: job.review?.checks ?? {
          source_grounding: true,
          factual_accuracy: true,
          safety: true,
          schema: true,
          fr_en_parity: true,
          novelty_anti_repetition: true
        },
        reviewed_at: `${EDITION_DATE}T09:00:00Z`
      }))
  };

  const builder = (table: string) => {
    let data = [...(rows[table] ?? [])];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        data = data.filter((row) => (row as Record<string, unknown>)[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        data = data.filter((row) => values.includes((row as Record<string, unknown>)[column]));
        return chain;
      },
      order: () => chain,
      limit: () => Promise.resolve({ data, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data, error: null })
    };
    return chain;
  };

  return { from: builder } as never;
}

describe("an approved staging batch becomes a publishable edition", () => {
  it("accepts a complete 23-job daily edition", async () => {
    const batch = await readApprovedStagingBatch(stagingStub({}), { editionDate: EDITION_DATE });

    expect(batch.items).toHaveLength(EXPECTED_SCHEDULED_JOBS);
    expect(batch.editionType).toBe("daily");
    expect(batch.approvedJobs).toBe(23);

    const counts = batch.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.contentType] = (acc[item.contentType] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ newsletter_article: 16, business_story: 1, mini_case: 6 });
  });

  it("carries both language versions of every job", async () => {
    const batch = await readApprovedStagingBatch(stagingStub({}), { editionDate: EDITION_DATE });

    for (const item of batch.items) {
      expect(item.items.fr.language).toBe("fr");
      expect(item.items.en.language).toBe("en");
      // One concept, two renderings: same sources on both sides.
      expect(item.items.fr.source_urls).toEqual(item.items.en.source_urls);
    }
  });

  it("maps into the payload shape the existing pipeline consumes", async () => {
    const batch = await readApprovedStagingBatch(stagingStub({}), { editionDate: EDITION_DATE });
    const { payload, articles } = buildPayloadsFromBatch(batch, "fr");

    expect(payload.drop_date).toBe(EDITION_DATE);
    expect(payload.language).toBe("fr");
    expect(payload.generator_version).toBe("chatgpt_scheduled");
    expect(payload.items).toHaveLength(23);
    // Source metadata for every cited URL, ready for mapArticlesToSourceUpserts.
    expect(articles).toHaveLength(1);
    expect(articles[0].url).toBe(SOURCE_URL);
    expect(articles[0].rank_reasons).toEqual(["chatgpt_staging_source"]);
  });

  it("passes the validators the LLM path used", async () => {
    const batch = await readApprovedStagingBatch(stagingStub({}), { editionDate: EDITION_DATE });

    for (const language of ["fr", "en"] as const) {
      const { payload, articles } = buildPayloadsFromBatch(batch, language);
      expect(validateBatchPayload({ payload, articles, productionStrict: false })).toEqual([]);
    }
  });

  it("records provenance without inventing a model name", async () => {
    const batch = await readApprovedStagingBatch(stagingStub({}), { editionDate: EDITION_DATE });
    const metadata = buildStagingContentMetadata({
      batch,
      runId: "run-1",
      contentStatus: "published"
    });

    expect(metadata.generator).toBe("chatgpt_scheduled");
    expect(metadata.staging_batch_id).toBe("batch-1");
    // The exact ChatGPT model is not exposed to us; a guess would be a false
    // fact in the provenance of every item.
    expect(metadata.model_name).toBeNull();
  });
});

describe("a batch that is not wholly approved is refused", () => {
  const refuse = async (jobs: JobSpec[], batch: Record<string, unknown> = {}) =>
    readApprovedStagingBatch(stagingStub({ jobs, batch }), { editionDate: EDITION_DATE });

  it("refuses a batch that is still generating", async () => {
    await expect(refuse(scheduledJobs(), { status: "generating" })).rejects.toThrow(/not ready/);
  });

  it("refuses a batch missing jobs", async () => {
    await expect(refuse(scheduledJobs().slice(0, 22))).rejects.toThrow(/expected 23/);
  });

  it("refuses a job awaiting revision", async () => {
    const jobs = scheduledJobs();
    jobs[0].status = "revision_required";
    await expect(refuse(jobs)).rejects.toThrow(/not approved/);
  });

  it("refuses a failed job", async () => {
    const jobs = scheduledJobs();
    jobs[3].status = "failed";
    await expect(refuse(jobs)).rejects.toThrow(/not approved/);
  });

  it("refuses a review below the score bar", async () => {
    const jobs = scheduledJobs();
    jobs[0].review = { score: 84 };
    await expect(refuse(jobs)).rejects.toThrow(/below the 90 bar/);
  });

  it("refuses a review with a critical check false", async () => {
    const jobs = scheduledJobs();
    jobs[0].review = {
      checks: {
        source_grounding: false,
        factual_accuracy: true,
        safety: true,
        schema: true,
        fr_en_parity: true
      }
    };
    await expect(refuse(jobs)).rejects.toThrow(/source_grounding/);
  });

  it("refuses a cited URL with no source record", async () => {
    const jobs = scheduledJobs();
    jobs[0].sourceRecords = [{ ...sourceRecord(), url: "https://sources.test/other" }];
    await expect(refuse(jobs)).rejects.toThrow(/has no source record/);
  });

  it("refuses content generated on the wrong topic", async () => {
    const jobs = scheduledJobs();
    jobs[0].output = { fr: newsletterItem("fr", "medicine"), en: newsletterItem("en", "medicine") };
    await expect(refuse(jobs)).rejects.toThrow(/commissioned for business/);
  });

  it("refuses a half-translated pair", async () => {
    const jobs = scheduledJobs();
    jobs[0].output = { fr: newsletterItem("fr", "business") };
    await expect(refuse(jobs)).rejects.toThrow(/output_json.en is missing/);
  });

  it("refuses a version written in the wrong language", async () => {
    const jobs = scheduledJobs();
    jobs[0].output = { fr: newsletterItem("en", "business"), en: newsletterItem("en", "business") };
    await expect(refuse(jobs)).rejects.toThrow(/language is en, expected fr/);
  });

  it("refuses a Mini Case with the wrong question structure", async () => {
    const jobs = scheduledJobs();
    const broken = miniCaseItem("fr", "finance_economy");
    (broken.questions as unknown[]).pop();
    jobs[17].output = { fr: broken, en: miniCaseItem("en", "finance_economy") };
    await expect(refuse(jobs)).rejects.toThrow(/expected exactly 3 questions/);
  });

  it("refuses a Mini Case with two correct answers", async () => {
    const jobs = scheduledJobs();
    const broken = miniCaseItem("fr", "finance_economy") as Record<string, unknown>;
    const questions = broken.questions as Array<{ options: Array<{ is_correct: boolean }> }>;
    questions[0].options[1].is_correct = true;
    jobs[17].output = { fr: broken, en: miniCaseItem("en", "finance_economy") };
    await expect(refuse(jobs)).rejects.toThrow(/expected exactly 1 correct option/);
  });

  it("refuses a Mini Case commissioned for another product topic", async () => {
    const jobs = scheduledJobs();
    jobs[17].output = { fr: miniCaseItem("fr", "ai"), en: miniCaseItem("en", "ai") };
    await expect(refuse(jobs)).rejects.toThrow(/commissioned for finance_economy/);
  });

  it("names every problem at once rather than the first", async () => {
    const jobs = scheduledJobs();
    jobs[0].output = { fr: { content_type: "newsletter_article" }, en: { content_type: "newsletter_article" } };

    const error = await refuse(jobs).catch((thrown: unknown) => thrown as StagingBatchRejectedError);

    expect(error).toBeInstanceOf(StagingBatchRejectedError);
    expect((error as StagingBatchRejectedError).details.length).toBeGreaterThan(3);
  });
});

describe("the cadence is the product's, not a second copy", () => {
  it("accepts the days the product publishes on", () => {
    // Monday, Wednesday, Friday are daily; Sunday is the weekly digest.
    expect(resolveEditionType("2026-08-24")).toBe("daily");
    expect(resolveEditionType("2026-08-26")).toBe("daily");
    expect(resolveEditionType("2026-08-28")).toBe("daily");
    expect(resolveEditionType("2026-08-23")).toBe("weekly_digest");
  });

  it("has no edition on the quiet days", () => {
    for (const quiet of ["2026-08-25", "2026-08-27", "2026-08-29"]) {
      expect(resolveEditionType(quiet)).toBeNull();
    }
  });

  it("reads a Sunday batch as a weekly digest", async () => {
    const batch = await readApprovedStagingBatch(
      stagingStub({
        batch: {
          edition_date: "2026-08-23",
          edition_kind: "weekly_digest",
          metadata: { edition_type: "weekly_digest" }
        }
      }),
      { editionDate: "2026-08-23" }
    );

    expect(batch.editionType).toBe("weekly_digest");
  });
});

describe("a test batch is for inspection, never for readers", () => {
  it("accepts a partial sample batch when previewing", async () => {
    const sample = scheduledJobs().slice(0, 3);
    const batch = await readApprovedStagingBatch(
      stagingStub({ jobs: sample, batch: { edition_kind: "test", metadata: { edition_type: "daily" } } }),
      { editionDate: EDITION_DATE, editionKind: "test", allowPartialTestBatch: true }
    );

    expect(batch.editionKind).toBe("test");
    expect(batch.items).toHaveLength(3);
    // It still produces real, validated payloads — that is what makes a preview
    // worth reading.
    const { payload, articles } = buildPayloadsFromBatch(batch, "en");
    expect(validateBatchPayload({ payload, articles, productionStrict: false })).toEqual([]);
  });

  it("refuses a partial batch that is not marked as a test", async () => {
    await expect(
      readApprovedStagingBatch(stagingStub({ jobs: scheduledJobs().slice(0, 3) }), {
        editionDate: EDITION_DATE
      })
    ).rejects.toThrow(/expected 23/);
  });
});

describe("what reaches the mobile readers is unchanged", () => {
  it("produces items carrying every field each reader renders", async () => {
    const batch = await readApprovedStagingBatch(stagingStub({}), { editionDate: EDITION_DATE });
    const { payload } = buildPayloadsFromBatch(batch, "fr");
    const byType = (type: string) => payload.items.find((item) => item.content_type === type);

    const newsletter = byType("newsletter_article") as GeneratedContentItem & Record<string, unknown>;
    for (const field of ["title", "summary", "body_md", "why_it_matters", "published_date", "source_urls"]) {
      expect(newsletter[field]).toBeTruthy();
    }

    const story = byType("business_story") as GeneratedContentItem & Record<string, unknown>;
    for (const field of [
      "company_or_market",
      "story_date",
      "setup",
      "tension",
      "decision",
      "outcome",
      "lesson",
      "body_md",
      "editorial_memory"
    ]) {
      expect(story[field]).toBeTruthy();
    }

    const miniCase = byType("mini_case") as GeneratedContentItem & Record<string, unknown>;
    for (const field of [
      "product_topic",
      "scenario_type",
      "decision_type",
      "concept_tested",
      "mechanism",
      "question_pattern",
      "correct_answer_pattern",
      "core_takeaway",
      "difficulty",
      "context",
      "challenge",
      "question",
      "expected_reasoning",
      "sample_answer",
      "conclusion",
      "final_takeaway",
      "body_md"
    ]) {
      expect(miniCase[field]).toBeTruthy();
    }
    expect(miniCase.score_max).toBe(3);
  });

  it("keeps the deterministic Mini Case option order the app relies on", async () => {
    const batch = await readApprovedStagingBatch(stagingStub({}), { editionDate: EDITION_DATE });
    const french = buildPayloadsFromBatch(batch, "fr").payload;
    const english = buildPayloadsFromBatch(batch, "en").payload;

    const frCase = french.items.find((item) => item.content_type === "mini_case");
    const enCase = english.items.find((item) => item.content_type === "mini_case");

    if (frCase?.content_type !== "mini_case" || enCase?.content_type !== "mini_case") {
      throw new Error("expected a mini case in both languages");
    }

    frCase.questions.forEach((question, index) => {
      // Both languages present the same option ids in the same order, which is
      // what makes a stored answer resolve after a language switch.
      expect(question.options.map((option) => option.id)).toEqual(
        enCase.questions[index].options.map((option) => option.id)
      );
      expect(question.options.filter((option) => option.is_correct)).toHaveLength(1);
    });
  });
});
