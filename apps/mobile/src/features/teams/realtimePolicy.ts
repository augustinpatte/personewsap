/**
 * When a Realtime channel is allowed to exist.
 *
 * Supabase Free gives 200 concurrent Realtime connections for the whole
 * product. A reader in eight Teams who opened one channel per Team would use
 * four percent of the entire budget by walking into a list screen — twenty-five
 * such readers would exhaust it, and the twenty-sixth person to open the app
 * would silently get no live updates at all.
 *
 * So the rule is narrow and mechanical, and it lives here rather than inside a
 * `useEffect` where it would be a comment nobody can test:
 *
 *   ONE channel, for ONE team, and only while that team's detail screen is
 *   actually on screen. The Teams list opens none. Leaving the screen closes it.
 *
 * There is deliberately no Presence anywhere in this file or in what uses it.
 * Presence is the most expensive Realtime feature per connected client, and the
 * question it answers — who is looking right now — is not one this product
 * asks. "Not started / In progress / Completed" is a fact about answers in the
 * database, not about whether somebody's phone is awake.
 */

/** Must match `public.team_leaderboard_topic(uuid)` exactly. */
export function teamLeaderboardTopic(teamId: string): string {
  return `team:${teamId}:leaderboard`;
}

const TOPIC_PATTERN = /^team:([0-9a-fA-F-]{36}):leaderboard$/;

export function teamIdFromTopic(topic: string): string | null {
  const match = TOPIC_PATTERN.exec(topic.trim());
  return match ? match[1] : null;
}

export type ChannelIntent =
  | { action: "none"; reason: string }
  | { action: "subscribe"; topic: string }
  | { action: "unsubscribe"; topic: string }
  | { action: "resubscribe"; topic: string; previousTopic: string };

/**
 * What should happen to the single channel, given what is on screen.
 *
 * A pure transition so every path — opening, switching teams, backgrounding,
 * leaving — is testable without a socket. The caller applies the answer.
 */
export function resolveChannelIntent(input: {
  /** The team whose detail screen is visible, or null for anything else. */
  visibleTeamId: string | null;
  /** The topic currently subscribed, or null. */
  currentTopic: string | null;
  /** False when the screen is not focused or the app is backgrounded. */
  isActive: boolean;
  /** A non-member has no channel: the server would refuse the subscription. */
  isMember: boolean;
}): ChannelIntent {
  const wanted =
    input.isActive && input.isMember && input.visibleTeamId
      ? teamLeaderboardTopic(input.visibleTeamId)
      : null;

  if (wanted === input.currentTopic) {
    return { action: "none", reason: wanted ? "already subscribed" : "nothing to subscribe" };
  }

  if (wanted && input.currentTopic) {
    // Switching teams without going through the list. One channel at a time,
    // so the old one closes in the same step the new one opens.
    return { action: "resubscribe", topic: wanted, previousTopic: input.currentTopic };
  }

  if (wanted) {
    return { action: "subscribe", topic: wanted };
  }

  return { action: "unsubscribe", topic: input.currentTopic as string };
}

/**
 * The payload a leaderboard broadcast is allowed to carry.
 *
 * A nudge, not a state transfer. The screen re-reads the leaderboard it is
 * already entitled to, which keeps the message tiny, keeps standings off the
 * message bus, and means a dropped or stale message can never leave a client
 * showing a number the database disagrees with.
 */
export type LeaderboardChangeEvent = {
  teamId: string;
  editionDate: string;
  userId: string;
};

const FORBIDDEN_PAYLOAD_KEYS = [
  "score",
  "score_milli",
  "grade",
  "grade_band",
  "rationale",
  "answer",
  "selected_option_id",
  "option_id",
  "attempt",
  "feedback"
];

/**
 * Reject a broadcast that carries more than it should.
 *
 * Defence in depth against the server sending — or a future edit adding — a
 * score or an answer to the payload. A client that silently accepted one would
 * be rendering the answer key.
 */
export function readLeaderboardChange(payload: unknown): LeaderboardChangeEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PAYLOAD_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden))) {
      return null;
    }
  }

  const teamId = typeof record.team_id === "string" ? record.team_id : null;

  if (!teamId) {
    return null;
  }

  return {
    teamId,
    editionDate: typeof record.edition_date === "string" ? record.edition_date : "",
    userId: typeof record.user_id === "string" ? record.user_id : ""
  };
}

/**
 * How long to wait before acting on a burst of events.
 *
 * Five team-mates answering the same question within a second produce five
 * broadcasts; refetching five times would turn a saving into a cost.
 */
export const LEADERBOARD_REFRESH_DEBOUNCE_MS = 800;
