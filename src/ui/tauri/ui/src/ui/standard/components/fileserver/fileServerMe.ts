/**
 * Client helpers for a user's *own* shared files ("my shared files").  Thin
 * wrappers over the per-user Tauri proxy commands, scoped server-side to the
 * caller's session JWT so a user only ever sees their own uploads.
 *
 * Mirrors the admin `fileServerAdmin` helpers but hits the `/me/files`
 * endpoints; the preview decode/cache is shared via `previewLoader`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { MyFilesResponse } from "@core/types";
import { cachedPreviewText, cachedPreviewUrl, dropPreview } from "@core/features/fileserver/previewLoader";
import type { FilePreviewSource } from "./FilePreview";
import { useAppStore } from "@core/store";
import { canonMyListFiles, canonForgetFile } from "@core/features/chat/starlingManage";
import { canonMediaUrl } from "@core/features/chat/starlingFiles";
import type { FileServerConfig } from "@core/types";

/** Base URL + the caller's own session JWT (from the file-server config). */
export interface FileServerCreds {
  readonly baseUrl: string;
  readonly sessionJwt: string;
}

/**
 * Whether "my shared files" can work against the connected server.
 *
 * Asked here rather than in the panel because the two servers answer it
 * differently, and the difference is not visible from the credentials. The
 * plugin needs its base URL and the caller's session JWT. The canon has
 * neither - `canonFileServerConfig` leaves both blank on purpose, because the
 * whole handshake happens in the backend - so a panel that gated on those read
 * a working file server as an absent one and said so.
 */
export function myFilesAvailable(
  kind: "plugin" | "canon" | null,
  config: FileServerConfig | null,
): boolean {
  if (!config) return false;
  if (kind === "canon") return true;
  return !!(config.baseUrl && config.sessionJwt);
}

/**
 * Whether a file can be handed to the system browser as a public link.
 *
 * Plugin only. A canon share is served through the control connection, so
 * there is no signed URL a browser could open on its own - the action is
 * hidden there rather than offered and refused.
 */
export function myFileLinkSupported(kind: "plugin" | "canon" | null): boolean {
  return kind !== "canon";
}

/** Reject after `ms` so a non-responding backend call can't spin forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * List only the files the caller uploaded.
 *
 * The canon has no session JWT to scope this with, so it matches on the
 * account (or the certificate, for a guest) recorded when the file went up -
 * see `starlingManage`. Same answer, same shape, different question.
 */
export function myListFiles(creds: FileServerCreds): Promise<MyFilesResponse> {
  if (useAppStore.getState().fileServerKind === "canon") {
    return withTimeout(canonMyListFiles(), 15000, "Listing files");
  }
  return withTimeout(
    invoke<MyFilesResponse>("fileserver_my_list_files", {
      request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt },
    }),
    15000,
    "Listing files",
  );
}

/** Delete one of the caller's own files. */
export function deleteMyFile(creds: FileServerCreds, fileId: string): Promise<void> {
  if (useAppStore.getState().fileServerKind === "canon") {
    return canonForgetFile(fileId);
  }
  return invoke("fileserver_my_delete_file", {
    request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt, fileId },
  });
}

/** Get the public, browser-openable signed download URL for one of the caller's
 *  own *public* files.  Rejects for password/session files (which need the app's
 *  auth handshake and can't be opened by a plain browser link). */
export function myFileLink(creds: FileServerCreds, fileId: string): Promise<string> {
  return invoke<string>("fileserver_my_file_link", {
    request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt, fileId },
  });
}

/** Fetch one of the caller's own files' bytes as base64. */
function myFileBase64(creds: FileServerCreds, fileId: string, maxBytes: number): Promise<string> {
  return invoke<string>("fileserver_my_file_base64", {
    request: { baseUrl: creds.baseUrl, sessionJwt: creds.sessionJwt, fileId, maxBytes },
  });
}

/**
 * A [`FilePreviewSource`] backed by the caller's own files.
 *
 * The canon has no base64 endpoint to decode and cache, so it takes the same
 * route the message cards take: `starling_media_url` hands back a loopback
 * address the backend serves ranges on, and the bytes never pass through the
 * page. A file's `id` is its canon key, which is exactly what that call wants.
 */
export function makeMyFilesSource(creds: FileServerCreds): FilePreviewSource {
  if (useAppStore.getState().fileServerKind === "canon") return canonFilesSource();
  const fetchB64 = (fileId: string, maxBytes: number) => myFileBase64(creds, fileId, maxBytes);
  return {
    loadPreviewUrl: (fileId, mime, maxBytes) => cachedPreviewUrl(fetchB64, fileId, mime, maxBytes),
    loadPreviewText: (fileId, maxBytes) => cachedPreviewText(fetchB64, fileId, maxBytes),
  };
}

function canonFilesSource(): FilePreviewSource {
  return {
    loadPreviewUrl: (fileId) => canonMediaUrl(fileId),
    loadPreviewText: async (fileId, maxBytes) => {
      const response = await fetch(await canonMediaUrl(fileId));
      if (!response.ok) throw new Error(`Preview failed (${response.status})`);
      // Trimmed here rather than by asking for less: the address serves ranges
      // for a media element, and a text preview only ever shows the head.
      return (await response.text()).slice(0, maxBytes);
    },
  };
}

export { dropPreview };
