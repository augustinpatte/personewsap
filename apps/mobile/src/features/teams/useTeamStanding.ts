import { useCallback, useEffect, useRef, useState } from "react";

import { resolveReaderEditionDate } from "../today/editionCadence";
import { createLatestRequestGate } from "./latestRequest";
import { rankLeaderboard, type LeaderboardRange, type LeaderboardRow } from "./leaderboard";
import { onTeamScoresChanged } from "./teamScoreEvents";
import {
  fetchBlockedUserIds,
  fetchLeaderboard,
  fetchMyStreak,
  fetchTeamDetail,
  type TeamDetail
} from "./teamsData";

/**
 * One Team's standing, as the server holds it right now.
 *
 * `get_team_leaderboard` is recomputed by the server inside the transaction of
 * every answer (team_question_scores -> team_member_edition_scores), so a
 * refetch is always the truth. What this hook guarantees is that the screen
 * asks at the right moments and draws only the newest answer:
 *
 *   on open and on every range switch;
 *   whenever the reader's own answer just scored for a Team (the quiz says so);
 *   whenever the screen calls `load` — a broadcast, a return to the
 *   foreground, a return from another screen.
 *
 * A failed refresh keeps the standing already drawn; only a load with nothing
 * drawn yet becomes the error state.
 */
export function useTeamStanding(input: {
  teamId: string;
  userId: string | null;
  range: LeaderboardRange;
}) {
  const { teamId, userId, range } = input;
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const gateRef = useRef(createLatestRequestGate());
  const hasDataRef = useRef(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = useCallback(
    async (nextRange: LeaderboardRange) => {
      if (!userId) {
        return;
      }

      const ticket = gateRef.current.issue();

      // Four reads, in parallel, once. The header, the standing, the reader's
      // run and their block list are all needed to draw a single frame, and a
      // Realtime nudge should cost one round trip of latency, not four.
      const [leaderboard, blocks, detail, myStreak] = await Promise.all([
        fetchLeaderboard({
          teamId,
          range: nextRange,
          editionDate: nextRange === "all_time" ? null : resolveReaderEditionDate()
        }),
        fetchBlockedUserIds(userId),
        fetchTeamDetail(teamId),
        fetchMyStreak({ teamId, userId })
      ]);

      // An older request answering last must not overwrite a newer one.
      if (!gateRef.current.isLatest(ticket)) {
        return;
      }

      if (!leaderboard.ok || !detail.ok) {
        if (!hasDataRef.current) {
          setStatus("error");
        }
        return;
      }

      const blockedUserIds = blocks.ok ? blocks.data : new Set<string>();

      setTeam(detail.data);
      setStreak(myStreak.ok ? myStreak.data : null);
      // Replaced, never accumulated: the rows are the server's totals.
      setRows(
        rankLeaderboard({
          members: leaderboard.data,
          selfUserId: userId,
          blockedUserIds
        })
      );
      hasDataRef.current = true;
      setStatus("ready");
    },
    [teamId, userId]
  );

  useEffect(() => {
    // A new range is a new question: nothing drawn for the old one may stand
    // in for it.
    hasDataRef.current = false;
    setStatus("loading");
    void load(range);
  }, [load, range]);

  // The reader's own answer just counted for a Team: ask the server now rather
  // than wait for the broadcast to come back round.
  useEffect(() => onTeamScoresChanged(() => void load(rangeRef.current)), [load]);

  return { rows, team, streak, status, load };
}
