import { describe, expect, it } from "vitest";

import {
  contentIdentity,
  describeEntryTeams,
  mergeTeamAndPersonalContent,
  mergedItems,
  type MergeableContent
} from "./teamMerge";

/**
 * One edition assembled from two sources.
 *
 * The case that decides whether this is right: a reader whose personal edition
 * carries Finance, and whose two Teams were both assigned the same Finance
 * article. They must see it ONCE, badged with both Teams, and answering it must
 * be one session. Getting that wrong ships a Newsletter tab with the same
 * headline three times.
 */

type Item = MergeableContent & { title: string };

function item(id: string, logicalKey: string | null, title = id): Item {
  return { id, contentLogicalKey: logicalKey, title };
}

const loyola = { id: "team-1", name: "Loyola Finance" };
const tennis = { id: "team-2", name: "Tennis Team" };

describe("content identity", () => {
  it("uses the logical key, so two languages are one article", () => {
    // The FR and EN renderings are different rows with different ids.
    expect(contentIdentity(item("row-en", "job-1"))).toBe(
      contentIdentity(item("row-fr", "job-1"))
    );
  });

  it("falls back to the row id when there is no logical key", () => {
    expect(contentIdentity(item("row-a", null))).toBe("item:row-a");
    expect(contentIdentity(item("row-a", "   "))).toBe("item:row-a");
  });

  it("never collides a logical key with a row id", () => {
    expect(contentIdentity(item("x", "x"))).not.toBe(contentIdentity(item("x", null)));
  });
});

describe("order", () => {
  it("puts Team content before personal content", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: loyola, item: item("t1", "job-t") }],
      personalItems: [item("p1", "job-p")]
    });

    expect(merged.map((entry) => entry.item.id)).toEqual(["t1", "p1"]);
    expect(merged[0].source).toBe("team");
    expect(merged[1].source).toBe("personal");
  });

  it("keeps the team's own assignment order", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [
        { team: loyola, item: item("b", "job-b"), position: 2 },
        { team: loyola, item: item("a", "job-a"), position: 1 }
      ],
      personalItems: []
    });

    expect(merged.map((entry) => entry.item.id)).toEqual(["a", "b"]);
  });

  it("keeps personal order among personal items", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [],
      personalItems: [item("p1", "job-1"), item("p2", "job-2"), item("p3", "job-3")]
    });

    expect(mergedItems(merged).map((entry) => entry.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("deduplication", () => {
  it("shows one article when personal and one Team both carry it", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: loyola, item: item("team-row", "finance-1") }],
      personalItems: [item("personal-row", "finance-1")]
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("team");
    // The Team row is the one kept: it is the id the backend scores against.
    expect(merged[0].item.id).toBe("team-row");
    expect(merged[0].inPersonalEdition).toBe(true);
  });

  it("shows one article when two Teams and the reader all carry it", () => {
    // Personal = Finance, Team A = Finance, Team B = Finance. Once, two badges.
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [
        { team: loyola, item: item("team-a-row", "finance-1") },
        { team: tennis, item: item("team-b-row", "finance-1") }
      ],
      personalItems: [item("personal-row", "finance-1")]
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].teams.map((team) => team.id)).toEqual(["team-1", "team-2"]);
    expect(merged[0].inPersonalEdition).toBe(true);
  });

  it("deduplicates across languages, not by row id", () => {
    // The regression this whole identity rule exists for: the Team was assigned
    // the French rendering and the personal edition holds the English one.
    // Deduplicating on the row id would show the article twice.
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: loyola, item: item("row-fr", "job-1", "Article FR") }],
      personalItems: [item("row-en", "job-1", "Article EN")]
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].item.id).toBe("row-fr");
  });

  it("never lists the same Team twice", () => {
    // A Team assigned both language renderings of one article.
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [
        { team: loyola, item: item("row-en", "job-1") },
        { team: loyola, item: item("row-fr", "job-1") }
      ],
      personalItems: []
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].teams).toHaveLength(1);
  });

  it("keeps two genuinely different articles apart", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: loyola, item: item("t", "job-1") }],
      personalItems: [item("p", "job-2")]
    });

    expect(merged).toHaveLength(2);
  });

  it("does not merge keyless legacy items with each other", () => {
    // Two items with no logical key are only ever themselves; merging them would
    // hide one of them on the strength of nothing.
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [],
      personalItems: [item("a", null), item("b", null)]
    });

    expect(merged).toHaveLength(2);
  });
});

describe("the Team + Solo collision", () => {
  it("presents the content as Team when any Team assignment exists", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: loyola, item: item("t", "job-1") }],
      personalItems: [item("p", "job-1")]
    });

    // Played once, presented as Team, and the personal route is not forgotten:
    // the reader's own progress still counts it.
    expect(merged[0].source).toBe("team");
    expect(merged[0].inPersonalEdition).toBe(true);
  });

  it("marks a purely personal item as personal with no teams", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [],
      personalItems: [item("p", "job-1")]
    });

    expect(merged[0].source).toBe("personal");
    expect(merged[0].teams).toEqual([]);
    expect(merged[0].inPersonalEdition).toBe(true);
  });

  it("marks a purely Team item as not in the personal edition", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: loyola, item: item("t", "job-1") }],
      personalItems: []
    });

    expect(merged[0].inPersonalEdition).toBe(false);
  });
});

describe("badges", () => {
  it("describes a single-team entry", () => {
    const [entry] = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: loyola, item: item("t", "job-1") }],
      personalItems: []
    });

    const described = describeEntryTeams(entry);

    expect(described.isTeam).toBe(true);
    expect(described.primary?.name).toBe("Loyola Finance");
    expect(described.extra).toEqual([]);
  });

  it("describes a multi-team entry without flattening it to text", () => {
    // Returned as data so the badge can be rendered in the product's own type
    // rather than as a pre-baked "Loyola Finance +1" string.
    const [entry] = mergeTeamAndPersonalContent({
      teamAssignments: [
        { team: loyola, item: item("a", "job-1") },
        { team: tennis, item: item("b", "job-1") }
      ],
      personalItems: []
    });

    const described = describeEntryTeams(entry);

    expect(described.primary?.name).toBe("Loyola Finance");
    expect(described.extra.map((team) => team.name)).toEqual(["Tennis Team"]);
  });

  it("survives a moderated team name", () => {
    const [entry] = mergeTeamAndPersonalContent({
      teamAssignments: [{ team: { id: "t", name: null }, item: item("a", "job-1") }],
      personalItems: []
    });

    expect(describeEntryTeams(entry).primary?.name).toBeNull();
  });

  it("reports a personal entry as not a Team entry", () => {
    const [entry] = mergeTeamAndPersonalContent({
      teamAssignments: [],
      personalItems: [item("p", "job-1")]
    });

    expect(describeEntryTeams(entry).isTeam).toBe(false);
  });
});

describe("empty inputs", () => {
  it("returns nothing for an empty edition", () => {
    expect(mergeTeamAndPersonalContent({ teamAssignments: [], personalItems: [] })).toEqual([]);
  });

  it("works with no Teams at all, which is most readers", () => {
    const merged = mergeTeamAndPersonalContent({
      teamAssignments: [],
      personalItems: [item("a", "job-1"), item("b", "job-2")]
    });

    expect(merged).toHaveLength(2);
    expect(merged.every((entry) => entry.source === "personal")).toBe(true);
  });
});
