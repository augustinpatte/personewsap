import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMemoryCache } from "../../lib/memoryCache";

/**
 * One edition, two sources — driven end to end through a fake Postgres.
 *
 * These are the cases that decide whether the feature is real, and every one of
 * them was checked against the shape the RPC actually returns rather than
 * against the shape it would be convenient for it to return:
 *
 *   A TEAM-ONLY ARTICLE ARRIVES AT ALL. It has no daily_drop_items row. If the
 *   loader only reads the reader's own drop, a Finance article their Team was
 *   given simply does not exist in the app, and every unit test still passes.
 *
 *   AN OVERLAP IS ONE ARTICLE. Personal + Team A + Team B is one card with two
 *   badges, not three cards. And the identity that decides this is the LOGICAL
 *   key: a reader holding the English rendering while their Team was assigned
 *   the French one has one article. Deduplicating on the row id looks correct
 *   in a single-language test and ships a duplicate the first time somebody
 *   switches language.
 *
 *   TEAM FIRST, PERSONAL AFTER, PER SECTION. The Newsletter lead has to be a
 *   newsletter article, not whichever mini case sorted first.
 *
 *   MINI CASES ARE PLURAL. One reader can be handed a Finance case by one Team,
 *   an AI case by another and their own Law case the same morning. The singular
 *   field could only ever show one of the three.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EDITION = "2026-09-07";

type QueryCall = { table: string; eq: Array<{ column: string; value: unknown }>; or: string[] };

vi.stubGlobal("__DEV__", false);

const calls: QueryCall[] = [];
/** Set by the "Team surface fails" case: the RPC throws rather than answering. */
let rpcThrows = false;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

/** The rows the fake database holds for one test. */
let contentRows: Array<Record<string, unknown>> = [];
let dropItemRows: Array<Record<string, unknown>> = [];
let dropRow: Record<string, unknown> | null = null;
let teamRows: Array<Record<string, unknown>> = [];
let questionRows: Array<Record<string, unknown>> = [];

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => createQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });

      if (rpcThrows) {
        throw new Error("network down");
      }

      return name === "get_my_team_edition_content"
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

const { fetchTodayDrop } = await import("./dailyDropData");

const loyola = { id: "team-1", name: "Loyola Finance" };
const tennis = { id: "team-2", name: "Tennis Team" };

beforeEach(() => {
  clearMemoryCache();
  calls.length = 0;
  rpcCalls.length = 0;
  contentRows = [];
  dropItemRows = [];
  teamRows = [];
  questionRows = [];
  dropRow = {
    id: "drop-1",
    user_id: USER,
    drop_date: EDITION,
    language: "en",
    status: "published",
    hide_display_date: false,
    generated_at: EDITION,
    published_at: null,
    created_at: "",
    updated_at: ""
  };
});

describe("a personal edition plus a Team edition", () => {
  it("shows a Team-only article the reader's own drop does not carry", async () => {
    givenPersonal([article("p-tech", "job-tech", "Chips and constraints", "tech_ai")]);
    givenTeam([
      {
        item: article("t-fin", "job-finance", "The Fed blinked", "finance"),
        teams: [loyola],
        position: 1
      }
    ]);

    const drop = await loadEdition();
    const titles = drop.items.newsletter.map((item) => item.title);

    expect(titles).toContain("The Fed blinked");
    // Team first, personal after.
    expect(titles).toEqual(["The Fed blinked", "Chips and constraints"]);
    expect(drop.items.newsletter[0].teams).toEqual([loyola]);
    expect(drop.items.newsletter[1].teams).toBeUndefined();
  });

  it("badges the reader's own copy of an article a Team was also assigned", async () => {
    // The overlap case, and the one most easily missed: nothing new arrives, so
    // a loader that only fetched Team-ONLY content would show no badge at all.
    givenPersonal([article("p-fin", "job-finance", "The Fed blinked", "finance")]);
    givenTeam([
      {
        item: article("t-fin", "job-finance", "The Fed blinked", "finance"),
        teams: [loyola],
        position: 1
      }
    ]);

    const drop = await loadEdition();

    expect(drop.items.newsletter).toHaveLength(1);
    // The reader's OWN row id survives, because that is what their interactions
    // and their drop assignment are anchored to.
    expect(drop.items.newsletter[0].id).toBe("p-fin");
    expect(drop.items.newsletter[0].teams).toEqual([loyola]);
  });

  it("shows an article two Teams were both assigned once, with both badges", async () => {
    givenTeam([
      {
        item: article("t-fin", "job-finance", "The Fed blinked", "finance"),
        teams: [loyola, tennis],
        position: 1
      }
    ]);

    const drop = await loadEdition();

    expect(drop.items.newsletter).toHaveLength(1);
    expect(drop.items.newsletter[0].teams).toEqual([loyola, tennis]);
  });

  it("deduplicates across languages, not across row ids", async () => {
    // The reader's drop holds the ENGLISH rendering; the Team was assigned the
    // FRENCH one. Two rows, two ids, one article.
    givenPersonal([article("p-fin-en", "job-finance", "The Fed blinked", "finance")]);
    givenTeam([
      {
        item: {
          ...article("p-fin-fr", "job-finance", "La Fed a cligné", "finance"),
          language: "fr"
        },
        teams: [tennis],
        position: 1
      }
    ]);

    const drop = await loadEdition();

    expect(drop.items.newsletter).toHaveLength(1);
    expect(drop.items.newsletter[0].id).toBe("p-fin-en");
    expect(drop.items.newsletter[0].teams).toEqual([tennis]);
  });

  it("keeps the sections apart: the Newsletter lead is a newsletter article", async () => {
    givenPersonal([article("p-tech", "job-tech", "Chips and constraints", "tech_ai")]);
    givenTeam([
      { item: miniCase("t-case", "job-case-fin", "Price the risk"), teams: [loyola], position: 1 }
    ]);

    const drop = await loadEdition();

    expect(drop.items.newsletter.map((item) => item.title)).toEqual([
      "Chips and constraints"
    ]);
    expect(drop.items.mini_cases.map((item) => item.title)).toEqual(["Price the risk"]);
  });
});

describe("mini cases are plural", () => {
  it("carries a Team case, another Team's case and the reader's own", async () => {
    givenPersonal([miniCase("p-law", "job-case-law", "Read the clause")]);
    givenTeam([
      {
        item: miniCase("t-fin", "job-case-fin", "Price the risk"),
        teams: [loyola],
        position: 1
      },
      {
        item: miniCase("t-ai", "job-case-ai", "Ship the model"),
        teams: [tennis],
        position: 2
      }
    ]);

    const drop = await loadEdition();

    expect(drop.items.mini_cases.map((item) => item.title)).toEqual([
      "Price the risk",
      "Ship the model",
      "Read the clause"
    ]);
    // The legacy alias is the first entry and never a second source of truth.
    expect(drop.items.mini_case).toBe(drop.items.mini_cases[0]);
  });

  it("shows a case two Teams chose once", async () => {
    givenTeam([
      {
        item: miniCase("t-fin", "job-case-fin", "Price the risk"),
        teams: [loyola, tennis],
        position: 1
      }
    ]);

    const drop = await loadEdition();

    expect(drop.items.mini_cases).toHaveLength(1);
    expect(drop.items.mini_cases[0].teams).toEqual([loyola, tennis]);
  });
});

describe("what it costs", () => {
  it("reads the Team surface once, however many Teams the reader is in", async () => {
    givenPersonal([article("p-tech", "job-tech", "Chips and constraints", "tech_ai")]);
    givenTeam([
      { item: article("t-a", "job-a", "A", "finance"), teams: [loyola, tennis], position: 1 },
      { item: article("t-b", "job-b", "B", "finance"), teams: [loyola], position: 2 },
      { item: miniCase("t-c", "job-c", "C"), teams: [tennis], position: 3 }
    ]);

    await loadEdition();

    expect(rpcCalls.filter((call) => call.name === "get_my_team_edition_content")).toHaveLength(1);
    // One query for the personal rows, one for every Team-only rendering.
    expect(calls.filter((call) => call.table === "content_items")).toHaveLength(2);
    expect(calls.filter((call) => call.table === "content_item_sources")).toHaveLength(1);
    expect(calls.filter((call) => call.table === "logical_questions")).toHaveLength(1);
  });

  it("costs a reader in no Team nothing but the one empty call", async () => {
    givenPersonal([article("p-tech", "job-tech", "Chips and constraints", "tech_ai")]);

    await loadEdition();

    // No Team content means no second content query: the fetch is skipped, not
    // issued with an empty filter.
    expect(calls.filter((call) => call.table === "content_items")).toHaveLength(1);
  });
});

describe("Team content is additive, never load-bearing", () => {
  it("still serves the personal edition when the Team surface fails", async () => {
    givenPersonal([article("p-tech", "job-tech", "Chips and constraints", "tech_ai")]);
    teamRows = [];
    rpcThrows = true;

    const drop = await loadEdition();

    expect(drop.items.newsletter.map((item) => item.title)).toEqual([
      "Chips and constraints"
    ]);

    rpcThrows = false;
  });

  it("makes an edition out of Team content alone when there is no personal drop", async () => {
    // Every module switched off, or an account created after the personal
    // build ran. The reader is not shown the empty-edition screen.
    dropRow = null;
    givenTeam([
      {
        item: article("t-fin", "job-finance", "The Fed blinked", "finance"),
        teams: [loyola],
        position: 1
      }
    ]);

    const result = await fetchTodayDrop(USER, EDITION, { language: "en" });

    expect(result.source).toBe("supabase");
    expect(result.data.items.newsletter.map((item) => item.title)).toEqual([
      "The Fed blinked"
    ]);
  });

  it("carries the other renderings of a Team item so completion survives a switch", async () => {
    // A Team item has no drop row to pin an id to, so the row on screen changes
    // with the reading language. The siblings travel with it; DailyDropContext
    // looks completion up across all of them.
    const fr = {
      ...article("t-fin-fr", "job-finance", "La Fed a cligné", "finance"),
      language: "fr"
    };
    givenTeam([
      {
        item: article("t-fin-en", "job-finance", "The Fed blinked", "finance"),
        teams: [loyola],
        position: 1,
        alsoPublished: [fr]
      }
    ]);

    const drop = await loadEdition();

    expect(drop.items.newsletter[0].id).toBe("t-fin-en");
    expect(drop.items.newsletter[0].translation_ids).toEqual(["t-fin-fr"]);
  });
});

/* ------------------------------------------------------------------------- */
/* The fake database                                                          */
/* ------------------------------------------------------------------------- */

/**
 * A LOGICAL KEY IS NOT AN IDENTITY ON ITS OWN.
 *
 * `logical_questions` is unique on (content_logical_key, content_type,
 * question_sequence) — the content type is part of the key, and the client
 * fetches by logical key alone because that is all PostgREST can filter here.
 * Grouping the answer by the key alone hands a newsletter article the mini
 * case's three questions as well as its own two.
 *
 * Not cosmetic. The three extra questions were never assigned to this reader,
 * so `start_question_attempt` refuses each one with 42501, and the flow stops
 * on a "Retry" it can never get past: the question on screen is the first
 * unsettled one, and a failed start never settles.
 */
describe("questions belong to a content type, not only to a logical key", () => {
  const questionRow = (
    id: string,
    contentType: string,
    logicalKey: string,
    sequence: number,
    role: string | null
  ) => ({
    id,
    content_logical_key: logicalKey,
    content_type: contentType,
    question_sequence: sequence,
    question_role: role
  });

  it("does not hand a newsletter article a mini case's questions", async () => {
    // One staging batch, one key, two content types — which the table permits.
    givenPersonal([
      article("p-fin", "job-shared", "The Fed blinked", "finance"),
      miniCase("p-case", "job-shared", "Price the risk")
    ]);

    questionRows = [
      questionRow("q-n1", "newsletter_article", "job-shared", 1, "interpretation"),
      questionRow("q-n2", "newsletter_article", "job-shared", 2, "application_decision"),
      questionRow("q-c1", "mini_case", "job-shared", 1, "method_framework"),
      questionRow("q-c2", "mini_case", "job-shared", 2, "technical_application"),
      questionRow("q-c3", "mini_case", "job-shared", 3, "conclusion_decision")
    ];

    const drop = await loadEdition();
    const newsletter = drop.items.newsletter[0] as unknown as {
      logical_questions?: Array<{ logical_question_id: string }>;
    };
    const miniCaseItem = drop.items.mini_cases[0] as unknown as {
      logical_questions?: Array<{ logical_question_id: string }>;
    };

    expect(newsletter.logical_questions?.map((q) => q.logical_question_id)).toEqual([
      "q-n1",
      "q-n2"
    ]);
    expect(miniCaseItem.logical_questions?.map((q) => q.logical_question_id)).toEqual([
      "q-c1",
      "q-c2",
      "q-c3"
    ]);
  });

  it("still attaches the questions of a content type that has them alone", async () => {
    givenPersonal([article("p-fin", "job-finance", "The Fed blinked", "finance")]);

    questionRows = [
      questionRow("q-1", "newsletter_article", "job-finance", 1, "interpretation"),
      questionRow("q-2", "newsletter_article", "job-finance", 2, "application_decision")
    ];

    const drop = await loadEdition();
    const newsletter = drop.items.newsletter[0] as unknown as {
      logical_questions?: Array<{ logical_question_id: string }>;
    };

    expect(newsletter.logical_questions).toHaveLength(2);
  });
});

async function loadEdition() {
  const result = await fetchTodayDrop(USER, EDITION, { language: "en" });

  expect(result.source).toBe("supabase");

  return result.data;
}

function givenPersonal(items: Array<Record<string, unknown>>) {
  contentRows.push(...items);
  dropItemRows.push(
    ...items.map((item, index) => ({
      daily_drop_id: "drop-1",
      content_item_id: item.id,
      slot: item.content_type === "mini_case" ? "mini_case" : "newsletter",
      position: index,
      created_at: ""
    }))
  );
}

function givenTeam(
  entries: Array<{
    item: Record<string, unknown>;
    teams: Array<{ id: string; name: string | null }>;
    position: number;
    /** Other renderings of the same logical content that exist in the table. */
    alsoPublished?: Array<Record<string, unknown>>;
  }>
) {
  for (const entry of entries) {
    // Only pushed to content_items if it is not already the reader's own row:
    // the overlap tests hand the same logical key to both sources.
    if (!contentRows.some((row) => row.id === entry.item.id)) {
      contentRows.push(entry.item);
    }

    contentRows.push(...(entry.alsoPublished ?? []));

    teamRows.push({
      content_logical_key: (entry.item.metadata as Record<string, unknown>).staging_job_id,
      content_type: entry.item.content_type,
      display_content_item_id: entry.item.id,
      display_language: entry.item.language,
      topic_id: entry.item.topic_id,
      product_topic: null,
      title: entry.item.title,
      summary: entry.item.summary,
      edition_date: EDITION,
      assignment_position: entry.position,
      teams: entry.teams
    });
  }
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
      if (column === "id") {
        filters.ids = values;
      }

      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve(
        table === "daily_drops" ? { data: dropRow, error: null } : { data: null, error: null }
      )
  };

  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolveMany(table, call, filters)).then(resolve);

  return builder;
}

function resolveMany(
  table: string,
  call: QueryCall,
  filters: { ids?: string[] }
) {
  if (table === "daily_drop_items") {
    // Scoped by `eq("daily_drop_id", …)`, and this fake holds exactly one drop.
    return { data: dropItemRows, error: null };
  }

  if (table === "content_items") {
    // The logical-key query: an `or` over the three metadata key fields.
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

  if (table === "logical_questions") {
    // Filtered on content_logical_key only, exactly as the client filters it —
    // so a test can hand back the collision the real table permits.
    return { data: questionRows, error: null };
  }

  return { data: [], error: null };
}

function article(
  id: string,
  logicalKey: string,
  title: string,
  topicId: string
): Record<string, unknown> {
  return {
    id,
    content_type: "newsletter_article",
    topic_id: topicId,
    language: "en",
    title,
    summary: `${title} — a short summary.`,
    body_md: `${title} body.`,
    difficulty: "medium",
    estimated_read_seconds: 180,
    publication_date: EDITION,
    version: 1,
    status: "published",
    generation_run_id: null,
    source_count: 0,
    metadata: { staging_job_id: logicalKey, topic: topicId, why_it_matters: "Because." },
    created_at: "",
    updated_at: ""
  };
}

function miniCase(id: string, logicalKey: string, title: string): Record<string, unknown> {
  return {
    id,
    content_type: "mini_case",
    topic_id: "finance",
    language: "en",
    title,
    summary: `${title} — the challenge.`,
    body_md: `${title} context.`,
    difficulty: "medium",
    estimated_read_seconds: 240,
    publication_date: EDITION,
    version: 1,
    status: "published",
    generation_run_id: null,
    source_count: 0,
    metadata: {
      staging_job_id: logicalKey,
      topic: "finance",
      challenge: "Decide.",
      context: "A situation.",
      question: "What do you do?",
      constraints: ["One week."]
    },
    created_at: "",
    updated_at: ""
  };
}
