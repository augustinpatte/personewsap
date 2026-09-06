import {
  MINI_CASE_QUESTION_ROLES,
  READING_QUESTION_ROLES,
  compareQuestionParity,
  normalizeQuestions,
  validateQuestionSet,
  type GradedQuestion,
  type QuestionRole
} from "../generation/gradedQuestions.js";

/**
 * Questions for content that is already approved and published.
 *
 * Roughly two months of Premium — Business Stories and the launch Mini Case
 * catalog — were written before questions existed. They are approved, they are
 * live, and readers have them in their archive. Regenerating them to add a
 * question block would be the worst possible trade: it would rewrite prose that
 * passed every editorial gate, invalidate the review that approved it, and
 * change what a reader who already read it saw.
 *
 * So this adds questions and touches nothing else. The guarantee is enforced
 * structurally rather than promised in a comment: a backfill task carries the
 * ids and the source text it needs to *write* questions, and there is no field
 * anywhere in this module through which a body, a setup, a tension, a decision,
 * an outcome, a lesson, a context, a challenge, a constraint, a concept_tested
 * or a mechanism could be written back.
 *
 * IDEMPOTENCE is the other half. A backfill over hundreds of items will be
 * interrupted; it has to be safe to simply run again. The unit of work is the
 * *logical* content key, not the content item, so the FR and EN renderings of
 * one story are one task producing one set of logical questions — and an item
 * whose key already has questions is skipped rather than duplicated.
 */

export type BackfillContentType = "business_story" | "mini_case" | "newsletter_article";

/** One published rendering, as read from content_items. */
export type PublishedItem = {
  id: string;
  content_type: BackfillContentType;
  language: "fr" | "en";
  content_logical_key: string | null;
  title: string;
  status: string;
  /** The stored metadata, read to find any question block already present. */
  metadata: Record<string, unknown>;
};

/** What already exists in the question tables, keyed by logical content key. */
export type ExistingQuestionIndex = {
  hasQuestions: (contentLogicalKey: string) => boolean;
};

export type BackfillSkipReason =
  | "already_has_questions"
  | "missing_logical_key"
  | "not_published"
  | "incomplete_language_pair"
  | "unsupported_content_type";

export type BackfillTask = {
  contentLogicalKey: string;
  contentType: BackfillContentType;
  expectedRoles: readonly QuestionRole[];
  /** The FR and EN renderings this task will produce localized questions for. */
  items: { fr: PublishedItem; en: PublishedItem };
};

export type BackfillSkip = {
  contentLogicalKey: string | null;
  contentType: BackfillContentType | null;
  itemIds: string[];
  reason: BackfillSkipReason;
};

export type BackfillPlan = {
  tasks: BackfillTask[];
  skipped: BackfillSkip[];
  counts: {
    itemsInspected: number;
    tasksPlanned: number;
    skipped: Record<BackfillSkipReason, number>;
  };
};

const EXPECTED_ROLES: Record<BackfillContentType, readonly QuestionRole[]> = {
  newsletter_article: READING_QUESTION_ROLES,
  business_story: READING_QUESTION_ROLES,
  // Three, in the fixed pedagogical order. A backfill never turns a Mini Case
  // into a two-question quiz.
  mini_case: MINI_CASE_QUESTION_ROLES
};

/**
 * The logical key of a published item.
 *
 * Same three metadata keys `public.content_logical_key(jsonb)` reads in the
 * database, in the same order. Duplicated here rather than queried because the
 * planner has to work on rows already in memory, and the two definitions are
 * pinned to each other by test.
 */
export function readContentLogicalKey(metadata: Record<string, unknown>): string | null {
  for (const key of ["staging_job_id", "catalog_entry_id", "entry_key"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

/**
 * Does this item already carry a usable question block in its own metadata?
 *
 * Separate from the database index because the two answer different questions:
 * the index knows whether logical questions were persisted, this knows whether
 * the generator ever produced any. An item with metadata questions but no
 * persisted rows is a publish that predates the question tables — it is
 * *migratable* rather than *generatable*, and reporting both as "needs work"
 * would hide the distinction.
 */
export function readMetadataQuestions(metadata: Record<string, unknown>): GradedQuestion[] {
  const raw = metadata.questions;
  return Array.isArray(raw) && raw.length > 0 ? normalizeQuestions(raw) : [];
}

/**
 * Decide the work, without doing any of it.
 *
 * Pure: it takes rows and returns a plan. That is what makes `--dry-run` an
 * honest preview rather than a second code path that might disagree with the
 * real one — the executor runs exactly this plan.
 */
export function planQuestionBackfill(input: {
  items: PublishedItem[];
  existing: ExistingQuestionIndex;
  contentTypes?: BackfillContentType[];
  limit?: number;
}): BackfillPlan {
  const allowedTypes = new Set(input.contentTypes ?? (["business_story", "mini_case"] as const));
  const skipped: BackfillSkip[] = [];
  const byLogicalKey = new Map<string, PublishedItem[]>();

  const counts: Record<BackfillSkipReason, number> = {
    already_has_questions: 0,
    missing_logical_key: 0,
    not_published: 0,
    incomplete_language_pair: 0,
    unsupported_content_type: 0
  };

  const skip = (entry: BackfillSkip) => {
    counts[entry.reason] += 1;
    skipped.push(entry);
  };

  for (const item of input.items) {
    if (!allowedTypes.has(item.content_type)) {
      skip({
        contentLogicalKey: null,
        contentType: item.content_type,
        itemIds: [item.id],
        reason: "unsupported_content_type"
      });
      continue;
    }

    // Only published content is backfilled. A draft is still the generator's
    // to finish, and writing questions for it would race the pipeline.
    if (item.status !== "published") {
      skip({
        contentLogicalKey: null,
        contentType: item.content_type,
        itemIds: [item.id],
        reason: "not_published"
      });
      continue;
    }

    const logicalKey = item.content_logical_key ?? readContentLogicalKey(item.metadata);

    // Without a logical key the FR and EN renderings cannot be tied together,
    // and a question written against one of them would be unanswerable in the
    // other language. Skipped rather than guessed.
    if (!logicalKey) {
      skip({
        contentLogicalKey: null,
        contentType: item.content_type,
        itemIds: [item.id],
        reason: "missing_logical_key"
      });
      continue;
    }

    const group = byLogicalKey.get(logicalKey) ?? [];
    group.push(item);
    byLogicalKey.set(logicalKey, group);
  }

  const tasks: BackfillTask[] = [];

  for (const [logicalKey, group] of byLogicalKey) {
    const contentType = group[0].content_type;
    const itemIds = group.map((item) => item.id);

    // THE idempotence gate. Runs before anything else costs a token.
    if (input.existing.hasQuestions(logicalKey)) {
      skip({
        contentLogicalKey: logicalKey,
        contentType,
        itemIds,
        reason: "already_has_questions"
      });
      continue;
    }

    const fr = group.find((item) => item.language === "fr");
    const en = group.find((item) => item.language === "en");

    if (!fr || !en) {
      skip({
        contentLogicalKey: logicalKey,
        contentType,
        itemIds,
        reason: "incomplete_language_pair"
      });
      continue;
    }

    tasks.push({
      contentLogicalKey: logicalKey,
      contentType,
      expectedRoles: EXPECTED_ROLES[contentType],
      items: { fr, en }
    });
  }

  // Stable order so two dry runs over the same catalog produce the same plan,
  // and so `--limit` takes a reproducible prefix rather than a random sample.
  tasks.sort((a, b) => a.contentLogicalKey.localeCompare(b.contentLogicalKey));

  const limited = typeof input.limit === "number" ? tasks.slice(0, Math.max(0, input.limit)) : tasks;

  return {
    tasks: limited,
    skipped,
    counts: {
      itemsInspected: input.items.length,
      tasksPlanned: limited.length,
      skipped: counts
    }
  };
}

export type GeneratedQuestionPair = {
  fr: GradedQuestion[];
  en: GradedQuestion[];
};

export type BackfillTaskResult = {
  contentLogicalKey: string;
  contentType: BackfillContentType;
  status: "written" | "skipped" | "failed";
  reason?: string;
  problems?: string[];
  questionCount?: number;
};

export type BackfillRunReport = {
  mode: "question-backfill";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  plan: BackfillPlan["counts"];
  results: BackfillTaskResult[];
  totals: { written: number; skipped: number; failed: number };
};

/**
 * Run the plan.
 *
 * Every side effect is injected, which is what lets the whole flow — including
 * the failure paths — be tested without a network or a model. `dryRun` short of
 * persisting is deliberately NOT a separate branch through the generator: a
 * preview that skips generation would tell you how many items need questions but
 * nothing about whether the questions would pass validation, which is the thing
 * you actually want to know before spending on a full run.
 */
export async function runQuestionBackfill(input: {
  plan: BackfillPlan;
  dryRun: boolean;
  /** Produces both language renderings of one content item's questions. */
  generate: (task: BackfillTask) => Promise<GeneratedQuestionPair>;
  /** Writes the logical questions, locales and private grading. Never called on a dry run. */
  persist: (task: BackfillTask, questions: GeneratedQuestionPair) => Promise<void>;
  /** Structured journal line per task, success or failure. */
  log?: (result: BackfillTaskResult) => void;
  now?: () => Date;
}): Promise<BackfillRunReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results: BackfillTaskResult[] = [];

  for (const task of input.plan.tasks) {
    let result: BackfillTaskResult;

    try {
      const questions = await input.generate(task);
      const problems = validateGeneratedPair(task, questions);

      if (problems.length > 0) {
        // A backfilled question is held to exactly the contract a freshly
        // generated one is. Persisting a broken one to "at least have something"
        // would put an unanswerable question in a reader's archive.
        result = {
          contentLogicalKey: task.contentLogicalKey,
          contentType: task.contentType,
          status: "failed",
          reason: "validation_failed",
          problems
        };
      } else if (input.dryRun) {
        result = {
          contentLogicalKey: task.contentLogicalKey,
          contentType: task.contentType,
          status: "skipped",
          reason: "dry_run",
          questionCount: questions.fr.length
        };
      } else {
        await input.persist(task, questions);
        result = {
          contentLogicalKey: task.contentLogicalKey,
          contentType: task.contentType,
          status: "written",
          questionCount: questions.fr.length
        };
      }
    } catch (error) {
      // One item failing must not end the run: the next item is independent,
      // and a rerun will pick this one up again because nothing was written.
      result = {
        contentLogicalKey: task.contentLogicalKey,
        contentType: task.contentType,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      };
    }

    results.push(result);
    input.log?.(result);
  }

  return {
    mode: "question-backfill",
    dryRun: input.dryRun,
    startedAt,
    finishedAt: now().toISOString(),
    plan: input.plan.counts,
    results,
    totals: {
      written: results.filter((entry) => entry.status === "written").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      failed: results.filter((entry) => entry.status === "failed").length
    }
  };
}

/**
 * The same gates a fresh generation passes, plus cross-language parity.
 *
 * Parity matters more here than anywhere: the two renderings are generated in
 * one call precisely so the option ids and tiers line up, and this is the check
 * that says they did.
 */
export function validateGeneratedPair(
  task: BackfillTask,
  questions: GeneratedQuestionPair
): string[] {
  const problems: string[] = [];

  for (const [language, set] of [
    ["fr", questions.fr],
    ["en", questions.en]
  ] as const) {
    for (const issue of validateQuestionSet(set, task.expectedRoles)) {
      problems.push(
        `${language}: ${issue.code} at question ${issue.questionIndex + 1}: ${issue.message}`
      );
    }
  }

  for (const problem of compareQuestionParity(questions.fr, questions.en)) {
    problems.push(`parity: ${problem}`);
  }

  return problems;
}
