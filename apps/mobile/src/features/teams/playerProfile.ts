/**
 * The identity a reader needs before they can appear on a leaderboard.
 *
 * THE GATE IS ONLY ON TEAMS. A reader who never opens the Teams tab never picks
 * a username, and nothing about Newsletter, Mini Cases, Stories, Path, the
 * archive or Settings changes for them. `profile.username` stays NULL and every
 * one of those screens works exactly as it does today — which is why this
 * module exports a predicate rather than a global provider that could creep
 * into the app's boot path.
 *
 * Validation is duplicated with the server on purpose, and the duplication has
 * a direction: this exists to give a fast, local, well-worded refusal. The
 * server's `set_player_identity` is the authority, and it checks uniqueness in
 * the same statement that writes, so two readers racing for the same name
 * cannot both win. A client check can only ever be a courtesy.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * Letters, digits, dot and underscore; must start and end with a letter or
 * digit. Identical to the CHECK constraint in 20260906091000 — a client that
 * accepted a name the column refuses would produce an error nobody can read.
 */
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$/;

export type UsernameProblem =
  | "too_short"
  | "too_long"
  | "invalid_characters"
  | "reserved"
  | "not_allowed";

/**
 * Names that must not become somebody's identity in a leaderboard.
 *
 * Deliberately small and structural rather than a profanity dictionary. A word
 * list in an app bundle is a list of slurs shipped to every device, it is
 * trivially defeated by a character swap, and it produces false positives that
 * insult real names. What is blocked here is impersonation of the product and
 * of moderation itself; genuine abuse is handled by report + the server-side
 * `moderate_player_identity`, which hides a name without destroying any score.
 */
const RESERVED_USERNAMES = new Set([
  "personews",
  "personewsap",
  "admin",
  "administrator",
  "moderator",
  "support",
  "official",
  "staff",
  "system",
  "root",
  "help"
]);

/**
 * A very small set of unambiguous slurs, matched on the normalised string.
 *
 * Kept as fragments rather than words so simple padding does not defeat it, and
 * kept short so it does not start rejecting ordinary names. This is a speed
 * bump on the laziest abuse, and it is documented as such rather than presented
 * as protection.
 */
const BLOCKED_FRAGMENTS = ["fuck", "shit", "nigg", "rape", "nazi", "hitler"];

/** Lowercased, accents stripped, separators removed — what the checks compare. */
export function normalizeForModeration(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function validateUsername(raw: string): UsernameProblem | null {
  const value = raw.trim();

  if (value.length < USERNAME_MIN_LENGTH) {
    return "too_short";
  }

  if (value.length > USERNAME_MAX_LENGTH) {
    return "too_long";
  }

  if (!USERNAME_PATTERN.test(value)) {
    return "invalid_characters";
  }

  const normalized = normalizeForModeration(value);

  if (RESERVED_USERNAMES.has(normalized)) {
    return "reserved";
  }

  if (BLOCKED_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    return "not_allowed";
  }

  return null;
}

export const TEAM_NAME_MIN_LENGTH = 2;
export const TEAM_NAME_MAX_LENGTH = 40;

export type TeamNameProblem = "too_short" | "too_long" | "not_allowed";

export function validateTeamName(raw: string): TeamNameProblem | null {
  const value = raw.trim();

  if (value.length < TEAM_NAME_MIN_LENGTH) {
    return "too_short";
  }

  if (value.length > TEAM_NAME_MAX_LENGTH) {
    return "too_long";
  }

  if (BLOCKED_FRAGMENTS.some((fragment) => normalizeForModeration(value).includes(fragment))) {
    return "not_allowed";
  }

  return null;
}

/** ISO 3166-1 alpha-2, uppercased. Never a coordinate, never an IP lookup. */
export function normalizeCountryCode(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

export type PlayerProfile = {
  username: string | null;
  countryCode: string | null;
  avatarPath: string | null;
};

/**
 * Is this profile ready for Teams?
 *
 * TWO THINGS: a username and a country. The photo is NOT one of them.
 *
 * It was, briefly, on the reasoning that a leaderboard of grey discs is a
 * spreadsheet rather than a list of people. That reasoning cost more than it
 * bought: it put a photo-library permission dialog between a reader and the
 * first Team they were invited to, made "I do not want my face in this app" a
 * refusal to play at all, and turned an optional column into a wall. A friend
 * is recognised by the name they chose — which IS required, is unique, and is
 * on every row — and a photo makes that nicer rather than possible.
 *
 * So the photo is offered on the same screen, in the same session, and can be
 * added, replaced or removed at any point afterwards from Account. What it can
 * never do is stop somebody using Teams.
 *
 * THE GATE IS STILL ONLY ON TEAMS. A reader who never opens the Teams tab never
 * picks a username and is never shown a photo-library prompt: Newsletter, Mini
 * Cases, Stories, Path, the archive and Settings all work untouched with
 * `profiles.username`, `country_code` and `avatar_path` all NULL.
 */
export function isProfileCompleteForTeams(profile: PlayerProfile): boolean {
  return Boolean(profile.username) && Boolean(profile.countryCode);
}

export type ProfileField = "username" | "country";

/**
 * What Teams is still waiting for.
 *
 * Only ever the required fields. A missing avatar is not missing — it is a
 * choice the reader is entitled to make and to keep making — so it is not
 * reported here and never appears in the "Teams needs…" line.
 */
export function missingProfileFields(profile: PlayerProfile): ProfileField[] {
  const missing: ProfileField[] = [];

  if (!profile.username) {
    missing.push("username");
  }

  if (!profile.countryCode) {
    missing.push("country");
  }

  return missing;
}
