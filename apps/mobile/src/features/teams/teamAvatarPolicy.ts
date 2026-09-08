/**
 * Where a Team's photo lives, and who is allowed to put it there.
 *
 * A DELIBERATE SECOND FILE, not a parameter on `avatarPolicy.ts`. The sizing
 * arithmetic is genuinely shared and is imported from there; the PERMISSIONS
 * are not, and that is the whole reason these are separate modules:
 *
 *   a player avatar is owned by the person whose id is its first path segment —
 *   `auth.uid()` decides, and nothing else can;
 *
 *   a Team avatar is owned by a TEAM whose id is its first path segment —
 *   `is_team_owner()` decides who may write it and `is_active_team_member()`
 *   who may read it, neither of which is a fact about the caller alone.
 *
 * Collapsing the two behind one `canWrite(path, id)` would put those two rules
 * one boolean apart, in a file whose job is to be the client's copy of a
 * Storage policy. They stay apart.
 *
 * The budget below is imported rather than restated for the opposite reason:
 * "how many bytes may a 40pt disc cost" has exactly one answer, and a Team
 * photo is rendered at the same size as a member's on the same screens.
 */

export {
  AVATAR_MAX_BYTES as TEAM_AVATAR_MAX_BYTES,
  AVATAR_MAX_DIMENSION as TEAM_AVATAR_MAX_DIMENSION,
  AVATAR_TARGET_BYTES as TEAM_AVATAR_TARGET_BYTES
} from "./avatarPolicy";

/** The bucket. Private, like `avatars`, and never made public for convenience. */
export const TEAM_AVATAR_BUCKET = "team-avatars";

/**
 * `<team id>/<file id>.jpg` — WITHOUT the bucket name, which
 * `from("team-avatars")` already supplies.
 *
 * The first segment is load-bearing rather than tidy: the Storage policy
 * compares it against `public.is_team_owner(...)`, so the path itself is what
 * makes "only this Team's owner may write this object" true. A flat
 * `<random>.jpg` would be unownable and any authenticated user could overwrite
 * any Team's picture.
 */
export function teamAvatarObjectPath(input: { teamId: string; fileId: string }): string {
  return `${input.teamId}/${input.fileId}.jpg`;
}

const TEAM_AVATAR_PATH_PATTERN = /^([0-9a-fA-F-]{36})\/[^/]+$/;

/** `team-avatars/<team id>/<file>` written by any older build resolves back. */
export function stripTeamBucketPrefix(path: string): string {
  return path.trim().replace(/^team-avatars\//, "");
}

/** The team id encoded in a stored path, or null when the path is malformed. */
export function teamOfAvatarPath(path: string): string | null {
  const match = TEAM_AVATAR_PATH_PATTERN.exec(stripTeamBucketPrefix(path));
  return match ? match[1] : null;
}

/**
 * Is this a path the given Team may hold?
 *
 * Mirrors the Storage policy so a bug that built the wrong path shows up here
 * with a name rather than remotely as a 403 nobody can interpret. It answers
 * only the SHAPE question — whether the caller is that Team's owner is decided
 * by Postgres, in the same statement that writes, and never here.
 */
export function isTeamAvatarPathFor(input: { path: string; teamId: string }): boolean {
  return (
    TEAM_AVATAR_PATH_PATTERN.test(input.path.trim()) &&
    teamOfAvatarPath(input.path) === input.teamId
  );
}
