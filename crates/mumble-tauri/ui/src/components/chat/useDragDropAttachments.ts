import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { PendingAttachment } from "./pending/PendingAttachmentsStrip";
import type { DragRegion } from "./livedoc/liveDocDropStore";

/** Shape of the Tauri native drag-drop event payload we consume. */
type DragDropPayload =
  | { readonly type: "enter" | "over" | "drop"; readonly position?: { readonly x: number; readonly y: number }; readonly paths?: string[] }
  | { readonly type: "leave" };

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
  /** Decide which region a drag at the given viewport CSS coordinates targets.
   *  Defaults to always "chat". */
  readonly resolveTarget?: (x: number, y: number) => DragRegion;
  /** Invoked with dropped items routed to the live doc instead of the chat. */
  readonly onLiveDocFiles?: (items: PendingAttachment[]) => void;
}

interface UseDragDropAttachmentsResult {
  readonly attachments: PendingAttachment[];
  readonly setAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>;
  /** Region currently under the drag, or null when no drag is active. */
  readonly dragTarget: DragRegion;
  readonly addFromFile: (file: File) => void;
  readonly removeAttachment: (id: string) => void;
  readonly clearAttachments: () => void;
}

/**
 * Hook that listens to Tauri's native drag-drop events and exposes
 * pending attachments + the region currently under the drag.  Native
 * file drops are global to the webview, so the target region is resolved
 * from the pointer position via `resolveTarget`.
 */
export function useDragDropAttachments({
  enabled,
  resolveTarget,
  onLiveDocFiles,
}: UseDragDropAttachmentsOptions): UseDragDropAttachmentsResult {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragTarget, setDragTarget] = useState<DragRegion>(null);

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

    const targetAt = (position: { x: number; y: number } | undefined): DragRegion => {
      if (!position) return "chat";
      const dpr = window.devicePixelRatio || 1;
      return resolveTarget?.(position.x / dpr, position.y / dpr) ?? "chat";
    };

    const handleDrop = (region: DragRegion, paths: string[] | undefined): void => {
      if (!paths || paths.length === 0) return;
      const items = paths.map(attachmentFromPath);
      if (region === "livedoc" && onLiveDocFiles) {
        onLiveDocFiles(items);
      } else {
        setAttachments((prev) => [...prev, ...items]);
      }
    };

    const handleEvent = (payload: DragDropPayload): void => {
      if (payload.type === "enter" || payload.type === "over") {
        setDragTarget(targetAt(payload.position));
      } else if (payload.type === "leave") {
        setDragTarget(null);
      } else if (payload.type === "drop") {
        const region = targetAt(payload.position);
        setDragTarget(null);
        handleDrop(region, payload.paths);
      }
    };

    (async () => {
      try {
        const webview = getCurrentWebview();
        const fn = await webview.onDragDropEvent((event) => handleEvent(event.payload));
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
  }, [enabled, resolveTarget, onLiveDocFiles]);

  return { attachments, setAttachments, dragTarget, addFromFile, removeAttachment, clearAttachments };
}
