import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { PendingAttachment } from "./PendingAttachmentsStrip";

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico",
]);

function fileNameFromPath(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() ?? path;
}

function isImageName(name: string): boolean {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTS.has(ext);
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Build a pending attachment from a Tauri file path. */
function attachmentFromPath(path: string): PendingAttachment {
  const name = fileNameFromPath(path);
  return { id: newId(), path, file: null, name, isImage: isImageName(name) };
}

/** Build a pending attachment from a browser File blob. */
function attachmentFromFile(file: File): PendingAttachment {
  const name = file.name || "file";
  return {
    id: newId(),
    path: null,
    file,
    name,
    isImage: file.type.startsWith("image/") || isImageName(name),
  };
}

interface UseDragDropAttachmentsOptions {
  /** Whether drag-drop should be accepted (e.g. only when a channel is open). */
  readonly enabled: boolean;
}

interface UseDragDropAttachmentsResult {
  readonly attachments: PendingAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>;
  readonly dragActive: boolean;
  readonly addFromFile: (file: File) => void;
  readonly removeAttachment: (id: string) => void;
  readonly clearAttachments: () => void;
}

/**
 * Hook that listens to Tauri's native drag-drop events and exposes
 * pending attachments + a "drag active" flag for overlay rendering.
 */
export function useDragDropAttachments({ enabled }: UseDragDropAttachmentsOptions): UseDragDropAttachmentsResult {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const addFromFile = useCallback((file: File) => {
    setAttachments((prev) => [...prev, attachmentFromFile(file)]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const webview = getCurrentWebview();
        const fn = await webview.onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDragActive(true);
          } else if (event.payload.type === "leave") {
            setDragActive(false);
          } else if (event.payload.type === "drop") {
            setDragActive(false);
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              setAttachments((prev) => [...prev, ...paths.map(attachmentFromPath)]);
            }
          }
        });
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      } catch (e) {
        console.warn("drag-drop listener unavailable:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  return { attachments, setAttachments, dragActive, addFromFile, removeAttachment, clearAttachments };
}
