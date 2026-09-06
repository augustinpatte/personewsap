import { describe, expect, it, vi } from "vitest";

import { submitWithDeadlineRetry } from "./quizSubmitPolicy";
import type { SubmittedAnswer } from "./quizSession";

/**
 * Retrying a submit, and knowing when to stop.
 *
 * The reader answered in time and the network dropped. Retrying is right: the
 * server compares against the deadline it set, not against when the request
 * happened to arrive. Once that deadline has passed there is nothing left to
 * rescue, and the product rule is explicit — an answer the server never
 * received in time scores zero.
 *
 * What must never happen is the fix that suggests itself here: adjusting a
 * timestamp so a late answer counts. There is no client timestamp in the RPC at
 * all, which is what makes that impossible rather than merely discouraged.
 */

const T0 = Date.parse("2026-09-06T10:00:00.000Z");
const deadline = new Date(T0 + 20_000).toISOString();

const success: SubmittedAnswer = {
  attemptId: "attempt-1",
  scoreMilli: 1000,
  gradeBand: "excellent",
  expired: false,
  skipped: false,
  selectedOptionId: "a"
};

const networkError = {
  ok: false as const,
  error: { code: "network", message: "Network request failed" }
};

describe("submitWithDeadlineRetry", () => {
  it("returns immediately when the first submit works", async () => {
    const submit = vi.fn(async () => ({ ok: true as const, data: success }));

    const result = await submitWithDeadlineRetry({
      attemptId: "attempt-1",
      selectedOptionId: "a",
      deadlineAt: deadline,
      submit,
      now: () => T0,
      sleep: async () => undefined
    });

    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("retries while the server deadline still stands", async () => {
    let calls = 0;
    const submit = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? networkError : { ok: true as const, data: success };
    });

    const result = await submitWithDeadlineRetry({
      attemptId: "attempt-1",
      selectedOptionId: "a",
      deadlineAt: deadline,
      submit,
      // Still eight seconds of the twenty left on every retry.
      now: () => T0 + 12_000,
      sleep: async () => undefined
    });

    expect(result.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("stops the moment the deadline has passed", async () => {
    const submit = vi.fn(async () => networkError);

    const result = await submitWithDeadlineRetry({
      attemptId: "attempt-1",
      selectedOptionId: "a",
      deadlineAt: deadline,
      submit,
      now: () => T0 + 25_000,
      sleep: async () => undefined
    });

    // One try, then it gives up: the server would score it zero anyway, and the
    // caller's state machine settles it at zero on its next tick.
    expect(submit).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
  });

  it("gives up after a bounded number of attempts", async () => {
    const submit = vi.fn(async () => networkError);

    await submitWithDeadlineRetry({
      attemptId: "attempt-1",
      selectedOptionId: "a",
      deadlineAt: deadline,
      submit,
      now: () => T0,
      sleep: async () => undefined,
      maxAttempts: 4
    });

    // A retry loop with no ceiling would keep a screen spinning forever on a
    // dead connection.
    expect(submit).toHaveBeenCalledTimes(4);
  });

  it("carries a skip through the same path", async () => {
    const submit = vi.fn(async () => ({
      ok: true as const,
      data: { ...success, scoreMilli: 0 as const, skipped: true, selectedOptionId: null }
    }));

    await submitWithDeadlineRetry({
      attemptId: "attempt-1",
      selectedOptionId: null,
      deadlineAt: deadline,
      submit,
      now: () => T0,
      sleep: async () => undefined
    });

    expect(submit).toHaveBeenCalledWith({ attemptId: "attempt-1", selectedOptionId: null });
  });

  it("sends no timestamp, ever", async () => {
    // The reason a late answer cannot be rescued by a client-side fix: there is
    // nothing in the request a client could move.
    const submit = vi.fn(async () => ({ ok: true as const, data: success }));

    await submitWithDeadlineRetry({
      attemptId: "attempt-1",
      selectedOptionId: "a",
      deadlineAt: deadline,
      submit,
      now: () => T0,
      sleep: async () => undefined
    });

    const [payload] = submit.mock.calls[0] as unknown as [Record<string, unknown>];

    expect(Object.keys(payload).sort()).toEqual(["attemptId", "selectedOptionId"]);
  });

  it("waits between retries rather than hammering", async () => {
    const sleep = vi.fn(async () => undefined);
    const submit = vi.fn(async () => networkError);

    await submitWithDeadlineRetry({
      attemptId: "attempt-1",
      selectedOptionId: "a",
      deadlineAt: deadline,
      submit,
      now: () => T0,
      sleep,
      maxAttempts: 3
    });

    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
