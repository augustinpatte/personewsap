import { supabase } from "../../lib/supabase";
import { isAvatarAcceptable } from "./avatarPolicy";
import { decodeBase64, newAvatarFileId, type AvatarUploadResult } from "./avatarUpload";
import {
  TEAM_AVATAR_BUCKET,
  isTeamAvatarPathFor,
  stripTeamBucketPrefix,
  teamAvatarObjectPath
} from "./teamAvatarPolicy";

/**
 * Storing and removing a Team's photo.
 *
 * The picking and the compression are shared with the player avatar
 * (`pickAndCompressAvatar`): the camera roll, the square crop, the 256px
 * resize and the quality ladder are identical questions with identical answers,
 * and a second copy of them would be a second thing to keep in step with the
 * bucket's size limit. What is NOT shared is the destination and the
 * permission — a different bucket, and a rule about a Team rather than about a
 * person — which is what this file is.
 */

export async function uploadTeamAvatar(input: {
  teamId: string;
  base64: string;
  bytes: number;
}): Promise<AvatarUploadResult> {
  if (!supabase) {
    return { status: "failed" };
  }

  if (!isAvatarAcceptable(input.bytes)) {
    return { status: "too_large" };
  }

  const path = teamAvatarObjectPath({ teamId: input.teamId, fileId: newAvatarFileId() });

  if (!isTeamAvatarPathFor({ path, teamId: input.teamId })) {
    return { status: "failed" };
  }

  try {
    const { error } = await supabase.storage
      .from(TEAM_AVATAR_BUCKET)
      .upload(path, decodeBase64(input.base64) as unknown as ArrayBuffer, {
        contentType: "image/jpeg",
        upsert: false
      });

    return error ? { status: "failed" } : { status: "uploaded", path };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Remove a Team photo object the Team no longer points at.
 *
 * Called AFTER `set_team_avatar` has written the new path (or NULL), never
 * before, and deliberately not awaited: if it fails the cost is one orphaned
 * 200KB file, whereas the reverse order would leave a Team pointing at an
 * object that no longer exists. Storage RLS already guarantees this can only
 * ever delete an object belonging to a Team the caller owns.
 */
export async function deleteTeamAvatarObject(path: string): Promise<void> {
  if (!supabase) {
    return;
  }

  const objectPath = stripTeamBucketPrefix(path);

  if (objectPath.length === 0) {
    return;
  }

  try {
    await supabase.storage.from(TEAM_AVATAR_BUCKET).remove([objectPath]);
  } catch {
    // Deliberately silent: a failure here costs a file, not the Team's photo.
  }
}
