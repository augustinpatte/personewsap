import { describe, expect, it, vi } from "vitest";

import {
  combineVerification,
  isEditionDate,
  resolveRequestedStages,
  runPublishStages,
  type PublishStageDeps,
} from "./core.ts";

/**
 * The production door, and the cases SQL cannot reach.
 *
 * The property this file defends is narrow and expensive to get wrong: an
 * edition whose content published and whose questions did not must be
 * OBSERVABLE, RETRYABLE and NON-DESTRUCTIVE. Every plausible mistake here is
 * silent in production —
 *
 *   throwing after the content committed  -> the scheduler records
 *                                            `production_publish_failed` for an
 *                                            edition that is on readers' phones
 *   reporting success anyway              -> a receipt is written, the batch is
 *                                            marked published, and nobody ever
 *                                            retries the missing questions
 *   skipping the assignment stage         -> every reader has an edition and no
 *                                            question is assigned to anyone
 */

const PAYLOAD = {
  ready: true,
  batch: { id: "b1", edition_date: "2026-09-09", edition_kind: "daily" },
  jobs: [],
};

function deps(overrides: Partial<PublishStageDeps> = {}): PublishStageDeps {
  return {
    publishContent: vi.fn(async () => ({ published: true, items_written: 46 })),
    publishQuestions: vi.fn(async () => ({ questions_written: 46, problems: [] })),
    materializeAssignments: vi.fn(async () => ({
      solo_question_assignments_written: 120,
      team: { teams_processed: 0 },
    })),
    ...overrides,
  };
}

async function run(overrides: Partial<PublishStageDeps> = {}, stages?: string[]) {
  const d = deps(overrides);
  const resolved = resolveRequestedStages(stages);

  if (!Array.isArray(resolved)) {
    throw new Error(`unexpected unknown stage ${resolved.unknown}`);
  }

  const result = await runPublishStages({
    payload: PAYLOAD,
    runId: "run-1",
    editionDate: "2026-09-09",
    stages: resolved,
    deps: d,
  });

  return { result, deps: d };
}

describe("which stages a request asks for", () => {
  it("means all three when nothing is named", () => {
    expect(resolveRequestedStages(undefined)).toEqual(["content", "questions", "assignments"]);
    expect(resolveRequestedStages(null)).toEqual(["content", "questions", "assignments"]);
  });

  it("keeps pipeline order whatever order they arrive in", () => {
    // Assignments before questions would assign an edition whose questions do
    // not exist yet, so the order is the pipeline's and not the caller's.
    expect(resolveRequestedStages(["assignments", "questions"])).toEqual([
      "questions",
      "assignments",
    ]);
  });

  it("refuses a stage name it does not know", () => {
    expect(resolveRequestedStages(["content", "drop_everything"])).toEqual({
      unknown: "drop_everything",
    });
    expect(resolveRequestedStages("content")).toEqual({ unknown: "content" });
  });

  it("deduplicates", () => {
    expect(resolveRequestedStages(["content", "content"])).toEqual(["content"]);
  });
});

describe("the happy path", () => {
  it("runs content, then questions, then assignments", async () => {
    const { result, deps: d } = await run();

    expect(d.publishContent).toHaveBeenCalledTimes(1);
    expect(d.publishQuestions).toHaveBeenCalledTimes(1);
    expect(d.materializeAssignments).toHaveBeenCalledTimes(1);

    // The assignment stage is keyed on the edition date the payload declared.
    expect(d.materializeAssignments).toHaveBeenCalledWith("2026-09-09");

    expect(result.published).toBe(true);
    expect(result.stages.content.status).toBe("ok");
    expect(result.stages.questions.status).toBe("ok");
    expect(result.stages.assignments.status).toBe("ok");
  });

  it("reports a receipt per stage, not one verdict for all three", async () => {
    const { result } = await run();

    expect(Object.keys(result.stages).sort()).toEqual([
      "assignments",
      "content",
      "questions",
    ]);
    expect(result.run_id).toBe("run-1");
    expect(result.edition_date).toBe("2026-09-09");
  });
});

describe("the content stage", () => {
  it("throws, because nothing has committed yet", async () => {
    // Before the publishing transaction commits, a throw means the database is
    // untouched and the scheduler records a clean refusal. That is the only
    // stage where that is true.
    await expect(
      run({
        publishContent: vi.fn(async () => {
          throw new Error("gate refused");
        }),
      }),
    ).rejects.toThrow("gate refused");
  });

  it("stops before the later stages when the RPC refuses", async () => {
    const { result, deps: d } = await run({
      publishContent: vi.fn(async () => ({ published: false, reason: "composition_invalid" })),
    });

    expect(result.published).toBe(false);
    expect(d.publishQuestions).not.toHaveBeenCalled();
    expect(d.materializeAssignments).not.toHaveBeenCalled();
    expect(result.stages.questions.status).toBe("skipped");
  });
});

describe("a question pass that fails after the content is live", () => {
  it("does not throw", async () => {
    // A throw here would answer the scheduler HTTP 500 for an edition that
    // genuinely published.
    const { result } = await run({
      publishQuestions: vi.fn(async () => {
        throw new Error("relation private.logical_question_grades does not exist");
      }),
    });

    expect(result.published).toBe(true);
  });

  it("is observable in the receipt", async () => {
    const { result } = await run({
      publishQuestions: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    expect(result.stages.questions).toEqual({ status: "failed", error: "boom" });
  });

  it("never claims the questions succeeded", async () => {
    const { result } = await run({
      publishQuestions: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    expect(result.stages.questions.status).not.toBe("ok");
  });

  it("still assigns what did persist", async () => {
    // `publish_scheduled_batch_questions` reports a per-job problem rather than
    // failing the batch, so the questions that DID land should still be
    // assigned; the ones that did not have nothing to assign.
    const { deps: d } = await run({
      publishQuestions: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    expect(d.materializeAssignments).toHaveBeenCalledTimes(1);
  });
});

describe("an assignment pass that fails", () => {
  it("is reported without destroying the edition", async () => {
    const { result } = await run({
      materializeAssignments: vi.fn(async () => {
        throw new Error("no edition has published yet");
      }),
    });

    expect(result.published).toBe(true);
    expect(result.stages.content.status).toBe("ok");
    expect(result.stages.questions.status).toBe("ok");
    expect(result.stages.assignments).toEqual({
      status: "failed",
      error: "no edition has published yet",
    });
  });
});

describe("retrying without republishing", () => {
  it("can run the tail stages alone, touching no editorial content", async () => {
    const { result, deps: d } = await run({}, ["questions", "assignments"]);

    expect(d.publishContent).not.toHaveBeenCalled();
    expect(result.stages.content).toEqual({ status: "skipped" });
    expect(d.publishQuestions).toHaveBeenCalledTimes(1);
    expect(d.materializeAssignments).toHaveBeenCalledTimes(1);
  });

  it("does not report the edition as published when it did not publish it", async () => {
    // `published` is a claim about the content stage. A tail-only retry made no
    // such claim, and inventing one would let a receipt be written for work this
    // request did not do.
    const { result } = await run({}, ["questions", "assignments"]);

    expect(result.published).toBeUndefined();
  });

  it("is idempotent in the only sense this function controls: same calls, same shape", async () => {
    const first = await run();
    const second = await run();

    expect(second.result.stages).toEqual(first.result.stages);
    expect(second.deps.publishContent).toHaveBeenCalledTimes(1);
    expect(second.deps.publishQuestions).toHaveBeenCalledTimes(1);
    expect(second.deps.materializeAssignments).toHaveBeenCalledTimes(1);
  });
});

describe("the combined verification", () => {
  it("is verified only when both halves are", () => {
    expect(combineVerification({ editorial: { ok: true }, game: { ok: true } }).ok).toBe(true);
    expect(combineVerification({ editorial: { ok: true }, game: { ok: false } }).ok).toBe(false);
    expect(combineVerification({ editorial: { ok: false }, game: { ok: true } }).ok).toBe(false);
  });

  it("names which half failed", () => {
    const verdict = combineVerification({
      editorial: { ok: true, reason: "ok" },
      game: { ok: false, reason: "question_count_mismatch" },
    });

    expect(verdict.reason).toBe("question_count_mismatch");
    expect(verdict.editorial_ok).toBe(true);
    expect(verdict.game_ok).toBe(false);
  });

  it("reports the editorial reason first when the content itself is wrong", () => {
    const verdict = combineVerification({
      editorial: { ok: false, reason: "newsletter_count_mismatch" },
      game: { ok: false, reason: "question_count_mismatch" },
    });

    expect(verdict.reason).toBe("newsletter_count_mismatch");
  });

  it("merges both problem lists so one report explains everything", () => {
    const verdict = combineVerification({
      editorial: { ok: false, problems: [{ code: "source_links_missing" }] },
      game: { ok: false, problems: [{ code: "question_grade_count_mismatch" }] },
    });

    expect(verdict.problems).toEqual([
      { code: "source_links_missing" },
      { code: "question_grade_count_mismatch" },
    ]);
  });

  it("treats a missing game verification as a failure, not an abstention", () => {
    // A missing migration must not silently restore the old behaviour, which is
    // exactly the state this work exists to leave.
    const verdict = combineVerification({ editorial: { ok: true }, game: null });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("game_verification_missing");
  });
});

describe("the edition date", () => {
  it("is taken from the payload and validated", () => {
    expect(isEditionDate("2026-09-09")).toBe(true);
    expect(isEditionDate("09-09-2026")).toBe(false);
    expect(isEditionDate(undefined)).toBe(false);
    expect(isEditionDate(20260909)).toBe(false);
  });
});
