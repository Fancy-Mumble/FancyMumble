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
    async (filePath: string, filename: string, choice: FileShareChoice) => {
      if (channelId === null) return;
      const id = newUploadId();
      setPlaceholders((prev) => [...prev, { id, filename, state: "uploading" }]);
      uploading.current = true;

      let unlisten: (() => void) | undefined;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ uploadId: string; bytesSent: number; totalBytes: number }>(
          "upload-progress",
          (event) => {
            if (event.payload.uploadId !== id) return;
            const pct =
              event.payload.totalBytes > 0
                ? Math.min(99, Math.round((event.payload.bytesSent / event.payload.totalBytes) * 100))
                : 0;
            setPlaceholders((prev) =>
              prev.map((entry) => (entry.id === id ? { ...entry, progress: pct } : entry)),
            );
          },
        );

        const store = useAppStore.getState();
        const response = await store.uploadFile({
          filePath,
          channelId,
          mode: choice.mode,
          password: choice.password,
          ttlSeconds: choice.ttlSeconds,
          filename,
          uploadId: id,
        });

        const info: FileAttachmentInfo = {
          url: response.download_url,
          filename,
          sizeBytes: response.size_bytes,
          mode: response.access_mode,
          expiresAt: response.expires_at,
        };
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
