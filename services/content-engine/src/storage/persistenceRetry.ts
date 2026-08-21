/**
 * Bounded retry for idempotent persistence writes.
 *
 * A catalog run spends real money before it reaches the database, so losing a
 * finished batch to one dropped socket is the expensive kind of failure. The
 * run that prompted this died on:
 *
 *   upsert sources on sources failed: TypeError: fetch failed
 *   HeadersTimeoutError: HTTP/2: "headers timeout after 300000"
 *
 * — a transport failure with no verdict from PostgREST at all.
 *
 * The distinction this module draws is between "no answer" and "an answer you
 * did not like". A timeout, a reset socket, a DNS blip, a 408/429 or a 5xx says
 * the request did not get a decision, so asking again is legitimate. A 401, an
 * RLS refusal, a schema mismatch, a constraint violation or any other
 * deterministic 4xx is a decision, and repeating the request only repeats it —
 * more slowly, and with the real error buried under retries.
 *
 * Retrying is only safe because the operations wrapped here are idempotent:
 * `upsert ... onConflict: url` converges on the same rows, and the content-item
 * path looks up its dedup key before inserting.
 */

export const DEFAULT_PERSISTENCE_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

/** PostgREST/HTTP statuses that mean "no decision yet", not "no". */
const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

/** Undici / Node transport failures. */
const TRANSIENT_ERROR_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND"
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /fetch failed/i,
  /headers timeout/i,
  /body timeout/i,
  /socket hang up/i,
  /connection (reset|closed|refused)/i,
  /network (error|timeout)/i,
  /temporarily unavailable/i,
  /timeout after \d+/i
];

/**
 * Errors that must never be retried, even when their text happens to mention a
 * network word. An authorisation refusal repeated three times is still a
 * refusal, and hiding it behind backoff makes it harder to diagnose.
 */
const PERMANENT_MESSAGE_PATTERNS = [
  /jwt|api key|apikey/i,
  /row-level security|violates row-level security|permission denied|not authorized|unauthorized/i,
  /does not exist|schema cache|could not find the .* column|undefined column|undefined table/i,
  /violates (unique|foreign key|check|not-null) constraint/i,
  /duplicate key value/i,
  /invalid input syntax|malformed/i
];

export function isTransientPersistenceError(error: unknown): boolean {
  const codes = collectCodes(error);
  const message = collectMessage(error);

  // A definite verdict wins over any transport-sounding wording around it.
  if (PERMANENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }

  if (codes.some((code) => TRANSIENT_ERROR_CODES.has(code))) {
    return true;
  }

  const status = collectStatus(error);
  if (status !== null) {
    return TRANSIENT_STATUS_CODES.has(status);
  }

  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export type PersistenceRetryDiagnostics = {
  action: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
};

/**
 * Run an idempotent persistence operation, retrying only transport-level
 * failures, with exponential backoff and jitter.
 *
 * The last failure is rethrown unchanged, so the caller still sees the real
 * error rather than a retry wrapper.
 */
export async function withPersistenceRetry<T>(
  action: string,
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    onRetry?: (diagnostics: PersistenceRetryDiagnostics) => void;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_PERSISTENCE_MAX_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientPersistenceError(error)) {
        throw error;
      }

      const delayMs = backoffDelayMs(attempt, random);

      options.onRetry?.({
        action,
        attempt,
        maxAttempts,
        delayMs,
        error: collectMessage(error)
      });

      await sleep(delayMs);
    }
  }
}

function backoffDelayMs(attempt: number, random: () => number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);

  // Small jitter so parallel writers do not line up on the same retry instant.
  return Math.round(exponential + random() * BASE_DELAY_MS);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Codes from the error and its cause chain: undici nests the real one. */
function collectCodes(error: unknown): string[] {
  const codes: string[] = [];

  for (const node of causeChain(error)) {
    const code = (node as { code?: unknown }).code;

    if (typeof code === "string") {
      codes.push(code);
    }
  }

  return codes;
}

function collectStatus(error: unknown): number | null {
  for (const node of causeChain(error)) {
    const record = node as { status?: unknown; statusCode?: unknown; code?: unknown };
    const candidate = record.status ?? record.statusCode;

    if (typeof candidate === "number") {
      return candidate;
    }

    // PostgREST reports its HTTP status as a numeric string in `code`.
    if (typeof record.code === "string" && /^\d{3}$/.test(record.code)) {
      return Number(record.code);
    }
  }

  return null;
}

function collectMessage(error: unknown): string {
  return causeChain(error)
    .map((node) => {
      const message = (node as { message?: unknown }).message;

      return typeof message === "string" ? message : "";
    })
    .filter(Boolean)
    .join(" | ");
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;

  // Bounded: a malformed cause cycle must not hang the run.
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  if (chain.length === 0 && typeof error === "string") {
    chain.push({ message: error });
  }

  return chain;
}
