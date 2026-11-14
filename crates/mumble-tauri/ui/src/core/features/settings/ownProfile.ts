import { invoke } from "@tauri-apps/api/core";
import { dataUrlToBytes, ownCommentOver } from "../../profileFormat";
import type { FancyProfile } from "../../types";
import {
  loadProfileData,
  loadServerProfileData,
  saveProfileData,
  saveServerProfileData,
  type ProfileData,
} from "./profileData";

/**
 * Writing the user's own profile comment.
 *
 * Another client (the native one) may have written fields into the comment
 * that this one does not know, such as `about` and `page`. Writing this
 * client's local copy as it is would drop them and silently revert that
 * client's work, so every write reads the comment the server holds now
 * (asked for, not taken from an event that may not have arrived), keeps
 * what it does not know, and sends nothing when the result says what the
 * server already has.
 */

/** What a write did: the merged profile and text, and whether anything was sent. */
export interface OwnProfileWrite {
  sent: boolean;
  profile: FancyProfile;
  bio: string;
}

/** The comment the server holds for `session` now, fetched if only its hash is known. */
async function currentComment(session: number | null): Promise<string | null> {
  if (session === null || session <= 0) return null;
  return (await invoke<string | null>("get_user_comment", { session })) ?? null;
}

/** Write `profile` and `bio` as the own comment of `session`, merged over what is there. */
export async function writeOwnProfile(
  session: number | null,
  profile: FancyProfile,
  bio: string,
): Promise<OwnProfileWrite> {
  const next = ownCommentOver(await currentComment(session), profile, bio);
  if (next.comment !== null) await invoke("set_user_comment", { comment: next.comment });
  return { sent: next.comment !== null, profile: next.profile, bio: next.bio };
}

/** Whether a write changed what the local copy should hold. */
function changedLocally(before: ProfileData, after: OwnProfileWrite): boolean {
  return (
    before.bio !== after.bio || JSON.stringify(before.profile.opaque) !== JSON.stringify(after.profile.opaque)
  );
}

/**
 * Put the saved profile on an unregistered user's fresh session (the server
 * does not keep it for them), merged over whatever the session already
 * carries, and keep what the merge learned in the local copy, so a later
 * connect with an empty comment still writes the other client's fields.
 */
export async function applySavedProfileOnConnect(
  session: number,
  identityLabel: string | null,
  serverId: string | null,
): Promise<void> {
  const { data, isOverride } = serverId
    ? await loadServerProfileData(serverId, identityLabel)
    : { data: await loadProfileData(identityLabel), isOverride: false };
  const written = await writeOwnProfile(session, data.profile, data.bio);
  if (changedLocally(data, written)) {
    const merged: ProfileData = { ...data, profile: written.profile, bio: written.bio };
    if (isOverride && serverId) await saveServerProfileData(serverId, merged, identityLabel);
    else await saveProfileData(merged, identityLabel);
  }
  const texture = data.avatarDataUrl ? dataUrlToBytes(data.avatarDataUrl) : [];
  if (texture.length > 0) await invoke("set_user_texture", { texture });
}
