import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { supabase } from "../../lib/supabase";
import {
  AVATAR_QUALITY_STEPS,
  avatarObjectPath,
  base64ByteLength,
  canWriteAvatarPath,
  isAvatarAcceptable,
  isAvatarSmallEnough,
  nextAvatarQuality,
  resizeTargetFor
} from "./avatarPolicy";

/**
 * Picking, shrinking and storing an avatar.
 *
 * The native side of `avatarPolicy.ts`: every rule about size, quality and path
 * lives there, pure and unit-tested, and this file is the camera roll, the
 * encoder and the bucket.
 *
 * PERMISSION IS ASKED ON THE TAP AND NEVER BEFORE. Nothing here runs on mount,
 * so opening the profile screen shows no system dialog. A reader sees "Choose a
 * photo" first and the OS prompt only once they have said what they want — the
 * order that makes a refusal informed rather than reflexive.
 *
 * SUPABASE FREE HAS NO IMAGE TRANSFORMATIONS. Whatever the phone uploads is
 * byte-for-byte what every team-mate downloads, on every leaderboard render,
 * forever. So the shrinking happens here, before the upload, and the loop stops
 * at the first quality step that fits the budget rather than spending quality it
 * did not need to spend.
 */

export type AvatarPickOutcome =
  | { status: "picked"; uri: string; base64: string; bytes: number; width: number; height: number }
  | { status: "cancelled" }
  /** The reader said no, or the OS never asked because it was already denied. */
  | { status: "permission_denied"; canAskAgain: boolean }
  /** Still over the hard maximum after the last quality step. */
  | { status: "too_large"; bytes: number }
  | { status: "failed" };

/**
 * Ask for the photo library, once, at the moment of the tap.
 *
 * `getMediaLibraryPermissionsAsync` first so an already-granted reader never
 * sees a second prompt, and `canAskAgain` is carried out so the screen can
 * offer "Open Settings" rather than a Retry button that can no longer do
 * anything.
 */
async function ensureLibraryPermission(): Promise<
  { ok: true } | { ok: false; canAskAgain: boolean }
> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();

  if (current.granted) {
    return { ok: true };
  }

  if (!current.canAskAgain) {
    return { ok: false, canAskAgain: false };
  }

  const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();

  return requested.granted ? { ok: true } : { ok: false, canAskAgain: requested.canAskAgain };
}

/**
 * Open the library, then shrink what comes back until it fits.
 *
 * A square crop is offered by the picker itself (`allowsEditing` with a 1:1
 * aspect) so the reader frames their own face rather than having a corner of it
 * chosen for them by a centre crop.
 */
export async function pickAndCompressAvatar(): Promise<AvatarPickOutcome> {
  const permission = await ensureLibraryPermission();

  if (!permission.ok) {
    return { status: "permission_denied", canAskAgain: permission.canAskAgain };
  }

  let picked: ImagePicker.ImagePickerResult;

  try {
    picked = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      // 1 here, and the real compression below: asking the picker to compress
      // as well would encode the photo twice and lose quality to a step whose
      // output size we cannot measure before it happens.
      quality: 1,
      exif: false
    });
  } catch {
    return { status: "failed" };
  }

  if (picked.canceled || !picked.assets?.[0]) {
    return { status: "cancelled" };
  }

  return compressAvatar(picked.assets[0]);
}

/**
 * Resize to at most 256px, then step the JPEG quality down until it fits.
 *
 * Rendered once and saved repeatedly: the resize is the expensive operation and
 * re-running it per quality step would decode the original four times over.
 */
export async function compressAvatar(asset: {
  uri: string;
  width?: number | null;
  height?: number | null;
}): Promise<AvatarPickOutcome> {
  try {
    const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    const target = resizeTargetFor({
      width: asset.width ?? 0,
      height: asset.height ?? 0
    });

    if (target) {
      context.resize({ width: target.width });
    }

    const image = await context.renderAsync();

    let quality: number | null = AVATAR_QUALITY_STEPS[0];
    let last: { uri: string; base64: string; bytes: number } | null = null;

    while (quality !== null) {
      const saved = await image.saveAsync({
        base64: true,
        compress: quality,
        format: ImageManipulator.SaveFormat.JPEG
      });

      const base64 = saved.base64 ?? "";
      const bytes = base64ByteLength(base64);

      last = { uri: saved.uri, base64, bytes };

      if (isAvatarSmallEnough(bytes)) {
        break;
      }

      quality = nextAvatarQuality(quality);
    }

    if (!last) {
      return { status: "failed" };
    }

    // The last line of defence: past every quality step and still too big, so
    // the reader is told rather than handed a 413 from Storage.
    if (!isAvatarAcceptable(last.bytes)) {
      return { status: "too_large", bytes: last.bytes };
    }

    return {
      status: "picked",
      uri: last.uri,
      base64: last.base64,
      bytes: last.bytes,
      width: image.width,
      height: image.height
    };
  } catch {
    return { status: "failed" };
  }
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 to bytes, by hand.
 *
 * Hermes has `atob`, but it returns a binary string whose per-character
 * `charCodeAt` round trip is the slow path, and a third-party decoder would be
 * a dependency for thirty lines. `supabase-js` uploads an `ArrayBuffer`
 * unchanged; handing it a string would store the base64 text as the file.
 */
export function decodeBase64(base64: string): Uint8Array {
  const value = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((value.length * 3) / 4));

  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let index = 0; index < value.length; index += 1) {
    const digit = BASE64_ALPHABET.indexOf(value[index]);

    if (digit < 0) {
      continue;
    }

    buffer = (buffer << 6) | digit;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (buffer >> bits) & 0xff;
      byteIndex += 1;
    }
  }

  return bytes.subarray(0, byteIndex);
}

/**
 * A random file id.
 *
 * `crypto.randomUUID` where it exists, and a v4-shaped fallback where it does
 * not. The value is never a secret — it only has to not collide with the
 * reader's previous avatar, so the old one stops being served the moment the
 * profile row points at the new path.
 */
export function newAvatarFileId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;

  if (typeof cryptoRef?.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export type AvatarUploadResult =
  | { status: "uploaded"; path: string }
  | { status: "too_large" }
  | { status: "failed" };

/**
 * Put the compressed bytes in the bucket and return the path to store.
 *
 * The path is `<user id>/<file id>.jpg` — WITHOUT the bucket name, which
 * `from("avatars")` already supplies. A path that repeated it would land at
 * `avatars/<user id>/…` inside the bucket, which is three segments, which
 * `public.avatar_object_owner` returns NULL for, which makes every storage
 * policy false. `canWriteAvatarPath` is checked here so that mistake fails
 * locally with a name rather than remotely as a 403.
 */
export async function uploadAvatar(input: {
  userId: string;
  base64: string;
  bytes: number;
}): Promise<AvatarUploadResult> {
  if (!supabase) {
    return { status: "failed" };
  }

  if (!isAvatarAcceptable(input.bytes)) {
    return { status: "too_large" };
  }

  const path = avatarObjectPath({ userId: input.userId, fileId: newAvatarFileId() });

  if (!canWriteAvatarPath({ path, userId: input.userId })) {
    return { status: "failed" };
  }

  try {
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, decodeBase64(input.base64) as unknown as ArrayBuffer, {
        contentType: "image/jpeg",
        upsert: false
      });

    return error ? { status: "failed" } : { status: "uploaded", path };
  } catch {
    return { status: "failed" };
  }
}
