// react / react-dom resolve to apps/mobile/node_modules (React 19), the copy
// the hooks themselves use — same harness as useArchiveSearch.test.tsx.
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeaderboardMember, LeaderboardRange } from "./leaderboard";

vi.stubGlobal("__DEV__", false);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

/**
 * A Team standing that follows the server, as the reader sees it on Team Detail.
 *
 * The server is scripted: each range returns whatever `server` holds at the
 * moment it is asked, exactly as `get_team_leaderboard` returns the totals the
 * last answer recomputed. The Realtime socket is a double that lets a test send
 * a broadcast, drop and rejoin the channel, and background the app.
 */

const TEAM = "aaaaaaaa-0000-4000-8000-000000000001";
const SELF = "bbbbbbbb-0000-4000-8000-000000000002";
const MATE = "cccccccc-0000-4000-8000-000000000003";

const appStateListeners: Array<(next: string) => void> = [];

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_type: string, listener: (next: string) => void) => {
      appStateListeners.push(listener);
      return {
        remove: () => {
          const index = appStateListeners.indexOf(listener);
          if (index >= 0) appStateListeners.splice(index, 1);
        }
      };
    }
  }
}));

type ChannelDouble = {
  topic: string;
  broadcast?: (message: { payload: unknown }) => void;
  status?: (status: string) => void;
  removed: boolean;
  api: Record<string, unknown>;
};

const channels: ChannelDouble[] = [];

vi.mock("../../lib/supabase", () => ({
  supabase: {
    channel: (topic: string) => {
      const record: ChannelDouble = { topic, removed: false, api: {} };
      const api = {
        on: (_type: string, _filter: unknown, handler: ChannelDouble["broadcast"]) => {
          record.broadcast = handler;
          return api;
        },
        subscribe: (callback: ChannelDouble["status"]) => {
          record.status = callback;
          return api;
        }
      };
      record.api = api;
      channels.push(record);
      return api;
    },
    removeChannel: (api: unknown) => {
      const record = channels.find((channel) => channel.api === api);
      if (record) record.removed = true;
      return Promise.resolve("ok");
    }
  }
}));

function member(userId: string, scoreMilli: number): LeaderboardMember {
  return {
    userId,
    username: userId === SELF ? "me" : "mate",
    countryCode: null,
    avatarPath: null,
    scoreMilli,
    answeredCount: 1,
    assignedCount: 2,
    editionsCompleted: 0,
    status: "in_progress"
  };
}

const server: Record<LeaderboardRange, LeaderboardMember[]> = {
  edition: [],
  week: [],
  all_time: []
};
const leaderboardCalls: Array<{ range: LeaderboardRange; editionDate?: string | null }> = [];
// When set, the next leaderboard answer waits for the test to release it.
let held: Array<() => void> | null = null;

vi.mock("./teamsData", () => ({
  fetchLeaderboard: (input: { range: LeaderboardRange; editionDate?: string | null }) => {
    leaderboardCalls.push({ range: input.range, editionDate: input.editionDate });
    const snapshot = server[input.range].map((row) => ({ ...row }));
    const answer = { ok: true as const, data: snapshot };

    if (held) {
      return new Promise((resolve) => held?.push(() => resolve(answer)));
    }

    return Promise.resolve(answer);
  },
  fetchBlockedUserIds: () => Promise.resolve({ ok: true, data: new Set<string>() }),
  fetchTeamDetail: () =>
    Promise.resolve({ ok: true, data: { id: TEAM, name: "Loyola Finance", memberCount: 2 } }),
  fetchMyStreak: () => Promise.resolve({ ok: true, data: 1 })
}));

vi.mock("../today/editionCadence", () => ({
  resolveReaderEditionDate: () => "2026-09-14"
}));

import { AppState } from "react-native";

import { findSelf } from "./leaderboard";
import { createLatestRequestGate } from "./latestRequest";
import { LEADERBOARD_REFRESH_DEBOUNCE_MS } from "./realtimePolicy";
import { notifyTeamScoresChanged } from "./teamScoreEvents";
import { useTeamLeaderboardChannel } from "./useTeamLeaderboardChannel";
import { useTeamStanding } from "./useTeamStanding";

type Standing = ReturnType<typeof useTeamStanding>;

const latest: { current: Standing | null } = { current: null };
let root: Root | null = null;

/** Team Detail's own wiring: the standing, the channel, and the foreground refetch. */
function TeamDetailProbe({ range }: { range: LeaderboardRange }) {
  const standing = useTeamStanding({ teamId: TEAM, userId: SELF, range });
  const { load } = standing;

  useTeamLeaderboardChannel({ teamId: TEAM, isMember: true, onChanged: () => void load(range) });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void load(range);
      }
    });
    return () => subscription.remove();
  }, [load, range]);

  latest.current = standing;
  return null;
}

function render(range: LeaderboardRange = "edition") {
  root = createRoot(document.createElement("div"));
  act(() => {
    root?.render(<TeamDetailProbe range={range} />);
  });
}

function rerender(range: LeaderboardRange) {
  act(() => {
    root?.render(<TeamDetailProbe range={range} />);
  });
}

async function flush() {
  await act(async () => {
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
  });
}

function standing(): Standing {
  if (!latest.current) throw new Error("not rendered");
  return latest.current;
}

const selfScore = () => findSelf(standing().rows)?.scoreMilli;
const selfRank = () => findSelf(standing().rows)?.rank;
const order = () => standing().rows.map((row) => row.userId);

function broadcast() {
  const channel = channels.find((candidate) => !candidate.removed);
  channel?.broadcast?.({
    payload: { team_id: TEAM, edition_date: "2026-09-14", user_id: MATE, at: "2026-09-14T20:00:00Z" }
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  channels.length = 0;
  appStateListeners.length = 0;
  leaderboardCalls.length = 0;
  held = null;
  server.edition = [member(MATE, 1000), member(SELF, 600)];
  server.week = [member(MATE, 3000), member(SELF, 2600)];
  server.all_time = [member(MATE, 9000), member(SELF, 8600)];
  latest.current = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

describe("8. opening Team Detail shows the server's standing", () => {
  it("fetches on mount, for the current edition", async () => {
    render();
    await flush();

    expect(leaderboardCalls).toEqual([{ range: "edition", editionDate: "2026-09-14" }]);
    expect(standing().status).toBe("ready");
    expect(selfScore()).toBe(600);
  });
});

describe("the standing moves without leaving Teams", () => {
  it("1. the reader's own answer scoring for a Team refetches at once, without a broadcast", async () => {
    render();
    await flush();

    server.edition = [member(MATE, 1000), member(SELF, 1600)];
    act(() => notifyTeamScoresChanged());
    await flush();

    expect(leaderboardCalls).toHaveLength(2);
    expect(selfScore()).toBe(1600);
  });

  it("2. a team-mate's broadcast refreshes the visible standing", async () => {
    render();
    await flush();

    server.edition = [member(MATE, 2000), member(SELF, 600)];
    act(() => broadcast());
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_REFRESH_DEBOUNCE_MS);
    });
    await flush();

    expect(standing().rows.find((row) => row.userId === MATE)?.scoreMilli).toBe(2000);
  });

  it("3. the order and the rank change when the refreshed totals do", async () => {
    render();
    await flush();
    expect(order()).toEqual([MATE, SELF]);
    expect(selfRank()).toBe(2);

    server.edition = [member(MATE, 1000), member(SELF, 1600)];
    act(() => broadcast());
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_REFRESH_DEBOUNCE_MS);
    });
    await flush();

    expect(order()).toEqual([SELF, MATE]);
    expect(selfRank()).toBe(1);
  });

  it.each([
    ["4. Current Edition", "edition" as const, "2026-09-14", 1600],
    ["5. This Week", "week" as const, "2026-09-14", 3600],
    ["6. All Time", "all_time" as const, null, 9600]
  ])("%s is refetched on its own scope", async (_label, range, editionDate, after) => {
    render(range);
    await flush();
    expect(leaderboardCalls.at(-1)).toEqual({ range, editionDate });

    server[range] = server[range].map((row) =>
      row.userId === SELF ? { ...row, scoreMilli: after } : row
    );
    act(() => notifyTeamScoresChanged());
    await flush();

    expect(leaderboardCalls.at(-1)).toEqual({ range, editionDate });
    expect(selfScore()).toBe(after);
  });
});

describe("7. nothing is left stale by a missed event", () => {
  it("refetches when the app returns to the foreground", async () => {
    render();
    await flush();

    // Scored while the app was in the background: the broadcast never arrived.
    server.edition = [member(MATE, 1000), member(SELF, 1600)];
    act(() => appStateListeners.forEach((listener) => listener("background")));
    act(() => appStateListeners.forEach((listener) => listener("active")));
    await flush();

    expect(selfScore()).toBe(1600);
  });

  it("refetches when the channel (re)joins after the network came back", async () => {
    render();
    await flush();

    server.edition = [member(MATE, 1000), member(SELF, 1600)];
    const channel = channels.find((candidate) => !candidate.removed);
    act(() => channel?.status?.("SUBSCRIBED"));
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_REFRESH_DEBOUNCE_MS);
    });
    await flush();

    expect(selfScore()).toBe(1600);
  });

  it("closes the channel in the background and opens a fresh one on return", async () => {
    render();
    await flush();

    act(() => appStateListeners.forEach((listener) => listener("background")));
    expect(channels.every((channel) => channel.removed)).toBe(true);

    act(() => appStateListeners.forEach((listener) => listener("active")));
    expect(channels.filter((channel) => !channel.removed)).toHaveLength(1);
  });
});

describe("9. nothing is ever counted twice", () => {
  it("draws the server's totals, never adds a refresh on top of the last one", async () => {
    render();
    await flush();

    server.edition = [member(MATE, 1000), member(SELF, 1600)];
    act(() => notifyTeamScoresChanged());
    await flush();
    // The broadcast for the same answer lands afterwards.
    act(() => broadcast());
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_REFRESH_DEBOUNCE_MS);
    });
    await flush();

    expect(selfScore()).toBe(1600);
    expect(standing().rows).toHaveLength(2);
  });

  it("turns a burst of broadcasts into one refetch", async () => {
    render();
    await flush();
    const before = leaderboardCalls.length;

    act(() => {
      for (let index = 0; index < 5; index += 1) broadcast();
    });
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_REFRESH_DEBOUNCE_MS);
    });
    await flush();

    expect(leaderboardCalls.length - before).toBe(1);
  });

  it("never lets an older answer overwrite a newer one", async () => {
    render();
    await flush();

    // Edition request held in flight; the reader switches to All Time meanwhile.
    held = [];
    act(() => notifyTeamScoresChanged());
    const slowEdition = held[0];
    held = null;
    rerender("all_time");
    await flush();
    expect(selfScore()).toBe(8600);

    // The older Current Edition answer arrives last. It must not be drawn.
    await act(async () => {
      slowEdition?.();
    });
    await flush();

    expect(selfScore()).toBe(8600);
  });

  it("issues tickets where only the latest may draw", () => {
    const gate = createLatestRequestGate();
    const first = gate.issue();
    const second = gate.issue();

    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });
});
