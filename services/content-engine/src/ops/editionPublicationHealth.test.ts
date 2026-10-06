import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateEditionPublication, resolveDueEditionDate } from "./editionPublicationHealth.js";

/**
 * Monitoring asks about the edition the calendar was owed, not the latest one
 * that happened to publish. Paris is UTC+2 in September, UTC+1 in January.
 */

describe("which edition was due", () => {
  it("is today on a publication day (Monday)", () => {
    expect(resolveDueEditionDate(new Date("2026-09-07T20:00:00Z"))).toBe("2026-09-07");
  });

  it("G. is the previous publication day on a quiet day (Tuesday -> Monday)", () => {
    expect(resolveDueEditionDate(new Date("2026-09-08T12:00:00Z"))).toBe("2026-09-07");
  });

  it("uses the Paris calendar, not UTC (Monday 23:30 UTC is Tuesday in Paris)", () => {
    expect(resolveDueEditionDate(new Date("2026-09-07T23:30:00Z"))).toBe("2026-09-07");
    expect(resolveDueEditionDate(new Date("2026-09-06T21:30:00Z"))).toBe("2026-09-06");
  });
});

describe("did it publish", () => {
  it("published is published, at any hour", () => {
    expect(
      evaluateEditionPublication({ editionDate: "2026-09-07", published: true, now: new Date("2026-09-07T17:05:00Z") }).status
    ).toBe("published");
  });

  it("unpublished before 21:15 Paris is pending (the catch-up window is still open)", () => {
    expect(
      evaluateEditionPublication({ editionDate: "2026-09-07", published: false, now: new Date("2026-09-07T19:10:00Z") }).status
    ).toBe("pending");
  });

  it("F. unpublished after 21:15 Paris is missed", () => {
    expect(
      evaluateEditionPublication({ editionDate: "2026-09-07", published: false, now: new Date("2026-09-07T19:16:00Z") }).status
    ).toBe("missed");
  });

  it("H. the deadline follows Paris through DST (21:15 CET is 20:15 UTC in January)", () => {
    expect(
      evaluateEditionPublication({ editionDate: "2026-01-05", published: false, now: new Date("2026-01-05T20:10:00Z") }).status
    ).toBe("pending");
    expect(
      evaluateEditionPublication({ editionDate: "2026-01-05", published: false, now: new Date("2026-01-05T20:16:00Z") }).status
    ).toBe("missed");
  });

  it("a past date that never published is missed the next day too", () => {
    expect(
      evaluateEditionPublication({ editionDate: "2026-09-07", published: false, now: new Date("2026-09-08T06:00:00Z") }).status
    ).toBe("missed");
  });
});

describe("notification-health surfaces a missed edition", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../storage/supabaseClient.js");
  });

  async function runWith(editions: Set<string>, now: Date) {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
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
              data: editions.has(filters.edition_date as string) ? { edition_date: filters.edition_date } : null,
              error: null
            })
          };
          return builder;
        }
      })
    }));

    const { runNotificationHealth, shouldFailNotificationHealth } = await import("../cli/notificationHealth.js");
    const options = { editionDate: null, strict: false, now };
    const output = await runNotificationHealth(options);
    return { output, fails: shouldFailNotificationHealth(output, options), rpc };
  }

  it("F. no edition by the deadline fails the check, even though older editions exist", async () => {
    const { output, fails, rpc } = await runWith(new Set(["2026-09-06", "2026-09-04"]), new Date("2026-09-07T19:30:00Z"));

    expect(output.publication?.status).toBe("missed");
    expect(output.status).toBe("critical");
    expect(fails).toBe(true);
    expect(output.detail).toContain("run_scheduled_publication_tick(true)");
    // It did not quietly fall back to Sunday's edition.
    expect(output.editionDate).toBe("2026-09-07");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("before the deadline it is pending and does not fail", async () => {
    const { output, fails } = await runWith(new Set(["2026-09-06"]), new Date("2026-09-07T17:10:00Z"));

    expect(output.publication?.status).toBe("pending");
    expect(fails).toBe(false);
  });

  it("G. on a quiet day with Monday published, nothing is raised", async () => {
    const { output, fails } = await runWith(new Set(["2026-09-07"]), new Date("2026-09-08T10:00:00Z"));

    expect(output.publication?.status).toBe("published");
    expect(output.editionDate).toBe("2026-09-07");
    expect(fails).toBe(false);
  });
});
