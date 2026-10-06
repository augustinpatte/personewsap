import { describe, expect, it, vi } from "vitest";

import { ContentRepository } from "./contentRepository.js";
import {
  assertBreakGlassTarget,
  PRODUCTION_PROJECT_REF,
  projectRefFromSupabaseUrl,
  ProjectTargetError,
  STAGING_PROJECT_REF
} from "./projectRef.js";
import { PublishedEditionError } from "./publishedEditionGuard.js";

/**
 * The application-side half of published-edition immutability (the database
 * half is supabase/tests/published_edition_immutability.test.sql): the legacy
 * and break-glass writers stop before writing a published date, and the
 * break-glass publisher refuses to write into the wrong project.
 */

function fakeSupabase(editions: Record<string, string>) {
  const reads: string[] = [];
  const writes: string[] = [];

  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        in: () => builder,
        maybeSingle: async () => {
          reads.push(table);
          const date = filters.edition_date as string;
          return { data: editions[date] ? { edition_date: date, published_at: editions[date] } : null, error: null };
        },
        upsert: () => {
          writes.push(table);
          return builder;
        },
        returns: () => Promise.resolve({ data: [], error: null })
      };
      return builder;
    }
  };

  return { client, reads, writes };
}

describe("ContentRepository refuses published dates", () => {
  it("names the recovery path when the date is published", async () => {
    const { client } = fakeSupabase({ "2026-09-07": "2026-09-07T17:00:03Z" });
    const repository = new ContentRepository(client as never);

    const refusal = repository.assertEditionNotPublished("2026-09-07", "The legacy daily job");

    await expect(refusal).rejects.toBeInstanceOf(PublishedEditionError);
    await expect(refusal).rejects.toThrow(/2026-09-07 is already published/);
    await expect(refusal).rejects.toThrow(/run_scheduled_publication_tick\(true\)/);
    await expect(refusal).rejects.toThrow(/allow_edition_rewrite/);
  });

  it("lets an unpublished date through", async () => {
    const { client } = fakeSupabase({});
    const repository = new ContentRepository(client as never);

    await expect(repository.assertEditionNotPublished("2026-09-09", "x")).resolves.toBeUndefined();
  });

  it("reads a published date once, not once per reader", async () => {
    const { client, reads } = fakeSupabase({ "2026-09-07": "2026-09-07T17:00:03Z" });
    const repository = new ContentRepository(client as never);

    for (let reader = 0; reader < 5; reader += 1) {
      await repository.assertEditionNotPublished("2026-09-07", "x").catch(() => undefined);
    }

    expect(reads).toEqual(["editions"]);
  });

  it("refuses a drop write for a published date before touching daily_drops", async () => {
    const { client, writes } = fakeSupabase({ "2026-09-07": "2026-09-07T17:00:03Z" });
    const repository = new ContentRepository(client as never);
    const listSpy = vi.spyOn(repository, "listDailyDropsForUsersOnDate");

    await expect(
      repository.createDailyDropForUserWithResult({
        userId: "user-1",
        dropDate: "2026-09-07",
        language: "fr",
        status: "published",
        itemIds: []
      })
    ).rejects.toBeInstanceOf(PublishedEditionError);

    expect(listSpy).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe("the break-glass publisher writes only where the batch says", () => {
  const production = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
  const staging = `https://${STAGING_PROJECT_REF}.supabase.co`;

  it("accepts production for a production batch", () => {
    expect(
      assertBreakGlassTarget({ productionUrl: production, stagingUrl: staging, batchTargetRef: PRODUCTION_PROJECT_REF })
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("refuses SUPABASE_URL pointing at staging", () => {
    expect(() =>
      assertBreakGlassTarget({ productionUrl: staging, stagingUrl: staging, batchTargetRef: PRODUCTION_PROJECT_REF })
    ).toThrow(ProjectTargetError);
  });

  it("refuses a project the batch does not target", () => {
    expect(() =>
      assertBreakGlassTarget({
        productionUrl: "https://someotherproject.supabase.co",
        stagingUrl: staging,
        batchTargetRef: PRODUCTION_PROJECT_REF
      })
    ).toThrow(/batch targets wkbviidrbmehmjbhvpeh/);
  });

  it("refuses a URL that names no project", () => {
    expect(() =>
      assertBreakGlassTarget({ productionUrl: "http://localhost:54321", stagingUrl: staging, batchTargetRef: null })
    ).toThrow(ProjectTargetError);
  });

  it("parses project refs strictly", () => {
    expect(projectRefFromSupabaseUrl(production)).toBe(PRODUCTION_PROJECT_REF);
    expect(projectRefFromSupabaseUrl(`${production}/rest/v1`)).toBe(PRODUCTION_PROJECT_REF);
    expect(projectRefFromSupabaseUrl("https://evil.example/https://x.supabase.co")).toBeNull();
    expect(projectRefFromSupabaseUrl(undefined)).toBeNull();
  });
});
