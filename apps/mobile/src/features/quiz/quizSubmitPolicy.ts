import type { SubmittedAnswer } from "./quizSession";

/**
 * When to retry a submit, and when to stop.
 *
 * Kept free of any Supabase import so the policy can be unit tested directly —
 * the same split `miniCaseMapping.ts` / `miniCaseSync.ts` already uses in this
 * codebase. The I/O lives in quizData.ts.
 *
 * The reader answered in time and the network dropped: retrying is right,
 * because the server compares against the deadline it set, not against when the
 * request happened to arrive. Once that deadline has passed there is nothing
 * left to rescue — the product rule is explicit that an answer the server never
 * received in time scores zero.
 *
 * Note what the request carries: an attempt id and an option id. No timestamp,
 * no duration, no score. That is what makes "adjust the clock to save a late
 * answer" impossible here rather than merely discouraged.
 */

export type SubmitError = { code?: string; message: string };

export type SubmitResult =
  | { ok: true; data: SubmittedAnswer }
  | { ok: false; error: SubmitError };

export type SubmitRequest = {
  attemptId: string;
  /** Null is an explicit skip, worth zero. Not an abandoned attempt. */
  selectedOptionId: string | null;
};

export async function submitWithDeadlineRetry(input: {
  attemptId: string;
  selectedOptionId: string | null;
  /** The SERVER deadline, from start_question_attempt. */
  deadlineAt: string;
  submit: (request: SubmitRequest) => Promise<SubmitResult>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  maxAttempts?: number;
}): Promise<SubmitResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = input.retryDelayMs ?? 400;
  // A retry loop with no ceiling keeps a screen spinning forever on a dead
  // connection, which is worse than telling the reader it did not go through.
  const maxAttempts = input.maxAttempts ?? 6;
  const deadline = Date.parse(input.deadlineAt);

  let lastError: SubmitError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await input.submit({
      attemptId: input.attemptId,
      selectedOptionId: input.selectedOptionId
    });

    if (result.ok) {
      return result;
    }

    lastError = result.error;

    if (Number.isFinite(deadline) && now() > deadline) {
      break;
    }

    if (attempt < maxAttempts) {
      await sleep(retryDelayMs);
    }
  }

  return {
    ok: false,
    error: lastError ?? { code: "submit_failed", message: "The answer could not be submitted." }
  };
}
