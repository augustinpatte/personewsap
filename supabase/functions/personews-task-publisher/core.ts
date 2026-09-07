/**
 * What publishing an edition into production actually consists of, as pure logic.
 *
 * Every side effect is injected, for the same reason `personews-scheduled-publisher`
 * does it: the interesting cases here are the failures, and the only honest way
 * to test "the question pass threw after the content committed" is to make it
 * throw on purpose. Deno-specific imports would put that out of reach of the
 * repository's test runner, so there are none — this module is plain TypeScript,
 * imported unchanged by the Edge Function and by vitest.
 *
 * THE SEQUENCE, AND WHY IT IS THIS ONE
 *
 *   content       one transaction. Items, sources, editorial memory, and the
 *                 daily drops whose publish trigger registers the edition.
 *   questions      needs both language items to exist, so it cannot live inside
 *                 that transaction. Display into public, grading into private.
 *   assignments    needs the questions (there is nothing to assign otherwise)
 *                 AND the drops (a solo assignment is derived from the reader's
 *                 own edition). Runs last for both reasons.
 *
 * THE ASYMMETRY THAT MATTERS
 *
 * Stage 1 throws on failure; stages 2 and 3 never do. That is not inconsistency,
 * it is the difference between a transaction that committed nothing and a live
 * edition. Before stage 1 commits, a throw means the database is untouched and
 * the scheduler records a clean refusal. After it commits, a throw would answer
 * the scheduler HTTP 500 for content that is already on readers' phones — so a
 * later failure becomes a reported receipt instead, verification fails on it, no
 * staging receipt is written, and the same batch is offered again to a retry
 * whose every stage is idempotent.
 */

export const PUBLISH_STAGES = ["content", "questions", "assignments"] as const;
export type PublishStage = (typeof PUBLISH_STAGES)[number];

export type StageReceipt =
  | { status: "skipped" }
  | { status: "ok"; result: unknown }
  | { status: "failed"; error: string };

export type StageReceipts = Record<PublishStage, StageReceipt>;

export type PublishStageDeps = {
  /** publish_scheduled_staging_payload. The only one allowed to throw. */
  publishContent(payload: unknown, runId: string): Promise<Record<string, unknown>>;
  /** publish_scheduled_batch_questions. */
  publishQuestions(payload: unknown, runId: string): Promise<unknown>;
  /** materialize_edition_assignments. */
  materializeAssignments(editionDate: string): Promise<unknown>;
};

export type PublishStagesResult = Record<string, unknown> & {
  run_id: string;
  edition_date: string;
  stages: StageReceipts;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isPublishStage(value: unknown): value is PublishStage {
  return typeof value === "string" && (PUBLISH_STAGES as readonly string[]).includes(value);
}

/**
 * The stages a request asked for.
 *
 * An absent list means all three, so the existing callers — which send only
 * `{ token, payload, run_id }` — keep working unchanged. A named subset is an
 * operator retrying the tail without touching editorial content, which is what
 * makes "retry the question pass" something other than "republish the edition".
 */
export function resolveRequestedStages(raw: unknown): PublishStage[] | { unknown: string } {
  if (raw === undefined || raw === null) {
    return [...PUBLISH_STAGES];
  }

  if (!Array.isArray(raw)) {
    return { unknown: String(raw) };
  }

  const requested: PublishStage[] = [];

  for (const entry of raw) {
    if (!isPublishStage(entry)) {
      return { unknown: String(entry) };
    }
    if (!requested.includes(entry)) {
      requested.push(entry);
    }
  }

  // Always in pipeline order, whatever order they were asked for in: assignments
  // before questions would assign an edition whose questions do not exist yet.
  return PUBLISH_STAGES.filter((stage) => requested.includes(stage));
}

export async function runPublishStages(input: {
  payload: Record<string, unknown>;
  runId: string;
  editionDate: string;
  stages: PublishStage[];
  deps: PublishStageDeps;
}): Promise<PublishStagesResult> {
  const { payload, runId, editionDate, stages, deps } = input;

  const receipts: StageReceipts = {
    content: { status: "skipped" },
    questions: { status: "skipped" },
    assignments: { status: "skipped" },
  };

  let contentResult: Record<string, unknown> = {};

  if (stages.includes("content")) {
    // Deliberately unguarded. See the header.
    contentResult = await deps.publishContent(payload, runId);
    receipts.content = { status: "ok", result: contentResult };

    if (contentResult.published !== true) {
      // The RPC refused. Nothing downstream has anything to work on, and a
      // question receipt over an edition that does not exist would be a receipt
      // for nothing.
      return { ...contentResult, run_id: runId, edition_date: editionDate, stages: receipts };
    }
  }

  if (stages.includes("questions")) {
    try {
      receipts.questions = { status: "ok", result: await deps.publishQuestions(payload, runId) };
    } catch (error) {
      receipts.questions = { status: "failed", error: errorMessage(error) };
    }
  }

  // Runs even when the question stage reported problems. `publish_scheduled_batch_questions`
  // reports a per-job problem rather than failing the batch, so the questions
  // that DID persist should still be assigned; the ones that did not have
  // nothing to assign, and the retry picks them up.
  if (stages.includes("assignments")) {
    try {
      receipts.assignments = {
        status: "ok",
        result: await deps.materializeAssignments(editionDate),
      };
    } catch (error) {
      receipts.assignments = { status: "failed", error: errorMessage(error) };
    }
  }

  // `published` keeps meaning exactly what it meant: the editorial content
  // committed. Whether the edition is COMPLETE is verification's answer, not
  // this function's — and verification now reads the questions and the
  // assignments too, so a failed stage here cannot become a receipt.
  return { ...contentResult, run_id: runId, edition_date: editionDate, stages: receipts };
}

export type VerificationHalf = Record<string, unknown> & { ok?: unknown };

/**
 * One verdict from the two read-backs.
 *
 * An edition is verified when the content landed AND the game landed. Either
 * alone is a partial edition, and a receipt is a statement of fact about the
 * whole thing — so this ANDs them rather than reporting the editorial half and
 * mentioning the other.
 *
 * An unavailable game verification counts as a failure, not as an abstention.
 * The alternative is that a missing migration silently restores the old
 * behaviour, which is precisely the state this work exists to leave.
 */
export function combineVerification(input: {
  editorial: VerificationHalf | null | undefined;
  game: VerificationHalf | null | undefined;
}): Record<string, unknown> {
  const editorial = (input.editorial ?? {}) as VerificationHalf;
  const game = (input.game ?? { ok: false, reason: "game_verification_missing" }) as VerificationHalf;

  const editorialOk = editorial.ok === true;
  const gameOk = game.ok === true;

  return {
    ...editorial,
    ok: editorialOk && gameOk,
    editorial_ok: editorialOk,
    game_ok: gameOk,
    reason: editorialOk
      ? gameOk
        ? "ok"
        : (game.reason as string) ?? "game_verification_failed"
      : (editorial.reason as string) ?? "editorial_verification_failed",
    game,
    problems: [
      ...(Array.isArray(editorial.problems) ? editorial.problems : []),
      ...(Array.isArray(game.problems) ? game.problems : []),
    ],
  };
}

export function isEditionDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
