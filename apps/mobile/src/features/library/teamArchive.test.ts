import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";

/**
 * Team content does not disappear when its edition closes.
 *
 * The archive is built from `daily_drop_items`, and Team content has no row
 * there — it reached the reader through an assignment made on a logical key. So
 * an article a Team gave them, which they opened and marked read, would simply
 * be gone the next morning. That is the bug this file exists for.
 *
 * The other half is what must NOT happen: this is not a durable grant. The
 * range RPC applies the same eligibility rule as every other Team surface, and
 * nothing here writes an entitlement row. And it folds content only into
 * editions ALREADY on the page — inventing an entry for a date outside it is
 * how keyset paging comes to repeat or skip an edition.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type QueryCall = { table: string; eq: Array<{ column: string; value: unknown }>; or: string[] };

vi.stubGlobal("__DEV__", false);

const calls: QueryCall[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

let dropRows: Array<Record<string, unknown>> = [];
let dropItemRows: Array<Record<string, unknown>> = [];
let contentRows: Array<Record<string, unknown>> = [];
let teamRows: Array<Record<string, unknown>> = [];
let interactionRows: Array<Record<string, unknown>> = [];

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => createQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });

      return name === "get_my_team_archive_content"
        ? { data: teamRows, error: null }
        : { data: [], error: null };
    }
  },
  isLikelyNetworkError: () => false,
  normalizeSupabaseError: (error: unknown, fallback?: string) => ({
    code: (error as { code?: string })?.code,
    message: (error as { message?: string })?.message ?? fallback ?? "error"
  })
}));

vi.mock("../../lib/mockPolicy", () => ({ allowMockContent: false }));

const { fetchLibraryDrops } = await import("./libraryData");

const loyola = { id: "team-1", name: "Loyola Finance" };

beforeEach(() => {
  clearMemoryCache();
  calls.length = 0;
  rpcCalls.length = 0;
  interactionRows = [];
  dropRows = [drop("drop-2", "2026-09-07"), drop("drop-1", "2026-09-04")];
  contentRows = [story("p-story", "job-story", "The pricing call", "2026-09-07")];
  dropItemRows = [
    {
      daily_drop_id: "drop-2",
      content_item_id: "p-story",
      slot: "business_story",
      position: 0,
      created_at: ""
    }
  ];
  teamRows = [];
});

describe("a Team reading in the archive", () => {
  it("appears in the edition it belonged to, badged, and marked read", async () => {
    givenTeamArchive("2026-09-07", article("t-fin", "job-finance", "The Fed blinked"), [
      loyola
    ]);
    interactionRows = [
      { content_item_id: "t-fin", interaction_type: "complete", user_id: USER }
    ];

    const page = await fetchLibraryDrops(USER, { language: "en" });
    const edition = page.data.find((entry) => entry.drop_date === "2026-09-07");

    expect(page.source).toBe("supabase");
    expect(edition?.items?.map((item) => item.title)).toEqual([
      // Team first, then the reader's own — the order the edition itself used.
      "The Fed blinked",
      "The pricing call"
    ]);
    expect(edition?.items?.[0].teams).toEqual([loyola]);
    expect(edition?.items?.[0].is_completed).toBe(true);
    expect(edition?.completed_item_count).toBe(1);
    expect(edition?.item_count).toBe(2);
  });

  it("is not repeated when the reader also had it personally", async () => {
    // Their own drop carries the same logical article. One row, badged.
    contentRows.push(article("p-fin", "job-finance", "The Fed blinked"));
    dropItemRows.push({
      daily_drop_id: "drop-2",
      content_item_id: "p-fin",
      slot: "newsletter",
      position: 1,
      created_at: ""
    });
    givenTeamArchive("2026-09-07", article("t-fin", "job-finance", "The Fed blinked"), [
      loyola
    ]);

    const page = await fetchLibraryDrops(USER, { language: "en" });
    const edition = page.data.find((entry) => entry.drop_date === "2026-09-07");

    expect(
      edition?.items?.filter((item) => item.title === "The Fed blinked")
    ).toHaveLength(1);
    expect(edition?.item_count).toBe(2);
  });

  it("counts a reading completed in the other language as read", async () => {
    // A Team item has no assigned id, so the row shown changes with the reading
    // language. The interaction was written against the French rendering.
    const french = {
      ...article("t-fin-fr", "job-finance", "La Fed a cligné"),
      language: "fr"
    };
    contentRows.push(french);
    givenTeamArchive("2026-09-07", article("t-fin-en", "job-finance", "The Fed blinked"), [
      loyola
    ]);
    interactionRows = [
      { content_item_id: "t-fin-fr", interaction_type: "complete", user_id: USER }
    ];

    const page = await fetchLibraryDrops(USER, { language: "en" });
    const edition = page.data.find((entry) => entry.drop_date === "2026-09-07");
    const teamItem = edition?.items?.find((item) => item.id === "t-fin-en");

    expect(teamItem?.is_completed).toBe(true);
  });

  it("never invents an edition for a date outside the page", async () => {
    // Keyset paging walks the reader's own drop_dates. An entry for a date the
    // page does not hold would be repeated or skipped by the next page.
    givenTeamArchive("2026-08-01", article("t-old", "job-old", "Older Team article"), [
      loyola
    ]);

    const page = await fetchLibraryDrops(USER, { language: "en" });

    expect(page.data.map((entry) => entry.drop_date)).toEqual(["2026-09-07"]);
    expect(
      page.data.flatMap((entry) => entry.items ?? []).map((item) => item.title)
    ).not.toContain("Older Team article");
  });

  it("asks the Team surface once for the whole page, over its date range", async () => {
    givenTeamArchive("2026-09-07", article("t-fin", "job-finance", "The Fed blinked"), [
      loyola
    ]);

    await fetchLibraryDrops(USER, { language: "en" });

    const archiveCalls = rpcCalls.filter(
      (call) => call.name === "get_my_team_archive_content"
    );

    expect(archiveCalls).toHaveLength(1);
    expect(archiveCalls[0].args).toMatchObject({
      p_from_date: "2026-09-04",
      p_to_date: "2026-09-07"
    });
  });

  it("costs nothing extra for a reader in no Team", async () => {
    await fetchLibraryDrops(USER, { language: "en" });

    // The RPC answers empty, and no content query follows it.
    expect(calls.filter((call) => call.table === "content_items")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------- */
/* The fake database                                                          */
/* ------------------------------------------------------------------------- */

function givenTeamArchive(
  editionDate: string,
  item: Record<string, unknown>,
  teams: Array<{ id: string; name: string | null }>
) {
  if (!contentRows.some((row) => row.id === item.id)) {
    contentRows.push(item);
  }

  teamRows.push({
    content_logical_key: (item.metadata as Record<string, unknown>).staging_job_id,
    content_type: item.content_type,
    display_content_item_id: item.id,
    display_language: item.language,
    topic_id: item.topic_id,
    product_topic: null,
    title: item.title,
    summary: item.summary,
    edition_date: editionDate,
    assignment_position: 1,
    teams
  });
}

function createQuery(table: string) {
  const call: QueryCall = { table, eq: [], or: [] };
  const filters: { ids?: string[] } = {};
  calls.push(call);

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      call.eq.push({ column, value });
      return builder;
    },
    or: (filter: string) => {
      call.or.push(filter);
      return builder;
    },
    in: (column: string, values: string[]) => {
      if (column === "id" || column === "content_item_id") {
        filters.ids = values;
      }

      return builder;
    },
    lt: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null })
  };

  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolveMany(table, call, filters)).then(resolve);

  return builder;
}

function resolveMany(table: string, call: QueryCall, filters: { ids?: string[] }) {
  if (table === "daily_drops") {
    return { data: dropRows, error: null };
  }

  if (table === "daily_drop_items") {
    return { data: dropItemRows, error: null };
  }

  if (table === "content_interactions") {
    return {
      data: interactionRows.filter((row) =>
        (filters.ids ?? []).includes(row.content_item_id as string)
      ),
      error: null
    };
  }

  if (table === "content_items") {
    if (call.or.length > 0) {
      const keys = [...call.or[0].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      const language = call.eq.find((entry) => entry.column === "language")?.value;

      return {
        data: contentRows.filter(
          (row) =>
            keys.includes(
              (row.metadata as Record<string, unknown>).staging_job_id as string
            ) &&
            (language === undefined || row.language === language)
        ),
        error: null
      };
    }

    return {
      data: contentRows.filter((row) => (filters.ids ?? []).includes(row.id as string)),
      error: null
    };
  }

  return { data: [], error: null };
}

function drop(id: string, dropDate: string): Record<string, unknown> {
  return {
    id,
    user_id: USER,
    drop_date: dropDate,
    language: "en",
    status: "published",
    hide_display_date: false,
    generated_at: dropDate,
    published_at: null,
    created_at: "",
    updated_at: ""
  };
}

function contentItem(
  id: string,
  logicalKey: string,
  title: string,
  contentType: string,
  publicationDate = "2026-09-07"
): Record<string, unknown> {
  return {
    id,
    content_type: contentType,
    topic_id: "finance",
    language: "en",
    title,
    summary: `${title} — a short summary.`,
    body_md: `${title} body.`,
    difficulty: "medium",
    estimated_read_seconds: 180,
    publication_date: publicationDate,
    version: 1,
    status: "published",
    generation_run_id: null,
    source_count: 0,
    metadata: { staging_job_id: logicalKey, topic: "finance" },
    created_at: "",
    updated_at: ""
  };
}

function article(id: string, logicalKey: string, title: string) {
  return contentItem(id, logicalKey, title, "newsletter_article");
}

function story(id: string, logicalKey: string, title: string, publicationDate: string) {
  return contentItem(id, logicalKey, title, "business_story", publicationDate);
}
