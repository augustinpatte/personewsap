/**
 * Turning edition scores into a standing.
 *
 * Kept pure and free of any Supabase import so the whole ranking contract is
 * unit tested rather than eyeballed against live data — the same split the rest
 * of this codebase uses between a rules module and its I/O.
 *
 * THREE RANGES, and no more. Current Edition, This Week, All Time. There are no
 * divisions, no tiers and no Bronze/Silver/Gold: a Team is a private league
 * between friends, and inventing a ladder inside a group of five people would
 * be a different product.
 *
 * TIES ARE ALLOWED AND ARE NOT BROKEN. Two members on 1,800 points are both
 * second, and the next member is fourth. Standard competition ranking, because
 * the alternative — inventing a tie-break on completion time — would smuggle a
 * speed bonus into a product that deliberately has none.
 */

export type LeaderboardRange = "edition" | "week" | "all_time";

export const LEADERBOARD_RANGES: LeaderboardRange[] = ["edition", "week", "all_time"];

/** What a member did with the edition in front of them. */
export type EditionStatus = "not_started" | "in_progress" | "completed";

export type LeaderboardMember = {
  userId: string;
  username: string | null;
  countryCode: string | null;
  avatarPath: string | null;
  scoreMilli: number;
  answeredCount: number;
  assignedCount: number;
  editionsCompleted: number;
  /** Consecutive editions finished. Null when not computed for this range. */
  streak?: number | null;
};

export type LeaderboardRow = LeaderboardMember & {
  rank: number;
  status: EditionStatus;
  isSelf: boolean;
  /** True when the viewer has blocked this member. Identity is masked, score is not. */
  isBlocked: boolean;
};

/**
 * Where a member is in the current edition.
 *
 * Read from the database — how many of their assigned questions are settled —
 * and never from a presence channel. "In progress" means they answered one of
 * three questions, not that their phone is currently awake, and conflating the
 * two would make the column lie every time somebody locked their screen.
 */
export function editionStatus(input: {
  answeredCount: number;
  assignedCount: number;
}): EditionStatus {
  if (input.assignedCount <= 0 || input.answeredCount <= 0) {
    return "not_started";
  }

  return input.answeredCount >= input.assignedCount ? "completed" : "in_progress";
}

/**
 * Standard competition ranking: 1, 2, 2, 4.
 *
 * Members who have not scored yet still appear — a leaderboard that hid them
 * would make a team of six look like a team of two on the morning an edition
 * drops, and would hide exactly the people a nudge is for.
 */
export function rankLeaderboard(input: {
  members: LeaderboardMember[];
  selfUserId: string;
  /** User ids the viewer has blocked. Their identity is masked, never their score. */
  blockedUserIds?: Set<string>;
}): LeaderboardRow[] {
  const blocked = input.blockedUserIds ?? new Set<string>();

  const sorted = [...input.members].sort((a, b) => {
    if (b.scoreMilli !== a.scoreMilli) {
      return b.scoreMilli - a.scoreMilli;
    }

    // Not a tie-break — the ranks below stay equal. This only makes the render
    // order stable so the list does not shuffle between refreshes.
    return a.userId.localeCompare(b.userId);
  });

  let lastScore: number | null = null;
  let lastRank = 0;

  return sorted.map((member, index) => {
    const rank = member.scoreMilli === lastScore ? lastRank : index + 1;
    lastScore = member.scoreMilli;
    lastRank = rank;

    return {
      ...member,
      rank,
      status: editionStatus(member),
      isSelf: member.userId === input.selfUserId,
      isBlocked: blocked.has(member.userId)
    };
  });
}

/** The viewer's own row, for the summary above the list. */
export function findSelf(rows: LeaderboardRow[]): LeaderboardRow | null {
  return rows.find((row) => row.isSelf) ?? null;
}

/**
 * What a blocked member's row shows.
 *
 * The score is untouched: a block is a viewing preference, not a way to remove a
 * competitor, and a leaderboard that quietly dropped somebody's points would be
 * lying to everyone else about the standing. Only the identity is neutralised,
 * and only for the person who blocked them.
 */
export function displayIdentity(
  row: LeaderboardRow,
  labels: { blocked: string; hidden: string }
): { name: string; showAvatar: boolean; showCountry: boolean } {
  if (row.isBlocked) {
    return { name: labels.blocked, showAvatar: false, showCountry: false };
  }

  // A moderated name is null from the server; the row still has to render.
  return {
    name: row.username ?? labels.hidden,
    showAvatar: Boolean(row.avatarPath),
    showCountry: Boolean(row.countryCode)
  };
}

/** Points as the reader sees them: 0 / 0.3 / 1.8 / 12. */
export function formatTeamPoints(scoreMilli: number): string {
  const points = scoreMilli / 1000;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/**
 * How far the team as a whole is through the edition.
 *
 * Members, not questions: "4 of 6 finished" is the sentence a captain wants,
 * and summing questions across members produces a number nobody can act on.
 */
export function teamEditionProgress(rows: LeaderboardRow[]): {
  completed: number;
  total: number;
} {
  return {
    completed: rows.filter((row) => row.status === "completed").length,
    total: rows.length
  };
}
