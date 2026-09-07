import { describe, expect, it, vi } from "vitest";

// Only the pure half of the module is under test here, but importing it pulls
// in the Supabase client — which the whole mobile suite stubs, because the real
// one cannot be loaded under this transform. The fetchers are covered by the
// edition tests, which drive them through a fake client.
vi.mock("../../lib/supabase", () => ({ supabase: null }));

import {
  indexTeamAssignmentsByIdentity,
  parseTeamContentAssignments,
  parseTeamRefs,
  teamContentIdentity
} from "./teamEditionContent";

/**
 * The seam where database JSON becomes typed application data.
 *
 * Everything here is about what must NOT get through. A malformed row must drop
 * out rather than reach a screen; a Business Story must be refused even if one
 * somehow appears, because Business Story is Solo and the schema refusing it is
 * only one of the two places that has to say so; and a moderated team name must
 * arrive as null rather than as a placeholder the badge would print.
 */

const loyola = { id: "team-1", name: "Loyola Finance" };
const tennis = { id: "team-2", name: "Tennis Team" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    content_logical_key: "job-finance",
    content_type: "newsletter_article",
    display_content_item_id: "item-en",
    display_language: "en",
    topic_id: "finance",
    product_topic: null,
    title: "The Fed blinked",
    summary: "A short summary.",
    edition_date: "2026-09-07",
    assignment_position: 1,
    teams: [loyola],
    ...overrides
  };
}

describe("parsing the Team edition", () => {
  it("reads a well-formed row", () => {
    const [assignment] = parseTeamContentAssignments([row()]);

    expect(assignment).toMatchObject({
      contentLogicalKey: "job-finance",
      contentType: "newsletter_article",
      displayContentItemId: "item-en",
      displayLanguage: "en",
      editionDate: "2026-09-07",
      position: 1
    });
    expect(assignment.teams).toEqual([loyola]);
  });

  it("refuses a Business Story, which is Solo", () => {
    // The schema refuses the content type outright. This is the second place
    // that says so, and it is the one that would stop a badge appearing if the
    // first were ever edited.
    expect(
      parseTeamContentAssignments([row({ content_type: "business_story" })])
    ).toEqual([]);
    expect(parseTeamContentAssignments([row({ content_type: "concept" })])).toEqual([]);
  });

  it("drops a row missing the identity it would be merged on", () => {
    for (const broken of [
      row({ content_logical_key: null }),
      row({ content_logical_key: "  " }),
      row({ display_content_item_id: null })
    ]) {
      expect(parseTeamContentAssignments([broken])).toEqual([]);
    }
  });

  it("survives anything that is not an array of rows", () => {
    for (const value of [null, undefined, "nope", 3, {}]) {
      expect(parseTeamContentAssignments(value)).toEqual([]);
    }

    expect(parseTeamContentAssignments([null, undefined, 7])).toEqual([]);
  });

  it("orders by the Team's own position, then by key", () => {
    const assignments = parseTeamContentAssignments([
      row({ content_logical_key: "job-c", assignment_position: 3 }),
      row({ content_logical_key: "job-b", assignment_position: 1 }),
      row({ content_logical_key: "job-a", assignment_position: 1 })
    ]);

    expect(assignments.map((entry) => entry.contentLogicalKey)).toEqual([
      "job-a",
      "job-b",
      "job-c"
    ]);
  });

  it("defaults an unreadable position to zero rather than to NaN", () => {
    // NaN in a sort comparator silently returns whatever order it started in.
    const [assignment] = parseTeamContentAssignments([
      row({ assignment_position: "not a number" })
    ]);

    expect(assignment.position).toBe(0);
  });
});

describe("team refs", () => {
  it("keeps a hidden name null rather than inventing one", () => {
    expect(parseTeamRefs([{ id: "team-1", name: null }])).toEqual([
      { id: "team-1", name: null }
    ]);
    expect(parseTeamRefs([{ id: "team-1", name: "   " }])).toEqual([
      { id: "team-1", name: null }
    ]);
  });

  it("drops a ref with no id and never repeats a team", () => {
    expect(parseTeamRefs([{ name: "No id" }, loyola, loyola])).toEqual([loyola]);
  });

  it("survives a malformed block", () => {
    for (const value of [null, "nope", [null], [3]]) {
      expect(() => parseTeamRefs(value)).not.toThrow();
    }
  });
});

describe("indexing by logical identity", () => {
  it("keys on content type and logical key together", () => {
    // A mini case and a newsletter article from one staging batch can share a
    // logical key; collapsing them would lose a reading.
    expect(
      teamContentIdentity({ contentLogicalKey: "job-1", contentType: "mini_case" })
    ).not.toBe(
      teamContentIdentity({
        contentLogicalKey: "job-1",
        contentType: "newsletter_article"
      })
    );
  });

  it("folds two Teams assigned the same article into one entry", () => {
    const index = indexTeamAssignmentsByIdentity(
      parseTeamContentAssignments([
        row({ teams: [loyola], assignment_position: 4 }),
        row({ teams: [tennis], assignment_position: 2 })
      ])
    );

    expect(index.size).toBe(1);

    const entry = index.get(
      teamContentIdentity({
        contentLogicalKey: "job-finance",
        contentType: "newsletter_article"
      })
    );

    // Listed in assignment order, not in the order the rows arrived: the Team
    // that placed the article earliest is named first, and that is also the
    // position the merged entry takes.
    expect(entry?.teams).toEqual([tennis, loyola]);
    expect(entry?.position).toBe(2);
  });

  it("never lists the same team twice for one article", () => {
    // A Team assigned both language renderings of one job.
    const index = indexTeamAssignmentsByIdentity(
      parseTeamContentAssignments([
        row({ teams: [loyola], display_content_item_id: "item-en" }),
        row({ teams: [loyola], display_content_item_id: "item-fr" })
      ])
    );

    expect([...index.values()][0].teams).toEqual([loyola]);
  });
});
