/**
 * Sending a recorded voice message: upload the clip, then post its marker.
 *
 * The upload is the canon file path with a voice flag on it, which is what
 * lets the server check it against its voice-message settings and the
 * `SendVoiceMessage` bit instead of `ShareFiles`. Everything after that is an
 * ordinary file message, so every pack that already draws file markers draws
 * this one too - as a voice note where it knows how, as an audio file where
 * it does not.
 */

import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { encodeFileAttachmentMarker, type FileAttachmentInfo } from "../fileAttachments";

/** A finished take, as `finish_voice_message` hands it over. */
export interface RecordedVoiceClip {
  readonly path: string;
  readonly durationMs: number;
  readonly size: number;
  readonly mimeType: string;
  readonly waveform: readonly number[];
}

/** Where the message goes: a channel, or a DM routed through one. */
export interface VoiceMessageTarget {
  readonly channelId: number;
  readonly dmSession: number | null;
}

/** What the file is called once shared, which is also what others see. */
const SHARED_NAME = "voice-message.ogg";

/** Upload one clip and describe it as a marker would. */
export async function uploadVoiceClip(
  clip: RecordedVoiceClip,
  channelId: number,
): Promise<FileAttachmentInfo> {
  const shared = await invoke<{ key: string; size: number; expiresAt: number }>("starling_upload_file", {
    filePath: clip.path,
    channelId,
    mimeType: clip.mimeType,
    uploadId: `voice-${Date.now().toString(36)}`,
    mode: "session",
    voiceDurationMs: clip.durationMs,
  });
  return {
    url: "",
    key: shared.key,
    filename: SHARED_NAME,
    sizeBytes: shared.size,
    mode: "session",
    expiresAt: shared.expiresAt > 0 ? shared.expiresAt : null,
    voice: { durationMs: clip.durationMs, waveform: clip.waveform },
  };
}

/**
 * Upload the clip, post it, and delete the temporary file either way.
 *
 * The file goes whether or not the send worked: a refused clip is one the
 * user has been told about, and keeping a copy they cannot see would be a
 * recording of them left in a temp folder.
 */
export async function sendVoiceMessage(clip: RecordedVoiceClip, target: VoiceMessageTarget): Promise<void> {
  try {
    const info = await uploadVoiceClip(clip, target.channelId);
    const marker = encodeFileAttachmentMarker(info);
    const store = useAppStore.getState();
    if (target.dmSession !== null) await store.sendDm(target.dmSession, marker);
    else await store.sendMessage(target.channelId, marker);
  } finally {
    await discardVoiceClip(clip);
  }
}

/** Delete a take's temporary file. Never throws: there is nothing to do if it fails. */
export async function discardVoiceClip(clip: RecordedVoiceClip): Promise<void> {
  await invoke("discard_voice_clip", { path: clip.path }).catch(() => {});
}
