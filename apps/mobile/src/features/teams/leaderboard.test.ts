import { describe, expect, it } from "vitest";

import {
  LEADERBOARD_RANGES,
  displayIdentity,
  editionStatus,
  findSelf,
  formatTeamPoints,
  rankLeaderboard,
  teamEditionProgress,
  type LeaderboardMember
} from "./leaderboard";

/**
 * The standing, and what it is not allowed to do.
 *
 * Two properties carry this file. Ties stay ties — inventing a tie-break on
 * time would smuggle a speed bonus into a product that deliberately has none.
 * And blocking somebody hides their name, never their points: a leaderboard
 * that quietly dropped a competitor's score would be lying to everyone else
 * about the standing.
 */

function member(overrides: Partial<LeaderboardMember> = {}): LeaderboardMember {
  return {
    userId: "user-a",
    username: "augustin",
    countryCode: "FR",
    avatarPath: "avatars/user-a/1.jpg",
    scoreMilli: 1000,
    answeredCount: 2,
    assignedCount: 2,
    editionsCompleted: 3,
    ...overrides
  };
}

describe("the three ranges", () => {
  it("offers exactly Current Edition, This Week and All Time", () => {
    // No divisions, no tiers, no Bronze/Silver/Gold.
    expect(LEADERBOARD_RANGES).toEqual(["edition", "week", "all_time"]);
    expect(LEADERBOARD_RANGES).toHaveLength(3);
  });
});

describe("edition status", () => {
  it("reads from answers, not from presence", () => {
    expect(editionStatus({ answeredCount: 0, assignedCount: 3 })).toBe("not_started");
    expect(editionStatus({ answeredCount: 1, assignedCount: 3 })).toBe("in_progress");
    expect(editionStatus({ answeredCount: 3, assignedCount: 3 })).toBe("completed");
  });

  it("treats an edition with nothing assigned as not started", () => {
    // Not "completed": finishing zero questions is not an achievement, and a
    // member who was assigned nothing must not read as having finished.
    expect(editionStatus({ answeredCount: 0, assignedCount: 0 })).toBe("not_started");
  });

  it("does not break if answers exceed assignments", () => {
    expect(editionStatus({ answeredCount: 4, assignedCount: 3 })).toBe("completed");
  });
});

describe("ranking", () => {
  it("orders by score, highest first", () => {
    const rows = rankLeaderboard({
      members: [
        member({ userId: "a", scoreMilli: 600 }),
        member({ userId: "b", scoreMilli: 1800 }),
        member({ userId: "c", scoreMilli: 1200 })
      ],
      selfUserId: "a"
    });

    expect(rows.map((row) => row.userId)).toEqual(["b", "c", "a"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("gives tied members the same rank and skips the next one", () => {
    // Standard competition ranking: 1, 2, 2, 4. Nothing separates the two on
    // 1,800 — and nothing should.
    const rows = rankLeaderboard({
      members: [
        member({ userId: "a", scoreMilli: 2000 }),
        member({ userId: "b", scoreMilli: 1800 }),
        member({ userId: "c", scoreMilli: 1800 }),
        member({ userId: "d", scoreMilli: 600 })
      ],
      selfUserId: "a"
    });

    expect(rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });

  it("never breaks a tie on anything time-related", () => {
    // The rows carry no timestamp at all, which is what makes a speed tie-break
    // impossible here rather than merely avoided.
    const rows = rankLeaderboard({
      members: [member({ userId: "a" }), member({ userId: "b" })],
      selfUserId: "a"
    });

    expect(rows[0].rank).toBe(rows[1].rank);
    expect(Object.keys(rows[0])).not.toContain("answeredAt");
    expect(Object.keys(rows[0])).not.toContain("completedAt");
  });

  it("is stable between refreshes", () => {
    const members = [
      member({ userId: "b", scoreMilli: 1000 }),
      member({ userId: "a", scoreMilli: 1000 })
    ];

    const first = rankLeaderboard({ members, selfUserId: "a" });
    const second = rankLeaderboard({ members: [...members].reverse(), selfUserId: "a" });

    // Equal scores must not shuffle the list every time it reloads.
    expect(first.map((row) => row.userId)).toEqual(second.map((row) => row.userId));
  });

  it("keeps members who have not scored yet", () => {
    // Hiding them would make a team of six look like a team of two the morning
    // an edition drops — and would hide exactly the people a nudge is for.
    const rows = rankLeaderboard({
      members: [
        member({ userId: "a", scoreMilli: 1000 }),
        member({ userId: "b", scoreMilli: 0, answeredCount: 0 })
      ],
      selfUserId: "a"
    });

    expect(rows).toHaveLength(2);
    expect(rows[1].status).toBe("not_started");
  });

  it("marks the viewer's own row", () => {
    const rows = rankLeaderboard({
      members: [member({ userId: "a" }), member({ userId: "b" })],
      selfUserId: "b"
    });

    expect(findSelf(rows)?.userId).toBe("b");
    expect(rows.filter((row) => row.isSelf)).toHaveLength(1);
  });

  it("returns nothing for an empty team", () => {
    expect(rankLeaderboard({ members: [], selfUserId: "a" })).toEqual([]);
    expect(findSelf([])).toBeNull();
  });
});

describe("blocking", () => {
  const rows = () =>
    rankLeaderboard({
      members: [
        member({ userId: "a", scoreMilli: 2000, username: "augustin" }),
        member({ userId: "b", scoreMilli: 1800, username: "someone" })
      ],
      selfUserId: "a",
      blockedUserIds: new Set(["b"])
    });

  it("does not change anyone's score or rank", () => {
    // A block is a viewing preference, not a way to remove a competitor.
    const [, blocked] = rows();

    expect(blocked.scoreMilli).toBe(1800);
    expect(blocked.rank).toBe(2);
    expect(blocked.isBlocked).toBe(true);
  });

  it("masks the identity and nothing else", () => {
    const [, blocked] = rows();
    const identity = displayIdentity(blocked, { blocked: "Blocked", hidden: "Player" });

    expect(identity.name).toBe("Blocked");
    expect(identity.showAvatar).toBe(false);
    expect(identity.showCountry).toBe(false);
  });

  it("leaves everyone else untouched", () => {
    const [self] = rows();

    expect(displayIdentity(self, { blocked: "Blocked", hidden: "Player" }).name).toBe("augustin");
  });

  it("renders a moderated name without breaking the row", () => {
    const [row] = rankLeaderboard({
      members: [member({ username: null, avatarPath: null })],
      selfUserId: "user-a"
    });

    expect(displayIdentity(row, { blocked: "Blocked", hidden: "Player" })).toEqual({
      name: "Player",
      showAvatar: false,
      showCountry: true
    });
  });
});

describe("presentation", () => {
  it("formats points the way the reader sees them", () => {
    expect(formatTeamPoints(0)).toBe("0");
    expect(formatTeamPoints(300)).toBe("0.3");
    expect(formatTeamPoints(1800)).toBe("1.8");
    expect(formatTeamPoints(12000)).toBe("12");
  });

  it("counts team progress in members, not questions", () => {
    // "4 of 6 finished" is the sentence a captain wants; a question total across
    // members is a number nobody can act on.
    const rows = rankLeaderboard({
      members: [
        member({ userId: "a", answeredCount: 2, assignedCount: 2 }),
        member({ userId: "b", answeredCount: 1, assignedCount: 2 }),
        member({ userId: "c", answeredCount: 0, assignedCount: 2 })
      ],
      selfUserId: "a"
    });

    expect(teamEditionProgress(rows)).toEqual({ completed: 1, total: 3 });
  });
});
