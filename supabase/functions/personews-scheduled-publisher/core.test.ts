import { describe, expect, it } from "vitest";

import {
  editorialDate,
  isEditorialDate,
  PUBLISHER_VERSION,
  runScheduledPublication,
  type GateVerdict,
  type ProductionPublishResult,
  type ProductionVerification,
  type PublisherDeps,
  type PublishPlan,
  type RunRecord,
} from "./core.ts";

/**
 * The orchestration half of the publication decision.
 *
 * The SQL half — is this batch actually publishable — is tested against the real
 * functions on the real staging database by
 * `supabase-staging/supabase/tests/scheduled_publication_gate.test.sql`. What is tested
 * here is what the publisher DOES with that verdict, including the three cases
 * SQL cannot reach: production refusing, production being unreachable, and
 * production accepting but not actually holding the edition afterwards.
 *
 * Each test records every call the orchestrator makes, so "nothing was
 * published" is asserted as "the publish function was never called", not as an
 * absence of complaint.
 */

type Recorder = {
  calls: string[];
  runs: RunRecord[];
  published: Array<{ payload: unknown; runId: string }>;
  receipts: Array<{ batchId: string; runId: string }>;
};

function harness(input: {
  plan: PublishPlan;
  publish?: (payload: unknown, runId: string) => Promise<ProductionPublishResult>;
  verify?: (date: string, batchId: string, runId: string) => Promise<ProductionVerification>;
  markPublished?: () => Promise<string>;
}): { deps: PublisherDeps; recorder: Recorder } {
  const recorder: Recorder = { calls: [], runs: [], published: [], receipts: [] };

  const deps: PublisherDeps = {
    plan: async () => {
      recorder.calls.push("plan");
      return input.plan;
    },
    runId: (date, batchId) => `personews-scheduled-publish:${PUBLISHER_VERSION}:${date}:${batchId}`,
    beginRun: async () => {
      recorder.calls.push("beginRun");
      return 1;
    },
    publish: async (payload, runId) => {
      recorder.calls.push("publish");
      recorder.published.push({ payload, runId });
      return input.publish ? await input.publish(payload, runId) : { published: true, items_written: 46 };
    },
    verify: async (date, batchId, runId) => {
      recorder.calls.push("verify");
      return input.verify ? await input.verify(date, batchId, runId) : { ok: true, items: { total: 46 } };
    },
    markPublished: async (batchId, runId) => {
      recorder.calls.push("markPublished");
      recorder.receipts.push({ batchId, runId });
      return input.markPublished ? await input.markPublished() : "receipt-1";
    },
    finishRun: async (_id, record) => {
      recorder.calls.push("finishRun");
      recorder.runs.push(record);
    },
  };

  return { deps, recorder };
}

const BATCH = "11111111-2222-3333-4444-555555555555";

function passingGate(overrides: Partial<GateVerdict> = {}): GateVerdict {
  return {
    ok: true,
    reason: "ok",
    already_published: false,
    edition_date: "2026-09-07",
    expected_edition_kind: "daily",
    edition_kind: "daily",
    batch_id: BATCH,
    batch_status: "ready",
    approved_jobs: 23,
    expected_jobs: 23,
    blockers: [],
    ...overrides,
  };
}

function refusedGate(reason: string, blockers: unknown[]): GateVerdict {
  return {
    ok: false,
    reason,
    already_published: false,
    edition_date: "2026-09-07",
    expected_edition_kind: "daily",
    edition_kind: "daily",
    batch_id: BATCH,
    batch_status: "reviewing",
    approved_jobs: 22,
    expected_jobs: 23,
    blockers,
  };
}

const READY_PAYLOAD = { ready: true, batch: { id: BATCH }, jobs: new Array(23).fill({}) };

async function run(deps: PublisherDeps, editionDate = "2026-09-07") {
  return runScheduledPublication({ editionDate, triggerSource: "cron", deps });
}

describe("scheduled publisher — the gate passes", () => {
  it("test 1: 23/23 approved and valid publishes, verifies, then records the receipt", async () => {
    const { deps, recorder } = harness({
      plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
    });

    const outcome = await run(deps);

    expect(outcome.published).toBe(true);
    expect(outcome.reason).toBe("published");
    expect(outcome.production_verified).toBe(true);
    expect(outcome.receipt_recorded).toBe(true);

    // Order is the safety property: nothing is marked published in staging
    // before production has been written AND read back.
    expect(recorder.calls).toEqual([
      "plan",
      "beginRun",
      "publish",
      "verify",
      "markPublished",
      "finishRun",
    ]);
  });

  it("forwards the canonical payload untouched, and a deterministic run id", async () => {
    const { deps, recorder } = harness({
      plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
    });

    const outcome = await run(deps);

    expect(recorder.published[0].payload).toBe(READY_PAYLOAD);
    expect(outcome.run_id).toBe(
      `personews-scheduled-publish:${PUBLISHER_VERSION}:2026-09-07:${BATCH}`,
    );
    expect(recorder.receipts[0].runId).toBe(outcome.run_id);
  });

  it("test 11: a Sunday weekly digest publishes on the same path", async () => {
    const { deps, recorder } = harness({
      plan: {
        gate: passingGate({ edition_date: "2026-09-06", edition_kind: "weekly_digest", expected_edition_kind: "weekly_digest" }),
        ready_payload: READY_PAYLOAD,
      },
    });

    const outcome = await run(deps, "2026-09-06");

    expect(outcome.published).toBe(true);
    expect(outcome.run_id).toContain("2026-09-06");
    expect(recorder.calls).toContain("markPublished");
  });

  it("test 12: Monday, Wednesday and Friday dailies each publish", async () => {
    for (const date of ["2026-09-07", "2026-09-09", "2026-09-11"]) {
      const { deps } = harness({
        plan: { gate: passingGate({ edition_date: date }), ready_payload: READY_PAYLOAD },
      });
      const outcome = await run(deps, date);
      expect(outcome.published).toBe(true);
      expect(outcome.gate.edition_kind).toBe("daily");
    }
  });
});

describe("scheduled publisher — the gate refuses", () => {
  const refusals: Array<{ label: string; gate: GateVerdict }> = [
    {
      label: "test 2: 22 of 23 approved",
      gate: refusedGate("jobs_not_all_approved", [
        { code: "jobs_not_all_approved", detail: "22 of 23 jobs are approved" },
      ]),
    },
    {
      label: "test 3: a review scored below 90",
      gate: refusedGate("review_score_below_bar", [
        { code: "review_score_below_bar", detail: "mini_case#1 scored 89, bar is 90" },
      ]),
    },
    {
      label: "test 4: a critical check is false",
      gate: refusedGate("critical_check_failed", [
        { code: "critical_check_failed", check: "safety" },
      ]),
    },
    {
      label: "test 5: the deterministic preflight is invalid",
      gate: refusedGate("deterministic_preflight_invalid", [
        { code: "deterministic_preflight_invalid", errors: ["fr:newsletter_body_words_100_outside_220_275"] },
      ]),
    },
    {
      label: "test 6: the batch targets the wrong project",
      gate: refusedGate("wrong_target_project", [
        { code: "wrong_target_project", detail: "batch targets kukyotcgbnchsoeriqoz" },
      ]),
    },
    {
      label: "test 7: the batch is a test batch",
      gate: refusedGate("batch_not_found", [
        { code: "batch_not_found", detail: "no daily batch exists" },
      ]),
    },
    {
      label: "a quiet day",
      gate: refusedGate("quiet_day", [{ code: "quiet_day", detail: "Tue is not a publication day" }]),
    },
  ];

  for (const { label, gate } of refusals) {
    it(`${label}: publishes nothing and writes no receipt`, async () => {
      const { deps, recorder } = harness({ plan: { gate, ready_payload: null } });

      const outcome = await run(deps);

      expect(outcome.published).toBe(false);
      expect(outcome.publication_attempted).toBe(false);
      expect(outcome.receipt_recorded).toBe(false);
      expect(outcome.reason).toBe(gate.reason);
      expect(recorder.calls).not.toContain("publish");
      expect(recorder.calls).not.toContain("markPublished");

      // The refusal is diagnosable: the audit row carries the blockers.
      expect(recorder.runs).toHaveLength(1);
      expect(recorder.runs[0].gate.blockers).toEqual(gate.blockers);
      expect(recorder.runs[0].gatePassed).toBe(false);
    });
  }

  it("refuses even if the gate passes but hands back no payload", async () => {
    const { deps, recorder } = harness({ plan: { gate: passingGate(), ready_payload: null } });

    const outcome = await run(deps);

    expect(outcome.published).toBe(false);
    expect(outcome.reason).toBe("ready_payload_missing");
    expect(recorder.calls).not.toContain("publish");
  });
});

describe("scheduled publisher — idempotence", () => {
  it("test 8: an already-published edition is a no-op, not a retry", async () => {
    const { deps, recorder } = harness({
      plan: {
        gate: passingGate({
          ok: false,
          reason: "already_published",
          already_published: true,
          receipt: { production_run_id: "personews-scheduled-publish:v1:2026-09-07:batch" },
        }),
        ready_payload: null,
      },
    });

    const outcome = await run(deps);

    expect(outcome.already_published).toBe(true);
    expect(outcome.published).toBe(false);
    expect(outcome.publication_attempted).toBe(false);
    expect(recorder.calls).toEqual(["plan", "beginRun", "finishRun"]);
    expect(recorder.receipts).toHaveLength(0);
  });

  it("gives the same run id on every attempt for the same edition and batch", async () => {
    const ids = new Set<string>();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { deps } = harness({
        plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
      });
      const outcome = await run(deps);
      ids.add(outcome.run_id ?? "");
    }

    expect(ids.size).toBe(1);
  });
});

describe("scheduled publisher — production does not cooperate", () => {
  it("test 9: the production RPC throws, so staging is never marked published", async () => {
    const { deps, recorder } = harness({
      plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
      publish: async () => {
        throw new Error("production_http_500: publish_scheduled_staging_payload failed");
      },
    });

    const outcome = await run(deps);

    expect(outcome.published).toBe(false);
    expect(outcome.publication_attempted).toBe(true);
    expect(outcome.publication_succeeded).toBe(false);
    expect(outcome.receipt_recorded).toBe(false);
    expect(outcome.reason).toBe("production_publish_failed");
    expect(outcome.error).toContain("publish_scheduled_staging_payload failed");
    expect(recorder.calls).not.toContain("markPublished");
    expect(recorder.calls).not.toContain("verify");
  });

  it("test 9b: the production RPC answers without published:true", async () => {
    const { deps, recorder } = harness({
      plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
      publish: async () => ({ error: "scheduled publish refused: expected 23 jobs, got 22" }),
    });

    const outcome = await run(deps);

    expect(outcome.published).toBe(false);
    expect(outcome.reason).toBe("production_publish_refused");
    expect(recorder.calls).not.toContain("markPublished");
  });

  it("test 10: production says published but verification disagrees — no false receipt", async () => {
    const { deps, recorder } = harness({
      plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
      verify: async () => ({
        ok: false,
        problems: [{ code: "newsletter_count_mismatch", detail: "fr=15 en=16" }],
      }),
    });

    const outcome = await run(deps);

    expect(outcome.published).toBe(false);
    expect(outcome.publication_succeeded).toBe(true);
    expect(outcome.production_verified).toBe(false);
    expect(outcome.receipt_recorded).toBe(false);
    expect(outcome.reason).toBe("production_verification_failed");
    expect(recorder.calls).not.toContain("markPublished");
    expect(recorder.runs[0].verification).toMatchObject({ ok: false });
  });

  it("test 10b: verification unreachable is also not a success", async () => {
    const { deps, recorder } = harness({
      plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
      verify: async () => {
        throw new Error("production_http_503");
      },
    });

    const outcome = await run(deps);

    expect(outcome.published).toBe(false);
    expect(outcome.reason).toBe("production_verification_unavailable");
    expect(recorder.calls).not.toContain("markPublished");
  });

  it("a receipt that cannot be written is reported, never silently swallowed", async () => {
    const { deps } = harness({
      plan: { gate: passingGate(), ready_payload: READY_PAYLOAD },
      markPublished: async () => {
        throw new Error("batch_not_ready_for_publication");
      },
    });

    const outcome = await run(deps);

    // The edition IS live in production, so `published` stays true; what failed
    // is the bookkeeping, and the reason says exactly that.
    expect(outcome.published).toBe(true);
    expect(outcome.production_verified).toBe(true);
    expect(outcome.receipt_recorded).toBe(false);
    expect(outcome.reason).toBe("receipt_write_failed");
  });
});

describe("scheduled publisher — the audit trail", () => {
  it("closes the run row on every path, including refusals and failures", async () => {
    const cases: PublishPlan[] = [
      { gate: passingGate(), ready_payload: READY_PAYLOAD },
      { gate: refusedGate("batch_not_ready", []), ready_payload: null },
      { gate: passingGate({ ok: false, reason: "already_published", already_published: true }), ready_payload: null },
    ];

    for (const plan of cases) {
      const { deps, recorder } = harness({ plan });
      await run(deps);
      expect(recorder.calls[recorder.calls.length - 1]).toBe("finishRun");
      expect(recorder.runs).toHaveLength(1);
    }
  });
});

describe("editorial date resolution", () => {
  it("reads the date in Europe/Paris, through both CET and CEST", () => {
    // 19:00 Paris in summer is 17:00 UTC.
    expect(editorialDate(new Date("2026-09-07T17:00:00Z"))).toBe("2026-09-07");
    // 19:00 Paris in winter is 18:00 UTC.
    expect(editorialDate(new Date("2026-12-07T18:00:00Z"))).toBe("2026-12-07");
    // Late enough in UTC that Paris has already turned the page.
    expect(editorialDate(new Date("2026-12-06T23:30:00Z"))).toBe("2026-12-07");
    // Early enough in UTC that Paris has not yet.
    expect(editorialDate(new Date("2026-09-07T22:30:00Z"))).toBe("2026-09-08");
  });

  it("accepts only ISO calendar dates", () => {
    expect(isEditorialDate("2026-09-07")).toBe(true);
    expect(isEditorialDate("07/09/2026")).toBe(false);
    expect(isEditorialDate("2026-9-7")).toBe(false);
    expect(isEditorialDate("")).toBe(false);
  });
});
