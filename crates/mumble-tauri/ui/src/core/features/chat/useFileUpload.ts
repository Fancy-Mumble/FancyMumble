/**
 * The lifecycle of putting a file on the file server and announcing it.
 *
 * Uploading is not a design decision: pick a file, ask how it may be shared,
 * stream it, watch the progress, then send a message whose body is the marker
 * that the attachment card is drawn from. What a pack decides is where the
 * progress row sits and what the dialog looks like - not the order of those
 * steps, nor what happens when one of them fails.
 *
 * Progress is capped at 99 until the placeholder is removed: the stream is
 * fully consumed well before the server has finished answering, and a bar that
 * sits at 100% while nothing appears reads as a stuck upload.
 */
import { useCallback, useRef, useState } from "react";
import { useAppStore } from "../../store";
import type { FileAccessMode } from "../../types";
import { encodeFileAttachmentMarker, type FileAttachmentInfo } from "./fileAttachments";
import { mimeForFilename } from "./starlingFiles";

/** How the uploader wants this file shared, as answered by the pack's dialog. */
export interface FileShareChoice {
  readonly mode: FileAccessMode;
  readonly password?: string;
  readonly message?: string;
  /** Lifetime in seconds: `undefined` = server default, `0` = never expire. */
  readonly ttlSeconds?: number;
}

/** One upload in flight, or one that failed and is still on screen. */
export interface UploadPlaceholder {
  readonly id: string;
  readonly filename: string;
  readonly state: "uploading" | "error";
  readonly errorMessage?: string;
  /** 0-100, present once the first progress event has arrived. */
  readonly progress?: number;
  /** The file's size on disk, known before a byte has moved. */
  readonly totalBytes?: number;
  /**
   * Seconds left at the rate so far, or absent while there is no rate yet.
   *
   * Measured rather than assumed: the first progress event arrives before any
   * time has passed, and a figure divided by nothing is not "instant".
   */
  readonly etaSeconds?: number;
  /**
   * A local preview of the file, for the kinds that have one.
   *
   * Carried through from whoever staged the file - the uploader is handed a
   * path, and a path is not something an `<img>` can be pointed at.
   */
  readonly previewUrl?: string;
}

/**
 * A file the composer is holding: picked and answered for, not yet sent.
 *
 * Staging is what lets one message carry several files and a sentence about
 * them. The share question is answered per batch rather than per file, so the
 * answer travels with each one from here to the upload it becomes.
 */
export interface StagedAttachment {
  readonly id: string;
  readonly filePath: string;
  readonly filename: string;
  /** Size on disk, absent until the stat comes back. */
  readonly sizeBytes?: number;
  /** A local preview URL, for the kinds that have one. */
  readonly previewUrl?: string;
  /** How this file may be shared, as answered for the batch it arrived in. */
  readonly choice: FileShareChoice;
}

/**
 * How long the rest of this upload will take at the rate it has managed.
 *
 * `undefined` rather than zero when there is nothing to go on: the first
 * progress event lands in the same millisecond the upload started, and
 * "0s left" on a file that has not begun is a worse answer than no answer.
 */
function remainingSeconds(startedAt: number, bytesSent: number, totalBytes: number): number | undefined {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed <= 0 || bytesSent <= 0 || totalBytes <= bytesSent) return undefined;
  return Math.max(1, Math.round((totalBytes - bytesSent) / (bytesSent / elapsed)));
}

function newUploadId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `upload-${Math.random().toString(36).slice(2)}`;
}

export interface FileUploadTarget {
  /** Channel the message announcing the file is sent to. */
  channelId: number | null;
  /** When set, the message is a DM to this session instead. */
  dmSession: number | null;
}

export function useFileUpload({ channelId, dmSession }: FileUploadTarget) {
  const [placeholders, setPlaceholders] = useState<readonly UploadPlaceholder[]>([]);
  const uploading = useRef(false);

  const dismiss = useCallback((id: string) => {
    setPlaceholders((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const upload = useCallback(
    async (
      filePath: string,
      filename: string,
      choice: FileShareChoice,
      /** What the stager already knows about the file, so the row can say it. */
      known: { sizeBytes?: number; previewUrl?: string } = {},
    ) => {
      if (channelId === null) return;
      const id = newUploadId();
      setPlaceholders((prev) => [
        ...prev,
        {
          id,
          filename,
          state: "uploading",
          totalBytes: known.sizeBytes,
          previewUrl: known.previewUrl,
        },
      ]);
      uploading.current = true;
      const startedAt = Date.now();

      let unlisten: (() => void) | undefined;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ uploadId: string; bytesSent: number; totalBytes: number }>(
          "upload-progress",
          (event) => {
            if (event.payload.uploadId !== id) return;
            const { bytesSent, totalBytes } = event.payload;
            const pct = totalBytes > 0 ? Math.min(99, Math.round((bytesSent / totalBytes) * 100)) : 0;
            setPlaceholders((prev) =>
              prev.map((entry) =>
                entry.id === id
                  ? {
                      ...entry,
                      progress: pct,
                      totalBytes: totalBytes > 0 ? totalBytes : entry.totalBytes,
                      etaSeconds: remainingSeconds(startedAt, bytesSent, totalBytes),
                    }
                  : entry,
              ),
            );
          },
        );

        const store = useAppStore.getState();
        const info = await uploadAttachment({ filePath, channelId, filename, uploadId: id, choice });
        const marker = encodeFileAttachmentMarker(info);
        const body = choice.message ? `${choice.message}\n${marker}` : marker;

        if (dmSession !== null) await store.sendDm(dmSession, body);
        else await store.sendMessage(channelId, body);

        setPlaceholders((prev) => prev.filter((entry) => entry.id !== id));
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        // A cancelled upload has already had its row taken away by whoever
        // cancelled it; turning it into an error would put one back.
        if (detail === "upload cancelled") {
          setPlaceholders((prev) => prev.filter((entry) => entry.id !== id));
          return;
        }
        console.error("file upload failed:", e);
        setPlaceholders((prev) =>
          prev.map((entry) =>
            entry.id === id ? { ...entry, state: "error" as const, errorMessage: detail } : entry,
          ),
        );
      } finally {
        unlisten?.();
        uploading.current = false;
      }
    },
    [channelId, dmSession],
  );

  /** Stop an upload in flight and take its row away. */
  const cancel = useCallback((id: string) => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("cancel_upload", { uploadId: id }));
    setPlaceholders((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  return { placeholders, upload, cancel, dismiss, isUploading: () => uploading.current };
}

/**
 * Put one file on whichever kind of file server this is, and describe it.
 *
 * Two servers, one flow. The plugin answers with a link that lasts; the canon
 * service answers with a key and signs a URL per look. Everything from the
 * marker down is the same either way, which is why every pack calls this
 * rather than deciding for itself - see `starlingFiles.ts`.
 */
export async function uploadAttachment({
  filePath,
  channelId,
  filename,
  uploadId,
  choice,
}: {
  filePath: string;
  channelId: number;
  filename: string;
  uploadId: string;
  choice: FileShareChoice;
}): Promise<FileAttachmentInfo> {
  const store = useAppStore.getState();
  return store.fileServerKind === "canon"
    ? await uploadOverCanon(filePath, channelId, filename, uploadId)
    : await uploadOverPlugin(store, filePath, channelId, filename, uploadId, choice);
}

/** Share a file with a server that runs the file-server plugin. */
async function uploadOverPlugin(
  store: ReturnType<typeof useAppStore.getState>,
  filePath: string,
  channelId: number,
  filename: string,
  uploadId: string,
  choice: FileShareChoice,
): Promise<FileAttachmentInfo> {
  const response = await store.uploadFile({
    filePath,
    channelId,
    mode: choice.mode,
    password: choice.password,
    ttlSeconds: choice.ttlSeconds,
    filename,
    uploadId,
  });
  return {
    url: response.download_url,
    filename,
    sizeBytes: response.size_bytes,
    mode: response.access_mode,
    expiresAt: response.expires_at,
  };
}

/**
 * Share a file with a server that speaks the canon.
 *
 * The visibility the dialog asked about is not sent: the canon has no field
 * for it, and the server scopes a file to the channel it was shared in. The
 * marker says `session` for the same reason - it is what "only people here"
 * already means everywhere else in the client.
 */
async function uploadOverCanon(
  filePath: string,
  channelId: number,
  filename: string,
  uploadId: string,
): Promise<FileAttachmentInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  const shared = await invoke<{ key: string; size: number }>("starling_upload_file", {
    filePath,
    channelId,
    mimeType: mimeForFilename(filename),
    uploadId,
  });
  return {
    url: "",
    key: shared.key,
    filename,
    sizeBytes: shared.size,
    mode: "session",
  };
}
