/**
 * How an avatar gets small enough to ship.
 *
 * Supabase Free has no Image Transformations, so there is no server-side resize
 * to fall back on: whatever the phone uploads is exactly what every team-mate
 * downloads, forever, on every leaderboard render. A 4MB camera-roll photo
 * would therefore cost 4MB of Storage and 4MB of egress per viewer per fetch,
 * for something drawn at 40 points.
 *
 * So the compression happens on the device, before the upload, and the budget
 * is explicit rather than hoped for. Kept pure and free of any Expo import so
 * the sizing arithmetic and the storage path rules are unit tested without a
 * native module.
 */

/** Drawn at 40pt at most; 256px covers @3x with room to spare. */
export const AVATAR_MAX_DIMENSION = 256;

/** The target the compression loop aims under. */
export const AVATAR_TARGET_BYTES = 200 * 1024;

/** A hard refusal, so a pathological file can never reach Storage. */
export const AVATAR_MAX_BYTES = 400 * 1024;

/**
 * Quality steps, tried in order until the result fits the target.
 *
 * Stepping down beats guessing once: JPEG size is not linear in quality and a
 * single 0.6 pass on a photo of a plain wall wastes quality it did not need to
 * spend, while on a busy photo it is not enough.
 */
export const AVATAR_QUALITY_STEPS = [0.8, 0.6, 0.45, 0.3] as const;

export function nextAvatarQuality(currentQuality: number): number | null {
  const index = AVATAR_QUALITY_STEPS.indexOf(currentQuality as (typeof AVATAR_QUALITY_STEPS)[number]);
  return index >= 0 && index < AVATAR_QUALITY_STEPS.length - 1
    ? AVATAR_QUALITY_STEPS[index + 1]
    : null;
}

export function isAvatarSmallEnough(bytes: number): boolean {
  return bytes <= AVATAR_TARGET_BYTES;
}

export function isAvatarAcceptable(bytes: number): boolean {
  return bytes > 0 && bytes <= AVATAR_MAX_BYTES;
}

/**
 * The resize the picker result needs, if any.
 *
 * Returns null when the image is already small enough — re-encoding a 200px
 * image to 256px would make it larger and blurrier at once.
 */
export function resizeTargetFor(input: { width: number; height: number }): {
  width: number;
} | null {
  const longest = Math.max(input.width, input.height);
  return longest > AVATAR_MAX_DIMENSION ? { width: AVATAR_MAX_DIMENSION } : null;
}

/**
 * Where a user's avatar lives INSIDE the bucket.
 *
 *     <user id>/<file id>.jpg
 *
 * THE BUCKET NAME IS NOT PART OF THE PATH. The object is addressed as
 * `supabase.storage.from("avatars").upload(path)`, so a path of
 * `avatars/<user id>/<file>.jpg` would create `avatars/avatars/<user id>/...`
 * — three segments, which `public.avatar_object_owner` returns NULL for, which
 * makes every storage policy false, which makes every upload a 403 nobody can
 * interpret. The migration is explicit about it: exactly two segments, the
 * first one a user id.
 *
 * That first segment is load-bearing rather than tidy: the Storage policy
 * compares it against `auth.uid()`, so the path itself is what makes "you may
 * only write your own avatar" true. A flat `<random>.jpg` would be unownable
 * and any authenticated user could overwrite any other's picture — which, on a
 * leaderboard where the avatar is how people recognise each other, is an
 * impersonation vector rather than a storage detail.
 */
export function avatarObjectPath(input: { userId: string; fileId: string }): string {
  return `${input.userId}/${input.fileId}.jpg`;
}

const AVATAR_PATH_PATTERN = /^([0-9a-fA-F-]{36})\/[^/]+$/;

/**
 * The owner encoded in a stored path.
 *
 * Tolerates a legacy `avatars/`-prefixed value so a row written by an older
 * build still resolves to its owner and still renders; nothing writes that
 * shape any more.
 */
export function ownerOfAvatarPath(path: string): string | null {
  const match = AVATAR_PATH_PATTERN.exec(stripBucketPrefix(path));
  return match ? match[1] : null;
}

/** `avatars/<uid>/<file>` written by an older build resolves to `<uid>/<file>`. */
export function stripBucketPrefix(path: string): string {
  return path.trim().replace(/^avatars\//, "");
}

/**
 * Is this path one the given user is allowed to write?
 *
 * Mirrors the Storage policy so the client refuses locally instead of firing a
 * request that will be refused anyway — and so a bug that built the wrong path
 * shows up here rather than as a 403 nobody can interpret.
 */
export function canWriteAvatarPath(input: { path: string; userId: string }): boolean {
  return (
    AVATAR_PATH_PATTERN.test(input.path.trim()) &&
    ownerOfAvatarPath(input.path) === input.userId
  );
}

/** Never store a signed URL: it expires, and it is a bearer token in a row. */
export function isStorablePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.includes("..")
  );
}

/**
 * The exact byte length a base64 payload decodes to.
 *
 * The compression loop needs a size before anything is written to disk or sent,
 * and `expo-image-manipulator` hands back base64 rather than a byte count. Four
 * base64 characters carry three bytes; each `=` removes one. Computed rather
 * than measured so the budget is checked before the upload, not after it.
 */
export function base64ByteLength(base64: string): number {
  const value = base64.replace(/[\r\n]/g, "");

  if (value.length === 0) {
    return 0;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}
