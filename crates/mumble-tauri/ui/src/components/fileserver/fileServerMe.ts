/**
 * Client helpers for a user's *own* shared files ("my shared files").  Thin
 * wrappers over the per-user Tauri proxy commands, scoped server-side to the
 * caller's session JWT so a user only ever sees their own uploads.
 *
 * Mirrors the admin `fileServerAdmin` helpers but hits the `/me/files`
 * endpoints; the preview decode/cache is shared via `previewLoader`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { MyFilesResponse } from "../../types";
import { cachedPreviewText, cachedPreviewUrl, dropPreview } from "./previewLoader";
import type { FilePreviewSource } from "./FilePreview";

/** Base URL + the caller's own session JWT (from the file-server config). */
export interface FileServerCreds {
  readonly baseUrl: string;
  readonly sessionJwt: string;
}

/** Reject after `ms` so a non-responding backend call can't spin forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/** List only the files the caller uploaded. */
export function myListFiles(creds: FileServerCreds): Promise<MyFilesResponse> {
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

/** A [`FilePreviewSource`] backed by the caller's own files. */
export function makeMyFilesSource(creds: FileServerCreds): FilePreviewSource {
  const fetchB64 = (fileId: string, maxBytes: number) => myFileBase64(creds, fileId, maxBytes);
  return {
    loadPreviewUrl: (fileId, mime, maxBytes) => cachedPreviewUrl(fetchB64, fileId, mime, maxBytes),
    loadPreviewText: (fileId, maxBytes) => cachedPreviewText(fetchB64, fileId, maxBytes),
  };
}

export { dropPreview };
