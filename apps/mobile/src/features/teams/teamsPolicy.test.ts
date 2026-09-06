import { describe, expect, it } from "vitest";

import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_DIMENSION,
  AVATAR_TARGET_BYTES,
  avatarObjectPath,
  canWriteAvatarPath,
  isAvatarAcceptable,
  isAvatarSmallEnough,
  isStorablePath,
  nextAvatarQuality,
  ownerOfAvatarPath,
  resizeTargetFor
} from "./avatarPolicy";
import {
  LEADERBOARD_REFRESH_DEBOUNCE_MS,
  readLeaderboardChange,
  resolveChannelIntent,
  teamIdFromTopic,
  teamLeaderboardTopic
} from "./realtimePolicy";

/**
 * The two places Free-plan discipline is actually enforced.
 *
 * Supabase Free has no Image Transformations, so whatever the phone uploads is
 * what every team-mate downloads forever — and 200 concurrent Realtime
 * connections for the entire product, so a channel per Team would be spent by
 * twenty-five readers walking into a list screen.
 */

const TEAM_ID = "e1e1e1e1-0000-4000-8000-000000000001";
const USER_ID = "aaaa0000-0000-4000-8000-00000000000a";

describe("avatar budget", () => {
  it("targets a size a leaderboard can afford to fetch repeatedly", () => {
    expect(AVATAR_TARGET_BYTES).toBeLessThanOrEqual(250 * 1024);
    expect(AVATAR_MAX_DIMENSION).toBe(256);
  });

  it("refuses a pathological file outright", () => {
    expect(isAvatarAcceptable(4 * 1024 * 1024)).toBe(false);
    expect(isAvatarAcceptable(AVATAR_MAX_BYTES)).toBe(true);
    expect(isAvatarAcceptable(0)).toBe(false);
  });

  it("knows when to stop compressing", () => {
    expect(isAvatarSmallEnough(150 * 1024)).toBe(true);
    expect(isAvatarSmallEnough(300 * 1024)).toBe(false);
  });

  it("steps quality down rather than guessing once", () => {
    // JPEG size is not linear in quality: one 0.6 pass overspends on a plain
    // photo and underspends on a busy one.
    expect(nextAvatarQuality(0.8)).toBe(0.6);
    expect(nextAvatarQuality(0.45)).toBe(0.3);
    expect(nextAvatarQuality(0.3)).toBeNull();
  });

  it("does not upscale an already small image", () => {
    // Re-encoding a 200px image to 256px makes it larger and blurrier at once.
    expect(resizeTargetFor({ width: 200, height: 200 })).toBeNull();
    expect(resizeTargetFor({ width: 4032, height: 3024 })).toEqual({ width: 256 });
    expect(resizeTargetFor({ width: 300, height: 4000 })).toEqual({ width: 256 });
  });
});

describe("avatar ownership", () => {
  it("puts the user id first in the path", () => {
    // Load-bearing: the Storage policy compares this segment against auth.uid(),
    // so the path itself is what makes "only your own avatar" true.
    const path = avatarObjectPath({ userId: USER_ID, fileId: "abc123" });

    expect(path).toBe(`avatars/${USER_ID}/abc123.jpg`);
    expect(ownerOfAvatarPath(path)).toBe(USER_ID);
  });

  it("lets a user write only their own path", () => {
    const mine = avatarObjectPath({ userId: USER_ID, fileId: "a" });
    const theirs = avatarObjectPath({
      userId: "bbbb0000-0000-4000-8000-00000000000b",
      fileId: "a"
    });

    expect(canWriteAvatarPath({ path: mine, userId: USER_ID })).toBe(true);
    expect(canWriteAvatarPath({ path: theirs, userId: USER_ID })).toBe(false);
  });

  it("refuses an unownable flat path", () => {
    // avatars/<random>.jpg would let any authenticated user overwrite any other.
    expect(ownerOfAvatarPath("avatars/anything.jpg")).toBeNull();
    expect(canWriteAvatarPath({ path: "avatars/anything.jpg", userId: USER_ID })).toBe(false);
  });

  it("refuses traversal and nested paths", () => {
    expect(ownerOfAvatarPath(`avatars/${USER_ID}/../other/1.jpg`)).toBeNull();
  });

  it("never stores a URL", () => {
    // A signed URL expires and is a bearer token in a row.
    expect(isStorablePath(`avatars/${USER_ID}/a.jpg`)).toBe(true);
    expect(isStorablePath("https://example.supabase.co/storage/v1/object/sign/x")).toBe(false);
    expect(isStorablePath("avatars/../../etc/passwd")).toBe(false);
    expect(isStorablePath("")).toBe(false);
  });
});

describe("the realtime topic", () => {
  it("matches the server's team_leaderboard_topic exactly", () => {
    // Both sides have to agree on this string or the subscription is refused.
    expect(teamLeaderboardTopic(TEAM_ID)).toBe(`team:${TEAM_ID}:leaderboard`);
    expect(teamIdFromTopic(teamLeaderboardTopic(TEAM_ID))).toBe(TEAM_ID);
  });

  it("rejects a malformed topic instead of throwing", () => {
    for (const topic of ["team::leaderboard", "team:not-a-uuid:leaderboard", "", "other"]) {
      expect(teamIdFromTopic(topic), topic).toBeNull();
    }
  });
});

describe("one channel, only while a team detail is open", () => {
  it("opens nothing on the Teams list", () => {
    // A reader in eight Teams would otherwise use four percent of the entire
    // product's Realtime budget by walking into a list screen.
    const intent = resolveChannelIntent({
      visibleTeamId: null,
      currentTopic: null,
      isActive: true,
      isMember: true
    });

    expect(intent.action).toBe("none");
  });

  it("subscribes when a team detail becomes visible", () => {
    const intent = resolveChannelIntent({
      visibleTeamId: TEAM_ID,
      currentTopic: null,
      isActive: true,
      isMember: true
    });

    expect(intent).toEqual({ action: "subscribe", topic: teamLeaderboardTopic(TEAM_ID) });
  });

  it("unsubscribes when the screen is left", () => {
    const intent = resolveChannelIntent({
      visibleTeamId: null,
      currentTopic: teamLeaderboardTopic(TEAM_ID),
      isActive: true,
      isMember: true
    });

    expect(intent).toEqual({ action: "unsubscribe", topic: teamLeaderboardTopic(TEAM_ID) });
  });

  it("unsubscribes when the app is backgrounded", () => {
    const intent = resolveChannelIntent({
      visibleTeamId: TEAM_ID,
      currentTopic: teamLeaderboardTopic(TEAM_ID),
      isActive: false,
      isMember: true
    });

    expect(intent.action).toBe("unsubscribe");
  });

  it("closes the old channel in the same step it opens a new one", () => {
    const other = "e2e2e2e2-0000-4000-8000-000000000002";
    const intent = resolveChannelIntent({
      visibleTeamId: other,
      currentTopic: teamLeaderboardTopic(TEAM_ID),
      isActive: true,
      isMember: true
    });

    expect(intent).toEqual({
      action: "resubscribe",
      topic: teamLeaderboardTopic(other),
      previousTopic: teamLeaderboardTopic(TEAM_ID)
    });
  });

  it("opens nothing for a non-member", () => {
    // The server would refuse the subscription anyway; not asking is cheaper
    // and produces no error to explain.
    const intent = resolveChannelIntent({
      visibleTeamId: TEAM_ID,
      currentTopic: null,
      isActive: true,
      isMember: false
    });

    expect(intent.action).toBe("none");
  });

  it("does nothing when the wanted channel is already open", () => {
    const intent = resolveChannelIntent({
      visibleTeamId: TEAM_ID,
      currentTopic: teamLeaderboardTopic(TEAM_ID),
      isActive: true,
      isMember: true
    });

    expect(intent.action).toBe("none");
  });
});

describe("the broadcast payload", () => {
  it("accepts the minimal nudge", () => {
    expect(
      readLeaderboardChange({ team_id: TEAM_ID, edition_date: "2026-09-06", user_id: USER_ID })
    ).toEqual({ teamId: TEAM_ID, editionDate: "2026-09-06", userId: USER_ID });
  });

  it("refuses anything carrying a score, a grade or an answer", () => {
    // Defence in depth: a future server edit that added a score to the payload
    // must not silently start rendering the answer key.
    for (const extra of [
      { score_milli: 1000 },
      { grade_band: "excellent" },
      { selected_option_id: "a" },
      { rationale: "because" },
      { attempt_id: "x", feedback: "y" }
    ]) {
      expect(
        readLeaderboardChange({ team_id: TEAM_ID, ...extra }),
        JSON.stringify(extra)
      ).toBeNull();
    }
  });

  it("refuses a payload with no team", () => {
    expect(readLeaderboardChange({})).toBeNull();
    expect(readLeaderboardChange(null)).toBeNull();
    expect(readLeaderboardChange("nope")).toBeNull();
  });

  it("debounces a burst rather than refetching per event", () => {
    // Five team-mates answering within a second produce five broadcasts;
    // refetching five times would turn a saving into a cost.
    expect(LEADERBOARD_REFRESH_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
  });
});

describe("no Presence anywhere", () => {
  it("is absent from the policy surface", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const source = readFileSync(join(__dirname, "realtimePolicy.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(source).not.toMatch(/presence/i);
    expect(source).not.toMatch(/postgres_changes/i);
  });
});
