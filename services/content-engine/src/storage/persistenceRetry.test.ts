import { describe, expect, it, vi } from "vitest";

import {
  isTransientPersistenceError,
  withPersistenceRetry,
  DEFAULT_PERSISTENCE_MAX_ATTEMPTS
} from "./persistenceRetry.js";
import { PersistenceError } from "./persistenceError.js";

/**
 * The failure that ended the launch catalog run:
 *
 *   upsert sources on sources failed: TypeError: fetch failed
 *     cause: HeadersTimeoutError: HTTP/2: "headers timeout after 300000"
 *
 * No verdict came back from the database, so asking again is legitimate. A
 * verdict that happens to be "no" is not, however much it mentions the network.
 */

/** The real shape: a PersistenceError wrapping undici's nested cause. */
function headersTimeout(): PersistenceError {
  const cause = Object.assign(new Error('HTTP/2: "headers timeout after 300000"'), {
    code: "UND_ERR_HEADERS_TIMEOUT"
  });

  return new PersistenceError({
    table: "sources",
    action: "upsert sources",
    error: Object.assign(new TypeError("fetch failed"), { cause })
  });
}

const noSleep = async () => undefined;

describe("what counts as worth retrying", () => {
  it("retries the headers timeout that killed the catalog run", () => {
    expect(isTransientPersistenceError(headersTimeout())).toBe(true);
  });

  it.each([
    ["reset socket", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })],
    ["DNS blip", Object.assign(new Error("getaddrinfo"), { code: "EAI_AGAIN" })],
    ["request timeout", { status: 408, message: "Request Timeout" }],
    ["rate limit", { status: 429, message: "Too Many Requests" }],
    ["bad gateway", { status: 502, message: "Bad Gateway" }],
    ["gateway timeout", { status: 504, message: "Gateway Timeout" }],
    ["bare transport failure", new TypeError("fetch failed")]
  ])("retries a %s", (_label, error) => {
    expect(isTransientPersistenceError(error)).toBe(true);
  });

  it.each([
    ["expired credentials", { message: "JWT expired" }],
    ["an RLS refusal", { message: "new row violates row-level security policy for table \"sources\"" }],
    ["a permission refusal", { message: "permission denied for table content_items" }],
    ["a schema mismatch", { message: "Could not find the 'hide_display_date' column in the schema cache" }],
    ["a missing relation", { message: 'relation "public.sourcez" does not exist' }],
    ["a constraint violation", { message: "duplicate key value violates unique constraint \"sources_url_key\"" }],
    ["bad data", { message: "invalid input syntax for type uuid" }],
    ["a plain not-found", { status: 404, message: "Not Found" }]
  ])("does not retry %s", (_label, error) => {
    expect(isTransientPersistenceError(error)).toBe(false);
  });

  it("treats a definite verdict as definite even when it mentions the network", () => {
    // Otherwise an auth failure whose text happens to say "connection" would be
    // hidden behind three rounds of backoff.
    expect(
      isTransientPersistenceError({
        message: "connection refused: permission denied for table sources"
      })
    ).toBe(false);
  });
});

describe("retrying an idempotent write", () => {
  it("succeeds on a later attempt after a transient failure", async () => {
    let attempts = 0;
    const result = await withPersistenceRetry(
      "upsert sources",
      async () => {
        attempts += 1;

        if (attempts < 3) {
          throw headersTimeout();
        }

        return "written";
      },
      { sleep: noSleep }
    );

    expect(result).toBe("written");
    expect(attempts).toBe(3);
  });

  it("performs the write once when the retry succeeds, not once per attempt", async () => {
    // The operation is idempotent, but a retry must still not be counted as a
    // second row: only the successful call returns a result to the caller.
    const rows: string[] = [];
    let attempts = 0;

    const result = await withPersistenceRetry(
      "upsert sources",
      async () => {
        attempts += 1;

        if (attempts === 1) {
          // Failed before writing anything: no verdict came back.
          throw headersTimeout();
        }

        rows.push("source-1");
        return rows;
      },
      { sleep: noSleep }
    );

    expect(result).toEqual(["source-1"]);
    expect(rows).toEqual(["source-1"]);
  });

  it("stops at the attempt limit and rethrows the real error", async () => {
    let attempts = 0;

    await expect(
      withPersistenceRetry(
        "upsert sources",
        async () => {
          attempts += 1;
          throw headersTimeout();
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow(/upsert sources on sources failed/);

    expect(attempts).toBe(DEFAULT_PERSISTENCE_MAX_ATTEMPTS);
  });

  it("fails immediately on a permanent error", async () => {
    let attempts = 0;

    await expect(
      withPersistenceRetry(
        "insert content item",
        async () => {
          attempts += 1;
          throw new PersistenceError({
            table: "content_items",
            action: "insert content item",
            error: { message: "new row violates row-level security policy" }
          });
        },
        { sleep: noSleep }
      )
    ).rejects.toThrow(/row-level security/);

    // One attempt: an authorisation refusal is an answer, not a lost request.
    expect(attempts).toBe(1);
  });

  it("backs off further each time, with jitter", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await withPersistenceRetry(
      "upsert sources",
      async () => {
        attempts += 1;

        if (attempts < 3) {
          throw headersTimeout();
        }

        return null;
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
        random: () => 0.5
      }
    );

    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    // Jitter is added on top of the exponential step.
    expect(delays[0]).toBeGreaterThan(500);
  });

  it("reports each retry instead of retrying silently", async () => {
    const onRetry = vi.fn();
    let attempts = 0;

    await withPersistenceRetry(
      "upsert sources",
      async () => {
        attempts += 1;

        if (attempts === 1) {
          throw headersTimeout();
        }

        return null;
      },
      { sleep: noSleep, onRetry }
    );

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry.mock.calls[0][0]).toMatchObject({ action: "upsert sources", attempt: 1 });
    expect(onRetry.mock.calls[0][0].error).toMatch(/headers timeout/);
  });
});

describe("the write that lost the catalog run is the one now protected", () => {
  it("wraps the source upsert", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const repository = readFileSync(join(__dirname, "contentRepository.ts"), "utf8");
    const upsert = repository.slice(repository.indexOf("async upsertSources"));

    expect(upsert.slice(0, upsert.indexOf("\n  }"))).toMatch(/withPersistenceRetry\("upsert sources"/);
    // Still idempotent, which is what makes the retry safe.
    expect(upsert).toMatch(/onConflict: "url"/);
  });
});
