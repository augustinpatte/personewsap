import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateEditionHealth,
  type StagingPublicationSnapshot
} from "./editionPublicationHealth.js";
import { readStagingPublication } from "./stagingPublicationState.js";

/**
 * Edition health is production AND staging AND readers.
 *
 * The blind spot this closes: production had an editions row, staging never
 * verified it (no receipt), and no device had come due yet — so the
 * notification counters were all zero and the check went green. A production
 * row is content written; the staging receipt is the edition verified.
 */

// Monday 7 September 2026. 19:30Z = 21:30 Paris (after the 21:15 deadline);
// 17:30Z = 19:30 Paris (before it).
const AFTER = new Date("2026-09-07T19:30:00Z");
const BEFORE = new Date("2026-09-07T17:30:00Z");
const DATE = "2026-09-07";

const receipted: StagingPublicationSnapshot = {
  available: true, status: "published", receipted: true, lastAttemptReason: "published", staleOpenRuns: 0, source: "rpc"
};
const noReceipt = (reason: string | null): StagingPublicationSnapshot => ({
  available: true, status: "missed", receipted: false, lastAttemptReason: reason, staleOpenRuns: 0, source: "rpc"
});

describe("the combined verdict for one edition date", () => {
  it("A. no edition by the deadline: missed, critical", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: AFTER, productionPublished: false, staging: noReceipt(null), notification: null
    });
    expect(health).toMatchObject({ state: "missed", severity: "critical", deadlinePassed: true });
  });

  it("A'. before the deadline the same facts are only pending", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: BEFORE, productionPublished: false, staging: noReceipt(null), notification: null
    });
    expect(health).toMatchObject({ state: "pending", severity: "ok" });
  });

  it("B. a production row with no staging receipt, after the deadline: critical", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: AFTER, productionPublished: true, staging: noReceipt("production_publish_timeout"),
      notification: { status: "ok", outboxStatus: "awaiting_verification" }
    });
    expect(health).toMatchObject({ state: "published_unverified", severity: "critical" });
    expect(health.detail).toContain("run_scheduled_publication_tick(true)");
  });

  it("B'. ...but while the window is still open it is in progress, not a failure", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: BEFORE, productionPublished: true, staging: noReceipt(null),
      notification: { status: "ok", outboxStatus: "awaiting_verification" }
    });
    expect(health).toMatchObject({ state: "published_unverified", severity: "ok" });
  });

  it("C. staging recorded a failed verification: critical after the deadline", () => {
    for (const reason of ["production_verification_failed", "production_verification_timeout", "production_verification_unavailable"]) {
      const health = evaluateEditionHealth({
        editionDate: DATE, now: AFTER, productionPublished: true, staging: noReceipt(reason),
        notification: { status: "ok", outboxStatus: "awaiting_verification" }
      });
      expect(health).toMatchObject({ state: "verification_failed", severity: "critical" });
    }
  });

  it("D. verified, but the notification release never happened: critical", () => {
    for (const outboxStatus of ["awaiting_verification", "failed"]) {
      const health = evaluateEditionHealth({
        editionDate: DATE, now: AFTER, productionPublished: true, staging: receipted,
        notification: { status: "ok", outboxStatus }
      });
      expect(health).toMatchObject({ state: "notification_failed", severity: "critical" });
    }
  });

  it("D'. verified and released, but due devices were never attempted: critical", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: AFTER, productionPublished: true, staging: receipted,
      notification: { status: "critical", outboxStatus: "processed" }
    });
    expect(health).toMatchObject({ state: "notification_failed", severity: "critical" });
  });

  it("E. verified and released, deliveries still retrying: a warning, not a failure", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: AFTER, productionPublished: true, staging: receipted,
      notification: { status: "warning", outboxStatus: "processed" }
    });
    expect(health).toMatchObject({ state: "verified_notification_pending", severity: "warning" });
  });

  it("F. published, verified, released: healthy", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: AFTER, productionPublished: true, staging: receipted,
      notification: { status: "ok", outboxStatus: "processed" }
    });
    expect(health).toMatchObject({ state: "healthy", severity: "ok" });
  });

  it("a staging receipt with no production edition is a contradiction: critical", () => {
    const health = evaluateEditionHealth({
      editionDate: DATE, now: BEFORE, productionPublished: false, staging: receipted, notification: null
    });
    expect(health).toMatchObject({ state: "failed", severity: "critical" });
  });

  it("an unreadable staging fails the gate (requireStaging), and only warns elsewhere", () => {
    const base = {
      editionDate: DATE, now: AFTER, productionPublished: true,
      staging: { available: false, reason: "unreadable", error: "timeout" } as StagingPublicationSnapshot,
      notification: { status: "ok" as const, outboxStatus: "processed" }
    };
    expect(evaluateEditionHealth({ ...base, requireStaging: true }).severity).toBe("critical");
    expect(evaluateEditionHealth({ ...base, requireStaging: false }).severity).toBe("warning");
  });

  it("DST: the deadline is 21:15 Paris in winter too (20:15 UTC)", () => {
    const winter = "2026-12-07"; // a Monday
    const facts = { editionDate: winter, productionPublished: true, staging: noReceipt(null),
      notification: { status: "ok" as const, outboxStatus: "awaiting_verification" } };
    expect(evaluateEditionHealth({ ...facts, now: new Date("2026-12-07T20:14:00Z") }).severity).toBe("ok");
    expect(evaluateEditionHealth({ ...facts, now: new Date("2026-12-07T20:16:00Z") }).severity).toBe("critical");
  });
});

describe("notification-health, end to end over a mocked production", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../storage/supabaseClient.js");
  });

  /**
   * Production: `editions` holds `editionsPublished`; the notification health
   * RPC answers `healthRow`. Staging: injected.
   */
  async function run(input: {
    editionsPublished: string[];
    healthRow: Record<string, unknown> | null;
    staging: (date: string) => Promise<StagingPublicationSnapshot>;
    now: Date;
    requireStaging?: boolean;
    strict?: boolean;
  }) {
    const rpc = vi.fn(async (name: string) =>
      name === "get_edition_notification_health"
        ? { data: input.healthRow ? [input.healthRow] : [], error: null }
        : { data: [], error: null }
    );

    vi.doMock("../storage/supabaseClient.js", () => ({
      createServiceRoleSupabaseClient: () => ({
        rpc,
        from: () => {
          const filters: Record<string, unknown> = {};
          const builder = {
            select: () => builder,
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return builder;
            },
            limit: () => builder,
            lte: () => builder,
            gte: () => builder,
            lt: () => builder,
            in: () => builder,
            order: () => builder,
            then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
            maybeSingle: async () => ({
              data: input.editionsPublished.includes(filters.edition_date as string)
                ? { edition_date: filters.edition_date }
                : null,
              error: null
            })
          };
          return builder;
        }
      })
    }));

    const { runNotificationHealth, shouldFailNotificationHealth } = await import("../cli/notificationHealth.js");
    const stagingCalls: string[] = [];
    const options = {
      editionDate: null,
      strict: input.strict ?? false,
      requireStaging: input.requireStaging ?? true,
      now: input.now,
      readStaging: async (date: string) => {
        stagingCalls.push(date);
        return input.staging(date);
      }
    };
    const output = await runNotificationHealth(options);
    return { output, fails: shouldFailNotificationHealth(output, options), stagingCalls };
  }

  const row = (overrides: Record<string, unknown> = {}) => ({
    edition_date: DATE, eligible_devices: 0, delivery_rows: 0, sent: 0, awaiting_receipt: 0,
    retryable: 0, terminal: 0, never_attempted: 0, outbox_status: "processed",
    scheduled_not_due: 0, due_awaiting_worker: 0, ...overrides
  });

  it("THE BLIND SPOT: production row + no staging receipt + no due device => fails after the deadline", async () => {
    const { output, fails } = await run({
      editionsPublished: [DATE],
      // Nothing was released, nobody is due yet: every counter is zero.
      healthRow: row({ outbox_status: "awaiting_verification" }),
      staging: async () => noReceipt("production_publish_timeout"),
      now: AFTER
    });

    expect(output.publication?.status).toBe("published");
    expect(output.edition).toMatchObject({ state: "published_unverified", severity: "critical" });
    expect(output.status).toBe("critical");
    expect(fails).toBe(true);
  });

  it("A. nothing anywhere by the deadline fails; yesterday's edition does not help", async () => {
    const { output, fails, stagingCalls } = await run({
      editionsPublished: ["2026-09-06", "2026-09-04"],
      healthRow: null,
      staging: async () => noReceipt(null),
      now: AFTER
    });

    expect(output.edition?.state).toBe("missed");
    expect(fails).toBe(true);
    // Staging was asked about the same, exact date.
    expect(stagingCalls).toEqual([DATE]);
  });

  it("C. staging's failed verification fails the check", async () => {
    const { output, fails } = await run({
      editionsPublished: [DATE],
      healthRow: row({ outbox_status: "awaiting_verification" }),
      staging: async () => noReceipt("production_verification_failed"),
      now: AFTER
    });

    expect(output.edition?.state).toBe("verification_failed");
    expect(fails).toBe(true);
  });

  it("D. receipted, but the release never happened, fails", async () => {
    const { output, fails } = await run({
      editionsPublished: [DATE],
      healthRow: row({ outbox_status: "awaiting_verification" }),
      staging: async () => receipted,
      now: AFTER
    });

    expect(output.edition?.state).toBe("notification_failed");
    expect(fails).toBe(true);
  });

  it("E. receipted, released, still retrying: a warning (fails only --strict)", async () => {
    const facts = {
      editionsPublished: [DATE],
      healthRow: row({ eligible_devices: 10, delivery_rows: 10, sent: 8, retryable: 2 }),
      staging: async () => receipted,
      now: AFTER
    };
    const lenient = await run(facts);
    const strict = await run({ ...facts, strict: true });

    expect(lenient.output.edition?.state).toBe("verified_notification_pending");
    expect(lenient.fails).toBe(false);
    expect(strict.fails).toBe(true);
  });

  it("F. receipted, released, everyone told: healthy and green", async () => {
    const { output, fails } = await run({
      editionsPublished: [DATE],
      healthRow: row({ eligible_devices: 10, delivery_rows: 10, sent: 10 }),
      staging: async () => receipted,
      now: AFTER
    });

    expect(output.edition?.state).toBe("healthy");
    expect(output.status).toBe("ok");
    expect(fails).toBe(false);
  });

  it("before the deadline, a production row still awaiting its receipt does not fail", async () => {
    const { output, fails } = await run({
      editionsPublished: [DATE],
      healthRow: row({ outbox_status: "awaiting_verification" }),
      staging: async () => noReceipt(null),
      now: BEFORE
    });

    expect(output.edition?.state).toBe("published_unverified");
    expect(fails).toBe(false);
  });
});

describe("reading staging", () => {
  const rpcClient = (answer: { data: unknown; error: { code?: string; message: string } | null }) =>
    ({ rpc: async () => answer, from: () => { throw new Error("tables not expected"); } }) as never;

  it("maps scheduled_edition_publication_health", async () => {
    const snapshot = await readStagingPublication(DATE, rpcClient({
      data: {
        status: "published",
        receipt: { batch_id: "b" },
        last_attempt: { reason: "published" },
        stale_open_runs: [{ run_id: "r" }]
      },
      error: null
    }));

    expect(snapshot).toEqual({
      available: true, status: "published", receipted: true, lastAttemptReason: "published", staleOpenRuns: 1, source: "rpc"
    });
  });

  it("before the staging migration, reads the same facts from the tables, for the exact date", async () => {
    const asked: Array<[string, string, unknown]> = [];
    const table = (name: string, rows: unknown[]) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { asked.push([name, column, value]); return builder; },
        in: (column: string, value: unknown) => { asked.push([name, column, value]); return builder; },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null })
      };
      return builder;
    };
    const client = {
      rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }),
      from: (name: string) =>
        name === "automation_batches" ? table(name, [{ id: "batch-1" }])
          : name === "publication_receipts" ? table(name, [])
          : table(name, [{ reason: "production_verification_failed", finished_at: "x", started_at: "2026-09-07T17:00:00Z" }])
    } as never;

    const snapshot = await readStagingPublication(DATE, client);

    expect(snapshot).toMatchObject({ available: true, receipted: false, lastAttemptReason: "production_verification_failed", source: "tables" });
    expect(asked).toContainEqual(["automation_batches", "edition_date", DATE]);
    expect(asked).toContainEqual(["scheduled_publication_runs", "edition_date", DATE]);
  });

  it("an error is reported as unreadable, with the database message only", async () => {
    const snapshot = await readStagingPublication(DATE, rpcClient({ data: null, error: { code: "42501", message: "permission denied" } }));
    expect(snapshot).toEqual({ available: false, reason: "unreadable", error: "permission denied" });
  });

  it("without credentials it says not_configured instead of guessing", async () => {
    const saved = { url: process.env.STAGING_SUPABASE_URL, key: process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.STAGING_SUPABASE_URL;
    delete process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(await readStagingPublication(DATE)).toEqual({ available: false, reason: "not_configured" });
    } finally {
      if (saved.url !== undefined) process.env.STAGING_SUPABASE_URL = saved.url;
      if (saved.key !== undefined) process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY = saved.key;
    }
  });
});
