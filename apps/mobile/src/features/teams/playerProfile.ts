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
 * Three things, and the avatar is one of them. An earlier version made it
 * optional on the reasoning that initials render a row perfectly well — true,
 * and beside the point. A leaderboard is a list of people, and a Team where
 * half the rows are two grey letters is a spreadsheet; the photo is how you
 * recognise the friend you are playing against. So Teams asks for all three
 * once, up front, and never asks again.
 *
 * THE GATE IS STILL ONLY ON TEAMS. A reader who never opens the Teams tab never
 * picks a username and is never shown a photo-library prompt: Newsletter, Mini
 * Cases, Stories, Path, the archive and Settings all work untouched with
 * `profiles.username`, `country_code` and `avatar_path` all NULL.
 */
export function isProfileCompleteForTeams(profile: PlayerProfile): boolean {
  return (
    Boolean(profile.username) && Boolean(profile.countryCode) && Boolean(profile.avatarPath)
  );
}

export type ProfileField = "username" | "country" | "avatar";

export function missingProfileFields(profile: PlayerProfile): ProfileField[] {
  const missing: ProfileField[] = [];

  if (!profile.avatarPath) {
    missing.push("avatar");
  }

  if (!profile.username) {
    missing.push("username");
  }

  if (!profile.countryCode) {
    missing.push("country");
  }

  return missing;
}

/**
 * The two initials a fallback avatar shows.
 *
 * Every leaderboard row has to render whether or not an image exists, loads, or
 * is still being fetched — so this never returns an empty string.
 */
export function initialsFor(username: string | null): string {
  const value = (username ?? "").trim();

  if (value.length === 0) {
    return "?";
  }

  const parts = value.split(/[._\s]+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return value.slice(0, 2).toUpperCase();
}
