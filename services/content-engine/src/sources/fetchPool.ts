/**
 * Bounded concurrency and retry policy for outbound feed fetches.
 *
 * The English proof failed 44/44 with every feed timing out at exactly the
 * timeout value. That signature — all of them, at the same millisecond budget —
 * is not 44 broken publishers: it is one process opening 44 sockets at once.
 * Node's undici pools connections per origin but not across origins, so a
 * single `Promise.allSettled` over the whole source list starts every DNS
 * lookup, TLS handshake and download simultaneously and they starve each other
 * until the shared deadline expires.
 *
 * The fix is to run the same work through a small worker pool, so a feed's
 * timeout budget is spent on that feed rather than on waiting behind 43 others.
 *
 * Kept dependency-free and pure: a queue of promises is not worth a runtime
 * dependency, and keeping it here makes the concurrency ceiling and the retry
 * classification directly testable.
 */

export type SettledResult<R> =
  | { status: "fulfilled"; value: R }
  | { status: "rejected"; reason: unknown };

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving input
 * order in the results.
 *
 * Never rejects: one bad feed must not fail the batch, so every outcome is
 * reported as settled and the caller decides what a failure means.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<SettledResult<R>[]> {
  const results = new Array<SettledResult<R>>(items.length);

  if (items.length === 0) {
    return results;
  }

  const ceiling = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length));
  let nextIndex = 0;

  // Each runner pulls the next index until the queue drains. The number of
  // runners *is* the concurrency ceiling, so no more than `ceiling` calls to
  // `worker` can ever be outstanding.
  const runner = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: ceiling }, () => runner()));

  return results;
}

export type FetchFailureKind = "transient" | "permanent";

export type FetchFailure = {
  kind: FetchFailureKind;
  /** Short reason for diagnostics, e.g. "timeout", "http_503". */
  code: string;
};

/**
 * Whether an attempt is worth repeating.
 *
 * Transient: the request never reached a verdict about the resource — a
 * timeout, a dropped connection, a rate limit, or a server that is briefly
 * unable to answer. Permanent: the server answered about the resource, and the
 * answer will not change on a second identical request (404, 401, 403, 410).
 * Retrying those wastes the timeout budget that the working feeds need.
 */
export function classifyFetchFailure(error: unknown): FetchFailure {
  if (isHttpStatusError(error)) {
    const status = error.httpStatus;

    if (status === 429) {
      return { kind: "transient", code: "http_429" };
    }

    if (status >= 500 && status <= 599) {
      return { kind: "transient", code: `http_${status}` };
    }

    return { kind: "permanent", code: `http_${status}` };
  }

  if (isAbortError(error)) {
    return { kind: "transient", code: "timeout" };
  }

  const message = errorMessage(error).toLowerCase();

  // Node/undici surface connection problems as opaque error strings.
  for (const marker of [
    "econnreset",
    "econnrefused",
    "etimedout",
    "esockettimedout",
    "epipe",
    "ehostunreach",
    "enetunreach",
    "eai_again",
    "enotfound",
    "socket hang up",
    "network",
    "fetch failed",
    "terminated",
    "timed out",
    "timeout"
  ]) {
    if (message.includes(marker)) {
      return { kind: "transient", code: "network" };
    }
  }

  // A parse failure is about the payload, not the connection: the same bytes
  // will fail to parse again.
  if (message.includes("parse")) {
    return { kind: "permanent", code: "parse" };
  }

  return { kind: "permanent", code: "unknown" };
}

/**
 * Backoff before a retry: exponential, with jitter so a whole batch retrying
 * after the same outage does not re-synchronise into a second thundering herd.
 */
export function computeRetryDelayMs(
  attempt: number,
  baseDelayMs = 250,
  random: () => number = Math.random
): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, 4_000);
  const jitter = Math.round(capped * 0.25 * random());

  return capped + jitter;
}

/** Marker interface for a failure that carries an HTTP status. */
export type HttpStatusError = Error & { httpStatus: number };

export function createHttpStatusError(message: string, httpStatus: number): HttpStatusError {
  return Object.assign(new Error(message), { httpStatus });
}

export function isHttpStatusError(error: unknown): error is HttpStatusError {
  return (
    error instanceof Error &&
    typeof (error as Partial<HttpStatusError>).httpStatus === "number"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
