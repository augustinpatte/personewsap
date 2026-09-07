/**
 * The shape of an invite code, kept free of any React import so the
 * normalisation is unit tested rather than eyeballed on a device.
 */

/** `generate_team_invite_code()` produces eight uppercase, unambiguous characters. */
export const INVITE_CODE_LENGTH = 8;

/**
 * A code as typed, made into a code as stored.
 *
 * Readers paste codes out of messages, and a message adds spaces, newlines and
 * an occasional dash on the way. Lowercase is what a phone keyboard produces
 * unless the reader fights it. None of that is a wrong code, so none of it is
 * treated as one — refusing "abcd 2345" would be the app inventing a failure
 * the server would not have had.
 */
export function normalizeInviteCode(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, INVITE_CODE_LENGTH);
}

export function isCompleteInviteCode(raw: string): boolean {
  return normalizeInviteCode(raw).length === INVITE_CODE_LENGTH;
}
