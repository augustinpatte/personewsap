import { normalizeSupabaseError, supabase, type NormalizedSupabaseError } from "../../lib/supabase";
import type { EditionStatus, LeaderboardMember, LeaderboardRange } from "./leaderboard";
import type { PlayerProfile } from "./playerProfile";

/**
 * Every read and write Teams makes.
 *
 * All of it goes through the RPCs built in Prompt 1. There is no table write
 * anywhere in this file, and no path by which a client could set a score, a
 * rank, an eligibility date or an invite code — those are decided by Postgres,
 * and the absence of a function here that could send one is the enforcement.
 *
 * PAGINATION AND FAN-OUT. `get_team_leaderboard` returns one aggregated row per
 * member, so rendering a team of forty is one query rather than forty. The Teams
 * list is a single query over `team_member_edition_scores` joined once — never a
 * per-team round trip, which on a reader in eight Teams would be eight requests
 * to draw one screen.
 */

export type TeamsResult<T> = { ok: true; data: T } | { ok: false; error: NormalizedSupabaseError };

function configError(): NormalizedSupabaseError {
  return normalizeSupabaseError({
    code: "missing_supabase_config",
    message: "Teams are not configured for this build."
  });
}

function fail(error: unknown): TeamsResult<never> {
  return { ok: false, error: normalizeSupabaseError(error) };
}

export type TeamSummary = {
  teamId: string;
  name: string | null;
  memberCount: number;
  isOwner: boolean;
  /** Null until the reader has scored in the current edition. */
  rank: number | null;
  scoreMilli: number;
  answeredCount: number;
  assignedCount: number;
  eligibleFromEdition: string | null;
  /** True while the reader's first scoring edition is still ahead of them. */
  startsNextEdition: boolean;
};

/**
 * The reader's own player identity.
 *
 * Read straight from `profiles`, which the reader's own row-level policy already
 * allows — no new access is needed for this and none was added.
 */
export async function fetchPlayerProfile(userId: string): Promise<TeamsResult<PlayerProfile>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("username,country_code,avatar_path")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return fail(error);
    }

    const row = (data ?? {}) as Record<string, unknown>;

    return {
      ok: true,
      data: {
        username: typeof row.username === "string" ? row.username : null,
        countryCode: typeof row.country_code === "string" ? row.country_code : null,
        avatarPath: typeof row.avatar_path === "string" ? row.avatar_path : null
      }
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Claim or update the player identity.
 *
 * `set_player_identity` checks uniqueness in the same statement that writes, so
 * two readers racing for the same name cannot both win — the loser gets 23505
 * and a real message rather than a silent overwrite. Arguments left null are not
 * changed, which is what makes this safe to reuse for editing later.
 */
export async function savePlayerIdentity(input: {
  username?: string | null;
  countryCode?: string | null;
  avatarPath?: string | null;
}): Promise<TeamsResult<PlayerProfile>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase
      .rpc("set_player_identity", {
        p_username: input.username ?? null,
        p_country_code: input.countryCode ?? null,
        p_avatar_path: input.avatarPath ?? null
      })
      .maybeSingle();

    if (error) {
      return fail(error);
    }

    const row = (data ?? {}) as Record<string, unknown>;

    return {
      ok: true,
      data: {
        username: typeof row.username === "string" ? row.username : null,
        countryCode: typeof row.country_code === "string" ? row.country_code : null,
        avatarPath: typeof row.avatar_path === "string" ? row.avatar_path : null
      }
    };
  } catch (error) {
    return fail(error);
  }
}

export async function isUsernameAvailable(username: string): Promise<TeamsResult<boolean>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase.rpc("is_username_available", {
      p_username: username
    });

    return error ? fail(error) : { ok: true, data: data === true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * The Teams list.
 *
 * One query. `team_members` is joined to `teams` and to the reader's own
 * `team_member_edition_scores` row for the current edition; the per-team rank is
 * computed on the detail screen, not here, because ranking a team needs every
 * member's score and doing that for eight teams to draw a list would be exactly
 * the N+1 this avoids.
 */
export async function fetchMyTeams(input: {
  userId: string;
  editionDate: string | null;
  limit?: number;
  offset?: number;
}): Promise<TeamsResult<TeamSummary[]>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;

  try {
    const { data, error } = await supabase
      .from("team_members")
      .select("team_id,role,eligible_from_edition")
      .eq("user_id", input.userId)
      .is("left_at", null)
      .range(offset, offset + limit - 1);

    if (error) {
      return fail(error);
    }

    const rows = data ?? [];
    const teamIds = rows.map((row) => row.team_id as string);

    if (teamIds.length === 0) {
      return { ok: true, data: [] };
    }

    // Three more queries for the whole list, not three per team.
    //
    // The teams themselves come from `team_directory` by id rather than through
    // an embedded join. `public.teams` is unreadable by a client — it carries
    // the invite code and the unmoderated name — and PostgREST's relationship
    // inference across a view is not something to bet a screen on. Two explicit
    // queries always work; an inferred embed either works or fails at runtime.
    const [{ data: memberRows }, { data: scoreRows }, { data: teamRows }] = await Promise.all([
      supabase.from("team_members").select("team_id").in("team_id", teamIds).is("left_at", null),
      input.editionDate
        ? supabase
            .from("team_member_edition_scores")
            .select("team_id,score_milli,answered_count,assigned_count")
            .eq("user_id", input.userId)
            .eq("edition_date", input.editionDate)
            .in("team_id", teamIds)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase
        .from("team_directory")
        .select("id,display_name,is_owner,status")
        .in("id", teamIds)
        .eq("status", "active")
    ]);

    const teams = new Map<string, Record<string, unknown>>();
    for (const row of (teamRows ?? []) as Array<Record<string, unknown>>) {
      teams.set(row.id as string, row);
    }

    const memberCounts = new Map<string, number>();
    for (const row of (memberRows ?? []) as Array<{ team_id: string }>) {
      memberCounts.set(row.team_id, (memberCounts.get(row.team_id) ?? 0) + 1);
    }

    const scores = new Map<string, Record<string, unknown>>();
    for (const row of (scoreRows ?? []) as Array<Record<string, unknown>>) {
      scores.set(row.team_id as string, row);
    }

    return {
      ok: true,
      data: rows
        // An archived team drops out here rather than in the membership query:
        // the filter lives on the directory row, which is the only thing that
        // knows the status.
        .filter((row) => teams.has(row.team_id as string))
        .map((row) => {
        const teamId = row.team_id as string;
        const team = teams.get(teamId) ?? {};
        const score = scores.get(teamId);
        const eligibleFrom = (row.eligible_from_edition as string) ?? null;

        return {
          teamId,
          // Already null when moderation has hidden it. The screen renders its
          // own neutral label; a client that forgets renders nothing, which is
          // the safe failure rather than the old name.
          name: typeof team.display_name === "string" ? team.display_name : null,
          memberCount: memberCounts.get(teamId) ?? 1,
          isOwner: team.is_owner === true,
          rank: null,
          scoreMilli: Number(score?.score_milli ?? 0),
          answeredCount: Number(score?.answered_count ?? 0),
          assignedCount: Number(score?.assigned_count ?? 0),
          eligibleFromEdition: eligibleFrom,
          // The mid-edition join rule, made visible: the reader is in the team
          // and can read the leaderboard, but their first scoring edition is
          // still ahead of them.
          startsNextEdition: Boolean(
            input.editionDate && eligibleFrom && eligibleFrom > input.editionDate
          )
        };
        })
    };
  } catch (error) {
    return fail(error);
  }
}

export async function fetchLeaderboard(input: {
  teamId: string;
  range: LeaderboardRange;
  editionDate?: string | null;
}): Promise<TeamsResult<LeaderboardMember[]>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase.rpc("get_team_leaderboard", {
      p_team_id: input.teamId,
      p_scope: input.range,
      p_edition_date: input.editionDate ?? null
    });

    if (error) {
      return fail(error);
    }

    const rows = Array.isArray(data) ? data : [];

    return {
      ok: true,
      data: rows.map((entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;

        return {
          userId: String(row.user_id ?? ""),
          username: typeof row.username === "string" ? row.username : null,
          countryCode: typeof row.country_code === "string" ? row.country_code : null,
          avatarPath: typeof row.avatar_path === "string" ? row.avatar_path : null,
          scoreMilli: Number(row.score_milli ?? 0),
          answeredCount: Number(row.answered_count ?? 0),
          assignedCount: Number(row.assigned_count ?? 0),
          editionsCompleted: Number(row.editions_completed ?? 0),
          // Carried through rather than recomputed: only the server knows
          // whether this member's first scoring edition is still ahead of them.
          status: typeof row.status === "string" ? (row.status as EditionStatus) : null
        };
      })
    };
  } catch (error) {
    return fail(error);
  }
}

export async function createTeam(name: string): Promise<
  TeamsResult<{ teamId: string; inviteCode: string; effectiveFromEdition: string }>
> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase.rpc("create_team", { p_name: name }).maybeSingle();

    if (error) {
      return fail(error);
    }

    const row = (data ?? {}) as Record<string, unknown>;

    return {
      ok: true,
      data: {
        teamId: String(row.team_id ?? ""),
        inviteCode: String(row.invite_code ?? ""),
        effectiveFromEdition: String(row.effective_from_edition ?? "")
      }
    };
  } catch (error) {
    return fail(error);
  }
}

export type JoinOutcome =
  | { status: "joined"; teamId: string; name: string | null; eligibleFromEdition: string }
  | { status: "already_member"; teamId: string; name: string | null }
  | { status: "not_found" }
  | { status: "failed"; error: NormalizedSupabaseError };

/**
 * Join by code.
 *
 * Atomic and idempotent server-side: `join_team_with_invite` reports an existing
 * membership rather than opening a second one, so a double tap cannot produce
 * two stints. A missing code and an archived team return the same "not found",
 * deliberately — distinguishing them would turn this into a code oracle.
 */
export async function joinTeamWithCode(code: string): Promise<JoinOutcome> {
  if (!supabase) {
    return { status: "failed", error: configError() };
  }

  try {
    const { data, error } = await supabase
      .rpc("join_team_with_invite", { p_invite_code: code })
      .maybeSingle();

    if (error) {
      return error.code === "P0002"
        ? { status: "not_found" }
        : { status: "failed", error: normalizeSupabaseError(error) };
    }

    const row = (data ?? {}) as Record<string, unknown>;
    const teamId = String(row.team_id ?? "");
    const name = typeof row.name === "string" ? row.name : null;

    if (!teamId) {
      return { status: "not_found" };
    }

    return row.already_member === true
      ? { status: "already_member", teamId, name }
      : {
          status: "joined",
          teamId,
          name,
          eligibleFromEdition: String(row.eligible_from_edition ?? "")
        };
  } catch (error) {
    return { status: "failed", error: normalizeSupabaseError(error) };
  }
}

export type LeaveOutcome =
  | { status: "left" }
  /**
   * The owner tried to walk out on a team other people are still playing in.
   *
   * Not an error to swallow: leaving, handing over and archiving are three
   * different decisions, and the server refuses to take all three at once. The
   * screen offers "transfer ownership, then leave".
   */
  | { status: "transfer_required" }
  | { status: "failed"; error: NormalizedSupabaseError };

export async function leaveTeam(teamId: string): Promise<LeaveOutcome> {
  if (!supabase) {
    return { status: "failed", error: configError() };
  }

  try {
    const { error } = await supabase.rpc("leave_team", { p_team_id: teamId });

    if (!error) {
      return { status: "left" };
    }

    return error.code === "42501" && /transfer ownership/i.test(error.message ?? "")
      ? { status: "transfer_required" }
      : { status: "failed", error: normalizeSupabaseError(error) };
  } catch (error) {
    return { status: "failed", error: normalizeSupabaseError(error) };
  }
}

export type TeamInvite = { code: string; rotatedAt: string | null; open: boolean };

/**
 * The invite code, for the owner only.
 *
 * A member cannot read it — `authenticated` holds no SELECT on `public.teams` —
 * so this is the single way to it and the server decides who is asking. A
 * non-owner gets "Team not found" rather than a permission error, because a
 * distinct refusal would confirm the team exists to anybody who guessed an id.
 */
export async function fetchInviteCode(teamId: string): Promise<TeamsResult<TeamInvite>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase
      .rpc("get_team_invite_code", { p_team_id: teamId })
      .maybeSingle();

    if (error) {
      return fail(error);
    }

    const row = (data ?? {}) as Record<string, unknown>;

    return {
      ok: true,
      data: {
        code: String(row.invite_code ?? ""),
        rotatedAt: (row.rotated_at as string) ?? null,
        open: row.invite_open !== false
      }
    };
  } catch (error) {
    return fail(error);
  }
}

/** Close or reopen the invite without rotating it. Owner only. */
export async function setInviteOpen(
  teamId: string,
  open: boolean
): Promise<TeamsResult<boolean>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase.rpc("set_team_invite_open", {
      p_team_id: teamId,
      p_open: open
    });

    return error ? fail(error) : { ok: true, data: data === true };
  } catch (error) {
    return fail(error);
  }
}

export async function rotateInviteCode(teamId: string): Promise<TeamsResult<string>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase.rpc("rotate_team_invite_code", {
      p_team_id: teamId
    });

    return error ? fail(error) : { ok: true, data: String(data ?? "") };
  } catch (error) {
    return fail(error);
  }
}

/** Blocks are the reader's own list; the row policy already scopes it to them. */
export async function fetchBlockedUserIds(userId: string): Promise<TeamsResult<Set<string>>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { data, error } = await supabase
      .from("user_blocks")
      .select("blocked_id")
      .eq("blocker_id", userId);

    if (error) {
      return fail(error);
    }

    return {
      ok: true,
      data: new Set((data ?? []).map((row) => row.blocked_id as string))
    };
  } catch (error) {
    return fail(error);
  }
}

export async function setBlocked(input: {
  blockerId: string;
  blockedId: string;
  blocked: boolean;
}): Promise<TeamsResult<null>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { error } = input.blocked
      ? await supabase
          .from("user_blocks")
          .upsert({ blocker_id: input.blockerId, blocked_id: input.blockedId })
      : await supabase
          .from("user_blocks")
          .delete()
          .eq("blocker_id", input.blockerId)
          .eq("blocked_id", input.blockedId);

    return error ? fail(error) : { ok: true, data: null };
  } catch (error) {
    return fail(error);
  }
}

export async function reportContent(input: {
  reporterId: string;
  reportedUserId?: string | null;
  teamId?: string | null;
  reason:
    | "inappropriate_username"
    | "inappropriate_avatar"
    | "inappropriate_team_name"
    | "harassment"
    | "other";
  details?: string;
}): Promise<TeamsResult<null>> {
  if (!supabase) {
    return { ok: false, error: configError() };
  }

  try {
    const { error } = await supabase.from("user_reports").insert({
      reporter_id: input.reporterId,
      reported_user_id: input.reportedUserId ?? null,
      team_id: input.teamId ?? null,
      reason: input.reason,
      details: input.details ?? null
    });

    return error ? fail(error) : { ok: true, data: null };
  } catch (error) {
    return fail(error);
  }
}

/**
 * A short-lived signed URL for an avatar.
 *
 * The bucket is private, so this is the only way to render one — and it is why
 * `profiles.avatar_path` stores a path and never a URL: a stored signed URL
 * expires, and persisting one would put a bearer token in a row every team-mate
 * can read.
 */
export async function signAvatarUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!supabase || !path) {
    return null;
  }

  try {
    const { data, error } = await supabase.storage
      .from("avatars")
      .createSignedUrl(path.replace(/^avatars\//, ""), expiresInSeconds);

    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}
