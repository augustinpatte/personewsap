import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import {
  planQuestionBackfill,
  readContentLogicalKey,
  runQuestionBackfill,
  type BackfillContentType,
  type BackfillRunReport,
  type BackfillTask,
  type GeneratedQuestionPair,
  type PublishedItem
} from "../backfill/questionBackfill.js";
import { READING_QUESTIONS_SCHEMA } from "../generation/dailyDropSchema.js";
import {
  MINI_CASE_QUESTION_ROLES,
  gradeBandForTier,
  type GradedQuestion
} from "../generation/gradedQuestions.js";
import { createRoutedProviderFactory } from "../generation/modelRouting.js";

/**
 * `content:question-backfill` — questions for Premium that is already approved.
 *
 * SAFETY DEFAULTS, because this runs against a database holding two months of
 * live content:
 *
 *   * dry run unless `--commit` is passed. Nothing is written by accident.
 *   * staging unless `--project=production` is passed. Staging first, always.
 *   * `--preview` stops before generation, so the plan can be inspected for
 *     free — no model call, no token spent.
 *   * `--limit` bounds a first real run to a handful of items.
 *
 * The whole flow is `planQuestionBackfill` + `runQuestionBackfill`, which are
 * pure and tested; everything below is the I/O those two are missing.
 */

export type QuestionBackfillOptions = {
  contentTypes: BackfillContentType[];
  limit?: number;
  commit: boolean;
  preview: boolean;
  project: "staging" | "production";
};

export function parseQuestionBackfillOptions(args: string[]): QuestionBackfillOptions {
  const read = (flag: string): string | undefined => {
    const inline = args.find((arg) => arg.startsWith(`${flag}=`));
    if (inline) {
      return inline.slice(flag.length + 1);
    }

    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const rawTypes = read("--content-type") ?? "business_story";
  const contentTypes = rawTypes
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is BackfillContentType =>
      value === "business_story" || value === "mini_case" || value === "newsletter_article"
    );

  if (contentTypes.length === 0) {
    throw new Error(
      "--content-type must be one or more of business_story, mini_case, newsletter_article"
    );
  }

  const rawLimit = read("--limit");
  const limit = rawLimit === undefined ? undefined : Number.parseInt(rawLimit, 10);

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  const project = read("--project") ?? "staging";

  if (project !== "staging" && project !== "production") {
    throw new Error("--project must be staging or production");
  }

  return {
    contentTypes,
    limit,
    // Writing is opt-in. A backfill that defaulted to committing would be one
    // typo away from writing generated questions across the live catalog.
    commit: args.includes("--commit"),
    preview: args.includes("--preview"),
    project
  };
}

const BACKFILL_SYSTEM_PROMPT = `You write scored comprehension questions for PersoNewsAP.

You are given ONE piece of editorial content that is already published and approved, in French and in English.

YOU MUST NOT rewrite, summarise, correct or comment on the content. It is final.
Your only output is the question block.

Produce the SAME logical questions in both languages:
  - the same question ids, in the same order;
  - the same option ids;
  - the same score_milli on the same option id in both languages;
  - naturally written French and naturally written English. Never a literal translation.

Each question has exactly four options, one at each of 0, 300, 600 and 1000.

THE CONTENT PROVIDES THE FACTS. THE QUESTION REQUIRES THE REASONING.
Never ask for a figure, a date, a name or a quote that a reader could answer by
scanning the text. Never require knowledge that is not in the content.

The four options must not be told apart by their shape: similar length, similar
grammar, similar precision, similar tone. The difference is the reasoning.

Include the internal rationale for each question. It is for the reviewer and is
never shown to a reader.`;

function buildUserPrompt(task: BackfillTask, roles: readonly string[]): string {
  const fr = task.items.fr;
  const en = task.items.en;

  return [
    `content_type: ${task.contentType}`,
    `question_count: ${roles.length}`,
    `roles_in_order: ${roles.join(", ")}`,
    "",
    "=== ENGLISH RENDERING ===",
    `title: ${en.title}`,
    readBodyForPrompt(en),
    "",
    "=== FRENCH RENDERING ===",
    `title: ${fr.title}`,
    readBodyForPrompt(fr),
    "",
    "Return one JSON object: { \"fr\": [...questions], \"en\": [...questions] }."
  ].join("\n");
}

/**
 * The content, as read-only input to the prompt.
 *
 * Deliberately assembled here from fields fetched for this purpose rather than
 * carried on the task: the task type has no body field precisely so that no code
 * path can write one back, and this function is where that constraint is paid
 * for.
 */
function readBodyForPrompt(item: PublishedItem & { body_md?: string; summary?: string }): string {
  return [item.summary, item.body_md].filter(Boolean).join("\n\n");
}

const BACKFILL_PAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fr", "en"],
  properties: {
    fr: READING_QUESTIONS_SCHEMA,
    en: READING_QUESTIONS_SCHEMA
  }
} as const;

export async function runQuestionBackfillCli(
  options: QuestionBackfillOptions
): Promise<BackfillRunReport> {
  const supabase = createServiceRoleSupabaseClient({ requireCredentials: true });

  const { data: rows, error } = await supabase
    .from("content_items")
    .select("id,content_type,language,title,summary,body_md,status,metadata")
    .in("content_type", options.contentTypes)
    .eq("status", "published");

  if (error) {
    throw new Error(`Could not read published content: ${error.message}`);
  }

  const items: Array<PublishedItem & { body_md?: string; summary?: string }> = (rows ?? []).map(
    (row) => ({
      id: row.id as string,
      content_type: row.content_type as BackfillContentType,
      language: row.language as "fr" | "en",
      title: (row.title as string) ?? "",
      summary: (row.summary as string) ?? undefined,
      body_md: (row.body_md as string) ?? undefined,
      status: row.status as string,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      content_logical_key: readContentLogicalKey((row.metadata as Record<string, unknown>) ?? {})
    })
  );

  // The idempotence index: which logical keys already have questions. Read once,
  // so a rerun over a fully backfilled catalog is two queries and no model call.
  const { data: existingRows, error: existingError } = await supabase
    .from("logical_questions")
    .select("content_logical_key");

  if (existingError) {
    throw new Error(`Could not read existing questions: ${existingError.message}`);
  }

  const existingKeys = new Set(
    (existingRows ?? []).map((row) => row.content_logical_key as string)
  );

  const plan = planQuestionBackfill({
    items,
    existing: { hasQuestions: (key) => existingKeys.has(key) },
    contentTypes: options.contentTypes,
    limit: options.limit
  });

  if (options.preview) {
    // Plan only. No provider is constructed, so this costs nothing and can be
    // run against production safely.
    return {
      mode: "question-backfill",
      dryRun: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      plan: plan.counts,
      results: plan.tasks.map((task) => ({
        contentLogicalKey: task.contentLogicalKey,
        contentType: task.contentType,
        status: "skipped" as const,
        reason: "preview"
      })),
      totals: { written: 0, skipped: plan.tasks.length, failed: 0 }
    };
  }

  // Routed through the same model routing the daily job uses, so a backfill and
  // a fresh generation are not quietly two different models.
  const providerFor = createRoutedProviderFactory();
  const bodyByItemId = new Map(items.map((item) => [item.id, item]));

  return runQuestionBackfill({
    plan,
    dryRun: !options.commit,
    generate: async (task) => {
      const roles =
        task.contentType === "mini_case" ? MINI_CASE_QUESTION_ROLES : task.expectedRoles;

      const enriched: BackfillTask = {
        ...task,
        items: {
          fr: bodyByItemId.get(task.items.fr.id) ?? task.items.fr,
          en: bodyByItemId.get(task.items.en.id) ?? task.items.en
        }
      };

      const provider = providerFor({
        section: task.contentType === "mini_case" ? "mini_case" : "business_story",
        language: "en",
        attempt: 1,
        maxAttempts: 1
      });

      const raw = (await provider.generateJson({
        systemPrompt: BACKFILL_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(enriched, roles),
        jsonSchema: BACKFILL_PAIR_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "question_backfill_pair"
      })) as GeneratedQuestionPair;

      return { fr: raw?.fr ?? [], en: raw?.en ?? [] };
    },
    persist: (task, questions) => persistQuestions(supabase, task, questions),
    log: (result) => {
      process.stderr.write(`${JSON.stringify({ event: "question_backfill", ...result })}\n`);
    }
  });
}

/**
 * Write the logical questions, their localized surface and their private grading.
 *
 * Note what is NOT here: any UPDATE of `content_items`. The content is not
 * touched, not even its metadata — the questions live in their own tables, which
 * is also what keeps the answer key out of anything a client can read.
 */
async function persistQuestions(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  task: BackfillTask,
  questions: GeneratedQuestionPair
): Promise<void> {
  for (const [index, enQuestion] of questions.en.entries()) {
    const frQuestion = questions.fr[index] as GradedQuestion;

    const { data: questionRow, error: questionError } = await supabase
      .from("logical_questions")
      .insert({
        content_logical_key: task.contentLogicalKey,
        content_type: task.contentType,
        question_sequence: index + 1,
        question_role: enQuestion.role
      })
      .select("id")
      .single();

    if (questionError) {
      throw new Error(`logical_questions insert failed: ${questionError.message}`);
    }

    const logicalQuestionId = questionRow.id as string;

    const { error: localeError } = await supabase.from("logical_question_locales").insert([
      {
        logical_question_id: logicalQuestionId,
        language: "en",
        content_item_id: task.items.en.id,
        prompt: enQuestion.question
      },
      {
        logical_question_id: logicalQuestionId,
        language: "fr",
        content_item_id: task.items.fr.id,
        prompt: frQuestion.question
      }
    ]);

    if (localeError) {
      throw new Error(`logical_question_locales insert failed: ${localeError.message}`);
    }

    for (const [optionIndex, enOption] of enQuestion.options.entries()) {
      const frOption =
        frQuestion.options.find((candidate) => candidate.id === enOption.id) ??
        frQuestion.options[optionIndex];

      const { data: optionRow, error: optionError } = await supabase
        .from("logical_question_options")
        .insert({
          logical_question_id: logicalQuestionId,
          option_key: String.fromCharCode(97 + optionIndex)
        })
        .select("id")
        .single();

      if (optionError) {
        throw new Error(`logical_question_options insert failed: ${optionError.message}`);
      }

      const optionId = optionRow.id as string;

      const { error: optionLocaleError } = await supabase
        .from("logical_question_option_locales")
        .insert([
          { option_id: optionId, language: "en", label: enOption.text },
          { option_id: optionId, language: "fr", label: frOption.text }
        ]);

      if (optionLocaleError) {
        throw new Error(`logical_question_option_locales insert failed: ${optionLocaleError.message}`);
      }

      // The answer key, into the schema PostgREST does not serve.
      const { error: gradeError } = await supabase.schema("private").from("logical_question_grades").insert({
        option_id: optionId,
        score_milli: enOption.score_milli,
        grade_band: gradeBandForTier(enOption.score_milli),
        rationale_md: JSON.stringify(enQuestion.rationale)
      });

      if (gradeError) {
        throw new Error(`private grading insert failed: ${gradeError.message}`);
      }

      const { error: feedbackError } = await supabase
        .schema("private")
        .from("logical_question_option_feedback")
        .insert([
          { option_id: optionId, language: "en", feedback_md: enOption.feedback },
          { option_id: optionId, language: "fr", feedback_md: frOption.feedback }
        ]);

      if (feedbackError) {
        throw new Error(`private feedback insert failed: ${feedbackError.message}`);
      }
    }
  }
}
