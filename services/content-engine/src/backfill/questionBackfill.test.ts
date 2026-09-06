import { describe, expect, it, vi } from "vitest";

import {
  MINI_CASE_QUESTION_ROLES,
  READING_QUESTION_ROLES,
  type GradedQuestion
} from "../generation/gradedQuestions.js";
import {
  planQuestionBackfill,
  readContentLogicalKey,
  readMetadataQuestions,
  runQuestionBackfill,
  validateGeneratedPair,
  type BackfillTask,
  type PublishedItem
} from "./questionBackfill.js";

/**
 * Adding questions to two months of already-approved Premium.
 *
 * Two properties carry the whole feature. It must be safe to run twice — a
 * backfill over hundreds of items will be interrupted — and it must not be able
 * to touch the writing. The second one is checked here by construction: the task
 * shape has no field a body could be written through, so the test asserts on the
 * shape rather than trusting the executor.
 */

function item(overrides: Partial<PublishedItem> = {}): PublishedItem {
  return {
    id: "item-en",
    content_type: "business_story",
    language: "en",
    content_logical_key: null,
    title: "A story",
    status: "published",
    metadata: { staging_job_id: "job-1" },
    ...overrides
  };
}

function pair(logicalKey: string, contentType: PublishedItem["content_type"] = "business_story") {
  return [
    item({ id: `${logicalKey}-en`, language: "en", content_type: contentType, metadata: { staging_job_id: logicalKey } }),
    item({ id: `${logicalKey}-fr`, language: "fr", content_type: contentType, metadata: { staging_job_id: logicalKey } })
  ];
}

const noExisting = { hasQuestions: () => false };
const allExisting = { hasQuestions: () => true };

function gradedQuestion(overrides: Partial<GradedQuestion> = {}): GradedQuestion {
  return {
    id: "q1",
    role: "interpretation",
    question: "Why did the margin move before the volume did?",
    options: [
      { id: "a", text: "Because the discount landed on contribution first", score_milli: 1000, feedback: "Right." },
      { id: "b", text: "Because the volume commitment lagged the demand curve", score_milli: 600, feedback: "Close." },
      { id: "c", text: "Because the headline price matched the competitor move", score_milli: 300, feedback: "Not it." },
      { id: "d", text: "Because the press coverage shifted the market mood", score_milli: 0, feedback: "No." }
    ],
    rationale: {
      decision_criterion: "Which quantity the discount moves first",
      excellent_reason: "Names contribution",
      good_limitation: "Right axis, wrong lag",
      average_limitation: "Compares a price",
      bad_failure: "Uses sentiment"
    },
    ...overrides
  };
}

function frenchQuestion(overrides: Partial<GradedQuestion> = {}): GradedQuestion {
  return gradedQuestion({
    options: [
      { id: "a", text: "Parce que la remise touche d'abord la contribution", score_milli: 1000, feedback: "Exact." },
      { id: "b", text: "Parce que le volume engagé suit la demande avec retard", score_milli: 600, feedback: "Proche." },
      { id: "c", text: "Parce que le prix affiché suivait le concurrent", score_milli: 300, feedback: "Non." },
      { id: "d", text: "Parce que la couverture presse a changé l'humeur", score_milli: 0, feedback: "Non." }
    ],
    ...overrides
  });
}

function twoQuestions(french: boolean) {
  const build = french ? frenchQuestion : gradedQuestion;
  return [build(), build({ id: "q2", role: "application_decision" })];
}

describe("reading the logical key", () => {
  it("uses the same three metadata keys as public.content_logical_key", () => {
    // Pinned to the SQL function in 20260904121000, in the same priority order.
    expect(readContentLogicalKey({ staging_job_id: "a", catalog_entry_id: "b" })).toBe("a");
    expect(readContentLogicalKey({ catalog_entry_id: "b", entry_key: "c" })).toBe("b");
    expect(readContentLogicalKey({ entry_key: "c" })).toBe("c");
    expect(readContentLogicalKey({})).toBeNull();
    expect(readContentLogicalKey({ staging_job_id: "   " })).toBeNull();
  });

  it("reads a question block already in metadata", () => {
    expect(readMetadataQuestions({})).toEqual([]);
    expect(readMetadataQuestions({ questions: [] })).toEqual([]);
    expect(readMetadataQuestions({ questions: [gradedQuestion()] })).toHaveLength(1);
  });
});

describe("planning", () => {
  it("groups the two language renderings into one task", () => {
    const plan = planQuestionBackfill({ items: pair("job-1"), existing: noExisting });

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].contentLogicalKey).toBe("job-1");
    expect(plan.tasks[0].items.fr.id).toBe("job-1-fr");
    expect(plan.tasks[0].items.en.id).toBe("job-1-en");
  });

  it("asks for two questions on a story and three on a mini case", () => {
    const stories = planQuestionBackfill({ items: pair("s1"), existing: noExisting });
    const cases = planQuestionBackfill({
      items: pair("c1", "mini_case"),
      existing: noExisting,
      contentTypes: ["mini_case"]
    });

    expect(stories.tasks[0].expectedRoles).toEqual(READING_QUESTION_ROLES);
    // The rule that must survive every backfill: a Mini Case is three questions.
    expect(cases.tasks[0].expectedRoles).toEqual(MINI_CASE_QUESTION_ROLES);
  });

  it("carries no field through which the writing could be changed", () => {
    // The non-destructive guarantee, asserted structurally. A task holds ids,
    // a title and metadata; there is nothing here to write a body back with.
    const [task] = planQuestionBackfill({ items: pair("job-1"), existing: noExisting }).tasks;

    for (const forbidden of [
      "body_md",
      "setup",
      "tension",
      "decision",
      "outcome",
      "lesson",
      "context",
      "challenge",
      "constraints",
      "concept_tested",
      "mechanism"
    ]) {
      expect(Object.keys(task.items.en), forbidden).not.toContain(forbidden);
      expect(Object.keys(task.items.fr), forbidden).not.toContain(forbidden);
    }
  });
});

describe("idempotence", () => {
  it("skips content that already has questions", () => {
    const plan = planQuestionBackfill({ items: pair("job-1"), existing: allExisting });

    expect(plan.tasks).toEqual([]);
    expect(plan.counts.skipped.already_has_questions).toBe(1);
  });

  it("checks the gate before anything costs a token", () => {
    // The skip is decided in the planner, so a rerun over an already-backfilled
    // catalog is a read and nothing else.
    const generate = vi.fn();
    const plan = planQuestionBackfill({ items: pair("job-1"), existing: allExisting });

    expect(plan.tasks).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it("produces the same plan twice for the same catalog", () => {
    const items = [...pair("b"), ...pair("a"), ...pair("c")];
    const first = planQuestionBackfill({ items, existing: noExisting });
    const second = planQuestionBackfill({ items: [...items].reverse(), existing: noExisting });

    expect(first.tasks.map((task) => task.contentLogicalKey)).toEqual(["a", "b", "c"]);
    expect(second.tasks.map((task) => task.contentLogicalKey)).toEqual(["a", "b", "c"]);
  });

  it("takes a reproducible prefix under --limit", () => {
    const items = [...pair("c"), ...pair("a"), ...pair("b")];
    const plan = planQuestionBackfill({ items, existing: noExisting, limit: 2 });

    expect(plan.tasks.map((task) => task.contentLogicalKey)).toEqual(["a", "b"]);
  });
});

describe("what is refused", () => {
  it("skips drafts", () => {
    const items = pair("job-1").map((entry) => ({ ...entry, status: "draft" }));
    const plan = planQuestionBackfill({ items, existing: noExisting });

    expect(plan.tasks).toEqual([]);
    expect(plan.counts.skipped.not_published).toBe(2);
  });

  it("skips content with no logical key", () => {
    const items = pair("job-1").map((entry) => ({ ...entry, metadata: {} }));
    const plan = planQuestionBackfill({ items, existing: noExisting });

    // Without a key the two languages cannot be tied together, so a question
    // written for one would be unanswerable in the other.
    expect(plan.counts.skipped.missing_logical_key).toBe(2);
  });

  it("skips a story that exists in only one language", () => {
    const plan = planQuestionBackfill({ items: [pair("job-1")[0]], existing: noExisting });

    expect(plan.tasks).toEqual([]);
    expect(plan.counts.skipped.incomplete_language_pair).toBe(1);
  });

  it("skips content types it was not asked for", () => {
    const plan = planQuestionBackfill({
      items: pair("n1", "newsletter_article"),
      existing: noExisting,
      contentTypes: ["business_story"]
    });

    expect(plan.counts.skipped.unsupported_content_type).toBe(2);
  });
});

describe("running", () => {
  const plan = () => planQuestionBackfill({ items: pair("job-1"), existing: noExisting });

  it("writes when the generated questions pass", async () => {
    const persist = vi.fn(async () => undefined);
    const report = await runQuestionBackfill({
      plan: plan(),
      dryRun: false,
      generate: async () => ({ fr: twoQuestions(true), en: twoQuestions(false) }),
      persist
    });

    expect(report.totals).toEqual({ written: 1, skipped: 0, failed: 0 });
    expect(persist).toHaveBeenCalledOnce();
  });

  it("generates but never persists on a dry run", async () => {
    // The preview validates: it tells you whether the questions WOULD pass, not
    // just how many items are missing them.
    const persist = vi.fn(async () => undefined);
    const generate = vi.fn(async () => ({ fr: twoQuestions(true), en: twoQuestions(false) }));

    const report = await runQuestionBackfill({ plan: plan(), dryRun: true, generate, persist });

    expect(generate).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
    expect(report.totals).toEqual({ written: 0, skipped: 1, failed: 0 });
    expect(report.results[0].reason).toBe("dry_run");
  });

  it("refuses to persist a question that fails validation", async () => {
    const persist = vi.fn(async () => undefined);
    const broken = twoQuestions(false);
    broken[0].options[1].score_milli = 1000;

    const report = await runQuestionBackfill({
      plan: plan(),
      dryRun: false,
      generate: async () => ({ fr: twoQuestions(true), en: broken }),
      persist
    });

    expect(persist).not.toHaveBeenCalled();
    expect(report.totals.failed).toBe(1);
    expect(report.results[0].problems?.join(" ")).toContain("question_score_tier_set_invalid");
  });

  it("keeps going when one item fails, and writes nothing for it", async () => {
    const items = [...pair("job-1"), ...pair("job-2")];
    const persist = vi.fn(async () => undefined);
    let call = 0;

    const report = await runQuestionBackfill({
      plan: planQuestionBackfill({ items, existing: noExisting }),
      dryRun: false,
      generate: async () => {
        call += 1;
        if (call === 1) {
          throw new Error("model timed out");
        }
        return { fr: twoQuestions(true), en: twoQuestions(false) };
      },
      persist
    });

    // The second item is independent, and a rerun picks the first one up again
    // because nothing was written for it.
    expect(report.totals).toEqual({ written: 1, skipped: 0, failed: 1 });
    expect(report.results[0].reason).toBe("model timed out");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("journals every task, success or failure", async () => {
    const log = vi.fn();
    await runQuestionBackfill({
      plan: planQuestionBackfill({ items: [...pair("a"), ...pair("b")], existing: noExisting }),
      dryRun: true,
      generate: async () => ({ fr: twoQuestions(true), en: twoQuestions(false) }),
      persist: async () => undefined,
      log
    });

    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe("the generated pair is held to the same bar as a fresh generation", () => {
  const task: BackfillTask = {
    contentLogicalKey: "job-1",
    contentType: "business_story",
    expectedRoles: READING_QUESTION_ROLES,
    items: { fr: item({ language: "fr" }), en: item() }
  };

  it("accepts a valid pair", () => {
    expect(validateGeneratedPair(task, { fr: twoQuestions(true), en: twoQuestions(false) })).toEqual(
      []
    );
  });

  it("rejects the wrong question count", () => {
    const problems = validateGeneratedPair(task, {
      fr: [frenchQuestion()],
      en: [gradedQuestion()]
    });

    expect(problems.join(" ")).toContain("Expected exactly 2 questions, got 1");
  });

  it("rejects a scale that differs between languages", () => {
    const fr = twoQuestions(true);
    fr[0].options[1].score_milli = 300;
    fr[0].options[2].score_milli = 600;

    expect(validateGeneratedPair(task, { fr, en: twoQuestions(false) }).join(" ")).toContain(
      "parity:"
    );
  });

  it("rejects an untranslated pair", () => {
    expect(
      validateGeneratedPair(task, { fr: twoQuestions(false), en: twoQuestions(false) }).join(" ")
    ).toContain("identical fr and en text");
  });
});
